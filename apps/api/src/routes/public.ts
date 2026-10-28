import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { avecClub, sansClub } from '../lib/db.js';
import { hacherJeton } from '../lib/securite.js';
import { nonTrouve, ErreurHttp } from '../lib/erreurs.js';
import { valider, uuid } from '../lib/contexte.js';
import { detailPlaylist } from './playlists.js';

async function partageValide(jeton: string) {
  const h = hacherJeton(jeton);
  const clubId = await sansClub(async (db) => (await db.query('SELECT f_club_du_partage($1) AS c', [h])).rows[0].c as string | null);
  if (!clubId) throw nonTrouve('Lien');
  const partage = await avecClub(clubId, async (db) => (await db.query('SELECT * FROM partages WHERE jeton_hash = $1', [h])).rows[0]);
  if (!partage) throw nonTrouve('Lien');
  if (partage.revoque_le) throw new ErreurHttp(410, 'Ce lien a été révoqué');
  if (new Date(partage.expire_le) < new Date()) throw new ErreurHttp(410, 'Ce lien a expiré');
  return { clubId, partage };
}

export default async function routesPublic(app: FastifyInstance) {
  // Lecture d'une playlist partagée (sans compte) : filigrane au nom du destinataire
  app.get('/api/public/partages/:jeton', async (req) => {
    const { jeton } = req.params as { jeton: string };
    const { clubId, partage } = await partageValide(jeton);
    return avecClub(clubId, async (db) => {
      const club = (await db.query('SELECT nom, logo_url, couleurs FROM clubs WHERE id = $1', [clubId])).rows[0];
      const detail = await detailPlaylist(db, clubId, partage.playlist_id, partage.libelle);
      await db.query('INSERT INTO lectures (club_id, partage_id, spectateur) VALUES ($1,$2,$3)', [clubId, partage.id, partage.libelle]);
      const { filtre: _f, auteur_id: _a, ...playlist } = detail;
      return { club, playlist, destinataire: partage.libelle, telechargement: partage.telechargement, expireLe: partage.expire_le };
    });
  });

  app.post('/api/public/partages/:jeton/lectures', async (req) => {
    const { jeton } = req.params as { jeton: string };
    const b = valider(z.object({ clip_id: uuid, secondes: z.number().min(0).max(3600) }), req.body);
    const { clubId, partage } = await partageValide(jeton);
    await avecClub(clubId, async (db) => {
      const ok = (await db.query('SELECT 1 FROM playlist_clips WHERE id = $1 AND playlist_id = $2', [b.clip_id, partage.playlist_id])).rowCount;
      if (ok) await db.query('INSERT INTO lectures (club_id, partage_id, clip_id, spectateur, secondes) VALUES ($1,$2,$3,$4,$5)', [clubId, partage.id, b.clip_id, partage.libelle, b.secondes]);
    });
    return { ok: true };
  });

  app.post('/api/public/partages/:jeton/commentaires', async (req) => {
    const { jeton } = req.params as { jeton: string };
    const b = valider(z.object({ texte: z.string().min(1).max(2000), clip_id: uuid.nullable().optional() }), req.body);
    const { clubId, partage } = await partageValide(jeton);
    return avecClub(clubId, async (db) => (await db.query(
      'INSERT INTO commentaires (club_id, playlist_id, clip_id, partage_id, auteur, texte) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [clubId, partage.playlist_id, b.clip_id ?? null, partage.id, partage.libelle, b.texte])).rows[0]);
  });

  app.get('/api/public/partages/:jeton/commentaires', async (req) => {
    const { jeton } = req.params as { jeton: string };
    const { clubId, partage } = await partageValide(jeton);
    // Pas de messagerie privée adulte vers mineur : les échanges sont visibles de tout le staff
    return avecClub(clubId, async (db) => (await db.query(
      'SELECT id, clip_id, auteur, texte, le FROM commentaires WHERE playlist_id = $1 AND (partage_id = $2 OR utilisateur_id IS NOT NULL) ORDER BY le', [partage.playlist_id, partage.id])).rows);
  });

  app.post('/api/public/partages/:jeton/reponses', async (req) => {
    const { jeton } = req.params as { jeton: string };
    const b = valider(z.object({ reponses: z.array(z.object({ question: z.string(), reponse: z.union([z.string(), z.number(), z.boolean()]) })) }), req.body);
    const { clubId, partage } = await partageValide(jeton);
    await avecClub(clubId, (db) => db.query('INSERT INTO reponses_questionnaire (club_id, partage_id, repondant, reponses) VALUES ($1,$2,$3,$4)',
      [clubId, partage.id, partage.libelle, JSON.stringify(b.reponses)]));
    return { ok: true };
  });

  // Page publique optionnelle du club : résultats et calendrier, sans vidéo ni donnée individuelle
  app.get('/api/public/clubs/:slug', async (req) => {
    const { slug } = req.params as { slug: string };
    const clubId = await sansClub(async (db) => (await db.query('SELECT f_club_public($1) AS c', [slug])).rows[0].c as string | null);
    if (!clubId) throw nonTrouve('Club');
    return avecClub(clubId, async (db) => ({
      club: (await db.query('SELECT nom, logo_url, couleurs, comite, poule FROM clubs WHERE id = $1', [clubId])).rows[0],
      matchs: (await db.query(
        `SELECT m.date, m.domicile, m.competition, m.score_nous, m.score_adv, e.nom AS equipe, a.nom AS adversaire
         FROM matchs m JOIN equipes e ON e.id = m.equipe_id LEFT JOIN adversaires a ON a.id = m.adversaire_id
         WHERE m.type = 'officiel' AND m.publie AND NOT e.archivee ORDER BY m.date DESC LIMIT 40`)).rows,
    }));
  });
}
