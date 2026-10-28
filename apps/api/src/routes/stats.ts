import type { FastifyInstance, FastifyReply } from 'fastify';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import {
  agregerMatchs, analyserRecherche, appliquerFiltre, evaluerObjectifs, moyennesParPoste, rapportAdverse, resumeMatch,
  suggestionsExercices, LIBELLES_STATS_JOUEUR, type StatsMatch,
} from '@rugby/shared';
import { avec, contexte, exigerFonction, filtreEquipes, journaliser, matchAccessible, valider, uuid, type Contexte } from '../lib/contexte.js';
import { chargerMatch, configClub, nomsJoueurs, typesDuClub, type MatchComplet } from '../lib/donneesMatch.js';
import type { Db } from '../lib/db.js';
import { nonTrouve } from '../lib/erreurs.js';

/** Matchs codés d'une équipe (ou d'un adversaire) pour les agrégations. */
export async function matchsCodes(db: Db, ctx: Contexte, f: { equipeId?: string; saisonId?: string; adversaireId?: string; types?: string[] }) {
  const p: unknown[] = [];
  const where = [filtreEquipes(ctx, 'stats.lire', 'm.equipe_id', p), 'EXISTS (SELECT 1 FROM evenements e WHERE e.match_id = m.id AND NOT e.supprime)'];
  if (f.equipeId) { p.push(f.equipeId); where.push(`m.equipe_id = $${p.length}`); }
  if (f.saisonId) { p.push(f.saisonId); where.push(`eq.saison_id = $${p.length}`); }
  if (f.adversaireId) { p.push(f.adversaireId); where.push(`m.adversaire_id = $${p.length}`); }
  if (f.types) { p.push(f.types); where.push(`m.type = ANY($${p.length})`); }
  const ids = (await db.query(`SELECT m.id FROM matchs m JOIN equipes eq ON eq.id = m.equipe_id WHERE ${where.join(' AND ')} ORDER BY m.date`, p)).rows;
  const types = await typesDuClub(db);
  const poids = (await configClub(db)).poids;
  const out: MatchComplet[] = [];
  for (const { id } of ids) out.push((await chargerMatch(db, id, { types, poids }))!);
  return out;
}

const formatValeur = (v: number | null, f: string) => (v == null ? '' : f === 'pourcentage' ? `${v} %` : String(v));

async function envoyerTableau(reply: FastifyReply, format: string, nom: string, entetes: string[], lignes: (string | number | null)[][]) {
  if (format === 'xlsx') {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(nom.slice(0, 30));
    ws.addRow(entetes).font = { bold: true };
    lignes.forEach((l) => ws.addRow(l));
    ws.columns.forEach((c) => { c.width = 22; });
    reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    reply.header('Content-Disposition', `attachment; filename="${nom}.xlsx"`);
    return reply.send(Buffer.from(await wb.xlsx.writeBuffer()));
  }
  const echap = (x: unknown) => `"${String(x ?? '').replace(/"/g, '""')}"`;
  const csv = '﻿' + [entetes, ...lignes].map((l) => l.map(echap).join(';')).join('\r\n');
  reply.header('Content-Type', 'text/csv; charset=utf-8');
  reply.header('Content-Disposition', `attachment; filename="${nom}.csv"`);
  return reply.send(csv);
}

