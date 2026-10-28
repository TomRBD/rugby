// Calcul des statistiques d'un match. Chaque chiffre conserve la liste des événements
// qui le composent, pour que l'interface ouvre les clips correspondants en un clic.
import type { Camp, DefinitionTypeEvenement, Evenement, ReperesHorloge, LigneFeuille, ChangementFeuille } from './types.js';
import { estSucces, indexTypes, pointsEvenement } from './taxonomie.js';
import { horlogeDepuisVideo, libellesTranches, tranche } from './horloge.js';
import { calculerTempsDeJeu, estSurLeTerrain } from './tempsDeJeu.js';
import { zoneDepuisCoordonnees, LIBELLES_LONGUEUR } from './terrain.js';

export type FormatIndicateur = 'nombre' | 'pourcentage' | 'decimal' | 'metres' | 'secondes';

export interface Valeur {
  valeur: number | null;
  ids: string[];
}

export interface Indicateur {
  key: string;
  famille: string;
  label: string;
  format: FormatIndicateur;
  /** "haut" : plus c'est élevé mieux c'est pour l'équipe concernée. */
  sens: 'haut' | 'bas';
  nous: Valeur;
  adversaire: Valeur;
}

export interface Repartition {
  key: string;
  label: string;
  lignes: { label: string; nous: Valeur; adversaire: Valeur }[];
}

export interface StatsJoueur {
  joueurId: string;
  tempsDeJeu: number;
  valeurs: Record<string, Valeur>;
  contribution: number;
}

export interface StatsMatch {
  score: { nous: number; adversaire: number };
  parMiTemps: { nous: Valeur; adversaire: Valeur }[];
  parTranche: { label: string; nous: Valeur; adversaire: Valeur }[];
  momentum: { label: string; valeur: number; ids: string[] }[];
  indicateurs: Indicateur[];
  repartitions: Repartition[];
  parType: { typeKey: string; label: string; famille: string; nous: { total: number; succes: number; ids: string[] }; adversaire: { total: number; succes: number; ids: string[] } }[];
  joueurs: StatsJoueur[];
  alertes: Alerte[];
}

export interface Alerte {
  evenementId?: string;
  niveau: 'alerte' | 'info';
  message: string;
}

export interface ContexteStats {
  types: DefinitionTypeEvenement[];
  reperes: ReperesHorloge;
  feuille?: LigneFeuille[];
  changements?: ChangementFeuille[];
  scoreSaisi?: { nous: number | null; adversaire: number | null };
  poidsContribution?: Record<string, number>;
}

/** Pondération par défaut de l'indice de contribution (configurable par le club). */
export const POIDS_CONTRIBUTION_DEFAUT: Record<string, number> = {
  essais: 5,
  franchissements: 3,
  defenseurs_battus: 1,
  offloads: 1,
  ballons_portes: 0.5,
  plaquages_reussis: 1,
  plaquages_dominants: 1,
  plaquages_manques: -1.5,
  turnovers: 3,
  grattages: 1,
  penalites_concedees: -2,
  penalites_provoquees: 1.5,
  rucks_premier_arrive: 0.5,
  nettoyages: 0.5,
  tirs_reussis: 1,
  cartons: -5,
};

export const LIBELLES_STATS_JOUEUR: Record<string, string> = {
  points: 'Points',
  essais: 'Essais',
  ballons_portes: 'Ballons portés',
  metres: 'Mètres gagnés',
  franchissements: 'Franchissements',
  defenseurs_battus: 'Défenseurs battus',
  offloads: 'Offloads',
  plaquages_tentes: 'Plaquages tentés',
  plaquages_reussis: 'Plaquages réussis',
  plaquages_manques: 'Plaquages manqués',
  plaquages_dominants: 'Plaquages dominants',
  rucks_premier_arrive: 'Premier arrivé au ruck',
  nettoyages: 'Nettoyages',
  grattages: 'Grattages',
  turnovers: 'Turnovers gagnés',
  penalites_concedees: 'Pénalités concédées',
  penalites_provoquees: 'Pénalités provoquées',
  jeu_au_pied: 'Jeux au pied',
  metres_au_pied: 'Mètres au pied',
  touches_lancees: 'Touches lancées',
  touches_gagnees_lancer: 'Touches gagnées au lancer',
  sauts_gagnes: 'Touches gagnées au saut',
  tirs_tentes: 'Tirs au but tentés',
  tirs_reussis: 'Tirs au but réussis',
  cartons: 'Cartons',
};

