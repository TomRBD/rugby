import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { OFFRES, TAXONOMIE_DEFAUT, type DefinitionTypeEvenement } from '@rugby/shared';
import { avec, contexte, journaliser, valider, uuid } from '../lib/contexte.js';
import { hacherJeton, jetonAleatoire } from '../lib/securite.js';
import { config } from '../lib/config.js';
import { nonTrouve, requeteInvalide } from '../lib/erreurs.js';
import { enfiler } from '../lib/jobs.js';
import { copierTaxonomie } from './auth.js';
import { typesDuClub } from '../lib/donneesMatch.js';

const ROLES = ['admin', 'entraineur', 'entraineur_adjoint', 'analyste', 'joueur', 'medical', 'dirigeant'] as const;

const definitionType = z.object({
  key: z.string().regex(/^[a-z0-9_]+$/),
  famille: z.string(),
  label: z.string().min(1),
  raccourci: z.string().max(1).optional(),
  niveaux: z.array(z.enum(['express', 'complet'])).min(1),
  resultats: z.array(z.object({ value: z.string(), label: z.string(), succes: z.boolean(), points: z.number().optional() })),
  attributs: z.array(z.object({
    key: z.string(), label: z.string(), type: z.enum(['choix', 'nombre', 'booleen', 'texte', 'joueur']),
    options: z.array(z.object({ value: z.string(), label: z.string() })).optional(), obligatoire: z.boolean().optional(),
  })),
  preRoll: z.number().min(0).max(60),
  postRoll: z.number().min(0).max(60),
  dureeDefaut: z.number().min(0).max(600),
  sensCamp: z.enum(['porteur', 'fautif', 'defense']).optional(),
  ordre: z.number(),
});

