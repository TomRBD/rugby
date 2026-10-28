// IA : analyses lancées en file sur le service dédié, résultats renvoyés comme propositions à valider.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { avec, contexte, exigerFonction, matchAccessible, valider, uuid } from '../lib/contexte.js';
import { enfiler } from '../lib/jobs.js';
import { nonTrouve, requeteInvalide } from '../lib/erreurs.js';
import { videoPrincipale } from '../lib/donneesMatch.js';

/** Métriques physiques estimées depuis les positions vidéo, avec marge d'erreur liée à la calibration. */
export function metriquesPhysiques(positions: [number, number, number][], margeCalibration = 0.08) {
  let distance = 0, vmax = 0, hsr = 0;
  for (let i = 1; i < positions.length; i++) {
    const [t0, x0, y0] = positions[i - 1];
    const [t1, x1, y1] = positions[i];
    const dt = t1 - t0;
    if (dt <= 0 || dt > 2) continue;
    const d = Math.hypot(x1 - x0, y1 - y0);
    const v = d / dt;
    if (v > 12) continue; // aberrant (changement d'identité de piste)
    distance += d;
    if (v >= 5.5) hsr += d;
    vmax = Math.max(vmax, v);
  }
  const marge = (x: number) => Math.round(x * margeCalibration * 10) / 10;
  return {
    distance_m: Math.round(distance), distance_marge_m: marge(distance),
    haute_intensite_m: Math.round(hsr), haute_intensite_marge_m: marge(hsr),
    vitesse_max_kmh: Math.round(vmax * 36) / 10, vitesse_max_marge_kmh: Math.round(vmax * 3.6 * (margeCalibration * 1.5) * 10) / 10,
  };
}

export default async function routesIa(app: FastifyInstance) {
  app.post('/api/clubs/:clubId/matchs/:id/analyse-ia', async (req) => {
    const ctx = await contexte(req, 'codage.ecrire');
    exigerFonction(ctx, 'ia');
    const { id } = valider(z.object({ id: uuid }), req.params);
    const { analyses } = valider(z.object({
      analyses: z.array(z.enum(['temps_morts', 'coups_envoi', 'phases_arretees', 'tracking'])).default(['temps_morts', 'coups_envoi', 'phases_arretees']),
    }), req.body ?? {});
    if (analyses.includes('tracking')) exigerFonction(ctx, 'tracking');
    return avec(ctx, async (db) => {
      await matchAccessible(db, ctx, id, 'codage.ecrire');
      const v = await videoPrincipale(db, id);
      if (!v) throw requeteInvalide('Aucune vidéo prête pour ce match');
      return { job: await enfiler(db, ctx.clubId, 'analyse_ia', { matchId: id, videoId: v.id, analyses }) };
    });
  });

  app.get('/api/clubs/:clubId/matchs/:id/jobs', async (req) => {
    const ctx = await contexte(req, 'match.lire');
    const { id } = valider(z.object({ id: uuid }), req.params);
    return avec(ctx, async (db) => {
      await matchAccessible(db, ctx, id, 'match.lire');
      const vids = (await db.query('SELECT id FROM videos WHERE match_id = $1', [id])).rows.map((r) => r.id);
      return (await db.query(
        `SELECT id, type, statut, erreur, cree_le, payload->>'progression' AS progression FROM jobs
         WHERE club_id = $1 AND (payload->>'matchId' = $2 OR payload->>'videoId' = ANY($3)) ORDER BY cree_le DESC LIMIT 20`,
        [ctx.clubId, id, vids])).rows;
    });
  });

  // Tracking (V2) : pistes de joueurs, correction manuelle des numéros lus par OCR, vue 2D, métriques estimées
  app.get('/api/clubs/:clubId/matchs/:id/tracking', async (req) => {
    const ctx = await contexte(req, 'stats.lire');
    exigerFonction(ctx, 'tracking');
    const { id } = valider(z.object({ id: uuid }), req.params);
    return avec(ctx, async (db) => {
      await matchAccessible(db, ctx, id, 'stats.lire');
      const pistes = (await db.query('SELECT * FROM tracking WHERE match_id = $1 ORDER BY camp, numero NULLS LAST, piste', [id])).rows;
      return pistes.map((p) => ({ ...p, metriques: metriquesPhysiques(p.positions) }));
    });
  });

  app.patch('/api/clubs/:clubId/tracking/:tid', async (req) => {
    const ctx = await contexte(req, 'codage.ecrire');
    exigerFonction(ctx, 'tracking');
    const { tid } = valider(z.object({ tid: uuid }), req.params);
    const b = valider(z.object({ numero: z.number().int().min(1).max(99).nullable().optional(), joueur_id: uuid.nullable().optional(), camp: z.enum(['nous', 'adversaire']).optional() }), req.body);
    return avec(ctx, async (db) => {
      const r = await db.query(
        `UPDATE tracking SET numero = CASE WHEN $2::boolean THEN $3 ELSE numero END, joueur_id = CASE WHEN $4::boolean THEN $5::uuid ELSE joueur_id END,
         camp = coalesce($6, camp), confiance_numero = CASE WHEN $2::boolean THEN 1 ELSE confiance_numero END WHERE id = $1 RETURNING id, numero, joueur_id, camp`,
        [tid, b.numero !== undefined, b.numero ?? null, b.joueur_id !== undefined, b.joueur_id ?? null, b.camp ?? null]);
      if (!r.rowCount) throw nonTrouve('Piste');
      return r.rows[0];
    });
  });
}