const v = (valeur: number | null, ids: string[] = []): Valeur => ({ valeur, ids });
const pct = (num: unknown[], den: unknown[]): Valeur => v(den.length ? Math.round((num.length / den.length) * 1000) / 10 : null);
const nombre = (n: number) => (typeof n === 'number' && Number.isFinite(n) ? n : 0);
const autre = (c: Camp): Camp => (c === 'nous' ? 'adversaire' : 'nous');

export function calculerStats(evenements: Evenement[], ctx: ContexteStats): StatsMatch {
  const types = indexTypes(ctx.types);
  const evs = [...evenements].sort((a, b) => a.debut - b.debut);
  const de = (key: string, camp?: Camp) => evs.filter((e) => e.typeKey === key && (!camp || e.camp === camp));
  const ids = (l: Evenement[]) => l.map((e) => e.id);
  const succes = (l: Evenement[]) => l.filter((e) => estSucces(types.get(e.typeKey), e.resultat) === true);
  const resultatDans = (l: Evenement[], vals: string[]) => l.filter((e) => vals.includes(e.resultat ?? ''));
  const attr = (e: Evenement, k: string) => e.attributs?.[k];
  const somme = (l: Evenement[], k: string) => l.reduce((s, e) => s + nombre(Number(attr(e, k))), 0);
  const points = (e: Evenement) => pointsEvenement(types.get(e.typeKey), e.resultat);

  // Score, mi-temps, tranches
  const marquants = evs.filter((e) => points(e) > 0);
  const score = { nous: 0, adversaire: 0 };
  for (const e of marquants) score[e.camp] += points(e);

  const nbTranches = libellesTranches(ctx.reperes.dureeMiTemps).length;
  const parTranche = libellesTranches(ctx.reperes.dureeMiTemps).map((label) => ({ label, nous: v(0), adversaire: v(0) }));
  const parMiTemps = [0, 1].map(() => ({ nous: v(0), adversaire: v(0) }));
  for (const e of marquants) {
    const h = horlogeDepuisVideo(e.debut, ctx.reperes);
    if (!h) continue;
    const mt = parMiTemps[h.miTemps - 1][e.camp];
    mt.valeur = (mt.valeur ?? 0) + points(e);
    mt.ids.push(e.id);
    const t = Math.min(tranche(h, ctx.reperes.dureeMiTemps), nbTranches - 1);
    const tr = parTranche[t][e.camp];
    tr.valeur = (tr.valeur ?? 0) + points(e);
    tr.ids.push(e.id);
  }

  // Momentum par 5 minutes : + pour nous, - pour l'adversaire
  const labels5 = libellesTranches(ctx.reperes.dureeMiTemps, 5);
  const momentum = labels5.map((label) => ({ label, valeur: 0, ids: [] as string[] }));
  for (const e of evs) {
    const h = horlogeDepuisVideo(e.debut, ctx.reperes);
    const t = types.get(e.typeKey);
    if (!h || !t) continue;
    const s = estSucces(t, e.resultat);
    if (s === null) continue;
    const favorableA: Camp = s ? e.camp : autre(e.camp);
    const poids = Math.max(1, points(e));
    const idx = Math.min(tranche(h, ctx.reperes.dureeMiTemps, 5), labels5.length - 1);
    momentum[idx].valeur += favorableA === 'nous' ? poids : -poids;
    momentum[idx].ids.push(e.id);
  }

  // Indicateurs collectifs
  const indicateurs: Indicateur[] = [];
  const ajouter = (
    key: string, famille: string, label: string, format: FormatIndicateur, sens: 'haut' | 'bas',
    calc: (c: Camp) => Valeur,
  ) => indicateurs.push({ key, famille, label, format, sens, nous: calc('nous'), adversaire: calc('adversaire') });

  ajouter('points', 'Résultat', 'Points', 'nombre', 'haut', (c) => v(score[c], ids(marquants.filter((e) => e.camp === c))));
  ajouter('essais', 'Résultat', 'Essais', 'nombre', 'haut', (c) => {
    const l = [...de('essai', c), ...de('essai_penalite', c)];
    return v(l.length, ids(l));
  });
  ajouter('transformations', 'Résultat', 'Transformations réussies', 'pourcentage', 'haut', (c) => {
    const l = de('transformation', c);
    return { ...pct(succes(l), l), ids: ids(l) };
  });
  ajouter('buteur', 'Buteur', 'Réussite au pied (tous tirs)', 'pourcentage', 'haut', (c) => {
    const l = [...de('transformation', c), ...de('penalite_tentee', c), ...de('drop', c)];
    return { ...pct(succes(l), l), ids: ids(l) };
  });

  // Possession (codage complet)
  const possessions = de('possession');
  const dureePoss = (c: Camp) => possessions.filter((e) => e.camp === c).reduce((s, e) => s + Math.max(0, e.fin - e.debut), 0);
  const totalPoss = dureePoss('nous') + dureePoss('adversaire');
  ajouter('possession', 'Possession', 'Possession', 'pourcentage', 'haut', (c) =>
    v(totalPoss ? Math.round((dureePoss(c) / totalPoss) * 1000) / 10 : null, ids(possessions.filter((e) => e.camp === c))));
  ajouter('nb_possessions', 'Possession', 'Nombre de possessions', 'nombre', 'haut', (c) => {
    const l = possessions.filter((e) => e.camp === c);
    return v(l.length, ids(l));
  });
  ajouter('duree_possession', 'Possession', 'Durée moyenne de possession', 'secondes', 'haut', (c) => {
    const l = possessions.filter((e) => e.camp === c);
    return v(l.length ? Math.round(dureePoss(c) / l.length) : null, ids(l));
  });
  ajouter('phases_possession', 'Possession', 'Phases par possession', 'decimal', 'haut', (c) => {
    const l = possessions.filter((e) => e.camp === c && attr(e, 'phases') != null);
    return v(l.length ? Math.round((somme(l, 'phases') / l.length) * 10) / 10 : null, ids(l));
  });
  ajouter('occupation', 'Possession', 'Occupation (actions dans la moitié adverse)', 'pourcentage', 'haut', (c) => {
    // Les coordonnées sont dans le repère de "nous" : la moitié adverse de "nous" est x >= 50.
    const loc = evs.filter((e) => e.x != null && e.typeKey !== 'plaquage');
    const dansMoitie = loc.filter((e) => (c === 'nous' ? (e.x as number) >= 50 : (e.x as number) < 50));
    return { ...pct(dansMoitie, loc), ids: ids(dansMoitie) };
  });

  // Efficacité
  ajouter('entrees_22', 'Efficacité', 'Entrées dans les 22', 'nombre', 'haut', (c) => {
    const l = de('entree_22', c);
    return v(l.length, ids(l));
  });
  ajouter('points_par_entree', 'Efficacité', 'Points par entrée dans les 22', 'decimal', 'haut', (c) => {
    const l = de('entree_22', c);
    const pts = l.reduce((s, e) => s + (types.get('entree_22')?.resultats.find((r) => r.value === e.resultat)?.points ?? 0), 0);
    return v(l.length ? Math.round((pts / l.length) * 10) / 10 : null, ids(l));
  });
  ajouter('entrees_converties', 'Efficacité', 'Entrées dans les 22 converties', 'pourcentage', 'haut', (c) => {
    const l = de('entree_22', c);
    return { ...pct(succes(l), l), ids: ids(l) };
  });

  // Conquête
  ajouter('melees', 'Conquête', 'Mêlées gagnées sur introduction', 'pourcentage', 'haut', (c) => {
    const l = de('melee', c).filter((e) => e.resultat !== 'reprise');
    return { ...pct(succes(l), l), ids: ids(l) };
  });
  ajouter('touches', 'Conquête', 'Touches gagnées sur lancer', 'pourcentage', 'haut', (c) => {
    const l = de('touche', c);
    return { ...pct(succes(l), l), ids: ids(l) };
  });
  ajouter('renvois', 'Conquête', 'Renvois récupérés', 'pourcentage', 'haut', (c) => {
    const l = de('renvoi', c);
    return { ...pct(succes(l), l), ids: ids(l) };
  });

  // Rucks et défense
  ajouter('rucks', 'Rucks', 'Rucks', 'nombre', 'haut', (c) => v(de('ruck', c).length, ids(de('ruck', c))));
  ajouter('rucks_gagnes', 'Rucks', 'Rucks conservés', 'pourcentage', 'haut', (c) => {
    const l = de('ruck', c);
    return { ...pct(succes(l), l), ids: ids(l) };
  });
  ajouter('rucks_rapides', 'Rucks', 'Sorties rapides (< 3 s)', 'pourcentage', 'haut', (c) => {
    const l = de('ruck', c);
    return { ...pct(resultatDans(l, ['rapide']), l), ids: ids(l) };
  });
  ajouter('plaquages', 'Défense', 'Plaquages tentés', 'nombre', 'haut', (c) => v(de('plaquage', c).length, ids(de('plaquage', c))));
  ajouter('plaquages_reussis', 'Défense', 'Plaquages réussis', 'pourcentage', 'haut', (c) => {
    const l = de('plaquage', c);
    return { ...pct(succes(l), l), ids: ids(l) };
  });
  ajouter('plaquages_dominants', 'Défense', 'Plaquages dominants', 'pourcentage', 'haut', (c) => {
    const l = de('plaquage', c);
    return { ...pct(resultatDans(l, ['dominant']), l), ids: ids(l) };
  });
  ajouter('plaquages_manques', 'Défense', 'Plaquages manqués', 'nombre', 'bas', (c) => {
    const l = resultatDans(de('plaquage', c), ['manque', 'casse']);
    return v(l.length, ids(l));
  });
  ajouter('turnovers', 'Défense', 'Turnovers gagnés', 'nombre', 'haut', (c) => v(de('turnover', c).length, ids(de('turnover', c))));
  ajouter('grattages', 'Défense', 'Grattages', 'nombre', 'haut', (c) => {
    const l = de('turnover', c).filter((e) => attr(e, 'type') === 'grattage');
    return v(l.length, ids(l));
  });
  ajouter('metres_concedes', 'Défense', 'Mètres concédés', 'metres', 'bas', (c) => {
    const l = [...de('course', autre(c)), ...de('franchissement', autre(c))];
    return v(somme(l, 'metres'), ids(l));
  });
  ajouter('franchissements', 'Attaque', 'Franchissements', 'nombre', 'haut', (c) => v(de('franchissement', c).length, ids(de('franchissement', c))));

  // Jeu au pied
  ajouter('jeu_au_pied', 'Jeu au pied', 'Jeux au pied', 'nombre', 'haut', (c) => v(de('jeu_au_pied', c).length, ids(de('jeu_au_pied', c))));
  ajouter('metres_au_pied', 'Jeu au pied', 'Mètres au pied', 'metres', 'haut', (c) => v(somme(de('jeu_au_pied', c), 'metres'), ids(de('jeu_au_pied', c))));
  ajouter('jap_recuperes', 'Jeu au pied', 'Jeux au pied récupérés', 'pourcentage', 'haut', (c) => {
    const l = de('jeu_au_pied', c);
    return { ...pct(succes(l), l), ids: ids(l) };
  });
  ajouter('50_22', 'Jeu au pied', '50:22', 'nombre', 'haut', (c) => {
    const l = de('jeu_au_pied', c).filter((e) => attr(e, 'type') === '50_22');
    return v(l.length, ids(l));
  });

  // Discipline
  ajouter('penalites', 'Discipline', 'Pénalités concédées', 'nombre', 'bas', (c) => v(de('penalite', c).length, ids(de('penalite', c))));
  ajouter('cartons', 'Discipline', 'Cartons', 'nombre', 'bas', (c) => v(de('carton', c).length, ids(de('carton', c))));

  // Répartitions détaillées
  const repartitions: Repartition[] = [];
  const repartir = (key: string, label: string, l: Evenement[], cle: (e: Evenement) => string | null | undefined, libelle: (k: string) => string = (k) => k) => {
    const groupes = new Map<string, { nous: Evenement[]; adversaire: Evenement[] }>();
    for (const e of l) {
      const k = cle(e);
      if (k == null || k === '') continue;
      if (!groupes.has(k)) groupes.set(k, { nous: [], adversaire: [] });
      groupes.get(k)![e.camp].push(e);
    }
    repartitions.push({
      key, label,
      lignes: [...groupes.entries()].map(([k, g]) => ({ label: libelle(k), nous: v(g.nous.length, ids(g.nous)), adversaire: v(g.adversaire.length, ids(g.adversaire)) })),
    });
  };
  const optionLabel = (typeKey: string, attrKey: string) => (val: string) =>
    types.get(typeKey)?.attributs.find((a) => a.key === attrKey)?.options?.find((o) => o.value === val)?.label ?? val;
  repartir('origine_essais', 'Origine des essais', de('essai'), (e) => attr(e, 'origine') as string, optionLabel('essai', 'origine'));
  repartir('penalites_motif', 'Pénalités concédées par motif', de('penalite'), (e) => attr(e, 'motif') as string, optionLabel('penalite', 'motif'));
  repartir('penalites_zone', 'Pénalités concédées par zone', de('penalite'), (e) => (e.x != null && e.y != null ? LIBELLES_LONGUEUR[zoneDepuisCoordonnees(e.x, e.y).longueur] : null));
  repartir('penalites_periode', 'Pénalités concédées par période', de('penalite'), (e) => {
    const h = horlogeDepuisVideo(e.debut, ctx.reperes);
    return h ? libellesTranches(ctx.reperes.dureeMiTemps)[Math.min(tranche(h, ctx.reperes.dureeMiTemps), nbTranches - 1)] : null;
  });
  repartir('touches_cible', 'Touches par cible', de('touche'), (e) => attr(e, 'cible') as string, optionLabel('touche', 'cible'));
  repartir('touches_gagnees_cible', 'Touches gagnées par cible', succes(de('touche')), (e) => attr(e, 'cible') as string, optionLabel('touche', 'cible'));
  repartir('jap_type', 'Jeu au pied par type', de('jeu_au_pied'), (e) => attr(e, 'type') as string, optionLabel('jeu_au_pied', 'type'));
  repartir('turnovers_type', 'Turnovers par type', de('turnover'), (e) => attr(e, 'type') as string, optionLabel('turnover', 'type'));
  repartir('tirs_zone', 'Tirs au but par zone', [...de('transformation'), ...de('penalite_tentee'), ...de('drop')], (e) =>
    e.x != null && e.y != null ? LIBELLES_LONGUEUR[zoneDepuisCoordonnees(e.x, e.y).longueur] : null);

  // Par type (garantit qu'aucun type codé n'échappe aux stats)
  const parType = ctx.types
    .filter((t) => evs.some((e) => e.typeKey === t.key))
    .sort((a, b) => a.ordre - b.ordre)
    .map((t) => {
      const bloc = (c: Camp) => {
        const l = de(t.key, c);
        return { total: l.length, succes: succes(l).length, ids: ids(l) };
      };
      return { typeKey: t.key, label: t.label, famille: t.famille, nous: bloc('nous'), adversaire: bloc('adversaire') };
    });

  // Statistiques individuelles
  const tdj = ctx.feuille ? calculerTempsDeJeu(ctx.feuille, ctx.changements ?? [], ctx.reperes.dureeMiTemps) : null;
  const parJoueur = new Map<string, Record<string, Valeur>>();
  const credit = (joueurId: unknown, stat: string, e: Evenement, quantite = 1) => {
    if (typeof joueurId !== 'string' || !joueurId) return;
    if (!parJoueur.has(joueurId)) parJoueur.set(joueurId, {});
    const s = parJoueur.get(joueurId)!;
    s[stat] ??= v(0);
    s[stat].valeur = (s[stat].valeur ?? 0) + quantite;
    if (!s[stat].ids.includes(e.id)) s[stat].ids.push(e.id);
  };
  for (const e of evs) {
    const acteur = e.joueurs[0];
    if (e.camp === 'nous') {
      const pts = points(e);
      if (pts > 0 && e.typeKey !== 'essai_penalite') credit(acteur, 'points', e, pts);
      switch (e.typeKey) {
        case 'essai': credit(acteur, 'essais', e); break;
        case 'course':
          credit(acteur, 'ballons_portes', e);
          credit(acteur, 'metres', e, nombre(Number(attr(e, 'metres'))));
          credit(acteur, 'defenseurs_battus', e, nombre(Number(attr(e, 'defenseurs_battus'))));
          break;
        case 'franchissement':
          credit(acteur, 'franchissements', e);
          credit(acteur, 'metres', e, nombre(Number(attr(e, 'metres'))));
          credit(acteur, 'defenseurs_battus', e, nombre(Number(attr(e, 'defenseurs_battus'))));
          break;
        case 'offload': if (e.resultat !== 'perdu') credit(acteur, 'offloads', e); break;
        case 'plaquage':
          for (const j of [acteur, attr(e, 'second_plaqueur')]) {
            credit(j, 'plaquages_tentes', e);
            if (estSucces(types.get('plaquage'), e.resultat)) credit(j, 'plaquages_reussis', e);
            else credit(j, 'plaquages_manques', e);
            if (e.resultat === 'dominant') credit(j, 'plaquages_dominants', e);
          }
          break;
        case 'ruck':
          credit(attr(e, 'premier_arrive'), 'rucks_premier_arrive', e);
          credit(attr(e, 'nettoyeur'), 'nettoyages', e);
          break;
        case 'turnover':
          credit(acteur, 'turnovers', e);
          if (attr(e, 'type') === 'grattage') credit(acteur, 'grattages', e);
          break;
        case 'penalite':
        case 'coup_franc':
          credit(acteur, 'penalites_concedees', e);
          break;
        case 'jeu_au_pied':
          credit(acteur, 'jeu_au_pied', e);
          credit(acteur, 'metres_au_pied', e, nombre(Number(attr(e, 'metres'))));
          break;
        case 'touche':
          credit(acteur, 'touches_lancees', e);
          if (estSucces(types.get('touche'), e.resultat)) {
            credit(acteur, 'touches_gagnees_lancer', e);
            credit(attr(e, 'sauteur'), 'sauts_gagnes', e);
          }
          break;
        case 'transformation':
        case 'penalite_tentee':
        case 'drop':
          credit(acteur, 'tirs_tentes', e);
          if (estSucces(types.get(e.typeKey), e.resultat)) credit(acteur, 'tirs_reussis', e);
          break;
        case 'carton': credit(acteur, 'cartons', e); break;
      }
    } else if (e.typeKey === 'penalite' || e.typeKey === 'coup_franc') {
      credit(attr(e, 'provoquee_par'), 'penalites_provoquees', e);
    }
  }
  const poids = ctx.poidsContribution ?? POIDS_CONTRIBUTION_DEFAUT;
  const joueursIds = new Set<string>([...parJoueur.keys(), ...(ctx.feuille ?? []).map((l) => l.joueurId)]);
  const joueurs: StatsJoueur[] = [...joueursIds].map((joueurId) => {
    const valeurs = parJoueur.get(joueurId) ?? {};
    const contribution = Object.entries(poids).reduce((s, [k, w]) => s + w * (valeurs[k]?.valeur ?? 0), 0);
    return { joueurId, tempsDeJeu: tdj?.minutes[joueurId] ?? 0, valeurs, contribution: Math.round(contribution * 10) / 10 };
  });
  joueurs.sort((a, b) => b.contribution - a.contribution);

  return {
    score, parMiTemps, parTranche, momentum, indicateurs, repartitions, parType, joueurs,
    alertes: controlesCoherence(evs, ctx, score),
  };
}

