// Chargement d'un match complet et calcul de ses stats (partagé par stats, rapports, app joueur, adverse).
import {
  calculerStats, OBJECTIFS_DEFAUT, POIDS_CONTRIBUTION_DEFAUT, TAXONOMIE_DEFAUT,
  type ChangementFeuille, type DefinitionTypeEvenement, type Evenement, type LigneFeuille, type Objectif, type StatsMatch,
} from '@rugby/shared';
import type { Db } from './db.js';

export function versEvenement(r: Record<string, any>): Evenement & Record<string, any> {
  return {
    id: r.id, typeKey: r.type_key, camp: r.camp, joueurs: r.joueurs ?? [], numeroAdverse: r.numero_adverse,
    resultat: r.resultat, attributs: r.attributs ?? {}, debut: r.debut, fin: r.fin, x: r.x, y: r.y,
    commentaire: r.commentaire, source: r.source, aCompleter: r.a_completer, version: r.version,
    supprime: r.supprime, auteurId: r.auteur_id, majLe: r.maj_le, matchId: r.match_id,
  };
}

export async function typesDuClub(db: Db): Promise<DefinitionTypeEvenement[]> {
  const r = await db.query('SELECT definition FROM types_evenements WHERE actif ORDER BY (definition->>\'ordre\')::int');
  return r.rows.length ? r.rows.map((x) => x.definition) : TAXONOMIE_DEFAUT;
}

export async function configClub(db: Db): Promise<{ objectifs: Objectif[]; poids: Record<string, number>; prePost: Record<string, { pre: number; post: number }>; [k: string]: any }> {
  const c = (await db.query('SELECT config FROM clubs LIMIT 1')).rows[0]?.config ?? {};
  return { ...c, objectifs: c.objectifs ?? OBJECTIFS_DEFAUT, poids: c.poids ?? POIDS_CONTRIBUTION_DEFAUT, prePost: c.prePost ?? {} };
}

export interface MatchComplet {
  match: Record<string, any>;
  evenements: ReturnType<typeof versEvenement>[];
  feuille: (LigneFeuille & { poste: string | null; prenom: string; nom: string; capitaine: boolean })[];
  changements: (ChangementFeuille & { id: string; evenementId: string | null })[];
  types: DefinitionTypeEvenement[];
  stats: StatsMatch;
}

export async function chargerMatch(db: Db, matchId: string, options: { types?: DefinitionTypeEvenement[]; poids?: Record<string, number> } = {}): Promise<MatchComplet | null> {
  const match = (await db.query(
    `SELECT m.*, a.nom AS adversaire_nom, e.nom AS equipe_nom, e.format AS equipe_format
     FROM matchs m LEFT JOIN adversaires a ON a.id = m.adversaire_id JOIN equipes e ON e.id = m.equipe_id WHERE m.id = $1`,
    [matchId],
  )).rows[0];
  if (!match) return null;
  // Requêtes séquentielles : une connexion PostgreSQL n'exécute qu'une requête à la fois
  const evs = await db.query('SELECT * FROM evenements WHERE match_id = $1 AND NOT supprime ORDER BY debut', [matchId]);
  const feuille = await db.query(
    `SELECT f.*, j.prenom, j.nom FROM feuille_match f JOIN joueurs j ON j.id = f.joueur_id WHERE f.match_id = $1 ORDER BY f.numero`,
    [matchId],
  );
  const changements = await db.query('SELECT * FROM changements_feuille WHERE match_id = $1 ORDER BY minute', [matchId]);
  const types = options.types ?? (await typesDuClub(db));
  const poids = options.poids ?? (await configClub(db)).poids;
  const evenements = evs.rows.map(versEvenement);
  const f = feuille.rows.map((l) => ({ joueurId: l.joueur_id, numero: l.numero, titulaire: l.titulaire, poste: l.poste, prenom: l.prenom, nom: l.nom, capitaine: l.capitaine }));
  const c = changements.rows.map((x) => ({ id: x.id, type: x.type, minute: x.minute, joueurSortant: x.joueur_sortant, joueurEntrant: x.joueur_entrant, evenementId: x.evenement_id }));
  const stats = calculerStats(evenements, {
    types,
    reperes: { dureeMiTemps: match.duree_mi_temps, coupEnvoi1: match.coup_envoi_1, coupEnvoi2: match.coup_envoi_2 },
    feuille: f.length ? f : undefined,
    changements: c,
    scoreSaisi: { nous: match.score_nous, adversaire: match.score_adv },
    poidsContribution: poids,
  });
  return { match, evenements, feuille: f, changements: c, types, stats };
}

export async function nomsJoueurs(db: Db): Promise<Record<string, string>> {
  const r = await db.query('SELECT id, prenom, nom FROM joueurs');
  return Object.fromEntries(r.rows.map((j) => [j.id, `${j.prenom} ${j.nom}`]));
}

/** Vidéo principale prête d'un match (angle principal en priorité). */
export async function videoPrincipale(db: Db, matchId: string) {
  return (await db.query(
    "SELECT * FROM videos WHERE match_id = $1 AND statut = 'pret' ORDER BY (angle = 'Principal') DESC, cree_le LIMIT 1",
    [matchId],
  )).rows[0] ?? null;
}
