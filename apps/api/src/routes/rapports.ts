// Rapports PDF en un clic (modèles personnalisables via la configuration du club).
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  agregerMatchs, evaluerObjectifs, rapportAdverse, resumeMatch, LIBELLES_STATS_JOUEUR, formatMinute, horlogeDepuisVideo,
} from '@rugby/shared';
import { avec, contexte, exigerFonction, exigerPermission, journaliser, matchAccessible, valider, uuid } from '../lib/contexte.js';
import { chargerMatch, configClub, nomsJoueurs } from '../lib/donneesMatch.js';
import { entete, nouveauDoc, paragraphe, puces, section, tableau, terrain } from '../lib/pdf.js';
import { matchsCodes } from './stats.js';
import { nonTrouve } from '../lib/erreurs.js';

const fmt = (v: number | null | undefined, f?: string) => (v == null ? '-' : f === 'pourcentage' ? `${v} %` : f === 'metres' ? `${v} m` : f === 'secondes' ? `${v} s` : String(v));
const dateFr = (d: string | Date) => new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

const INDICATEURS_APRES_MATCH = ['points', 'essais', 'possession', 'melees', 'touches', 'renvois', 'rucks_gagnes', 'rucks_rapides',
  'plaquages_reussis', 'plaquages_dominants', 'turnovers', 'franchissements', 'points_par_entree', 'jap_recuperes', 'penalites', 'cartons', 'buteur'];

function envoyer(reply: FastifyReply, nom: string, pdf: Buffer) {
  reply.header('Content-Type', 'application/pdf');
  reply.header('Content-Disposition', `inline; filename="${nom}.pdf"`);
  return reply.send(pdf);
}

