import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { z } from 'zod';
import { horlogeDepuisVideo } from '@rugby/shared';
import { avec, contexte, journaliser, matchAccessible, valider, uuid, type Contexte } from '../lib/contexte.js';
import { avecClub, sansClub, type Db } from '../lib/db.js';
import { nonTrouve, requeteInvalide } from '../lib/erreurs.js';
import { verifierJwt } from '../lib/securite.js';
import { typesDuClub, versEvenement } from '../lib/donneesMatch.js';
import { peut } from '@rugby/shared';

const evenementSchema = z.object({
  id: uuid,
  type_key: z.string().min(1),
  camp: z.enum(['nous', 'adversaire']),
  joueurs: z.array(uuid).max(5).default([]),
  numero_adverse: z.number().int().min(1).max(99).nullable().optional(),
  resultat: z.string().nullable().optional(),
  attributs: z.record(z.any()).default({}),
  debut: z.number().min(0),
  fin: z.number().min(0),
  x: z.number().min(0).max(100).nullable().optional(),
  y: z.number().min(0).max(70).nullable().optional(),
  commentaire: z.string().max(2000).nullable().optional(),
  source: z.enum(['manuel', 'live', 'ia_validee', 'vocal']).default('manuel'),
  a_completer: z.boolean().default(false),
  version: z.number().int().min(0).default(0),
  supprime: z.boolean().default(false),
});
type EvenementEntrant = z.infer<typeof evenementSchema>;

// Salles de codage collaboratif : un ensemble de sockets par match
const salles = new Map<string, Set<{ ws: WebSocket; nom: string; secteur: string | null }>>();

function diffuser(matchId: string, message: unknown, sauf?: WebSocket) {
  const s = salles.get(matchId);
  if (!s) return;
  const txt = JSON.stringify(message);
  for (const c of s) if (c.ws !== sauf && c.ws.readyState === 1) c.ws.send(txt);
}

function presence(matchId: string) {
  diffuser(matchId, { type: 'presence', codeurs: [...(salles.get(matchId) ?? [])].map((c) => ({ nom: c.nom, secteur: c.secteur })) });
}

/**
 * Écrit un lot d'événements (codage, synchro hors ligne, fusion collaborative).
 * L'identifiant est généré par le client : rejouer un lot est sans effet de bord.
 * Conflit sur le même événement : la version la plus récente gagne, l'autre reçoit la version serveur.
 */
export async function ecrireEvenements(db: Db, ctx: Contexte, matchId: string, lot: EvenementEntrant[]) {
  const m = await matchAccessible(db, ctx, matchId, 'codage.ecrire');
  const types = new Set((await typesDuClub(db)).map((t) => t.key));
  const resultats = [];
  const conflits = [];
  for (const e of lot) {
    if (!types.has(e.type_key)) throw requeteInvalide(`Type d'événement inconnu : ${e.type_key}`);
    if (e.fin < e.debut) e.fin = e.debut;
    const existant = (await db.query('SELECT * FROM evenements WHERE id = $1 FOR UPDATE', [e.id])).rows[0];
    if (existant && existant.match_id !== matchId) throw requeteInvalide('Événement d\'un autre match');
    if (existant && existant.version > e.version) {
      conflits.push(versEvenement(existant));
      continue;
    }
    const r = await db.query(
      `INSERT INTO evenements (id, club_id, match_id, type_key, camp, joueurs, numero_adverse, resultat, attributs, debut, fin, x, y,
                               commentaire, auteur_id, source, a_completer, supprime, version)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,1)
       ON CONFLICT (id) DO UPDATE SET type_key = EXCLUDED.type_key, camp = EXCLUDED.camp, joueurs = EXCLUDED.joueurs,
         numero_adverse = EXCLUDED.numero_adverse, resultat = EXCLUDED.resultat, attributs = EXCLUDED.attributs,
         debut = EXCLUDED.debut, fin = EXCLUDED.fin, x = EXCLUDED.x, y = EXCLUDED.y, commentaire = EXCLUDED.commentaire,
         a_completer = EXCLUDED.a_completer, supprime = EXCLUDED.supprime, version = evenements.version + 1, maj_le = now()
       RETURNING *`,
      [e.id, ctx.clubId, matchId, e.type_key, e.camp, e.joueurs, e.numero_adverse ?? null, e.resultat ?? null, JSON.stringify(e.attributs),
        e.debut, e.fin, e.x ?? null, e.y ?? null, e.commentaire ?? null, ctx.utilisateurId, e.source, e.a_completer, e.supprime],
    );
    const ligne = r.rows[0];
    await synchroniserCarton(db, ctx, m, ligne);
    if (e.supprime && existant && !existant.supprime) await journaliser(db, ctx, 'suppression', 'evenements', e.id);
    resultats.push(versEvenement(ligne));
  }
  if (m.statut === 'a_coder' && resultats.length) await db.query("UPDATE matchs SET statut = 'en_cours' WHERE id = $1", [matchId]);
  return { evenements: resultats, conflits };
}

