// Santé (V2) : données chiffrées à part, accès staff médical uniquement, chaque accès est journalisé.
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ETAPES_PROTOCOLE_COMMOTION, ratioAiguChronique } from '@rugby/shared';
import { avec, contexte, exigerFonction, exigerPermission, filtreEquipes, journaliser, valider, uuid } from '../lib/contexte.js';
import { chiffrer, dechiffrer } from '../lib/securite.js';
import { nonTrouve, requeteInvalide } from '../lib/erreurs.js';

const contenuDossier = z.object({
  description: z.string().max(4000).default(''),
  zone: z.string().optional(), gravite: z.enum(['legere', 'moderee', 'grave']).optional(),
  retour_prevu: z.string().optional(), notes: z.string().max(4000).optional(),
});

/** Résumé GPS depuis un CSV (temps, vitesse en km/h ou m/s, fréquence cardiaque). */
export function analyserCsvGps(csv: string) {
  const lignes = csv.trim().split(/\r?\n/);
  const sep = lignes[0].includes(';') ? ';' : ',';
  const entetes = lignes[0].toLowerCase().split(sep).map((s) => s.trim());
  const col = (...noms: string[]) => entetes.findIndex((h) => noms.some((n) => h.includes(n)));
  const iT = col('time', 'temps', 'timestamp');
  const iV = col('speed', 'vitesse');
  const iFc = col('hr', 'heart', 'fc', 'cardio');
  if (iT < 0 || iV < 0) throw requeteInvalide('Colonnes requises : temps et vitesse');
  const enKmh = entetes[iV].includes('km');
  const points: [number, number, number | null][] = [];
  for (const l of lignes.slice(1)) {
    const c = l.split(sep);
    const t = Number(c[iT]);
    const v = Number(c[iV]) / (enKmh ? 3.6 : 1);
    if (Number.isFinite(t) && Number.isFinite(v)) points.push([t, v, iFc >= 0 ? Number(c[iFc]) || null : null]);
  }
  let distance = 0, hsr = 0, sprints = 0, vmax = 0, enSprint = false;
  for (let i = 1; i < points.length; i++) {
    const dt = points[i][0] - points[i - 1][0];
    if (dt <= 0 || dt > 10) continue;
    const v = points[i][1];
    distance += v * dt;
    if (v >= 5.5) hsr += v * dt; // course à haute intensité > 19,8 km/h
    if (v >= 7 && !enSprint) sprints++;
    enSprint = v >= 7;
    vmax = Math.max(vmax, v);
  }
  const fc = points.map((p) => p[2]).filter((x): x is number => x != null);
  return {
    resume: {
      distance_m: Math.round(distance), haute_intensite_m: Math.round(hsr), sprints, vitesse_max_kmh: Math.round(vmax * 36) / 10,
      fc_moyenne: fc.length ? Math.round(fc.reduce((a, b) => a + b, 0) / fc.length) : null, fc_max: fc.length ? Math.max(...fc) : null,
      duree_s: points.length ? points[points.length - 1][0] - points[0][0] : 0,
    },
    // Échantillonnage à 1 point/seconde maximum pour le calage vidéo
    points: points.filter((_, i) => i % Math.max(1, Math.floor(points.length / 6000)) === 0).map(([t, v]) => [t, Math.round(v * 100) / 100]),
  };
}

