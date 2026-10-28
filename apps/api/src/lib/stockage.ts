// Stockage objet : dossier local (dev, petit serveur) ou S3 compatible (Scaleway, OVHcloud, MinIO).
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  S3Client, GetObjectCommand, PutObjectCommand, HeadObjectCommand, ListObjectsV2Command, DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { config } from './config.js';

export interface LectureObjet {
  flux: Readable;
  taille: number;
  debut: number;
  fin: number;
  tailleTotale: number;
}

export interface Stockage {
  ecrire(cle: string, donnees: Buffer | string): Promise<void>;
  /** Écrit un morceau d'un téléversement reprenable. */
  ecrireMorceau(cle: string, offset: number, donnees: Buffer): Promise<void>;
  /** Reconstitue un fichier téléversé par morceaux. */
  assemblerMorceaux(cle: string, destination: string): Promise<void>;
  lire(cle: string, plage?: { debut: number; fin?: number }): Promise<LectureObjet | null>;
  lireTexte(cle: string): Promise<string | null>;
  taille(cle: string): Promise<number | null>;
  telechargerVersFichier(cle: string, destination: string): Promise<void>;
  televerserFichier(source: string, cle: string): Promise<void>;
  televerserDossier(dossier: string, prefixe: string): Promise<void>;
  supprimerPrefixe(prefixe: string): Promise<void>;
  /** Chemin disque direct si disponible (évite une copie pour FFmpeg). */
  cheminLocal(cle: string): string | null;
}

const sur = (cle: string) => {
  const n = path.posix.normalize(cle);
  if (n.startsWith('..') || path.isAbsolute(n)) throw new Error('Clé de stockage invalide');
  return n;
};

class StockageLocal implements Stockage {
  constructor(private racine: string) {}
  private p(cle: string) {
    return path.join(this.racine, sur(cle));
  }
  cheminLocal(cle: string) {
    return this.p(cle);
  }
  async ecrire(cle: string, d: Buffer | string) {
    await fsp.mkdir(path.dirname(this.p(cle)), { recursive: true });
    await fsp.writeFile(this.p(cle), d);
  }
  async ecrireMorceau(cle: string, offset: number, d: Buffer) {
    const f = this.p(cle);
    await fsp.mkdir(path.dirname(f), { recursive: true });
    const h = await fsp.open(f, fs.existsSync(f) ? 'r+' : 'w');
    try {
      await h.write(d, 0, d.length, offset);
    } finally {
      await h.close();
    }
  }
  async assemblerMorceaux(cle: string, destination: string) {
    if (path.resolve(destination) !== path.resolve(this.p(cle))) await fsp.copyFile(this.p(cle), destination);
  }
  async lire(cle: string, plage?: { debut: number; fin?: number }) {
    const f = this.p(cle);
    const st = await fsp.stat(f).catch(() => null);
    if (!st?.isFile()) return null;
    const debut = plage?.debut ?? 0;
    const fin = Math.min(plage?.fin ?? st.size - 1, st.size - 1);
    return { flux: fs.createReadStream(f, { start: debut, end: fin }), taille: fin - debut + 1, debut, fin, tailleTotale: st.size };
  }
  async lireTexte(cle: string) {
    return fsp.readFile(this.p(cle), 'utf8').catch(() => null);
  }
  async taille(cle: string) {
    const st = await fsp.stat(this.p(cle)).catch(() => null);
    return st ? st.size : null;
  }
  async telechargerVersFichier(cle: string, dest: string) {
    await fsp.copyFile(this.p(cle), dest);
  }
  async televerserFichier(src: string, cle: string) {
    await fsp.mkdir(path.dirname(this.p(cle)), { recursive: true });
    if (path.resolve(src) !== path.resolve(this.p(cle))) await fsp.copyFile(src, this.p(cle));
  }
  async televerserDossier(dossier: string, prefixe: string) {
    await fsp.mkdir(this.p(prefixe), { recursive: true });
    await fsp.cp(dossier, this.p(prefixe), { recursive: true });
  }
  async supprimerPrefixe(prefixe: string) {
    await fsp.rm(this.p(prefixe), { recursive: true, force: true });
  }
}