/** Contrôles de cohérence : joueur sorti codé, transformation sans essai, score incohérent. */
export function controlesCoherence(evs: Evenement[], ctx: ContexteStats, score?: { nous: number; adversaire: number }): Alerte[] {
  const alertes: Alerte[] = [];
  const tdj = ctx.feuille ? calculerTempsDeJeu(ctx.feuille, ctx.changements ?? [], ctx.reperes.dureeMiTemps) : null;
  const surFeuille = new Set((ctx.feuille ?? []).map((l) => l.joueurId));
  for (const e of evs) {
    if (e.camp !== 'nous' || !tdj) continue;
    const h = horlogeDepuisVideo(e.debut, ctx.reperes);
    for (const j of e.joueurs) {
      if (!surFeuille.has(j)) {
        alertes.push({ evenementId: e.id, niveau: 'alerte', message: "Joueur codé absent de la feuille de match" });
      } else if (h && !estSurLeTerrain(tdj, j, h.secondes / 60)) {
        alertes.push({ evenementId: e.id, niveau: 'alerte', message: `Joueur codé alors qu'il n'est pas sur le terrain (${Math.floor(h.secondes / 60) + 1}')` });
      }
    }
  }
  for (const e of evs.filter((x) => x.typeKey === 'transformation')) {
    const essai = evs.find((x) => (x.typeKey === 'essai') && x.camp === e.camp && x.debut <= e.debut && e.debut - x.debut <= 180);
    if (!essai) alertes.push({ evenementId: e.id, niveau: 'alerte', message: 'Transformation sans essai dans les 3 minutes précédentes' });
  }
  const saisi = ctx.scoreSaisi;
  if (score && saisi && saisi.nous != null && saisi.adversaire != null && (saisi.nous !== score.nous || saisi.adversaire !== score.adversaire)) {
    alertes.push({ niveau: 'alerte', message: `Score codé ${score.nous}-${score.adversaire} différent du score saisi ${saisi.nous}-${saisi.adversaire}` });
  }
  if (ctx.reperes.coupEnvoi1 == null) {
    alertes.push({ niveau: 'info', message: "Repère du coup d'envoi non placé : minutes et temps de jeu approximatifs" });
  }
  return alertes;
}