export default async function routesSante(app: FastifyInstance) {
  app.get('/api/clubs/:clubId/sante/dossiers', async (req) => {
    const ctx = await contexte(req, 'sante.lire');
    exigerFonction(ctx, 'sante');
    const { joueurId } = req.query as { joueurId?: string };
    // Staff médical rattaché à une équipe : uniquement les joueurs de cette équipe
    const p: unknown[] = [];
    const where = [filtreEquipes(ctx, 'sante.lire', 'ej.equipe_id', p)];
    if (joueurId) { p.push(joueurId); where.push(`d.joueur_id = $${p.length}`); }
    return avec(ctx, async (db) => {
      const r = await db.query(
        `SELECT DISTINCT d.*, j.prenom, j.nom FROM dossiers_sante d JOIN joueurs j ON j.id = d.joueur_id
         LEFT JOIN equipe_joueurs ej ON ej.joueur_id = j.id WHERE ${where.join(' AND ')} ORDER BY d.clos, d.date DESC`, p);
      await journaliser(db, ctx, 'acces_medical', 'dossiers_sante', joueurId);
      return r.rows.map(({ contenu_chiffre, ...d }) => ({
        ...d, contenu: dechiffrer(contenu_chiffre),
        etapes: d.type === 'commotion' ? ETAPES_PROTOCOLE_COMMOTION : undefined,
      }));
    });
  });

  app.post('/api/clubs/:clubId/sante/dossiers', async (req) => {
    const ctx = await contexte(req, 'sante.ecrire');
    exigerFonction(ctx, 'sante');
    const b = valider(z.object({ joueur_id: uuid, type: z.enum(['blessure', 'commotion']), date: z.string(), contenu: contenuDossier }), req.body);
    return avec(ctx, async (db) => {
      const r = (await db.query(
        'INSERT INTO dossiers_sante (club_id, joueur_id, type, date, contenu_chiffre) VALUES ($1,$2,$3,$4,$5) RETURNING id, joueur_id, type, date, etape_protocole, clos',
        [ctx.clubId, b.joueur_id, b.type, b.date, chiffrer(b.contenu)])).rows[0];
      // Le statut sportif (non médical) passe à « blessé » : visible du staff sans détail de santé
      await db.query("UPDATE joueurs SET statut = 'blesse' WHERE id = $1", [b.joueur_id]);
      await journaliser(db, ctx, 'dossier_medical_cree', 'joueur', b.joueur_id, { type: b.type });
      return r;
    });
  });

  app.patch('/api/clubs/:clubId/sante/dossiers/:id', async (req) => {
    const ctx = await contexte(req, 'sante.ecrire');
    const { id } = valider(z.object({ id: uuid }), req.params);
    const b = valider(z.object({ contenu: contenuDossier.optional(), etape_protocole: z.number().int().min(0).max(ETAPES_PROTOCOLE_COMMOTION.length).optional(), clos: z.boolean().optional() }), req.body);
    return avec(ctx, async (db) => {
      const d = (await db.query('SELECT * FROM dossiers_sante WHERE id = $1', [id])).rows[0];
      if (!d) throw nonTrouve('Dossier');
      // Protocole commotion FFR : clôture uniquement après validation de toutes les étapes
      const etape = b.etape_protocole ?? d.etape_protocole;
      if (b.clos && d.type === 'commotion' && etape < ETAPES_PROTOCOLE_COMMOTION.length) {
        throw requeteInvalide('Toutes les étapes du protocole commotion doivent être validées avant la reprise');
      }
      await db.query(
        'UPDATE dossiers_sante SET contenu_chiffre = coalesce($2, contenu_chiffre), etape_protocole = $3, clos = coalesce($4, clos), maj_le = now() WHERE id = $1',
        [id, b.contenu ? chiffrer(b.contenu) : null, etape, b.clos ?? null]);
      if (b.clos) {
        const ouverts = Number((await db.query('SELECT count(*) FROM dossiers_sante WHERE joueur_id = $1 AND NOT clos', [d.joueur_id])).rows[0].count);
        if (!ouverts) await db.query("UPDATE joueurs SET statut = 'disponible' WHERE id = $1 AND statut = 'blesse'", [d.joueur_id]);
      }
      await journaliser(db, ctx, 'dossier_medical_modifie', 'joueur', d.joueur_id, { etape, clos: b.clos });
      return { ok: true, etape_protocole: etape };
    });
  });

  // Charge d'entraînement : RPE x durée, ratio aigu/chronique par joueur
  app.get('/api/clubs/:clubId/equipes/:id/charge', async (req) => {
    const { id } = valider(z.object({ id: uuid }), req.params);
    const ctx = await contexte(req);
    // Lecture réservée au staff médical ou aux entraîneurs de l'équipe
    if (!ctx.adhesions.some((a) => a.role === 'medical')) exigerPermission(ctx, 'effectif.ecrire', id);
    const date = (req.query as { date?: string }).date ?? new Date().toISOString().slice(0, 10);
    return avec(ctx, async (db) => {
      const joueurs = (await db.query('SELECT j.id, j.prenom, j.nom, j.statut FROM joueurs j JOIN equipe_joueurs ej ON ej.joueur_id = j.id WHERE ej.equipe_id = $1 AND NOT j.archive ORDER BY j.nom', [id])).rows;
      const suivi = (await db.query(
        "SELECT joueur_id, to_char(date, 'YYYY-MM-DD') AS date, rpe, duree_minutes, fatigue, douleurs, disponible FROM suivi_joueur WHERE joueur_id = ANY($1::uuid[]) AND date > $2::date - 35 ORDER BY date",
        [joueurs.map((j) => j.id), date])).rows;
      return joueurs.map((j) => {
        const s = suivi.filter((x) => x.joueur_id === j.id);
        const seances = s.filter((x) => x.rpe && x.duree_minutes).map((x) => ({ date: x.date, rpe: x.rpe, dureeMinutes: x.duree_minutes }));
        const dernier = s[s.length - 1];
        return { ...j, ...ratioAiguChronique(seances, date), fatigue: dernier?.fatigue ?? null, douleurs: dernier?.douleurs ?? null, disponible: dernier?.disponible ?? null };
      });
    });
  });

  // Import GPS / cardio (CSV), calé sur la vidéo par un décalage
  app.post('/api/clubs/:clubId/gps', async (req) => {
    const ctx = await contexte(req, 'match.ecrire');
    exigerFonction(ctx, 'gps');
    const b = valider(z.object({ joueur_id: uuid, match_id: uuid.optional(), entrainement_id: uuid.optional(), decalage_video: z.number().default(0), csv: z.string().min(10).max(20_000_000) }), req.body);
    const { resume, points } = analyserCsvGps(b.csv);
    return avec(ctx, async (db) => (await db.query(
      'INSERT INTO donnees_gps (club_id, joueur_id, match_id, entrainement_id, decalage_video, resume, points) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, resume',
      [ctx.clubId, b.joueur_id, b.match_id ?? null, b.entrainement_id ?? null, b.decalage_video, JSON.stringify(resume), JSON.stringify(points)])).rows[0]);
  });

  app.get('/api/clubs/:clubId/matchs/:id/gps', async (req) => {
    const ctx = await contexte(req, 'stats.lire');
    const { id } = valider(z.object({ id: uuid }), req.params);
    return avec(ctx, async (db) => (await db.query(
      'SELECT g.id, g.joueur_id, g.decalage_video, g.resume, j.prenom, j.nom FROM donnees_gps g JOIN joueurs j ON j.id = g.joueur_id WHERE g.match_id = $1', [id])).rows);
  });
}