class StockageS3 implements Stockage {
  private s3: S3Client;
  private bucket: string;
  constructor() {
    const c = config.storage.s3;
    this.bucket = c.bucket;
    this.s3 = new S3Client({
      endpoint: c.endpoint, region: c.region, forcePathStyle: true,
      credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey },
    });
  }
  cheminLocal() {
    return null;
  }
  async ecrire(cle: string, d: Buffer | string) {
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: sur(cle), Body: d }));
  }
  // Chaque morceau est un objet distinct nommé par son offset (reprise idempotente)
  async ecrireMorceau(cle: string, offset: number, d: Buffer) {
    await this.ecrire(`${cle}.morceaux/${String(offset).padStart(15, '0')}`, d);
  }
  private async lister(prefixe: string): Promise<string[]> {
    const cles: string[] = [];
    let token: string | undefined;
    do {
      const r = await this.s3.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefixe, ContinuationToken: token }));
      for (const o of r.Contents ?? []) if (o.Key) cles.push(o.Key);
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
    return cles.sort();
  }
  async assemblerMorceaux(cle: string, destination: string) {
    const out = fs.createWriteStream(destination);
    for (const k of await this.lister(`${sur(cle)}.morceaux/`)) {
      const r = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: k }));
      await pipeline(r.Body as Readable, out, { end: false });
    }
    await new Promise<void>((res, rej) => out.end((e?: Error | null) => (e ? rej(e) : res())));
  }
  async lire(cle: string, plage?: { debut: number; fin?: number }) {
    try {
      const Range = plage ? `bytes=${plage.debut}-${plage.fin ?? ''}` : undefined;
      const r = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: sur(cle), Range }));
      const taille = r.ContentLength ?? 0;
      const total = r.ContentRange ? Number(r.ContentRange.split('/')[1]) : taille;
      const debut = plage?.debut ?? 0;
      return { flux: r.Body as Readable, taille, debut, fin: debut + taille - 1, tailleTotale: total };
    } catch {
      return null;
    }
  }
  async lireTexte(cle: string) {
    const r = await this.lire(cle);
    if (!r) return null;
    const morceaux: Buffer[] = [];
    for await (const m of r.flux) morceaux.push(Buffer.from(m));
    return Buffer.concat(morceaux).toString('utf8');
  }
  async taille(cle: string) {
    try {
      const r = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: sur(cle) }));
      return r.ContentLength ?? 0;
    } catch {
      return null;
    }
  }
  async telechargerVersFichier(cle: string, dest: string) {
    const r = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: sur(cle) }));
    await pipeline(r.Body as Readable, fs.createWriteStream(dest));
  }
  async televerserFichier(src: string, cle: string) {
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: sur(cle), Body: fs.createReadStream(src), ContentLength: (await fsp.stat(src)).size }));
  }
  async televerserDossier(dossier: string, prefixe: string) {
    const fichiers = await fsp.readdir(dossier, { recursive: true, withFileTypes: true });
    const liste = fichiers.filter((f) => f.isFile()).map((f) => path.join(f.parentPath, f.name));
    // Envoi parallèle par paquets de 16
    for (let i = 0; i < liste.length; i += 16) {
      await Promise.all(liste.slice(i, i + 16).map((f) => this.televerserFichier(f, path.posix.join(prefixe, path.relative(dossier, f).split(path.sep).join('/')))));
    }
  }
  async supprimerPrefixe(prefixe: string) {
    const cles = await this.lister(sur(prefixe));
    for (let i = 0; i < cles.length; i += 1000) {
      await this.s3.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: cles.slice(i, i + 1000).map((Key) => ({ Key })) } }));
    }
  }
}

export const stockage: Stockage = config.storage.driver === 's3' ? new StockageS3() : new StockageLocal(config.storage.dir);
