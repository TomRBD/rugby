import type { FastifyInstance } from 'fastify';
import path from 'node:path';
import { z } from 'zod';
import { OFFRES } from '@rugby/shared';
import { avec, contexte, exigerFonction, journaliser, matchAccessible, valider, uuid } from '../lib/contexte.js';
import { nonTrouve, quotaAtteint, requeteInvalide } from '../lib/erreurs.js';
import { stockage } from '../lib/stockage.js';
import { signerMedia, verifierMedia } from '../lib/securite.js';
import { enfiler } from '../lib/jobs.js';

const MORCEAU_MAX = 32 * 1024 * 1024;
const EXTENSIONS = ['.mp4', '.mov', '.mkv', '.avi', '.m4v', '.mts', '.ts'];

export const prefixeVideo = (clubId: string, videoId: string) => `clubs/${clubId}/videos/${videoId}`;

const TYPES_MIME: Record<string, string> = {
  '.m3u8': 'application/vnd.apple.mpegurl', '.ts': 'video/mp2t', '.m4s': 'video/iso.segment', '.mp4': 'video/mp4',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.webm': 'audio/webm', '.ogg': 'audio/ogg', '.json': 'application/json', '.vtt': 'text/vtt',
};

export default async function routesVideos(app: FastifyInstance) {
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit: MORCEAU_MAX + 1024 }, (_req, body, done) => done(null, body));

  app.post('/api/clubs/:clubId/matchs/:id/videos', async (req) => {
    const ctx = await contexte(req, 'video.ecrire');
    const { id } = valider(z.object({ id: uuid }), req.params);
    const b = valider(z.object({
      angle: z.string().min(1).default('Principal'),
      parties: z.array(z.object({ nom_fichier: z.string().min(1), taille: z.number().int().positive() })).min(1).max(40),
      conserver_original: z.boolean().optional(),
    }), req.body);
    for (const p of b.parties) {
      if (!EXTENSIONS.includes(path.extname(p.nom_fichier).toLowerCase())) throw requeteInvalide(`Format non pris en charge : ${p.nom_fichier} (MP4, MOV, MKV, AVI)`);
    }
    return avec(ctx, async (db) => {
      await matchAccessible(db, ctx, id, 'video.ecrire');
      if (b.angle !== 'Principal') {
        const n = Number((await db.query('SELECT count(*) FROM videos WHERE match_id = $1', [id])).rows[0].count);
        if (n > 0) exigerFonction(ctx, 'multi_angles');
      }
      const heures = OFFRES[ctx.offre].heuresVideo;
      if (heures !== null) {
        const u = Number((await db.query("SELECT coalesce(sum(duree),0)/3600 AS h FROM videos WHERE statut <> 'archive'")).rows[0].h);
        if (u >= heures) throw quotaAtteint(`Quota vidéo atteint (${heures} h) : archivez d'anciens matchs ou changez d'offre`);
      }
      const v = (await db.query(
        'INSERT INTO videos (club_id, match_id, angle, conserver_original) VALUES ($1,$2,$3,$4) RETURNING *',
        [ctx.clubId, id, b.angle, b.conserver_original ?? true],
      )).rows[0];
      const parties = [];
      for (const [i, p] of b.parties.entries()) {
        const cle = `${prefixeVideo(ctx.clubId, v.id)}/original/${String(i).padStart(2, '0')}${path.extname(p.nom_fichier).toLowerCase()}`;
        parties.push((await db.query(
          'INSERT INTO video_parties (club_id, video_id, ordre, nom_fichier, taille, cle_stockage) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, ordre, nom_fichier, taille, recu',
          [ctx.clubId, v.id, i, p.nom_fichier, p.taille, cle],
        )).rows[0]);
      }
      return { video: v, parties, tailleMorceau: 8 * 1024 * 1024 };
    });
  });

  // Import depuis un lien (YouTube/Vimeo non listé, Drive, Dropbox, exports Veo, Pixellot, Spiideo, Hudl)
  app.post('/api/clubs/:clubId/matchs/:id/videos/import', async (req) => {
    const ctx = await contexte(req, 'video.ecrire');
    const { id } = valider(z.object({ id: uuid }), req.params);
    const b = valider(z.object({ url: z.string().url(), angle: z.string().default('Principal') }), req.body);
    return avec(ctx, async (db) => {
      await matchAccessible(db, ctx, id, 'video.ecrire');
      const v = (await db.query(
        "INSERT INTO videos (club_id, match_id, angle, statut, source, source_url) VALUES ($1,$2,$3,'en_attente','url',$4) RETURNING *",
        [ctx.clubId, id, b.angle, b.url],
      )).rows[0];
      await enfiler(db, ctx.clubId, 'import_url', { videoId: v.id, url: b.url });
      return v;
    });
  });

  // Téléversement reprenable : HEAD/GET donne l'offset reçu, PUT envoie un morceau à un offset
  app.get('/api/clubs/:clubId/videos/:vid/parties/:pid', async (req) => {
    const ctx = await contexte(req, 'video.ecrire');
    const { pid } = valider(z.object({ vid: uuid, pid: uuid }), req.params);
    return avec(ctx, async (db) => {
      const p = (await db.query('SELECT id, recu, taille FROM video_parties WHERE id = $1', [pid])).rows[0];
      if (!p) throw nonTrouve('Partie');
      return p;
    });
  });

  app.put('/api/clubs/:clubId/videos/:vid/parties/:pid', async (req) => {
    const ctx = await contexte(req, 'video.ecrire');
    const { vid, pid } = valider(z.object({ vid: uuid, pid: uuid }), req.params);
    const offset = Number((req.query as { offset?: string }).offset ?? NaN);
    const morceau = req.body as Buffer;
    if (!Buffer.isBuffer(morceau) || !Number.isInteger(offset) || offset < 0) throw requeteInvalide('Morceau invalide');
    return avec(ctx, async (db) => {
      const p = (await db.query('SELECT * FROM video_parties WHERE id = $1 AND video_id = $2 FOR UPDATE', [pid, vid])).rows[0];
      if (!p) throw nonTrouve('Partie');
      if (offset > p.recu) throw requeteInvalide(`Offset attendu : ${p.recu}`);
      if (offset + morceau.length > p.taille) throw requeteInvalide('Morceau au-delà de la taille annoncée');
      await stockage.ecrireMorceau(p.cle_stockage, offset, morceau);
      const recu = Math.max(p.recu, offset + morceau.length);
      await db.query('UPDATE video_parties SET recu = $2 WHERE id = $1', [pid, recu]);
      return { recu, taille: p.taille };
    });
  });

  app.post('/api/clubs/:clubId/videos/:vid/terminer', async (req) => {
    const ctx = await contexte(req, 'video.ecrire');
    const { vid } = valider(z.object({ vid: uuid }), req.params);
    return avec(ctx, async (db) => {
      const v = (await db.query('SELECT * FROM videos WHERE id = $1 FOR UPDATE', [vid])).rows[0];
      if (!v) throw nonTrouve('Vidéo');
      const incompletes = (await db.query('SELECT nom_fichier FROM video_parties WHERE video_id = $1 AND recu < taille', [vid])).rows;
      if (incompletes.length) throw requeteInvalide(`Téléversement incomplet : ${incompletes.map((p) => p.nom_fichier).join(', ')}`);
      if (v.statut === 'televersement') {
        await db.query("UPDATE videos SET statut = 'en_attente' WHERE id = $1", [vid]);
        await enfiler(db, ctx.clubId, 'transcodage', { videoId: vid });
      }
      return { ok: true };
    });
  });

  // Relance du traitement d'une vidéo en erreur (par exemple après installation de FFmpeg)
  app.post('/api/clubs/:clubId/videos/:vid/relancer', async (req) => {
    const ctx = await contexte(req, 'video.ecrire');
    const { vid } = valider(z.object({ vid: uuid }), req.params);
    return avec(ctx, async (db) => {
      const v = (await db.query('SELECT * FROM videos WHERE id = $1 FOR UPDATE', [vid])).rows[0];
      if (!v) throw nonTrouve('Vidéo');
      await matchAccessible(db, ctx, v.match_id, 'video.ecrire');
      if (v.statut !== 'erreur') throw requeteInvalide('Seule une vidéo en erreur peut être relancée');
      const incompletes = (await db.query('SELECT 1 FROM video_parties WHERE video_id = $1 AND recu < taille', [vid])).rowCount;
      if (incompletes) throw requeteInvalide('Envoi incomplet : resélectionnez le fichier pour terminer l\'envoi');
      await db.query("UPDATE videos SET statut = 'en_attente', erreur = NULL, etape = NULL, progression = 0 WHERE id = $1", [vid]);
      // Import par lien déjà téléchargé : seul le transcodage est à refaire
      const telecharge = (await db.query('SELECT 1 FROM video_parties WHERE video_id = $1', [vid])).rowCount;
      if (v.source === 'url' && !telecharge) await enfiler(db, ctx.clubId, 'import_url', { videoId: vid, url: v.source_url });
      else await enfiler(db, ctx.clubId, 'transcodage', { videoId: vid });
      return { ok: true };
    });
  });

  app.patch('/api/clubs/:clubId/videos/:vid', async (req) => {
    const ctx = await contexte(req, 'video.ecrire');
    const { vid } = valider(z.object({ vid: uuid }), req.params);
    const b = valider(z.object({ angle: z.string().optional(), decalage: z.number().optional(), conserver_original: z.boolean().optional() }), req.body);
    return avec(ctx, async (db) => {
      const v = (await db.query('SELECT * FROM videos WHERE id = $1', [vid])).rows[0];
      if (!v) throw nonTrouve('Vidéo');
      await matchAccessible(db, ctx, v.match_id, 'video.ecrire');
      const r = await db.query(
        'UPDATE videos SET angle = coalesce($2, angle), decalage = coalesce($3, decalage), conserver_original = coalesce($4, conserver_original) WHERE id = $1 RETURNING *',
        [vid, b.angle ?? null, b.decalage ?? null, b.conserver_original ?? null],
      );
      if (b.conserver_original === false && v.statut === 'pret') await stockage.supprimerPrefixe(`${prefixeVideo(ctx.clubId, vid)}/original`);
      return r.rows[0];
    });
  });

  // Synchronisation automatique d'un angle sur le principal (détection audio du sifflet / clap)
  app.post('/api/clubs/:clubId/videos/:vid/synchroniser', async (req) => {
    const ctx = await contexte(req, 'video.ecrire');
    exigerFonction(ctx, 'multi_angles');
    const { vid } = valider(z.object({ vid: uuid }), req.params);
    return avec(ctx, async (db) => {
      const v = (await db.query('SELECT * FROM videos WHERE id = $1', [vid])).rows[0];
      if (!v) throw nonTrouve('Vidéo');
      const principale = (await db.query("SELECT id FROM videos WHERE match_id = $1 AND id <> $2 AND statut = 'pret' ORDER BY (angle = 'Principal') DESC LIMIT 1", [v.match_id, vid])).rows[0];
      if (!principale) throw requeteInvalide('Aucune vidéo de référence prête');
      return { job: await enfiler(db, ctx.clubId, 'synchro_angles', { videoId: vid, referenceId: principale.id }) };
    });
  });

  app.delete('/api/clubs/:clubId/videos/:vid', async (req) => {
    const ctx = await contexte(req, 'video.ecrire');
    const { vid } = valider(z.object({ vid: uuid }), req.params);
    return avec(ctx, async (db) => {
      const v = (await db.query('SELECT * FROM videos WHERE id = $1', [vid])).rows[0];
      if (!v) throw nonTrouve('Vidéo');
      await matchAccessible(db, ctx, v.match_id, 'video.ecrire');
      await db.query('DELETE FROM videos WHERE id = $1', [vid]);
      await stockage.supprimerPrefixe(prefixeVideo(ctx.clubId, vid));
      await journaliser(db, ctx, 'suppression', 'videos', vid);
      return { ok: true };
    });
  });

  // URL de lecture signée et expirable
  app.get('/api/clubs/:clubId/videos/:vid/lecture', async (req) => {
    const ctx = await contexte(req, 'match.lire');
    const { vid } = valider(z.object({ vid: uuid }), req.params);
    return avec(ctx, async (db) => {
      const v = (await db.query('SELECT * FROM videos WHERE id = $1', [vid])).rows[0];
      if (!v) throw nonTrouve('Vidéo');
      await matchAccessible(db, ctx, v.match_id, 'match.lire');
      return urlLecture(ctx.clubId, v);
    });
  });

  // Service des fichiers média (HLS, vignettes, exports) avec prise en charge des plages (Range)
  app.get('/media/:jeton/*', async (req, reply) => {
    const { jeton } = req.params as { jeton: string; '*': string };
    const fichier = (req.params as Record<string, string>)['*'];
    const ok = verifierMedia(jeton);
    if (!ok) return reply.code(403).send({ erreur: 'Lien expiré ou invalide' });
    const cle = path.posix.normalize(path.posix.join(ok.prefixe, fichier));
    if (!cle.startsWith(ok.prefixe)) return reply.code(403).send({ erreur: 'Chemin refusé' });
    const plage = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
    const lecture = await stockage.lire(cle, plage ? { debut: Number(plage[1]), fin: plage[2] ? Number(plage[2]) : undefined } : undefined);
    if (!lecture) return reply.code(404).send({ erreur: 'Fichier introuvable' });
    reply.header('Content-Type', TYPES_MIME[path.extname(cle)] ?? 'application/octet-stream');
    reply.header('Accept-Ranges', 'bytes');
    reply.header('Cache-Control', cle.endsWith('.m3u8') ? 'private, max-age=5' : 'private, max-age=86400');
    reply.header('Content-Length', lecture.taille);
    if (plage) {
      reply.code(206);
      reply.header('Content-Range', `bytes ${lecture.debut}-${lecture.fin}/${lecture.tailleTotale}`);
    }
    if ((req.query as { telecharger?: string }).telecharger) reply.header('Content-Disposition', `attachment; filename="${path.basename(cle)}"`);
    return reply.send(lecture.flux);
  });
}

export function urlLecture(clubId: string, v: Record<string, any>, filigrane?: string, duree?: number) {
  if (v.statut !== 'pret') return { pret: false, statut: v.statut, progression: v.progression };
  const jeton = signerMedia(`${prefixeVideo(clubId, v.id)}/hls/`, duree, filigrane);
  return {
    pret: true, videoId: v.id, angle: v.angle, decalage: v.decalage, duree: v.duree,
    url: `/media/${jeton}/master.m3u8`, vignettes: `/media/${jeton}/vignettes.jpg`, filigrane: filigrane ?? null,
  };
}
