import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { OFFRES, calculerTempsDeJeu } from '@rugby/shared';
import { crud } from '../lib/crud.js';
import { avec, contexte, journaliser, matchAccessible, valider, uuid } from '../lib/contexte.js';
import { nonTrouve, quotaAtteint, requeteInvalide } from '../lib/erreurs.js';
import { chargerMatch } from '../lib/donneesMatch.js';
import { notifierJoueurs } from '../lib/notifications.js';

const champsMatch = z.object({
  equipe_id: uuid, adversaire_id: uuid.nullable().optional(),
  type: z.enum(['officiel', 'amical', 'observation']).optional(), competition: z.string().nullable().optional(),
  date: z.string(), domicile: z.boolean().optional(), arbitre: z.string().nullable().optional(),
  meteo: z.string().nullable().optional(), terrain: z.string().nullable().optional(),
  duree_mi_temps: z.number().int().min(5).max(40).optional(),
  niveau_codage: z.enum(['express', 'complet']).optional(),
  coup_envoi_1: z.number().nullable().optional(), coup_envoi_2: z.number().nullable().optional(),
  score_nous_mt: z.number().int().nullable().optional(), score_adv_mt: z.number().int().nullable().optional(),
  score_nous: z.number().int().nullable().optional(), score_adv: z.number().int().nullable().optional(),
  consignes: z.string().nullable().optional(),
  points_positifs: z.array(z.string()).max(3).optional(), axes_travail: z.array(z.string()).max(3).optional(),
  objectifs: z.array(z.object({ key: z.string(), camp: z.enum(['nous', 'adversaire']), cible: z.number() })).nullable().optional(),
  statut: z.enum(['a_coder', 'en_cours', 'code', 'valide']).optional(),
});

