// Analyses dérivées : objectifs, saison, rapport adverse, résumé automatique, santé et charge.
import type { Camp } from './types.js';
import type { Indicateur, StatsMatch } from './stats.js';

// Objectifs par match (tableau de bord après-match vert/rouge)
export interface Objectif {
  key: string; // clé d'indicateur
  camp: Camp;
  cible: number;
}

export interface EtatObjectif extends Objectif {
  label: string;
  valeur: number | null;
  atteint: boolean | null;
  ids: string[];
  format: Indicateur['format'];
}

export function evaluerObjectifs(stats: StatsMatch, objectifs: Objectif[]): EtatObjectif[] {
  return objectifs.map((o) => {
    const ind = stats.indicateurs.find((i) => i.key === o.key);
    if (!ind) return { ...o, label: o.key, valeur: null, atteint: null, ids: [], format: 'nombre' };
    const val = ind[o.camp].valeur;
    // L'objectif sur l'adversaire s'interprète à l'inverse (ex. points encaissés : rester sous la cible)
    const sens = o.camp === 'nous' ? ind.sens : ind.sens === 'haut' ? 'bas' : 'haut';
    const atteint = val == null ? null : sens === 'haut' ? val >= o.cible : val <= o.cible;
    return { ...o, label: ind.label + (o.camp === 'adversaire' ? ' (adversaire)' : ''), valeur: val, atteint, ids: ind[o.camp].ids, format: ind.format };
  });
}

export const OBJECTIFS_DEFAUT: Objectif[] = [
  { key: 'plaquages_reussis', camp: 'nous', cible: 85 },
  { key: 'melees', camp: 'nous', cible: 90 },
  { key: 'touches', camp: 'nous', cible: 85 },
  { key: 'penalites', camp: 'nous', cible: 10 },
  { key: 'rucks_gagnes', camp: 'nous', cible: 92 },
  { key: 'rucks_rapides', camp: 'nous', cible: 50 },
  { key: 'points_par_entree', camp: 'nous', cible: 3 },
  { key: 'renvois', camp: 'nous', cible: 30 },
  { key: 'turnovers', camp: 'nous', cible: 6 },
  { key: 'points', camp: 'adversaire', cible: 15 },
];

// Agrégation sur plusieurs matchs (saison, comparaison, moyenne)
export interface IndicateurAgrege {
  key: string;
  label: string;
  famille: string;
  format: Indicateur['format'];
  sens: Indicateur['sens'];
  moyenneNous: number | null;
  moyenneAdversaire: number | null;
  serieNous: (number | null)[];
  serieAdversaire: (number | null)[];
}

const moyenne = (l: (number | null)[]) => {
  const n = l.filter((x): x is number => x != null);
  return n.length ? Math.round((n.reduce((a, b) => a + b, 0) / n.length) * 10) / 10 : null;
};

export function agregerMatchs(matchs: StatsMatch[]): IndicateurAgrege[] {
  if (!matchs.length) return [];
  return matchs[0].indicateurs.map((ref) => {
    const serieNous = matchs.map((m) => m.indicateurs.find((i) => i.key === ref.key)?.nous.valeur ?? null);
    const serieAdversaire = matchs.map((m) => m.indicateurs.find((i) => i.key === ref.key)?.adversaire.valeur ?? null);
    return {
      key: ref.key, label: ref.label, famille: ref.famille, format: ref.format, sens: ref.sens,
      moyenneNous: moyenne(serieNous), moyenneAdversaire: moyenne(serieAdversaire), serieNous, serieAdversaire,
    };
  });
}

/** Moyennes individuelles par poste, pour le radar joueur vs moyenne du poste. */
export function moyennesParPoste(
  lignes: { joueurId: string; poste: string | null; valeurs: Record<string, number>; minutes: number }[],
  cles: string[],
): Record<string, Record<string, number>> {
  const parPoste: Record<string, { somme: Record<string, number>; minutes: number }> = {};
  for (const l of lignes) {
    if (!l.poste) continue;
    const p = (parPoste[l.poste] ??= { somme: {}, minutes: 0 });
    p.minutes += l.minutes;
    for (const k of cles) p.somme[k] = (p.somme[k] ?? 0) + (l.valeurs[k] ?? 0);
  }
  // Ramené à 80 minutes jouées
  const out: Record<string, Record<string, number>> = {};
  for (const [poste, p] of Object.entries(parPoste)) {
    out[poste] = Object.fromEntries(cles.map((k) => [k, p.minutes ? Math.round(((p.somme[k] ?? 0) / p.minutes) * 80 * 10) / 10 : 0]));
  }
  return out;
}

