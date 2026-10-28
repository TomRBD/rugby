// Chaîne vidéo réelle : téléversement en 2 parties, assemblage, transcodage HLS, analyse audio, synchro d'angles, export MP4.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { construireApp } from '../src/app.js';
import { fermerPools, poolAdmin } from '../src/lib/db.js';
import { TACHES } from '../src/worker/taches.js';
import { executer, FFMPEG } from '../src/worker/ffmpeg.js';
import { stockage } from '../src/lib/stockage.js';

let app: FastifyInstance;
let tmp: string;
const SIFFLETS = [5, 12, 18, 27, 33];

async function genererVideo(fichier: string, debut: number, duree: number) {
  const sifflets = SIFFLETS.map((s) => `between(t+${debut},${s},${s + 0.8})`).join('+');
  await executer(FFMPEG, ['-hide_banner', '-y',
    '-f', 'lavfi', '-i', `testsrc2=size=1280x720:rate=25:duration=${duree}`,
    '-f', 'lavfi', '-i', `aevalsrc='0.5*sin(2*PI*3400*t)*(${sifflets})+0.02*(random(0)-0.5)':s=44100:d=${duree}`,
    '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', fichier]);
}

let clubTest = '';
async function executerJobs(type: string) {
  const jobs = (await poolAdmin.query("SELECT * FROM jobs WHERE type = $1 AND statut = 'en_attente' AND club_id = $2", [type, clubTest])).rows;
  for (const j of jobs) {
    await TACHES[type](j);
    await poolAdmin.query("UPDATE jobs SET statut = 'termine' WHERE id = $1", [j.id]);
  }
  return jobs.length;
}