export default async function routesMatchs(app: FastifyInstance) {
  crud(app, {
    chemin: '/api/clubs/:clubId/matchs', table: 'matchs', lire: 'match.lire', ecrire: 'match.ecrire', ordre: 't.date DESC',
    colonneEquipe: 'equipe_id', colonnesJson: ['objectifs'],
    schema: champsMatch,
    selection: `SELECT t.*, a.nom AS adversaire_nom, e.nom AS equipe_nom,
                  (SELECT count(*) FROM evenements ev WHERE ev.match_id = t.id AND NOT ev.supprime)::int AS nb_evenements,
                  (SELECT v.statut FROM videos v WHERE v.match_id = t.id ORDER BY v.cree_le LIMIT 1) AS statut_video
                FROM matchs t LEFT JOIN adversaires a ON a.id = t.adversaire_id JOIN equipes e ON e.id = t.equipe_id`,
    avantCreation: async (db, ctx, data) => {
      const o = OFFRES[ctx.offre];
      if (o.maxMatchs !== null) {
        const n = Number((await db.query('SELECT count(*) FROM matchs').then((r) => r.rows[0].count)));
        if (n >= o.maxMatchs) throw quotaAtteint(`Votre offre ${o.nom} est limitée à ${o.maxMatchs} matchs`);
      }
      if (data.niveau_codage === 'complet' && !o.fonctionnalites.includes('codage_complet')) throw quotaAtteint('Le codage complet nécessite l\'offre Club');
      if (data.type === 'observation' && !o.fonctionnalites.includes('analyse_adverse')) throw quotaAtteint("L'analyse adverse nécessite l'offre Club+");
      const eq = (await db.query('SELECT duree_mi_temps FROM equipes WHERE id = $1', [data.equipe_id])).rows[0];
      if (!eq) throw nonTrouve('Équipe');
      data.duree_mi_temps ??= eq.duree_mi_temps;
    },
  });

  // Vue complète d'un match (ouverture d'un match codé : une seule requête)
  app.get('/api/clubs/:clubId/matchs/:id/complet', async (req) => {
    const ctx = await contexte(req, 'match.lire');
    const { id } = valider(z.object({ id: uuid }), req.params);
    return avec(ctx, async (db) => {
      await matchAccessible(db, ctx, id, 'match.lire');
      const m = await chargerMatch(db, id);
      if (!m) throw nonTrouve('Match');
      const videos = (await db.query('SELECT * FROM videos WHERE match_id = $1 ORDER BY (angle = \'Principal\') DESC, cree_le', [id])).rows;
      const equipe = (await db.query(
        `SELECT j.id, j.prenom, j.nom, j.poste_principal, j.numero_habituel, j.statut FROM joueurs j
         JOIN equipe_joueurs ej ON ej.joueur_id = j.id WHERE ej.equipe_id = $1 AND NOT j.archive ORDER BY j.nom`, [m.match.equipe_id])).rows;
      const joueursAdverses = m.match.adversaire_id
        ? (await db.query('SELECT * FROM joueurs_adverses WHERE adversaire_id = $1 ORDER BY numero', [m.match.adversaire_id])).rows : [];
      const tdj = calculerTempsDeJeu(m.feuille, m.changements, m.match.duree_mi_temps);
      return { ...m, videos, effectif: equipe, joueursAdverses, tempsDeJeu: tdj };
    });
  });

  // Feuille de match : remplacée en bloc
  app.put('/api/clubs/:clubId/matchs/:id/feuille', async (req) => {
    const ctx = await contexte(req, 'match.ecrire');
    const { id } = valider(z.object({ id: uuid }), req.params);
    const { lignes, forcer } = valider(z.object({
      lignes: z.array(z.object({ joueur_id: uuid, numero: z.number().int().min(1).max(30), titulaire: z.boolean(), poste: z.string().nullable().optional(), capitaine: z.boolean().optional() })),
      forcer: z.boolean().optional(),
    }), req.body);
    return avec(ctx, async (db) => {
      const m = await matchAccessible(db, ctx, id, 'match.ecrire');
      const eq = (await db.query('SELECT nb_titulaires, nb_remplacants FROM equipes WHERE id = $1', [m.equipe_id])).rows[0];
      const nbTit = lignes.filter((l) => l.titulaire).length;
      if (nbTit > eq.nb_titulaires) throw requeteInvalide(`${eq.nb_titulaires} titulaires maximum`);
      if (lignes.length - nbTit > eq.nb_remplacants) throw requeteInvalide(`${eq.nb_remplacants} remplaçants maximum`);
      if (new Set(lignes.map((l) => l.numero)).size !== lignes.length) throw requeteInvalide('Numéro en double');
      if (new Set(lignes.map((l) => l.joueur_id)).size !== lignes.length) throw requeteInvalide('Joueur en double');
      // Blocage de sélection : protocole commotion en cours (non contournable), blessé ou suspendu (contournable)
      const ids = lignes.map((l) => l.joueur_id);
      const bloques = (await db.query(
        `SELECT j.prenom, j.nom FROM joueurs j WHERE j.id = ANY($1::uuid[])
         AND EXISTS (SELECT 1 FROM dossiers_sante d WHERE d.joueur_id = j.id AND d.type = 'commotion' AND NOT d.clos)`, [ids])).rows;
      if (bloques.length) throw requeteInvalide(`Sélection impossible, protocole commotion en cours : ${bloques.map((b) => `${b.prenom} ${b.nom}`).join(', ')}`);
      const indispo = (await db.query("SELECT prenom, nom, statut FROM joueurs WHERE id = ANY($1::uuid[]) AND statut IN ('blesse','suspendu')", [ids])).rows;
      if (indispo.length && !forcer) {
        throw requeteInvalide(`Joueurs indisponibles : ${indispo.map((b) => `${b.prenom} ${b.nom} (${b.statut === 'blesse' ? 'blessé' : 'suspendu'})`).join(', ')}. Confirmez pour forcer.`);
      }
      await db.query('DELETE FROM feuille_match WHERE match_id = $1', [id]);
      for (const l of lignes) {
        await db.query('INSERT INTO feuille_match (club_id, match_id, joueur_id, numero, titulaire, poste, capitaine) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [ctx.clubId, id, l.joueur_id, l.numero, l.titulaire, l.poste ?? null, l.capitaine ?? false]);
      }
      return (await chargerMatch(db, id))!.feuille;
    });
  });

  // Annonce de la composition aux joueurs (app joueur + push)
  app.post('/api/clubs/:clubId/matchs/:id/annoncer-compo', async (req) => {
    const ctx = await contexte(req, 'match.ecrire');
    const { id } = valider(z.object({ id: uuid }), req.params);
    return avec(ctx, async (db) => {
      const m = await matchAccessible(db, ctx, id, 'match.ecrire');
      await db.query('UPDATE matchs SET compo_annoncee = true WHERE id = $1', [id]);
      const equipe = (await db.query('SELECT joueur_id FROM equipe_joueurs WHERE equipe_id = $1', [m.equipe_id])).rows.map((r) => r.joueur_id);
      await notifierJoueurs(db, ctx.clubId, equipe, 'Composition annoncée', `La composition du prochain match est disponible.`, `/joueur/matchs/${id}`);
      return { ok: true };
    });
  });

  // Changements : remplacements (temporaires ou définitifs) et cartons, avec minute
  app.post('/api/clubs/:clubId/matchs/:id/changements', async (req) => {
    const ctx = await contexte(req, 'match.ecrire');
    const { id } = valider(z.object({ id: uuid }), req.params);
    const b = valider(z.object({
      type: z.enum(['remplacement', 'temporaire_commotion', 'temporaire_saignement', 'retour', 'carton_jaune', 'carton_rouge', 'carton_bleu']),
      minute: z.number().min(0).max(100), joueur_sortant: uuid.nullable().optional(), joueur_entrant: uuid.nullable().optional(),
    }), req.body);
    if (b.type.startsWith('carton') && !b.joueur_sortant) throw requeteInvalide('Joueur sanctionné requis');
    if (['remplacement', 'temporaire_commotion', 'temporaire_saignement', 'retour'].includes(b.type) && (!b.joueur_sortant || !b.joueur_entrant)) {
      throw requeteInvalide('Joueurs sortant et entrant requis');
    }
    return avec(ctx, async (db) => {
      await matchAccessible(db, ctx, id, 'match.ecrire');
      return (await db.query(
        'INSERT INTO changements_feuille (club_id, match_id, type, minute, joueur_sortant, joueur_entrant) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
        [ctx.clubId, id, b.type, b.minute, b.joueur_sortant ?? null, b.joueur_entrant ?? null],
      )).rows[0];
    });
  });

  app.delete('/api/clubs/:clubId/matchs/:id/changements/:cid', async (req) => {
    const ctx = await contexte(req, 'match.ecrire');
    const { id, cid } = valider(z.object({ id: uuid, cid: uuid }), req.params);
    return avec(ctx, async (db) => {
      await matchAccessible(db, ctx, id, 'match.ecrire');
      await db.query('DELETE FROM changements_feuille WHERE id = $1 AND match_id = $2', [cid, id]);
      await journaliser(db, ctx, 'suppression', 'changements_feuille', cid);
      return { ok: true };
    });
  });
}
