// App joueur : mes stats, mes clips, mes objectifs, playlists, consignes, compo, RPE, fatigue, douleurs, disponibilité.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { avec, contexte, exigerPermission, valider, uuid, type Contexte } from '../lib/contexte.js';
import { interdit, nonTrouve } from '../lib/erreurs.js';
import { detailPlaylist } from './playlists.js';
import { chargerMatch } from '../lib/donneesMatch.js';

function mesJoueurs(ctx: Contexte): string[] {
  const ids = ctx.adhesions.map((a) => a.joueurId).filter((x): x is string => !!x);
  if (!ids.length) throw interdit('Aucun profil joueur rattaché à ce compte');
  return [...new Set(ids)];
}

export default async function routesJoueur(app: FastifyInstance) {
  app.get('/api/clubs/:clubId/moi/joueur', async (req) => {
    const ctx = await contexte(req);
    const ids = mesJoueurs(ctx);
    return avec(ctx, async (db) => {
      const joueurs = (await db.query('SELECT * FROM joueurs WHERE id = ANY($1::uuid[])', [ids])).rows;
      const prochains = (await db.query(
        `SELECT m.id, m.date, m.domicile, m.consignes, m.compo_annoncee, a.nom AS adversaire, e.nom AS equipe,
                f.numero, f.titulaire, f.poste
         FROM matchs m JOIN equipes e ON e.id = m.equipe_id LEFT JOIN adversaires a ON a.id = m.adversaire_id
         JOIN equipe_joueurs ej ON ej.equipe_id = m.equipe_id AND ej.joueur_id = ANY($1::uuid[])
         LEFT JOIN feuille_match f ON f.match_id = m.id AND f.joueur_id = ej.joueur_id
         WHERE m.date > now() - interval '1 day' AND m.type <> 'observation' ORDER BY m.date LIMIT 5`, [ids])).rows
        .map((m) => (m.compo_annoncee ? m : { ...m, numero: null, titulaire: null, poste: null }));
      const playlists = (await db.query(
        `SELECT s.id AS partage_id, s.expire_le, p.id, p.titre, p.type, p.consignes, p.cree_le,
                (SELECT count(*) FROM playlist_clips c WHERE c.playlist_id = p.id)::int AS nb_clips,
                EXISTS (SELECT 1 FROM lectures l WHERE l.partage_id = s.id AND l.clip_id IS NOT NULL) AS vue
         FROM partages s JOIN playlists p ON p.id = s.playlist_id
         WHERE s.joueur_id = ANY($1::uuid[]) AND s.revoque_le IS NULL AND s.expire_le > now() ORDER BY s.cree_le DESC`, [ids])).rows;
      const suivi = (await db.query('SELECT * FROM suivi_joueur WHERE joueur_id = ANY($1::uuid[]) ORDER BY date DESC LIMIT 30', [ids])).rows;
      return { joueurs, prochains, playlists, suivi };
    });
  });

  // Compo annoncée d'un match (visible des joueurs une fois annoncée)
  app.get('/api/clubs/:clubId/moi/matchs/:id/compo', async (req) => {
    const ctx = await contexte(req);
    const ids = mesJoueurs(ctx);
    const { id } = valider(z.object({ id: uuid }), req.params);
    return avec(ctx, async (db) => {
      const m = (await db.query(
        `SELECT m.*, a.nom AS adversaire FROM matchs m LEFT JOIN adversaires a ON a.id = m.adversaire_id
         WHERE m.id = $1 AND m.compo_annoncee AND EXISTS (SELECT 1 FROM equipe_joueurs ej WHERE ej.equipe_id = m.equipe_id AND ej.joueur_id = ANY($2::uuid[]))`,
        [id, ids])).rows[0];
      if (!m) throw nonTrouve('Composition');
      const feuille = (await db.query(
        'SELECT f.numero, f.titulaire, f.poste, f.capitaine, j.prenom, j.nom FROM feuille_match f JOIN joueurs j ON j.id = f.joueur_id WHERE f.match_id = $1 ORDER BY f.numero', [id])).rows;
      return { match: { id: m.id, date: m.date, adversaire: m.adversaire, domicile: m.domicile, consignes: m.consignes }, feuille };
    });
  });

  // Mes chiffres sur un match codé (les stats détaillées passent par /joueurs/:id/stats, autorisé pour soi)
  app.get('/api/clubs/:clubId/moi/matchs/:id/stats', async (req) => {
    const ctx = await contexte(req);
    const ids = mesJoueurs(ctx);
    const { id } = valider(z.object({ id: uuid }), req.params);
    return avec(ctx, async (db) => {
      const m = await chargerMatch(db, id);
      if (!m || !m.feuille.some((f) => ids.includes(f.joueurId))) throw nonTrouve('Match');
      return {
        match: { id, date: m.match.date, adversaire: m.match.adversaire_nom, score: m.stats.score },
        moi: m.stats.joueurs.filter((j) => ids.includes(j.joueurId)),
      };
    });
  });

  app.get('/api/clubs/:clubId/moi/playlists/:partageId', async (req) => {
    const ctx = await contexte(req);
    const ids = mesJoueurs(ctx);
    const { partageId } = valider(z.object({ partageId: uuid }), req.params);
    return avec(ctx, async (db) => {
      const s = (await db.query('SELECT * FROM partages WHERE id = $1 AND joueur_id = ANY($2::uuid[]) AND revoque_le IS NULL AND expire_le > now()', [partageId, ids])).rows[0];
      if (!s) throw nonTrouve('Playlist');
      await db.query('INSERT INTO lectures (club_id, partage_id, spectateur) VALUES ($1,$2,$3)', [ctx.clubId, s.id, s.libelle]);
      return { ...(await detailPlaylist(db, ctx.clubId, s.playlist_id, s.libelle)), partageId: s.id, telechargement: s.telechargement };
    });
  });

  app.post('/api/clubs/:clubId/moi/playlists/:partageId/lectures', async (req) => {
    const ctx = await contexte(req);
    const ids = mesJoueurs(ctx);
    const { partageId } = valider(z.object({ partageId: uuid }), req.params);
    const b = valider(z.object({ clip_id: uuid, secondes: z.number().min(0).max(3600) }), req.body);
    await avec(ctx, async (db) => {
      const s = (await db.query('SELECT * FROM partages WHERE id = $1 AND joueur_id = ANY($2::uuid[])', [partageId, ids])).rows[0];
      if (s) await db.query('INSERT INTO lectures (club_id, partage_id, clip_id, spectateur, secondes) VALUES ($1,$2,$3,$4,$5)', [ctx.clubId, s.id, b.clip_id, s.libelle, b.secondes]);
    });
    return { ok: true };
  });

  // Suivi quotidien : RPE (1 à 10), durée, fatigue, douleurs, disponibilité
  app.post('/api/clubs/:clubId/moi/suivi', async (req) => {
    const ctx = await contexte(req);
    const ids = mesJoueurs(ctx);
    const b = valider(z.object({
      joueur_id: uuid.optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), type: z.enum(['match', 'entrainement', 'autre']).default('entrainement'),
      rpe: z.number().int().min(1).max(10).nullable().optional(), duree_minutes: z.number().int().min(0).max(300).nullable().optional(),
      fatigue: z.number().int().min(1).max(5).nullable().optional(), douleurs: z.string().max(500).nullable().optional(), disponible: z.boolean().default(true),
    }), req.body);
    const joueurId = b.joueur_id ?? ids[0];
    if (!ids.includes(joueurId)) throw interdit();
    return avec(ctx, async (db) => (await db.query(
      `INSERT INTO suivi_joueur (club_id, joueur_id, date, type, rpe, duree_minutes, fatigue, douleurs, disponible) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [ctx.clubId, joueurId, b.date, b.type, b.rpe ?? null, b.duree_minutes ?? null, b.fatigue ?? null, b.douleurs ?? null, b.disponible])).rows[0]);
  });

  // Objectifs individuels fixés par le staff
  app.put('/api/clubs/:clubId/joueurs/:id/objectifs', async (req) => {
    const ctx = await contexte(req, 'effectif.ecrire');
    const { id } = valider(z.object({ id: uuid }), req.params);
    const objectifs = valider(z.array(z.object({ key: z.string(), cible: z.number(), libelle: z.string().optional() })).max(10), req.body);
    exigerPermission(ctx, 'effectif.ecrire');
    return avec(ctx, async (db) => (await db.query('UPDATE joueurs SET objectifs_perso = $2 WHERE id = $1 RETURNING objectifs_perso', [id, JSON.stringify(objectifs)])).rows[0]);
  });
}