export default async function routesClub(app: FastifyInstance) {
  app.get('/api/clubs/:clubId', async (req) => {
    const ctx = await contexte(req);
    return avec(ctx, async (db) => {
      const club = (await db.query('SELECT * FROM clubs WHERE id = $1', [ctx.clubId])).rows[0];
      const usage = (await db.query(
        `SELECT (SELECT count(*) FROM equipes WHERE NOT archivee) AS equipes, (SELECT count(*) FROM matchs) AS matchs,
                (SELECT coalesce(sum(duree), 0) / 3600 FROM videos WHERE statut <> 'archive') AS heures_video`,
      )).rows[0];
      return { ...club, offreDetail: OFFRES[club.offre as keyof typeof OFFRES], usage, mesRoles: ctx.adhesions };
    });
  });

  app.patch('/api/clubs/:clubId', async (req) => {
    const ctx = await contexte(req, 'club.gerer', null);
    const b = valider(z.object({
      nom: z.string().min(2).optional(), logo_url: z.string().url().nullable().optional(),
      couleurs: z.object({ primaire: z.string(), secondaire: z.string() }).optional(),
      stades: z.array(z.string()).optional(), comite: z.string().nullable().optional(), poule: z.string().nullable().optional(),
      page_publique: z.boolean().optional(),
      config: z.record(z.any()).optional(),
    }), req.body);
    return avec(ctx, async (db) => {
      const champs = Object.entries(b).filter(([k, v]) => v !== undefined && k !== 'config');
      if (champs.length) {
        const sets = champs.map(([k], i) => `${k} = $${i + 2}`).join(', ');
        await db.query(`UPDATE clubs SET ${sets} WHERE id = $1`, [ctx.clubId, ...champs.map(([k, v]) => (['couleurs', 'stades'].includes(k) ? JSON.stringify(v) : v))]);
      }
      if (b.config) await db.query("UPDATE clubs SET config = config || $2::jsonb WHERE id = $1", [ctx.clubId, JSON.stringify(b.config)]);
      return (await db.query('SELECT * FROM clubs WHERE id = $1', [ctx.clubId])).rows[0];
    });
  });

  // Offre, cycle de facturation et suspension estivale (le paiement passe par le prestataire configuré)
  app.post('/api/clubs/:clubId/abonnement', async (req) => {
    const ctx = await contexte(req, 'club.gerer', null);
    const b = valider(z.object({
      offre: z.enum(['decouverte', 'club', 'club_plus', 'pro']).optional(),
      cycle_facturation: z.enum(['mensuel', 'annuel']).optional(),
      suspendu_ete: z.boolean().optional(),
    }), req.body);
    return avec(ctx, async (db) => {
      if (b.offre) {
        const o = OFFRES[b.offre];
        const n = Number((await db.query('SELECT count(*) FROM equipes WHERE NOT archivee')).rows[0].count);
        if (o.maxEquipes !== null && n > o.maxEquipes) throw requeteInvalide(`L'offre ${o.nom} est limitée à ${o.maxEquipes} équipe(s) : archivez des équipes d'abord`);
        await db.query('UPDATE clubs SET offre = $2 WHERE id = $1', [ctx.clubId, b.offre]);
      }
      if (b.cycle_facturation) await db.query('UPDATE clubs SET cycle_facturation = $2 WHERE id = $1', [ctx.clubId, b.cycle_facturation]);
      if (b.suspendu_ete !== undefined) await db.query('UPDATE clubs SET suspendu_ete = $2 WHERE id = $1', [ctx.clubId, b.suspendu_ete]);
      await journaliser(db, ctx, 'abonnement_modifie', 'club', ctx.clubId, b);
      return (await db.query('SELECT offre, cycle_facturation, suspendu_ete FROM clubs WHERE id = $1', [ctx.clubId])).rows[0];
    });
  });

  // Fin d'abonnement : export complet puis suppression planifiée à 90 jours
  app.post('/api/clubs/:clubId/resiliation', async (req) => {
    const ctx = await contexte(req, 'club.gerer', null);
    return avec(ctx, async (db) => {
      await db.query("UPDATE clubs SET fin_abonnement = current_date, suppression_prevue = current_date + 90 WHERE id = $1", [ctx.clubId]);
      await db.query(
        "INSERT INTO jobs (club_id, type, payload, executer_apres) VALUES ($1, 'purge_club', '{}', now() + interval '90 days')", [ctx.clubId]);
      await journaliser(db, ctx, 'resiliation', 'club', ctx.clubId);
      return { suppressionPrevue: (await db.query('SELECT suppression_prevue FROM clubs WHERE id = $1', [ctx.clubId])).rows[0].suppression_prevue };
    });
  });

  app.get('/api/clubs/:clubId/export-complet', async (req, reply) => {
    const ctx = await contexte(req, 'club.gerer', null);
    const data = await avec(ctx, async (db) => {
      const tables = ['clubs', 'saisons', 'equipes', 'joueurs', 'equipe_joueurs', 'adversaires', 'joueurs_adverses', 'matchs', 'feuille_match',
        'changements_feuille', 'videos', 'types_evenements', 'evenements', 'playlists', 'playlist_clips', 'suivi_joueur', 'entrainements', 'consentements'];
      const out: Record<string, unknown[]> = {};
      for (const t of tables) out[t] = (await db.query(`SELECT * FROM ${t}`)).rows;
      await journaliser(db, ctx, 'export_complet', 'club', ctx.clubId);
      return out;
    });
    reply.header('Content-Disposition', 'attachment; filename="export-club.json"');
    return data;
  });

  // Membres et rôles
  app.get('/api/clubs/:clubId/membres', async (req) => {
    const ctx = await contexte(req, 'club.gerer', null);
    return avec(ctx, async (db) => (await db.query(
      `SELECT a.id, a.role, a.equipe_id, a.joueur_id, a.secteur, u.id AS utilisateur_id, u.nom, u.email, u.telephone, u.mfa_actif, e.nom AS equipe
       FROM adhesions a JOIN utilisateurs u ON u.id = a.utilisateur_id LEFT JOIN equipes e ON e.id = a.equipe_id ORDER BY u.nom, a.role`,
    )).rows);
  });

  app.delete('/api/clubs/:clubId/membres/:id', async (req) => {
    const ctx = await contexte(req, 'club.gerer', null);
    const { id } = valider(z.object({ id: uuid }), req.params);
    return avec(ctx, async (db) => {
      const a = (await db.query('SELECT * FROM adhesions WHERE id = $1', [id])).rows[0];
      if (!a) throw nonTrouve('Adhésion');
      if (a.role === 'admin') {
        const n = Number((await db.query("SELECT count(*) FROM adhesions WHERE role = 'admin'")).rows[0].count);
        if (n <= 1) throw requeteInvalide('Le club doit garder au moins un administrateur');
      }
      await db.query('DELETE FROM adhesions WHERE id = $1', [id]);
      await journaliser(db, ctx, 'membre_retire', 'adhesion', id, { role: a.role });
      return { ok: true };
    });
  });

  app.post('/api/clubs/:clubId/invitations', async (req) => {
    const ctx = await contexte(req, 'club.gerer', null);
    const b = valider(z.object({
      role: z.enum(ROLES), equipeId: uuid.nullable().optional(), joueurId: uuid.nullable().optional(), joursValidite: z.number().int().min(1).max(60).default(14),
    }), req.body);
    if (b.role === 'joueur' && !b.joueurId) throw requeteInvalide('Une invitation joueur doit viser un joueur de l\'effectif');
    const jeton = jetonAleatoire();
    await avec(ctx, async (db) => {
      await db.query(
        `INSERT INTO invitations (club_id, jeton_hash, role, equipe_id, joueur_id, expire_le, cree_par)
         VALUES ($1,$2,$3,$4,$5, now() + ($6 || ' days')::interval, $7)`,
        [ctx.clubId, hacherJeton(jeton), b.role, b.equipeId ?? null, b.joueurId ?? null, String(b.joursValidite), ctx.utilisateurId],
      );
      await journaliser(db, ctx, 'invitation_creee', 'invitation', undefined, { role: b.role });
    });
    // Le front affiche ce lien et son QR code
    return { lien: `${config.publicWebUrl}/invitation/${jeton}`, jeton };
  });

  app.get('/api/clubs/:clubId/journal', async (req) => {
    const ctx = await contexte(req, 'club.gerer', null);
    return avec(ctx, async (db) => (await db.query(
      `SELECT j.*, u.nom AS utilisateur FROM journal j LEFT JOIN utilisateurs u ON u.id = j.utilisateur_id ORDER BY j.le DESC LIMIT 500`,
    )).rows);
  });

  // Taxonomie configurable (fenêtres de codage du club)
  app.get('/api/clubs/:clubId/taxonomie', async (req) => {
    const ctx = await contexte(req);
    return avec(ctx, (db) => typesDuClub(db));
  });

  app.put('/api/clubs/:clubId/taxonomie/:key', async (req) => {
    const ctx = await contexte(req, 'taxonomie.ecrire');
    const def = valider(definitionType, req.body) as DefinitionTypeEvenement;
    const { key } = req.params as { key: string };
    if (def.key !== key) throw requeteInvalide('Clé incohérente');
    return avec(ctx, async (db) => {
      const autres = (await typesDuClub(db)).filter((t) => t.key !== key && def.raccourci && t.raccourci === def.raccourci);
      if (autres.length) throw requeteInvalide(`Raccourci déjà utilisé par « ${autres[0].label} »`);
      await db.query(
        `INSERT INTO types_evenements (club_id, key, definition) VALUES ($1,$2,$3)
         ON CONFLICT (club_id, key) DO UPDATE SET definition = EXCLUDED.definition, actif = true`,
        [ctx.clubId, key, JSON.stringify(def)],
      );
      return def;
    });
  });

  app.delete('/api/clubs/:clubId/taxonomie/:key', async (req) => {
    const ctx = await contexte(req, 'taxonomie.ecrire');
    const { key } = req.params as { key: string };
    // Désactivation seulement : les événements déjà codés restent lisibles
    await avec(ctx, (db) => db.query('UPDATE types_evenements SET actif = false WHERE key = $1', [key]));
    return { ok: true };
  });

  app.post('/api/clubs/:clubId/taxonomie/reinitialiser', async (req) => {
    const ctx = await contexte(req, 'taxonomie.ecrire');
    await avec(ctx, async (db) => {
      await db.query('DELETE FROM types_evenements');
      await copierTaxonomie(db, ctx.clubId);
      await journaliser(db, ctx, 'taxonomie_reinitialisee');
    });
    return TAXONOMIE_DEFAUT;
  });

  // Notifications in-app (et abonnement Web Push)
  app.get('/api/clubs/:clubId/notifications', async (req) => {
    const ctx = await contexte(req);
    const joueurs = ctx.adhesions.map((a) => a.joueurId).filter(Boolean);
    return avec(ctx, async (db) => (await db.query(
      'SELECT * FROM notifications WHERE utilisateur_id = $1 OR joueur_id = ANY($2::uuid[]) ORDER BY le DESC LIMIT 50',
      [ctx.utilisateurId, joueurs],
    )).rows);
  });

  app.post('/api/clubs/:clubId/notifications/lues', async (req) => {
    const ctx = await contexte(req);
    const joueurs = ctx.adhesions.map((a) => a.joueurId).filter(Boolean);
    await avec(ctx, (db) => db.query('UPDATE notifications SET lue = true WHERE utilisateur_id = $1 OR joueur_id = ANY($2::uuid[])', [ctx.utilisateurId, joueurs]));
    return { ok: true };
  });

  app.post('/api/clubs/:clubId/push', async (req) => {
    const ctx = await contexte(req);
    const abonnement = valider(z.object({ endpoint: z.string().url(), keys: z.object({ p256dh: z.string(), auth: z.string() }) }), req.body);
    await avec(ctx, (db) => db.query('INSERT INTO abonnements_push (club_id, utilisateur_id, abonnement) VALUES ($1,$2,$3)', [ctx.clubId, ctx.utilisateurId, JSON.stringify(abonnement)]));
    return { ok: true, clePublique: config.vapid.publicKey ?? null };
  });

  app.get('/api/push/cle', async () => ({ clePublique: config.vapid.publicKey ?? null }));

  app.post('/api/clubs/:clubId/jobs/archivage', async (req) => {
    const ctx = await contexte(req, 'club.gerer', null);
    const { saisonId } = valider(z.object({ saisonId: uuid }), req.body);
    return avec(ctx, async (db) => ({ job: await enfiler(db, ctx.clubId, 'archivage_saison', { saisonId }) }));
  });
}
