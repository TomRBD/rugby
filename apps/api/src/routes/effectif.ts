import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { OFFRES } from '@rugby/shared';
import { crud } from '../lib/crud.js';
import { avec, contexte, exigerPermission, journaliser, valider, uuid } from '../lib/contexte.js';
import { nonTrouve, quotaAtteint } from '../lib/erreurs.js';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export default async function routesEffectif(app: FastifyInstance) {
  crud(app, {
    chemin: '/api/clubs/:clubId/saisons', table: 'saisons', lire: 'effectif.lire', ecrire: 'club.gerer', ordre: 't.debut DESC',
    schema: z.object({ libelle: z.string().min(1), debut: date, fin: date, archivee: z.boolean().optional() }),
  });

  crud(app, {
    chemin: '/api/clubs/:clubId/equipes', table: 'equipes', lire: 'effectif.lire', ecrire: 'club.gerer', ordre: 't.archivee, t.nom',
    colonneEquipe: 'id',
    schema: z.object({
      saison_id: uuid, nom: z.string().min(1),
      categorie: z.enum(['seniors', 'crabos', 'reichel', 'm16', 'm18', 'm21', 'feminines', 'cadettes', 'juniors']).default('seniors'),
      format: z.enum(['XV', '7']).default('XV'), feminine: z.boolean().optional(),
      duree_mi_temps: z.number().int().min(5).max(40).optional(),
      nb_titulaires: z.number().int().min(5).max(15).optional(), nb_remplacants: z.number().int().min(0).max(12).optional(),
      archivee: z.boolean().optional(),
    }),
    selection: `SELECT t.*, s.libelle AS saison, (SELECT count(*) FROM equipe_joueurs ej WHERE ej.equipe_id = t.id)::int AS nb_joueurs
                FROM equipes t JOIN saisons s ON s.id = t.saison_id`,
    avantCreation: async (db, ctx, data) => {
      const max = OFFRES[ctx.offre].maxEquipes;
      const n = Number((await db.query('SELECT count(*) FROM equipes WHERE NOT archivee')).rows[0].count);
      if (max !== null && n >= max) throw quotaAtteint(`Votre offre ${OFFRES[ctx.offre].nom} est limitée à ${max} équipe(s)`);
      // Valeurs par défaut selon le format (7 : mi-temps de 7 min, 7 titulaires, 5 remplaçants)
      if (data.format === '7') {
        data.duree_mi_temps ??= 7;
        data.nb_titulaires ??= 7;
        data.nb_remplacants ??= 5;
      } else if (['m16', 'crabos', 'cadettes'].includes(data.categorie)) {
        data.duree_mi_temps ??= 35;
      }
    },
  });

  crud(app, {
    chemin: '/api/clubs/:clubId/joueurs', table: 'joueurs', lire: 'effectif.lire', ecrire: 'effectif.ecrire', ordre: 't.archive, t.nom, t.prenom',
    schema: z.object({
      prenom: z.string().min(1), nom: z.string().min(1), photo_url: z.string().nullable().optional(), date_naissance: date.nullable().optional(),
      poste_principal: z.string().nullable().optional(), postes_secondaires: z.array(z.string()).optional(),
      pied_fort: z.enum(['droit', 'gauche', 'les_deux']).nullable().optional(),
      taille_cm: z.number().int().min(100).max(230).nullable().optional(), poids_kg: z.number().int().min(30).max(200).nullable().optional(),
      licence: z.string().nullable().optional(), categorie: z.string().nullable().optional(),
      statut: z.enum(['disponible', 'blesse', 'suspendu', 'absent', 'prete']).optional(),
      numero_habituel: z.number().int().min(1).max(99).nullable().optional(),
      responsable_legal_nom: z.string().nullable().optional(), responsable_legal_contact: z.string().nullable().optional(),
      archive: z.boolean().optional(),
    }),
    selection: `SELECT t.*, (t.date_naissance > current_date - interval '18 years') AS mineur,
                coalesce((SELECT array_agg(ej.equipe_id) FROM equipe_joueurs ej WHERE ej.joueur_id = t.id), '{}') AS equipes
                FROM joueurs t`,
  });

  // Rattachement des joueurs à une équipe
  app.put('/api/clubs/:clubId/equipes/:id/joueurs', async (req) => {
    const { id } = valider(z.object({ id: uuid }), req.params);
    const ctx = await contexte(req, 'effectif.ecrire', id);
    const { joueurs } = valider(z.object({ joueurs: z.array(uuid) }), req.body);
    return avec(ctx, async (db) => {
      await db.query('DELETE FROM equipe_joueurs WHERE equipe_id = $1', [id]);
      for (const j of joueurs) await db.query('INSERT INTO equipe_joueurs (club_id, equipe_id, joueur_id) VALUES ($1,$2,$3)', [ctx.clubId, id, j]);
      return { ok: true, nb: joueurs.length };
    });
  });

  app.get('/api/clubs/:clubId/equipes/:id/joueurs', async (req) => {
    const { id } = valider(z.object({ id: uuid }), req.params);
    const ctx = await contexte(req, 'effectif.lire', id);
    return avec(ctx, async (db) => (await db.query(
      `SELECT j.*, (j.date_naissance > current_date - interval '18 years') AS mineur,
              EXISTS (SELECT 1 FROM dossiers_sante d WHERE d.joueur_id = j.id AND d.type = 'commotion' AND NOT d.clos) AS protocole_commotion
       FROM joueurs j JOIN equipe_joueurs ej ON ej.joueur_id = j.id WHERE ej.equipe_id = $1 AND NOT j.archive ORDER BY j.nom`, [id])).rows);
  });

  // Consentements droit à l'image et parental : historisés et révocables
  app.post('/api/clubs/:clubId/joueurs/:id/consentements', async (req) => {
    const ctx = await contexte(req);
    const { id } = valider(z.object({ id: uuid }), req.params);
    const b = valider(z.object({ type: z.enum(['image', 'parental']), accorde: z.boolean(), par: z.string().min(2) }), req.body);
    // Le joueur lui-même (ou son responsable) ou le staff effectif peut modifier
    const estLeJoueur = ctx.adhesions.some((a) => a.joueurId === id);
    if (!estLeJoueur) exigerPermission(ctx, 'effectif.ecrire');
    return avec(ctx, async (db) => {
      const j = (await db.query('SELECT id FROM joueurs WHERE id = $1', [id])).rows[0];
      if (!j) throw nonTrouve('Joueur');
      await db.query('INSERT INTO consentements (club_id, joueur_id, type, accorde, par) VALUES ($1,$2,$3,$4,$5)', [ctx.clubId, id, b.type, b.accorde, b.par]);
      await db.query(`UPDATE joueurs SET ${b.type === 'image' ? 'consentement_image' : 'consentement_parental'} = $2 WHERE id = $1`, [id, b.accorde]);
      await journaliser(db, ctx, b.accorde ? 'consentement_accorde' : 'consentement_revoque', 'joueur', id, b);
      return (await db.query('SELECT * FROM consentements WHERE joueur_id = $1 ORDER BY le DESC', [id])).rows;
    });
  });

  app.get('/api/clubs/:clubId/joueurs/:id/consentements', async (req) => {
    const ctx = await contexte(req);
    const { id } = valider(z.object({ id: uuid }), req.params);
    if (!ctx.adhesions.some((a) => a.joueurId === id)) exigerPermission(ctx, 'effectif.lire');
    return avec(ctx, async (db) => (await db.query('SELECT * FROM consentements WHERE joueur_id = $1 ORDER BY le DESC', [id])).rows);
  });

  // RGPD : export et effacement des données d'un joueur
  app.get('/api/clubs/:clubId/joueurs/:id/export', async (req) => {
    const ctx = await contexte(req);
    const { id } = valider(z.object({ id: uuid }), req.params);
    if (!ctx.adhesions.some((a) => a.joueurId === id)) exigerPermission(ctx, 'export');
    return avec(ctx, async (db) => {
      const out = {
        joueur: (await db.query('SELECT * FROM joueurs WHERE id = $1', [id])).rows[0],
        feuilles: (await db.query('SELECT * FROM feuille_match WHERE joueur_id = $1', [id])).rows,
        evenements: (await db.query('SELECT * FROM evenements WHERE $1 = ANY(joueurs)', [id])).rows,
        suivi: (await db.query('SELECT * FROM suivi_joueur WHERE joueur_id = $1', [id])).rows,
        consentements: (await db.query('SELECT * FROM consentements WHERE joueur_id = $1', [id])).rows,
      };
      if (!out.joueur) throw nonTrouve('Joueur');
      await journaliser(db, ctx, 'export_donnees_joueur', 'joueur', id);
      return out;
    });
  });

  app.post('/api/clubs/:clubId/joueurs/:id/effacement', async (req) => {
    const ctx = await contexte(req);
    const { id } = valider(z.object({ id: uuid }), req.params);
    if (!ctx.adhesions.some((a) => a.joueurId === id)) exigerPermission(ctx, 'club.gerer', null);
    return avec(ctx, async (db) => {
      // Anonymisation : les événements restent pour les stats collectives mais ne pointent plus vers la personne
      await db.query('UPDATE evenements SET joueurs = array_remove(joueurs, $1::uuid) WHERE $1 = ANY(joueurs)', [id]);
      await db.query('DELETE FROM suivi_joueur WHERE joueur_id = $1', [id]);
      await db.query('DELETE FROM dossiers_sante WHERE joueur_id = $1', [id]);
      await db.query('DELETE FROM donnees_gps WHERE joueur_id = $1', [id]);
      await db.query(`UPDATE joueurs SET prenom = 'Joueur', nom = 'anonymisé', photo_url = NULL, date_naissance = NULL, licence = NULL,
                      responsable_legal_nom = NULL, responsable_legal_contact = NULL, consentement_image = false, archive = true WHERE id = $1`, [id]);
      await journaliser(db, ctx, 'effacement_joueur', 'joueur', id);
      return { ok: true };
    });
  });

  // Adversaires, réutilisables entre saisons
  crud(app, {
    chemin: '/api/clubs/:clubId/adversaires', table: 'adversaires', lire: 'match.lire', ecrire: 'match.ecrire', ordre: 't.nom',
    schema: z.object({ nom: z.string().min(1), ville: z.string().nullable().optional(), couleurs: z.string().nullable().optional(), notes: z.string().nullable().optional() }),
  });
  crud(app, {
    chemin: '/api/clubs/:clubId/joueurs-adverses', table: 'joueurs_adverses', lire: 'match.lire', ecrire: 'adverse.ecrire', ordre: 't.numero',
    schema: z.object({ adversaire_id: uuid, numero: z.number().int().min(1).max(99), nom: z.string().nullable().optional(), poste: z.string().nullable().optional(), notes: z.string().nullable().optional() }),
  });

  // Entraînements (V2)
  crud(app, {
    chemin: '/api/clubs/:clubId/entrainements', table: 'entrainements', lire: 'match.lire', ecrire: 'match.ecrire', ordre: 't.date DESC',
    colonneEquipe: 'equipe_id', colonnesJson: ['exercices'],
    schema: z.object({
      equipe_id: uuid, date: z.string(), duree_minutes: z.number().int().min(10).max(300).optional(), theme: z.string().nullable().optional(),
      exercices: z.array(z.object({ titre: z.string(), duree: z.number().optional(), description: z.string().optional() })).optional(),
      presences: z.array(uuid).optional(),
    }),
  });
}