describe('worker vidéo', () => {
  let jeton: string, club: string, match: string, video: string;
  const api = async (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) => {
    const r = await app.inject({ method: method as any, url, headers: { authorization: `Bearer ${jeton}`, ...headers }, ...(body !== undefined ? { payload: body as any } : {}) });
    return { statut: r.statusCode, json: (() => { try { return r.json(); } catch { return null; } })() };
  };

  beforeAll(async () => {
    app = await construireApp();
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rugby-test-'));
    const r = await app.inject({ method: 'POST', url: '/api/auth/inscription', payload: { nom: 'Vidéo', email: 'video@club.fr', motDePasse: 'motdepasse', club: { nom: 'RC Vidéo' } } });
    jeton = r.json().jeton;
    club = r.json().utilisateur.clubs[0].id;
    clubTest = club;
    await api('POST', `/api/clubs/${club}/abonnement`, { offre: 'pro' });
    const saison = (await api('GET', `/api/clubs/${club}/saisons`)).json[0].id;
    const eq = (await api('POST', `/api/clubs/${club}/equipes`, { saison_id: saison, nom: 'Séniors' })).json.id;
    match = (await api('POST', `/api/clubs/${club}/matchs`, { equipe_id: eq, date: '2026-10-25T15:00:00Z' })).json.id;
  });

  afterAll(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
    await app.close();
    await fermerPools();
  });

  it('assemble et transcode deux fichiers découpés', async () => {
    await genererVideo(path.join(tmp, 'p1.mp4'), 0, 20);
    await genererVideo(path.join(tmp, 'p2.mp4'), 20, 20);
    const fichiers = [await fs.readFile(path.join(tmp, 'p1.mp4')), await fs.readFile(path.join(tmp, 'p2.mp4'))];
    const v = await api('POST', `/api/clubs/${club}/matchs/${match}/videos`, { parties: fichiers.map((f, i) => ({ nom_fichier: `GOPR000${i}.MP4`, taille: f.length })) });
    expect(v.statut).toBe(200);
    video = v.json.video.id;
    for (const [i, p] of v.json.parties.entries()) {
      const f = fichiers[i];
      for (let o = 0; o < f.length; o += 200_000) {
        const r = await api('PUT', `/api/clubs/${club}/videos/${video}/parties/${p.id}?offset=${o}`, f.subarray(o, o + 200_000), { 'content-type': 'application/octet-stream' });
        expect(r.statut).toBe(200);
      }
    }
    expect((await api('POST', `/api/clubs/${club}/videos/${video}/terminer`)).statut).toBe(200);
    expect(await executerJobs('transcodage')).toBe(1);
    const lecture = await api('GET', `/api/clubs/${club}/videos/${video}/lecture`);
    expect(lecture.json.pret).toBe(true);
    expect(lecture.json.duree).toBeGreaterThan(39);
    const master = await app.inject({ method: 'GET', url: lecture.json.url });
    expect(master.statusCode).toBe(200);
    expect(master.body).toContain('720p/index.m3u8');
    expect(master.body).not.toContain('1080p');
    const seg = await app.inject({ method: 'GET', url: lecture.json.url.replace('master.m3u8', '480p/seg00000.ts'), headers: { range: 'bytes=0-99' } });
    expect(seg.statusCode).toBe(206);
    expect(seg.rawPayload.length).toBe(100);
    // Jeton falsifié refusé
    expect((await app.inject({ method: 'GET', url: lecture.json.url.replace(/\/media\/[^.]+/, '/media/abc') })).statusCode).toBe(403);
  }, 120000);

  it('propose le coup d\'envoi par détection du sifflet', async () => {
    expect(await executerJobs('analyse_ia')).toBe(1);
    const props = (await api('GET', `/api/clubs/${club}/matchs/${match}/propositions`)).json;
    const ce = props.find((p: any) => p.type === 'coup_envoi_1');
    expect(ce).toBeTruthy();
    expect(Math.abs(ce.debut - 5)).toBeLessThan(0.3);
    // Validation humaine : le repère est appliqué au match
    expect((await api('POST', `/api/clubs/${club}/propositions/${ce.id}/valider`, { id: crypto.randomUUID() })).statut).toBe(200);
    const m = (await api('GET', `/api/clubs/${club}/matchs/${match}`)).json;
    expect(Math.abs(m.coup_envoi_1 - 5)).toBeLessThan(0.3);
  }, 60000);

  it('synchronise un second angle sur les sifflets', async () => {
    // Angle décalé : la caméra 2 démarre 3 s après la principale
    const f = path.join(tmp, 'angle2.mp4');
    await executer(FFMPEG, ['-hide_banner', '-y', '-ss', '3', '-i', path.join(tmp, 'p1.mp4'), '-c', 'copy', f]);
    const contenu = await fs.readFile(f);
    const v = await api('POST', `/api/clubs/${club}/matchs/${match}/videos`, { angle: 'Tribune', parties: [{ nom_fichier: 'angle2.mp4', taille: contenu.length }] });
    await api('PUT', `/api/clubs/${club}/videos/${v.json.video.id}/parties/${v.json.parties[0].id}?offset=0`, contenu, { 'content-type': 'application/octet-stream' });
    await api('POST', `/api/clubs/${club}/videos/${v.json.video.id}/terminer`);
    await executerJobs('transcodage');
    await poolAdmin.query("DELETE FROM jobs WHERE type = 'analyse_ia'");
    expect((await api('POST', `/api/clubs/${club}/videos/${v.json.video.id}/synchroniser`)).statut).toBe(200);
    await executerJobs('synchro_angles');
    const d = (await poolAdmin.query('SELECT decalage FROM videos WHERE id = $1', [v.json.video.id])).rows[0].decalage;
    expect(Math.abs(d - 3)).toBeLessThan(0.2);
  }, 120000);

  it('exporte une playlist en MP4 9:16 avec incrustations', async () => {
    const ev = crypto.randomUUID();
    await api('POST', `/api/clubs/${club}/matchs/${match}/evenements/sync`, { evenements: [{ id: ev, type_key: 'essai', camp: 'nous', debut: 20, fin: 22 }] });
    const p = await api('POST', `/api/clubs/${club}/playlists`, { titre: 'Essais', match_id: match, evenements: [ev] });
    expect(p.json.clips).toHaveLength(1);
    const e = await api('POST', `/api/clubs/${club}/playlists/${p.json.id}/export`, { format: '9:16', filigrane: 'Jean Dupont' });
    expect(e.statut).toBe(200);
    await executerJobs('export_video');
    const fin = await api('GET', `/api/clubs/${club}/exports/${e.json.id}`);
    expect(fin.json.statut).toBe('termine');
    expect(await stockage.taille(fin.json.cle_stockage)).toBeGreaterThan(10_000);
  }, 120000);
});