// Rapport adverse : synthèse des matchs où l'adversaire a été codé (camp "adversaire")
export interface RapportAdverse {
  nbMatchs: number;
  indicateurs: IndicateurAgrege[];
  pointsForts: string[];
  pointsFaibles: string[];
  joueursCles: { numero: number; actions: number; detail: Record<string, number> }[];
  schemas: string[];
}

export function rapportAdverse(
  matchs: StatsMatch[],
  evenementsAdverses: { typeKey: string; numeroAdverse?: number | null; attributs: Record<string, unknown>; resultat?: string | null }[],
): RapportAdverse {
  const ind = agregerMatchs(matchs);
  const get = (k: string) => ind.find((i) => i.key === k);
  const pointsForts: string[] = [];
  const pointsFaibles: string[] = [];
  const seuil = (k: string, haut: number, bas: number, fort: string, faible: string) => {
    const x = get(k)?.moyenneAdversaire;
    if (x == null) return;
    if (x >= haut) pointsForts.push(`${fort} (${x} %)`);
    else if (x <= bas) pointsFaibles.push(`${faible} (${x} %)`);
  };
  seuil('touches', 90, 75, 'Touche très fiable', 'Touche fragile');
  seuil('melees', 92, 80, 'Mêlée dominante', 'Mêlée en difficulté');
  seuil('plaquages_reussis', 88, 78, 'Défense solide', 'Défense perméable');
  seuil('buteur', 75, 55, 'Buteur fiable', 'Buteur irrégulier');
  seuil('rucks_rapides', 55, 35, 'Libération rapide au ruck', 'Rucks lents');
  const pen = get('penalites')?.moyenneAdversaire;
  if (pen != null && pen >= 12) pointsFaibles.push(`Indiscipline (${pen} pénalités par match)`);

  const parNumero = new Map<number, Record<string, number>>();
  for (const e of evenementsAdverses) {
    if (e.numeroAdverse == null) continue;
    const d = parNumero.get(e.numeroAdverse) ?? {};
    d[e.typeKey] = (d[e.typeKey] ?? 0) + 1;
    parNumero.set(e.numeroAdverse, d);
  }
  const joueursCles = [...parNumero.entries()]
    .map(([numero, detail]) => ({ numero, detail, actions: Object.values(detail).reduce((a, b) => a + b, 0) }))
    .sort((a, b) => b.actions - a.actions)
    .slice(0, 5);

  // Schémas récurrents : cible de touche, type de jeu au pied, motif de pénalité dominants
  const schemas: string[] = [];
  const dominant = (typeKey: string, attr: string, phrase: (v: string, p: number) => string) => {
    const l = evenementsAdverses.filter((e) => e.typeKey === typeKey && e.attributs?.[attr] != null);
    if (l.length < 4) return;
    const c = new Map<string, number>();
    for (const e of l) c.set(String(e.attributs[attr]), (c.get(String(e.attributs[attr])) ?? 0) + 1);
    const [val, n] = [...c.entries()].sort((a, b) => b[1] - a[1])[0];
    const p = Math.round((n / l.length) * 100);
    if (p >= 45) schemas.push(phrase(val.replace(/_/g, ' '), p));
  };
  dominant('touche', 'cible', (v, p) => `Lance majoritairement ${v} de touche (${p} %)`);
  dominant('jeu_au_pied', 'type', (v, p) => `Jeu au pied privilégié : ${v} (${p} %)`);
  dominant('penalite', 'motif', (v, p) => `Faute la plus fréquente : ${v} (${p} %)`);
  dominant('essai', 'origine', (v, p) => `Marque surtout sur ${v} (${p} % des essais)`);

  return { nbMatchs: matchs.length, indicateurs: ind, pointsForts, pointsFaibles, joueursCles, schemas };
}

