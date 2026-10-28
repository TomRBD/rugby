// Échange de vidéos entre clubs d'une même poule (V2), sur consentement mutuel.
// La table est hors RLS (deux clubs) : chaque requête filtre explicitement sur le club courant.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { avec, contexte, exigerFonction, journaliser, valider, uuid } from '../lib/contexte.js';
import { poolAdmin, sansClub } from '../lib/db.js';
import { interdit, nonTrouve, requeteInvalide } from '../lib/erreurs.js';
import { urlLecture } from './videos.js';

export default async function routesEchanges(app: FastifyInstance) {
  app.get('/api/clubs/:clubId/echanges', async (req) => {
    const ctx = await contexte(req, 'match.lire');
    exigerFonction(ctx, 'analyse_adverse');
    const clubsPoule = await sansClub(async (db) => (await db.query('SELECT * FROM f_clubs_poule($1)', [ctx.clubId])).rows);
    const echanges = (await poolAdmin.query(
      `SELECT x.*, cd.nom AS club_demandeur_nom, cc.nom AS club_cible_nom,
              mo.date AS match_offert_date, mc.date AS match_cible_date
       FROM echanges_video x JOIN clubs cd ON cd.id = x.club_demandeur JOIN clubs cc ON cc.id = x.club_cible
       LEFT JOIN matchs mo ON mo.id = x.match_offert_id LEFT JOIN matchs mc ON mc.id = x.match_cible_id
       WHERE x.club_demandeur = $1 OR x.club_cible = $1 ORDER BY x.le DESC`, [ctx.clubId])).rows;
    return { clubsPoule, echanges };
  });

  app.post('/api/clubs/:clubId/echanges', async (req) => {
    const ctx = await contexte(req, 'club.gerer', null);
    exigerFonction(ctx, 'analyse_adverse');
    const b = valider(z.object({ club_cible: uuid, match_offert_id: uuid, message: z.string().max(500).optional() }), req.body);
    const poule = await sansClub(async (db) => (await db.query('SELECT id FROM f_clubs_poule($1)', [ctx.clubId])).rows.map((r) => r.id));
    if (!poule.includes(b.club_cible)) throw requeteInvalide('Ce club n\'est pas dans votre poule');
    await avec(ctx, async (db) => {
      if (!(await db.query('SELECT 1 FROM matchs WHERE id = $1', [b.match_offert_id])).rowCount) throw nonTrouve('Match');
      await journaliser(db, ctx, 'echange_demande', 'club', b.club_cible);
    });
    return (await poolAdmin.query(
      'INSERT INTO echanges_video (club_demandeur, club_cible, match_offert_id, message) VALUES ($1,$2,$3,$4) RETURNING *',
      [ctx.clubId, b.club_cible, b.match_offert_id, b.message ?? null])).rows[0];
  });

  app.post('/api/clubs/:clubId/echanges/:eid/repondre', async (req) => {
    const ctx = await contexte(req, 'club.gerer', null);
    const { eid } = valider(z.object({ eid: uuid }), req.params);
    const b = valider(z.object({ accepter: z.boolean(), match_cible_id: uuid.optional() }), req.body);
    const x = (await poolAdmin.query('SELECT * FROM echanges_video WHERE id = $1 AND club_cible = $2', [eid, ctx.clubId])).rows[0];
    if (!x || x.statut !== 'demande') throw nonTrouve('Demande');
    if (b.accepter) {
      if (!b.match_cible_id) throw requeteInvalide('Choisissez le match à partager en retour');
      await avec(ctx, async (db) => {
        if (!(await db.query('SELECT 1 FROM matchs WHERE id = $1', [b.match_cible_id])).rowCount) throw nonTrouve('Match');
        await journaliser(db, ctx, 'echange_accepte', 'club', x.club_demandeur);
      });
    }
    return (await poolAdmin.query('UPDATE echanges_video SET statut = $2, match_cible_id = $3 WHERE id = $1 RETURNING *',
      [eid, b.accepter ? 'accepte' : 'refuse', b.match_cible_id ?? null])).rows[0];
  });

  app.post('/api/clubs/:clubId/echanges/:eid/revoquer', async (req) => {
    const ctx = await contexte(req, 'club.gerer', null);
    const { eid } = valider(z.object({ eid: uuid }), req.params);
    const r = await poolAdmin.query("UPDATE echanges_video SET statut = 'revoque' WHERE id = $1 AND (club_demandeur = $2 OR club_cible = $2) RETURNING id", [eid, ctx.clubId]);
    if (!r.rowCount) throw nonTrouve('Échange');
    return { ok: true };
  });

  // Lecture de la vidéo reçue (seulement si l'échange est accepté et non révoqué)
  app.get('/api/clubs/:clubId/echanges/:eid/video', async (req) => {
    const ctx = await contexte(req, 'match.lire');
    const { eid } = valider(z.object({ eid: uuid }), req.params);
    const x = (await poolAdmin.query('SELECT * FROM echanges_video WHERE id = $1', [eid])).rows[0];
    if (!x || (x.club_demandeur !== ctx.clubId && x.club_cible !== ctx.clubId)) throw nonTrouve('Échange');
    if (x.statut !== 'accepte') throw interdit('Échange non accepté');
    const [autreClub, matchId] = x.club_demandeur === ctx.clubId ? [x.club_cible, x.match_cible_id] : [x.club_demandeur, x.match_offert_id];
    const v = (await poolAdmin.query("SELECT * FROM videos WHERE match_id = $1 AND club_id = $2 AND statut = 'pret' ORDER BY (angle = 'Principal') DESC LIMIT 1", [matchId, autreClub])).rows[0];
    if (!v) throw nonTrouve('Vidéo');
    return urlLecture(autreClub, v, undefined, 3 * 3600);
  });
}
