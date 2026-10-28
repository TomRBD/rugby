import crypto from 'node:crypto';
import { config } from './config.js';

// Mots de passe : scrypt avec sel aléatoire
export function hacherMotDePasse(mdp: string): string {
  const sel = crypto.randomBytes(16);
  const h = crypto.scryptSync(mdp, sel, 64);
  return `scrypt$${sel.toString('base64')}$${h.toString('base64')}`;
}

export function verifierMotDePasse(mdp: string, stocke: string): boolean {
  const [algo, sel, h] = stocke.split('$');
  if (algo !== 'scrypt') return false;
  const attendu = Buffer.from(h, 'base64');
  const calc = crypto.scryptSync(mdp, Buffer.from(sel, 'base64'), attendu.length);
  return crypto.timingSafeEqual(attendu, calc);
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

function signer(data: string, secret = config.secret): string {
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

function egal(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// Jetons de session (JWT HS256)
export interface JetonSession {
  sub: string; // utilisateur
  mfa: boolean; // MFA vérifiée pendant cette session
  exp: number;
}

export function creerJwt(payload: Omit<JetonSession, 'exp'>, dureeSecondes = 60 * 60 * 24 * 14): string {
  const entete = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const corps = b64url(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + dureeSecondes }));
  return `${entete}.${corps}.${signer(`${entete}.${corps}`)}`;
}

export function verifierJwt(jeton: string): JetonSession | null {
  const [e, c, s] = jeton.split('.');
  if (!e || !c || !s || !egal(signer(`${e}.${c}`), s)) return null;
  try {
    const p = JSON.parse(Buffer.from(c, 'base64url').toString()) as JetonSession;
    return p.exp > Date.now() / 1000 ? p : null;
  } catch {
    return null;
  }
}

// Jetons opaques (partage, invitation) : seul le hash est stocké
export const jetonAleatoire = () => crypto.randomBytes(24).toString('base64url');
export const hacherJeton = (j: string) => crypto.createHash('sha256').update(j).digest('hex');

// URLs média signées et expirables : /media/<jeton>/master.m3u8
// Le jeton est dans le chemin pour que les segments HLS relatifs en héritent.
export function signerMedia(prefixe: string, dureeSecondes = 6 * 3600, filigrane?: string): string {
  const exp = Math.floor(Date.now() / 1000) + dureeSecondes;
  const corps = b64url(JSON.stringify({ p: prefixe, exp, f: filigrane }));
  return `${corps}.${signer(corps, config.secret + ':media')}`;
}

export function verifierMedia(jeton: string): { prefixe: string; filigrane?: string } | null {
  const [corps, sig] = jeton.split('.');
  if (!corps || !sig || !egal(signer(corps, config.secret + ':media'), sig)) return null;
  try {
    const p = JSON.parse(Buffer.from(corps, 'base64url').toString());
    return p.exp > Date.now() / 1000 ? { prefixe: p.p, filigrane: p.f } : null;
  } catch {
    return null;
  }
}

// TOTP (RFC 6238) pour la double authentification admin et médical
const ALPHABET_B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function secretTotp(): string {
  const octets = crypto.randomBytes(20);
  let bits = '';
  for (const o of octets) bits += o.toString(2).padStart(8, '0');
  let s = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) s += ALPHABET_B32[parseInt(bits.slice(i, i + 5), 2)];
  return s;
}

function decoderB32(s: string): Buffer {
  let bits = '';
  for (const c of s.replace(/=+$/, '').toUpperCase()) bits += ALPHABET_B32.indexOf(c).toString(2).padStart(5, '0');
  const out: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}

export function codeTotp(secret: string, instant = Date.now(), pas = 30): string {
  const compteur = Buffer.alloc(8);
  compteur.writeBigUInt64BE(BigInt(Math.floor(instant / 1000 / pas)));
  const h = crypto.createHmac('sha1', decoderB32(secret)).update(compteur).digest();
  const o = h[h.length - 1] & 0xf;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, '0');
}

export function verifierTotp(secret: string, code: string): boolean {
  const now = Date.now();
  return [-1, 0, 1].some((d) => egal(codeTotp(secret, now + d * 30000), code.trim()));
}

// Chiffrement AES-256-GCM des données de santé (clé distincte)
const cleSante = () => Buffer.from(config.healthKey, 'hex');

export function chiffrer(donnees: unknown): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', cleSante(), iv);
  const chiffre = Buffer.concat([c.update(JSON.stringify(donnees), 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), chiffre].map((b) => b.toString('base64')).join('.');
}

export function dechiffrer<T = unknown>(s: string): T {
  const [iv, tag, data] = s.split('.').map((x) => Buffer.from(x, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', cleSante(), iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(data), d.final()]).toString('utf8'));
}