// Résumé automatique et suggestions d'exercices
export function resumeMatch(stats: StatsMatch, noms: { equipe: string; adversaire: string; joueurs: Record<string, string> }): string {
  const { nous, adversaire } = stats.score;
  const issue = nous > adversaire ? 'Victoire' : nous < adversaire ? 'Défaite' : 'Match nul';
  const phrases = [`${issue} ${nous} à ${adversaire} face à ${noms.adversaire}.`];
  const mt = stats.parMiTemps;
  if (mt[0].nous.valeur != null) phrases.push(`Score à la pause : ${mt[0].nous.valeur ?? 0} à ${mt[0].adversaire.valeur ?? 0}.`);
  const ind = (k: string) => stats.indicateurs.find((i) => i.key === k);
  const bloc = (k: string, label: string) => {
    const i = ind(k);
    if (i?.nous.valeur != null) phrases.push(`${label} : ${i.nous.valeur}${i.format === 'pourcentage' ? ' %' : ''}.`);
  };
  bloc('plaquages_reussis', 'Plaquages réussis');
  bloc('touches', 'Touches gagnées sur notre lancer');
  bloc('melees', 'Mêlées gagnées sur notre introduction');
  bloc('penalites', 'Pénalités concédées');
  const meilleurs = stats.joueurs.slice(0, 3).filter((j) => j.contribution > 0).map((j) => noms.joueurs[j.joueurId] ?? 'Joueur');
  if (meilleurs.length) phrases.push(`Plus fortes contributions : ${meilleurs.join(', ')}.`);
  const fort = [...stats.momentum].sort((a, b) => b.valeur - a.valeur)[0];
  const faible = [...stats.momentum].sort((a, b) => a.valeur - b.valeur)[0];
  if (fort && fort.valeur > 0) phrases.push(`Meilleur temps fort entre ${fort.label}.`);
  if (faible && faible.valeur < 0) phrases.push(`Période la plus difficile entre ${faible.label}.`);
  return phrases.join(' ');
}

const EXERCICES: Record<string, string[]> = {
  plaquages_reussis: ['Plaquage 1 contre 1 en couloir réduit', 'Atelier placement de tête et épaule', 'Défense en ligne avec montée inversée'],
  touches: ['Répétition lancer-saut en 3 contre 0 puis opposition', 'Codes de touche sous pression du temps', 'Lancer sur cible fixe à 5, 10, 15 m'],
  melees: ['Poussée sur joug avec bind correct', 'Mêlée 3 contre 3 en opposition contrôlée', 'Travail de liaison talonneur et piliers'],
  penalites: ['Jeu réduit avec arbitrage strict au ruck', 'Rappel des règles du hors-jeu en vidéo', 'Exercice de repli derrière le dernier pied'],
  rucks_rapides: ['Nettoyage à 2 en moins de 3 secondes', 'Placement du porteur au sol (présentation longue)', 'Jeu à toucher avec ruck imposé'],
  renvois: ['Réception de renvoi avec ascenseur', 'Poursuite sur renvoi court'],
  jap_recuperes: ['Chandelle et poursuite à 3', 'Diagonale et chasse en ligne'],
  buteur: ['Routine de tir sous fatigue', 'Tirs par zone avec feuille de suivi'],
};

export function suggestionsExercices(stats: StatsMatch, objectifs = OBJECTIFS_DEFAUT): { indicateur: string; exercices: string[] }[] {
  return evaluerObjectifs(stats, objectifs)
    .filter((o) => o.atteint === false && EXERCICES[o.key])
    .map((o) => ({ indicateur: o.label, exercices: EXERCICES[o.key] }));
}

// Santé et charge (V2)
export interface SeanceCharge {
  date: string; // AAAA-MM-JJ
  rpe: number; // 1 à 10
  dureeMinutes: number;
}

export function chargeSeance(s: SeanceCharge): number {
  return s.rpe * s.dureeMinutes;
}

/** Ratio aigu/chronique : charge des 7 derniers jours / moyenne hebdomadaire des 28 derniers jours. */
export function ratioAiguChronique(seances: SeanceCharge[], dateRef: string): { aigue: number; chronique: number; ratio: number | null; zone: 'sous_charge' | 'optimale' | 'risque' | 'inconnue' } {
  const ref = new Date(dateRef + 'T00:00:00Z').getTime();
  const jour = 86400000;
  const dans = (s: SeanceCharge, jours: number) => {
    const d = new Date(s.date + 'T00:00:00Z').getTime();
    return d <= ref && d > ref - jours * jour;
  };
  const aigue = seances.filter((s) => dans(s, 7)).reduce((a, s) => a + chargeSeance(s), 0);
  const chronique = seances.filter((s) => dans(s, 28)).reduce((a, s) => a + chargeSeance(s), 0) / 4;
  const ratio = chronique > 0 ? Math.round((aigue / chronique) * 100) / 100 : null;
  const zone = ratio == null ? 'inconnue' : ratio < 0.8 ? 'sous_charge' : ratio <= 1.3 ? 'optimale' : 'risque';
  return { aigue, chronique: Math.round(chronique), ratio, zone };
}

/** Étapes du protocole commotion (retour progressif) : la sélection est bloquée tant que la dernière n'est pas validée. */
export const ETAPES_PROTOCOLE_COMMOTION = [
  'Repos complet et évaluation médicale initiale',
  'Activité légère sans contact',
  'Exercices spécifiques au rugby sans contact',
  'Entraînement sans contact plus intense',
  'Entraînement avec contact après avis médical',
  'Autorisation médicale de reprise de la compétition',
];