export default async function routesRapports(app: FastifyInstance) {
  app.get('/api/clubs/:clubId/matchs/:id/rapport.pdf', async (req, reply) => {
    const ctx = await contexte(req, 'stats.lire');
    const { id } = valider(z.object({ id: uuid }), req.params);
    const pdf = await avec(ctx, async (db) => {
      await matchAccessible(db, ctx, id, 'stats.lire');
      const m = (await chargerMatch(db, id))!;
      const conf = await configClub(db);
      const club = (await db.query('SELECT nom, couleurs FROM clubs LIMIT 1')).rows[0];
      const noms = await nomsJoueurs(db);
      const modele = conf.modelesRapport?.apresMatch ?? {};
      const cles: string[] = modele.indicateurs ?? INDICATEURS_APRES_MATCH;
      const { doc, fin } = nouveauDoc('Rapport après-match');
      const adv = m.match.adversaire_nom ?? 'Adversaire';
      entete(doc, club, `${m.match.equipe_nom} ${m.stats.score.nous} - ${m.stats.score.adversaire} ${adv}`, `${dateFr(m.match.date)} · ${m.match.domicile ? 'Domicile' : 'Extérieur'}${m.match.competition ? ` · ${m.match.competition}` : ''}`);
      const mt = m.stats.parMiTemps[0];
      paragraphe(doc, `Mi-temps : ${mt.nous.valeur ?? 0} - ${mt.adversaire.valeur ?? 0}.  Arbitre : ${m.match.arbitre ?? 'non renseigné'}.  Météo : ${m.match.meteo ?? 'non renseignée'}.`);
      section(doc, 'Résumé');
      paragraphe(doc, resumeMatch(m.stats, { equipe: m.match.equipe_nom, adversaire: adv, joueurs: noms }));

      section(doc, 'Objectifs du match');
      const obj = evaluerObjectifs(m.stats, m.match.objectifs ?? conf.objectifs);
      tableau(doc, ['Indicateur', 'Objectif', 'Réalisé', 'Statut'], obj.map((o) => [o.label, fmt(o.cible, o.format), fmt(o.valeur, o.format), o.atteint == null ? 'Non mesuré' : o.atteint ? 'Atteint' : 'Non atteint']),
        [250, 85, 85, 95], obj.map((o) => [null, null, null, o.atteint == null ? '#777777' : o.atteint ? '#1a7f37' : '#c62828']));

      section(doc, 'Statistiques clés');
      const inds = cles.map((k) => m.stats.indicateurs.find((i) => i.key === k)).filter((i): i is NonNullable<typeof i> => !!i && (i.nous.valeur != null || i.adversaire.valeur != null));
      tableau(doc, ['Indicateur', m.match.equipe_nom, adv], inds.map((i) => [i.label, fmt(i.nous.valeur, i.format), fmt(i.adversaire.valeur, i.format)]), [255, 130, 130]);

      section(doc, 'Points par tranche de 10 minutes');
      tableau(doc, ['Tranche', ...m.stats.parTranche.map((t) => t.label)], [
        [m.match.equipe_nom, ...m.stats.parTranche.map((t) => t.nous.valeur ?? 0)],
        [adv, ...m.stats.parTranche.map((t) => t.adversaire.valeur ?? 0)],
      ]);

      section(doc, 'Carte du match');
      const loc = m.evenements.filter((e) => e.x != null && e.y != null && ['essai', 'penalite', 'plaquage', 'turnover', 'franchissement'].includes(e.typeKey));
      terrain(doc, loc.map((e) => ({
        x: e.x as number, y: e.y as number,
        couleur: e.typeKey === 'essai' ? (e.camp === 'nous' ? '#1565c0' : '#c62828') : e.typeKey === 'penalite' ? '#f9a825' : e.typeKey === 'turnover' ? '#6a1b9a' : e.typeKey === 'franchissement' ? '#00897b' : '#ffffff',
        forme: e.typeKey === 'plaquage' && !['dominant', 'passif'].includes(e.resultat ?? '') ? ('croix' as const) : ('rond' as const),
      })).filter((p) => !(p.couleur === '#ffffff' && p.forme !== 'croix')), [
        { label: 'Essai pour', couleur: '#1565c0' }, { label: 'Essai contre', couleur: '#c62828' }, { label: 'Pénalité concédée', couleur: '#f9a825' },
        { label: 'Turnover', couleur: '#6a1b9a' }, { label: 'Franchissement', couleur: '#00897b' }, { label: 'Plaquage manqué (croix)', couleur: '#ffffff' },
      ]);

      section(doc, 'Chronologie');
      const reperes = { dureeMiTemps: m.match.duree_mi_temps, coupEnvoi1: m.match.coup_envoi_1, coupEnvoi2: m.match.coup_envoi_2 };
      const chrono = m.evenements.filter((e) => ['essai', 'transformation', 'penalite_tentee', 'drop', 'carton', 'essai_penalite'].includes(e.typeKey) && (e.typeKey !== 'transformation' && e.typeKey !== 'penalite_tentee' && e.typeKey !== 'drop' || ['reussie', 'reussi'].includes(e.resultat ?? '')));
      tableau(doc, ['Minute', 'Équipe', 'Action', 'Joueur'], chrono.map((e) => [
        formatMinute(horlogeDepuisVideo(e.debut, reperes), m.match.duree_mi_temps) || '-', e.camp === 'nous' ? m.match.equipe_nom : adv,
        `${m.types.find((t) => t.key === e.typeKey)?.label ?? e.typeKey}${e.typeKey === 'carton' ? ` ${e.resultat}` : ''}`,
        e.camp === 'nous' ? (noms[e.joueurs[0]] ?? '') : e.numeroAdverse ? `n° ${e.numeroAdverse}` : '',
      ]), [60, 130, 160, 165]);

      if (m.match.points_positifs?.length || m.match.axes_travail?.length) {
        section(doc, '3 points positifs');
        puces(doc, m.match.points_positifs, '#1a7f37');
        section(doc, '3 axes de travail');
        puces(doc, m.match.axes_travail, '#c62828');
      }

      section(doc, 'Joueurs');
      const lignesJ = m.stats.joueurs.filter((j) => j.tempsDeJeu > 0 || Object.keys(j.valeurs).length).slice(0, 25);
      tableau(doc, ['Joueur', 'Min.', 'Pts', 'Plaq. réussis', 'Plaq. manqués', 'Franch.', 'Turnovers', 'Pén. conc.', 'Contribution'],
        lignesJ.map((j) => [noms[j.joueurId] ?? '?', j.tempsDeJeu, j.valeurs.points?.valeur ?? 0, j.valeurs.plaquages_reussis?.valeur ?? 0, j.valeurs.plaquages_manques?.valeur ?? 0,
          j.valeurs.franchissements?.valeur ?? 0, j.valeurs.turnovers?.valeur ?? 0, j.valeurs.penalites_concedees?.valeur ?? 0, j.contribution]),
        [140, 35, 35, 55, 55, 45, 50, 50, 50]);
      await journaliser(db, ctx, 'export', 'rapport_apres_match', id);
      return fin();
    });
    return envoyer(reply, 'rapport-apres-match', pdf);
  });

  app.get('/api/clubs/:clubId/joueurs/:id/rapport.pdf', async (req, reply) => {
    const ctx = await contexte(req);
    const { id } = valider(z.object({ id: uuid }), req.params);
    if (!ctx.adhesions.some((a) => a.joueurId === id)) exigerPermission(ctx, 'stats.lire');
    const pdf = await avec(ctx, async (db) => {
      const j = (await db.query('SELECT * FROM joueurs WHERE id = $1', [id])).rows[0];
      if (!j) throw nonTrouve('Joueur');
      const club = (await db.query('SELECT nom, couleurs FROM clubs LIMIT 1')).rows[0];
      const ids = (await db.query('SELECT DISTINCT match_id FROM feuille_match WHERE joueur_id = $1', [id])).rows.map((r) => r.match_id);
      const lignes = [];
      const totaux: Record<string, number> = {};
      let minutes = 0;
      for (const mid of ids) {
        const m = (await chargerMatch(db, mid))!;
        const s = m.stats.joueurs.find((x) => x.joueurId === id);
        if (!s) continue;
        minutes += s.tempsDeJeu;
        for (const [k, v] of Object.entries(s.valeurs)) totaux[k] = (totaux[k] ?? 0) + (v.valeur ?? 0);
        lignes.push({ date: m.match.date, adv: m.match.adversaire_nom, s });
      }
      lignes.sort((a, b) => String(a.date).localeCompare(String(b.date)));
      const { doc, fin } = nouveauDoc('Rapport individuel');
      entete(doc, club, `${j.prenom} ${j.nom}`, `${j.poste_principal ?? 'Poste non renseigné'} · ${lignes.length} match(s) · ${Math.round(minutes)} min`);
      section(doc, 'Totaux');
      const cles = Object.keys(LIBELLES_STATS_JOUEUR).filter((k) => totaux[k]);
      tableau(doc, ['Statistique', 'Total', 'Pour 80 min'], cles.map((k) => [LIBELLES_STATS_JOUEUR[k], totaux[k], minutes ? Math.round((totaux[k] / minutes) * 80 * 10) / 10 : '-']), [255, 130, 130]);
      section(doc, 'Match par match');
      tableau(doc, ['Date', 'Adversaire', 'Min.', 'Pts', 'Plaquages', 'Franch.', 'Turnovers', 'Contribution'],
        lignes.map((l) => [new Date(l.date).toLocaleDateString('fr-FR'), l.adv ?? '-', l.s.tempsDeJeu, l.s.valeurs.points?.valeur ?? 0,
          `${l.s.valeurs.plaquages_reussis?.valeur ?? 0}/${l.s.valeurs.plaquages_tentes?.valeur ?? 0}`, l.s.valeurs.franchissements?.valeur ?? 0, l.s.valeurs.turnovers?.valeur ?? 0, l.s.contribution]),
        [60, 120, 40, 35, 65, 50, 60, 85]);
      if (j.objectifs_perso?.length) {
        section(doc, 'Objectifs individuels');
        puces(doc, j.objectifs_perso.map((o: any) => `${o.libelle ?? LIBELLES_STATS_JOUEUR[o.key] ?? o.key} : ${o.cible} (réalisé ${totaux[o.key] ?? 0})`));
      }
      await journaliser(db, ctx, 'export', 'rapport_individuel', id);
      return fin();
    });
    return envoyer(reply, 'rapport-individuel', pdf);
  });

  // Rapport de saison et rapport de fin de cycle (jeunes) : même trame, le second ajoute les appréciations
  const rapportSaison = async (req: any, reply: FastifyReply, cycle: boolean) => {
    const { id } = valider(z.object({ id: uuid }), req.params);
    const ctx = await contexte(req, 'stats.lire', id);
    const appreciations = (req.method === 'POST' ? valider(z.object({ appreciations: z.record(z.string()).default({}) }), req.body ?? {}).appreciations : {}) as Record<string, string>;
    const pdf = await avec(ctx, async (db) => {
      const eq = (await db.query('SELECT e.*, s.libelle AS saison FROM equipes e JOIN saisons s ON s.id = e.saison_id WHERE e.id = $1', [id])).rows[0];
      if (!eq) throw nonTrouve('Équipe');
      const club = (await db.query('SELECT nom, couleurs FROM clubs LIMIT 1')).rows[0];
      const noms = await nomsJoueurs(db);
      const matchs = await matchsCodes(db, ctx, { equipeId: id, types: ['officiel', 'amical'] });
      const { doc, fin } = nouveauDoc(cycle ? 'Bilan de fin de cycle' : 'Rapport de saison');
      entete(doc, club, `${cycle ? 'Bilan de fin de cycle' : 'Rapport de saison'} : ${eq.nom}`, `Saison ${eq.saison} · ${matchs.length} match(s) codé(s)`);
      section(doc, 'Résultats');
      tableau(doc, ['Date', 'Adversaire', 'Lieu', 'Score'], matchs.map((m) => [new Date(m.match.date).toLocaleDateString('fr-FR'), m.match.adversaire_nom ?? '-', m.match.domicile ? 'Dom.' : 'Ext.', `${m.stats.score.nous} - ${m.stats.score.adversaire}`]), [80, 240, 60, 135]);
      section(doc, 'Moyennes par match');
      const ag = agregerMatchs(matchs.map((m) => m.stats)).filter((i) => i.moyenneNous != null || i.moyenneAdversaire != null);
      tableau(doc, ['Indicateur', 'Nous', 'Adversaires'], ag.map((i) => [i.label, fmt(i.moyenneNous, i.format), fmt(i.moyenneAdversaire, i.format)]), [255, 130, 130]);
      section(doc, 'Joueurs');
      const cumul = new Map<string, { min: number; matchs: number; contrib: number; premiere: number; seconde: number }>();
      matchs.forEach((m, idx) => {
        for (const j of m.stats.joueurs) {
          const c = cumul.get(j.joueurId) ?? { min: 0, matchs: 0, contrib: 0, premiere: 0, seconde: 0 };
          c.min += j.tempsDeJeu;
          if (j.tempsDeJeu > 0) c.matchs++;
          c.contrib += j.contribution;
          if (idx < matchs.length / 2) c.premiere += j.contribution; else c.seconde += j.contribution;
          cumul.set(j.joueurId, c);
        }
      });
      const lignes = [...cumul.entries()].sort((a, b) => b[1].min - a[1].min);
      tableau(doc, ['Joueur', 'Matchs', 'Minutes', 'Contribution', 'Évolution'], lignes.map(([jid, c]) => [noms[jid] ?? '?', c.matchs, Math.round(c.min), Math.round(c.contrib * 10) / 10,
        c.seconde > c.premiere ? 'En progrès' : c.seconde < c.premiere ? 'En baisse' : 'Stable']), [180, 60, 70, 90, 115]);
      if (cycle) {
        section(doc, 'Appréciations individuelles');
        for (const [jid] of lignes) {
          if (appreciations[jid]) {
            doc.font('Helvetica-Bold').text(noms[jid] ?? '?');
            paragraphe(doc, appreciations[jid]);
          }
        }
        // Formation : le temps de jeu équitable est un indicateur clé chez les jeunes
        const mins = lignes.map(([, c]) => c.min);
        if (mins.length) paragraphe(doc, `Temps de jeu : de ${Math.round(Math.min(...mins))} à ${Math.round(Math.max(...mins))} minutes selon les joueurs.`);
      }
      await journaliser(db, ctx, 'export', cycle ? 'rapport_fin_cycle' : 'rapport_saison', id);
      return fin();
    });
    return envoyer(reply, cycle ? 'bilan-fin-de-cycle' : 'rapport-saison', pdf);
  };
  app.get('/api/clubs/:clubId/equipes/:id/rapport-saison.pdf', (req, reply) => rapportSaison(req, reply, false));
  app.post('/api/clubs/:clubId/equipes/:id/rapport-fin-cycle.pdf', (req, reply) => rapportSaison(req, reply, true));

  app.get('/api/clubs/:clubId/adversaires/:id/rapport.pdf', async (req, reply) => {
    const ctx = await contexte(req, 'stats.lire');
    exigerFonction(ctx, 'analyse_adverse');
    const { id } = valider(z.object({ id: uuid }), req.params);
    const pdf = await avec(ctx, async (db) => {
      const adv = (await db.query('SELECT * FROM adversaires WHERE id = $1', [id])).rows[0];
      if (!adv) throw nonTrouve('Adversaire');
      const club = (await db.query('SELECT nom, couleurs FROM clubs LIMIT 1')).rows[0];
      const matchs = await matchsCodes(db, ctx, { adversaireId: id });
      const r = rapportAdverse(matchs.map((m) => m.stats), matchs.flatMap((m) => m.evenements.filter((e) => e.camp === 'adversaire')));
      const connus = (await db.query('SELECT numero, nom, poste FROM joueurs_adverses WHERE adversaire_id = $1', [id])).rows;
      const { doc, fin } = nouveauDoc('Rapport adverse');
      entete(doc, club, `Rapport adverse : ${adv.nom}`, `${r.nbMatchs} match(s) analysé(s)`);
      section(doc, 'Points forts');
      puces(doc, r.pointsForts.length ? r.pointsForts : ['Aucun point fort marqué sur les données disponibles']);
      section(doc, 'Points faibles');
      puces(doc, r.pointsFaibles.length ? r.pointsFaibles : ['Aucun point faible marqué sur les données disponibles']);
      section(doc, 'Schémas récurrents');
      puces(doc, r.schemas.length ? r.schemas : ['Pas assez de données pour dégager des schémas']);
      section(doc, 'Joueurs clés');
      tableau(doc, ['N°', 'Nom', 'Poste', 'Actions', 'Détail'], r.joueursCles.map((j) => {
        const k = connus.find((c) => c.numero === j.numero);
        return [j.numero, k?.nom ?? '-', k?.poste ?? '-', j.actions, Object.entries(j.detail).map(([t, n]) => `${t.replace(/_/g, ' ')} ${n}`).join(', ')];
      }), [35, 110, 70, 50, 250]);
      section(doc, 'Moyennes de l\'adversaire');
      const lignes = r.indicateurs.filter((i) => i.moyenneAdversaire != null && ['points', 'essais', 'melees', 'touches', 'renvois', 'rucks_rapides', 'plaquages_reussis', 'jeu_au_pied', 'jap_recuperes', 'penalites', 'buteur', '50_22'].includes(i.key));
      tableau(doc, ['Indicateur', 'Moyenne'], lignes.map((i) => [i.label, fmt(i.moyenneAdversaire, i.format)]), [330, 185]);
      await journaliser(db, ctx, 'export', 'rapport_adverse', id);
      return fin();
    });
    return envoyer(reply, 'rapport-adverse', pdf);
  });
}