export default async function routesStats(app: FastifyInstance) {
  app.get('/api/clubs/:clubId/matchs/:id/stats', async (req) => {
    const ctx = await contexte(req, 'stats.lire');
    const { id } = valider(z.object({ id: uuid }), req.params);
    return avec(ctx, async (db) => {
      await matchAccessible(db, ctx, id, 'stats.lire');
      const m = (await chargerMatch(db, id))!;
      const conf = await configClub(db);
      const objectifs = evaluerObjectifs(m.stats, m.match.objectifs ?? conf.objectifs);
      const noms = await nomsJoueurs(db);
      return {
        stats: m.stats, objectifs, evenements: m.evenements, feuille: m.feuille, match: m.match,
        resume: resumeMatch(m.stats, { equipe: m.match.equipe_nom, adversaire: m.match.adversaire_nom ?? 'l\'adversaire', joueurs: noms }),
        exercices: suggestionsExercices(m.stats, m.match.objectifs ?? conf.objectifs),
      };
    });
  });

  app.get('/api/clubs/:clubId/matchs/:id/export', async (req, reply) => {
    const ctx = await contexte(req, 'export');
    const { id } = valider(z.object({ id: uuid }), req.params);
    const { format = 'csv', quoi = 'collectif' } = req.query as { format?: string; quoi?: string };
    const { m, noms } = await avec(ctx, async (db) => {
      await matchAccessible(db, ctx, id, 'stats.lire');
      await journaliser(db, ctx, 'export', 'match', id, { format, quoi });
      return { m: (await chargerMatch(db, id))!, noms: await nomsJoueurs(db) };
    });
    if (quoi === 'joueurs') {
      const cles = Object.keys(LIBELLES_STATS_JOUEUR);
      return envoyerTableau(reply, format, 'stats-joueurs', ['Joueur', 'Temps de jeu', ...cles.map((k) => LIBELLES_STATS_JOUEUR[k]), 'Contribution'],
        m.stats.joueurs.map((j) => [noms[j.joueurId] ?? j.joueurId, j.tempsDeJeu, ...cles.map((k) => j.valeurs[k]?.valeur ?? 0), j.contribution]));
    }
    if (quoi === 'evenements') {
      return envoyerTableau(reply, format, 'evenements', ['Début (s)', 'Fin (s)', 'Type', 'Camp', 'Joueur', 'N° adverse', 'Résultat', 'x', 'y', 'Attributs', 'Commentaire'],
        m.evenements.map((e) => [e.debut, e.fin, m.types.find((t) => t.key === e.typeKey)?.label ?? e.typeKey, e.camp,
          e.joueurs.map((j) => noms[j]).join(', '), e.numeroAdverse ?? '', e.resultat ?? '', e.x ?? '', e.y ?? '', JSON.stringify(e.attributs), e.commentaire ?? '']));
    }
    return envoyerTableau(reply, format, 'stats-match', ['Famille', 'Indicateur', 'Nous', 'Adversaire'],
      m.stats.indicateurs.map((i) => [i.famille, i.label, formatValeur(i.nous.valeur, i.format), formatValeur(i.adversaire.valeur, i.format)]));
  });

  // Saison : moyennes, séries (courbes), comparaison entre saisons
  app.get('/api/clubs/:clubId/equipes/:id/saison', async (req) => {
    const { id } = valider(z.object({ id: uuid }), req.params);
    const ctx = await contexte(req, 'stats.lire', id);
    return avec(ctx, async (db) => {
      const matchs = await matchsCodes(db, ctx, { equipeId: id, types: ['officiel', 'amical'] });
      const conf = await configClub(db);
      const noms = await nomsJoueurs(db);
      const joueurs = (await db.query('SELECT id, poste_principal FROM joueurs')).rows;
      const poste = Object.fromEntries(joueurs.map((j) => [j.id, j.poste_principal]));
      // Cumul individuel
      const cumul = new Map<string, { minutes: number; matchs: number; valeurs: Record<string, number>; contribution: number }>();
      for (const m of matchs) {
        for (const j of m.stats.joueurs) {
          const c = cumul.get(j.joueurId) ?? { minutes: 0, matchs: 0, valeurs: {}, contribution: 0 };
          c.minutes += j.tempsDeJeu;
          c.matchs += j.tempsDeJeu > 0 ? 1 : 0;
          c.contribution += j.contribution;
          for (const [k, v] of Object.entries(j.valeurs)) c.valeurs[k] = (c.valeurs[k] ?? 0) + (v.valeur ?? 0);
          cumul.set(j.joueurId, c);
        }
      }
      const lignesJoueurs = [...cumul.entries()].map(([joueurId, c]) => ({ joueurId, nom: noms[joueurId], poste: poste[joueurId] ?? null, ...c }));
      return {
        matchs: matchs.map((m) => ({
          id: m.match.id, date: m.match.date, adversaire: m.match.adversaire_nom, domicile: m.match.domicile, score: m.stats.score,
          objectifs: evaluerObjectifs(m.stats, m.match.objectifs ?? conf.objectifs).map((o) => ({ key: o.key, atteint: o.atteint })),
        })),
        indicateurs: agregerMatchs(matchs.map((m) => m.stats)),
        joueurs: lignesJoueurs.sort((a, b) => b.contribution - a.contribution),
        moyennesPoste: moyennesParPoste(lignesJoueurs.map((l) => ({ ...l, valeurs: l.valeurs })), Object.keys(LIBELLES_STATS_JOUEUR)),
      };
    });
  });

  // Comparaison de saisons (archivées comprises)
  app.get('/api/clubs/:clubId/comparaison-saisons', async (req) => {
    const ctx = await contexte(req, 'stats.lire');
    return avec(ctx, async (db) => {
      const saisons = (await db.query('SELECT * FROM saisons ORDER BY debut')).rows;
      const out = [];
      for (const s of saisons) {
        const matchs = await matchsCodes(db, ctx, { saisonId: s.id, types: ['officiel', 'amical'] });
        out.push({ saison: s.libelle, nbMatchs: matchs.length, indicateurs: agregerMatchs(matchs.map((m) => m.stats)) });
      }
      return out;
    });
  });

  // Fiche joueur : stats par match, cumuls, radar vs moyenne du poste
  app.get('/api/clubs/:clubId/joueurs/:id/stats', async (req) => {
    const ctx = await contexte(req);
    const { id } = valider(z.object({ id: uuid }), req.params);
    const estLeJoueur = ctx.adhesions.some((a) => a.joueurId === id);
    if (!estLeJoueur) await contexte(req, 'stats.lire');
    return avec(ctx, async (db) => {
      const j = (await db.query('SELECT * FROM joueurs WHERE id = $1', [id])).rows[0];
      if (!j) throw nonTrouve('Joueur');
      const ids = (await db.query(
        `SELECT DISTINCT m.id FROM matchs m LEFT JOIN feuille_match f ON f.match_id = m.id
         WHERE (f.joueur_id = $1 OR EXISTS (SELECT 1 FROM evenements e WHERE e.match_id = m.id AND $1 = ANY(e.joueurs)))`, [id])).rows;
      const types = await typesDuClub(db);
      const poids = (await configClub(db)).poids;
      const parMatch = [];
      const statsTous: StatsMatch[] = [];
      for (const { id: mid } of ids) {
        const m = (await chargerMatch(db, mid, { types, poids }))!;
        statsTous.push(m.stats);
        const s = m.stats.joueurs.find((x) => x.joueurId === id);
        parMatch.push({ matchId: mid, date: m.match.date, adversaire: m.match.adversaire_nom, tempsDeJeu: s?.tempsDeJeu ?? 0, valeurs: s?.valeurs ?? {}, contribution: s?.contribution ?? 0 });
      }
      parMatch.sort((a, b) => String(a.date).localeCompare(String(b.date)));
      // Moyenne du poste (même club) ramenée à 80 minutes
      const lignes = statsTous.flatMap((s) => s.joueurs).map((x) => ({ joueurId: x.joueurId, minutes: x.tempsDeJeu, valeurs: Object.fromEntries(Object.entries(x.valeurs).map(([k, v]) => [k, v.valeur ?? 0])) }));
      const postes = Object.fromEntries((await db.query('SELECT id, poste_principal FROM joueurs')).rows.map((r) => [r.id, r.poste_principal]));
      const moyPoste = moyennesParPoste(lignes.map((l) => ({ ...l, poste: postes[l.joueurId] ?? null })), Object.keys(LIBELLES_STATS_JOUEUR));
      const moi = moyennesParPoste(lignes.filter((l) => l.joueurId === id).map((l) => ({ ...l, poste: 'moi' })), Object.keys(LIBELLES_STATS_JOUEUR)).moi ?? {};
      return { joueur: j, parMatch, par80: moi, moyennePoste: moyPoste[j.poste_principal] ?? {}, libelles: LIBELLES_STATS_JOUEUR };
    });
  });

  // Tableau de bord dirigeant : synthèse club toutes équipes
  app.get('/api/clubs/:clubId/tableau-de-bord', async (req) => {
    const ctx = await contexte(req, 'stats.lire');
    return avec(ctx, async (db) => {
      const p: unknown[] = [];
      const equipes = (await db.query(`SELECT e.* FROM equipes e WHERE NOT e.archivee AND ${filtreEquipes(ctx, 'stats.lire', 'e.id', p)} ORDER BY e.nom`, p)).rows;
      const out = [];
      for (const e of equipes) {
        const matchs = await matchsCodes(db, ctx, { equipeId: e.id, types: ['officiel'] });
        const bilan = { victoires: 0, nuls: 0, defaites: 0, pointsPour: 0, pointsContre: 0 };
        for (const m of matchs) {
          const n = m.match.score_nous ?? m.stats.score.nous;
          const a = m.match.score_adv ?? m.stats.score.adversaire;
          bilan.pointsPour += n;
          bilan.pointsContre += a;
          if (n > a) bilan.victoires++; else if (n < a) bilan.defaites++; else bilan.nuls++;
        }
        const prochains = (await db.query(
          `SELECT m.id, m.date, a.nom AS adversaire, m.domicile FROM matchs m LEFT JOIN adversaires a ON a.id = m.adversaire_id
           WHERE m.equipe_id = $1 AND m.date > now() AND m.type <> 'observation' ORDER BY m.date LIMIT 3`, [e.id])).rows;
        out.push({ equipe: e, bilan, nbMatchsCodes: matchs.length, indicateurs: agregerMatchs(matchs.map((m) => m.stats)).filter((i) => ['points', 'essais', 'plaquages_reussis', 'touches', 'melees', 'penalites'].includes(i.key)), prochains });
      }
      return out;
    });
  });

  // Recherche en langage naturel dans les événements codés
  app.get('/api/clubs/:clubId/recherche', async (req) => {
    const ctx = await contexte(req, 'stats.lire');
    exigerFonction(ctx, 'ia');
    const { q, matchId, equipeId } = valider(z.object({ q: z.string().min(2), matchId: uuid.optional(), equipeId: uuid.optional() }), req.query);
    return avec(ctx, async (db) => {
      const types = await typesDuClub(db);
      const joueurs = (await db.query('SELECT id, nom, prenom, numero_habituel AS numero FROM joueurs')).rows;
      const filtre = analyserRecherche(q, types, joueurs);
      const matchs = matchId ? [(await chargerMatch(db, (await matchAccessible(db, ctx, matchId, 'stats.lire')).id, { types }))!] : await matchsCodes(db, ctx, { equipeId });
      const resultats = matchs.flatMap((m) => appliquerFiltre(m.evenements, filtre, types, {
        dureeMiTemps: m.match.duree_mi_temps, coupEnvoi1: m.match.coup_envoi_1, coupEnvoi2: m.match.coup_envoi_2,
      }).map((e) => ({ ...e, matchId: m.match.id, adversaire: m.match.adversaire_nom, date: m.match.date })));
      return { filtre, resultats: resultats.slice(0, 500), total: resultats.length };
    });
  });

  // Rapport adverse : nos matchs contre lui + matchs d'observation (l'adversaire est codé en camp "adversaire")
  app.get('/api/clubs/:clubId/adversaires/:id/rapport', async (req) => {
    const ctx = await contexte(req, 'stats.lire');
    exigerFonction(ctx, 'analyse_adverse');
    const { id } = valider(z.object({ id: uuid }), req.params);
    return avec(ctx, async (db) => {
      const adv = (await db.query('SELECT * FROM adversaires WHERE id = $1', [id])).rows[0];
      if (!adv) throw nonTrouve('Adversaire');
      const matchs = await matchsCodes(db, ctx, { adversaireId: id });
      const evsAdverses = matchs.flatMap((m) => m.evenements.filter((e) => e.camp === 'adversaire'));
      const rapport = rapportAdverse(matchs.map((m) => m.stats), evsAdverses);
      const joueursConnus = (await db.query('SELECT numero, nom, poste FROM joueurs_adverses WHERE adversaire_id = $1', [id])).rows;
      return {
        adversaire: adv, ...rapport,
        joueursCles: rapport.joueursCles.map((j) => ({ ...j, ...joueursConnus.find((k) => k.numero === j.numero) })),
        matchs: matchs.map((m) => ({ id: m.match.id, date: m.match.date, type: m.match.type, score: m.stats.score })),
        // Événements clés (avec timecodes) pour la playlist « préparation »
        cles: evsAdverses.filter((e) => ['essai', 'touche', 'jeu_au_pied', 'penalite_tentee', 'melee', 'franchissement'].includes(e.typeKey))
          .map((e) => ({ id: e.id, typeKey: e.typeKey, matchId: e.matchId, debut: e.debut, resultat: e.resultat })),
      };
    });
  });
}