/** Un carton codé sur un de nos joueurs alimente la feuille de match (temps de jeu). */
async function synchroniserCarton(db: Db, ctx: Contexte, match: Record<string, any>, e: Record<string, any>) {
  await db.query('DELETE FROM changements_feuille WHERE evenement_id = $1', [e.id]);
  if (e.supprime || e.type_key !== 'carton' || e.camp !== 'nous' || !e.joueurs?.length) return;
  const h = horlogeDepuisVideo(e.debut, { dureeMiTemps: match.duree_mi_temps, coupEnvoi1: match.coup_envoi_1, coupEnvoi2: match.coup_envoi_2 });
  if (!h || !['jaune', 'rouge', 'bleu'].includes(e.resultat)) return;
  await db.query(
    'INSERT INTO changements_feuille (club_id, match_id, type, minute, joueur_sortant, evenement_id) VALUES ($1,$2,$3,$4,$5,$6)',
    [ctx.clubId, match.id, `carton_${e.resultat}`, Math.round((h.secondes / 60) * 10) / 10, e.joueurs[0], e.id],
  );
}

export default async function routesCodage(app: FastifyInstance) {
  app.get('/api/clubs/:clubId/matchs/:id/evenements', async (req) => {
    const ctx = await contexte(req, 'match.lire');
    const { id } = valider(z.object({ id: uuid }), req.params);
    const depuis = (req.query as { depuis?: string }).depuis;
    return avec(ctx, async (db) => {
      await matchAccessible(db, ctx, id, 'match.lire');
      const r = depuis
        ? await db.query('SELECT * FROM evenements WHERE match_id = $1 AND maj_le > $2 ORDER BY debut', [id, depuis])
        : await db.query('SELECT * FROM evenements WHERE match_id = $1 AND NOT supprime ORDER BY debut', [id]);
      return { evenements: r.rows.map(versEvenement), horodatage: new Date().toISOString() };
    });
  });

  app.post('/api/clubs/:clubId/matchs/:id/evenements/sync', async (req) => {
    const ctx = await contexte(req, 'codage.ecrire');
    const { id } = valider(z.object({ id: uuid }), req.params);
    const { evenements } = valider(z.object({ evenements: z.array(evenementSchema).max(2000) }), req.body);
    const r = await avec(ctx, (db) => ecrireEvenements(db, ctx, id, evenements));
    diffuser(id, { type: 'evenements', evenements: r.evenements });
    return r;
  });

  app.patch('/api/clubs/:clubId/matchs/:id/reperes', async (req) => {
    const ctx = await contexte(req, 'codage.ecrire');
    const { id } = valider(z.object({ id: uuid }), req.params);
    const b = valider(z.object({ coup_envoi_1: z.number().nullable().optional(), coup_envoi_2: z.number().nullable().optional() }), req.body);
    const r = await avec(ctx, async (db) => {
      await matchAccessible(db, ctx, id, 'codage.ecrire');
      if (b.coup_envoi_1 !== undefined) await db.query('UPDATE matchs SET coup_envoi_1 = $2 WHERE id = $1', [id, b.coup_envoi_1]);
      if (b.coup_envoi_2 !== undefined) await db.query('UPDATE matchs SET coup_envoi_2 = $2 WHERE id = $1', [id, b.coup_envoi_2]);
      return (await db.query('SELECT coup_envoi_1, coup_envoi_2 FROM matchs WHERE id = $1', [id])).rows[0];
    });
    diffuser(id, { type: 'reperes', ...r });
    return r;
  });

  // Propositions de l'IA : jamais d'événement créé sans validation humaine
  app.get('/api/clubs/:clubId/matchs/:id/propositions', async (req) => {
    const ctx = await contexte(req, 'codage.ecrire');
    const { id } = valider(z.object({ id: uuid }), req.params);
    return avec(ctx, async (db) => {
      await matchAccessible(db, ctx, id, 'codage.ecrire');
      return (await db.query("SELECT * FROM propositions_ia WHERE match_id = $1 ORDER BY debut", [id])).rows;
    });
  });

  app.post('/api/clubs/:clubId/propositions/:pid/valider', async (req) => {
    const ctx = await contexte(req, 'codage.ecrire');
    const { pid } = valider(z.object({ pid: uuid }), req.params);
    const b = valider(evenementSchema.partial().extend({ id: uuid }), req.body);
    const r = await avec(ctx, async (db) => {
      const p = (await db.query("SELECT * FROM propositions_ia WHERE id = $1 AND statut = 'en_attente' FOR UPDATE", [pid])).rows[0];
      if (!p) throw nonTrouve('Proposition');
      // Repères d'horloge proposés : ils mettent à jour le match, pas la liste d'événements
      if (p.type === 'coup_envoi_1' || p.type === 'coup_envoi_2') {
        await matchAccessible(db, ctx, p.match_id, 'codage.ecrire');
        await db.query(`UPDATE matchs SET ${p.type} = $2 WHERE id = $1`, [p.match_id, p.debut]);
        await db.query("UPDATE propositions_ia SET statut = 'validee' WHERE id = $1", [pid]);
        return { matchId: p.match_id, evenements: [] };
      }
      const e = evenementSchema.parse({
        type_key: p.type, camp: 'nous', debut: p.debut, fin: p.fin, ...b, source: 'ia_validee',
      });
      const ecrit = await ecrireEvenements(db, ctx, p.match_id, [e]);
      await db.query("UPDATE propositions_ia SET statut = 'validee', evenement_id = $2 WHERE id = $1", [pid, e.id]);
      return { matchId: p.match_id, evenements: ecrit.evenements };
    });
    if (r.evenements.length) diffuser(r.matchId, { type: 'evenements', evenements: r.evenements });
    return r;
  });

  app.post('/api/clubs/:clubId/propositions/:pid/rejeter', async (req) => {
    const ctx = await contexte(req, 'codage.ecrire');
    const { pid } = valider(z.object({ pid: uuid }), req.params);
    await avec(ctx, (db) => db.query("UPDATE propositions_ia SET statut = 'rejetee' WHERE id = $1", [pid]));
    return { ok: true };
  });

  // WebSocket de codage collaboratif : /api/ws/matchs/:id?club=...&jeton=...&secteur=avants
  app.get('/api/ws/matchs/:id', { websocket: true }, async (socket, req) => {
    const q = req.query as { club?: string; jeton?: string; secteur?: string };
    const { id } = req.params as { id: string };
    const s = q.jeton ? verifierJwt(q.jeton) : null;
    if (!s || !q.club || !uuid.safeParse(id).success || !uuid.safeParse(q.club).success) return socket.close(4401, 'non autorisé');
    try {
      const { adhesions, nom } = await sansClub(async (db) => ({
        adhesions: (await db.query('SELECT * FROM f_mes_adhesions($1) WHERE club_id = $2', [s.sub, q.club])).rows,
        nom: (await db.query('SELECT nom FROM utilisateurs WHERE id = $1', [s.sub])).rows[0]?.nom ?? 'Codeur',
      }));
      const match = await avecClub(q.club, async (db) => (await db.query('SELECT equipe_id FROM matchs WHERE id = $1', [id])).rows[0]);
      const ad = adhesions.map((a) => ({ role: a.role, equipeId: a.equipe_id }));
      if (!match || !peut(ad, 'match.lire', match.equipe_id)) return socket.close(4403, 'interdit');
      const client = { ws: socket, nom, secteur: q.secteur ?? null };
      if (!salles.has(id)) salles.set(id, new Set());
      salles.get(id)!.add(client);
      presence(id);
      socket.on('message', (raw: Buffer) => {
        // Relais léger (position de lecture, sélection) : les écritures passent par l'API REST
        try {
          const msg = JSON.parse(raw.toString());
          if (msg?.type === 'curseur') diffuser(id, { type: 'curseur', nom, temps: Number(msg.temps) || 0 }, socket);
        } catch { /* message ignoré */ }
      });
      socket.on('close', () => {
        salles.get(id)?.delete(client);
        if (!salles.get(id)?.size) salles.delete(id);
        presence(id);
      });
    } catch {
      socket.close(1011, 'erreur');
    }
  });
}
