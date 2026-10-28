// Taxonomie par défaut. Elle est copiée en base pour chaque club à sa création :
// le club peut ensuite la modifier (boutons, raccourcis, attributs) sans toucher au code.
import type { DefinitionTypeEvenement, DefinitionResultat, OptionChoix } from './types.js';

const opt = (...pairs: [string, string][]): OptionChoix[] => pairs.map(([value, label]) => ({ value, label }));
const res = (value: string, label: string, succes: boolean, points?: number): DefinitionResultat =>
  points === undefined ? { value, label, succes } : { value, label, succes, points };

export const ORIGINES = opt(
  ['touche', 'Touche'],
  ['melee', 'Mêlée'],
  ['renvoi', 'Renvoi'],
  ['turnover', 'Turnover'],
  ['jeu_au_pied_adverse', 'Jeu au pied adverse'],
  ['penalite', 'Pénalité jouée'],
);

export const MOTIFS_PENALITE = opt(
  ['hors_jeu', 'Hors-jeu'],
  ['ruck', 'Ruck (mains, côté)'],
  ['melee', 'Mêlée'],
  ['touche', 'Touche'],
  ['plaquage_dangereux', 'Plaquage dangereux'],
  ['obstruction', 'Obstruction'],
  ['en_avant_volontaire', 'En-avant volontaire'],
  ['comportement', 'Comportement'],
  ['autre', 'Autre'],
);

export const TAXONOMIE_DEFAUT: DefinitionTypeEvenement[] = [
  // Points
  {
    key: 'essai', famille: 'Points', label: 'Essai', raccourci: 'e', niveaux: ['express', 'complet'],
    resultats: [res('marque', 'Marqué', true, 5)],
    attributs: [{ key: 'origine', label: 'Origine', type: 'choix', options: ORIGINES }],
    preRoll: 15, postRoll: 5, dureeDefaut: 3, sensCamp: 'porteur', ordre: 10,
  },
  {
    key: 'transformation', famille: 'Points', label: 'Transformation', raccourci: 't', niveaux: ['express', 'complet'],
    resultats: [res('reussie', 'Réussie', true, 2), res('manquee', 'Manquée', false)],
    attributs: [],
    preRoll: 3, postRoll: 4, dureeDefaut: 3, sensCamp: 'porteur', ordre: 11,
  },
  {
    key: 'penalite_tentee', famille: 'Points', label: 'Pénalité tentée', raccourci: 'b', niveaux: ['express', 'complet'],
    resultats: [res('reussie', 'Réussie', true, 3), res('manquee', 'Manquée', false)],
    attributs: [],
    preRoll: 3, postRoll: 4, dureeDefaut: 3, sensCamp: 'porteur', ordre: 12,
  },
  {
    key: 'drop', famille: 'Points', label: 'Drop', raccourci: 'o', niveaux: ['express', 'complet'],
    resultats: [res('reussi', 'Réussi', true, 3), res('manque', 'Manqué', false)],
    attributs: [],
    preRoll: 8, postRoll: 3, dureeDefaut: 2, sensCamp: 'porteur', ordre: 13,
  },
  {
    key: 'essai_penalite', famille: 'Points', label: 'Essai de pénalité', raccourci: 'i', niveaux: ['express', 'complet'],
    resultats: [res('accorde', 'Accordé', true, 7)],
    attributs: [],
    preRoll: 15, postRoll: 5, dureeDefaut: 3, sensCamp: 'porteur', ordre: 14,
  },
  // Conquête
  {
    key: 'melee', famille: 'Mêlée', label: 'Mêlée', raccourci: 'm', niveaux: ['express', 'complet'],
    resultats: [
      res('gagnee_propre', 'Gagnée propre', true),
      res('gagnee_sous_pression', 'Gagnée sous pression', true),
      res('penalite_pour', 'Pénalité pour', true),
      res('perdue', 'Perdue', false),
      res('penalite_contre', 'Pénalité contre', false),
      res('effondrement', 'Effondrement', false),
      res('reprise', 'À rejouer', false),
    ],
    attributs: [],
    preRoll: 3, postRoll: 6, dureeDefaut: 8, sensCamp: 'porteur', ordre: 20,
  },
  {
    key: 'touche', famille: 'Touche', label: 'Touche', raccourci: 'l', niveaux: ['express', 'complet'],
    resultats: [
      res('gagnee', 'Gagnée', true),
      res('volee', 'Volée', false),
      res('pas_droit', 'Pas droit', false),
      res('penalite_pour', 'Pénalité pour', true),
      res('penalite_contre', 'Pénalité contre', false),
    ],
    attributs: [
      { key: 'nb_joueurs', label: 'Nombre de joueurs', type: 'nombre' },
      { key: 'cible', label: 'Cible', type: 'choix', options: opt(['devant', 'Devant'], ['milieu', 'Milieu'], ['fond', 'Fond']) },
      { key: 'sauteur', label: 'Sauteur', type: 'joueur' },
      { key: 'groupe_penetrant', label: 'Groupé pénétrant', type: 'booleen' },
    ],
    preRoll: 3, postRoll: 6, dureeDefaut: 6, sensCamp: 'porteur', ordre: 30,
  },
  {
    key: 'renvoi', famille: 'Renvois', label: 'Renvoi', raccourci: 'k', niveaux: ['express', 'complet'],
    resultats: [res('recupere', 'Récupéré', true), res('perdu', 'Perdu', false), res('faute', 'Faute (direct, 10 m)', false)],
    attributs: [
      { key: 'type', label: 'Type', type: 'choix', options: opt(['coup_envoi', "Coup d'envoi"], ['renvoi_22', 'Renvoi aux 22'], ['renvoi_en_but', "Renvoi d'en-but"]) },
      { key: 'longueur', label: 'Longueur', type: 'choix', options: opt(['court', 'Court'], ['long', 'Long']) },
      { key: 'receptionneur', label: 'Réceptionneur', type: 'joueur' },
    ],
    preRoll: 2, postRoll: 6, dureeDefaut: 5, sensCamp: 'porteur', ordre: 40,
  },
  // Jeu courant
  {
    key: 'ruck', famille: 'Ruck', label: 'Ruck', raccourci: 'r', niveaux: ['express', 'complet'],
    resultats: [res('rapide', 'Rapide (< 3 s)', true), res('lent', 'Lent', true), res('perdu', 'Perdu', false)],
    attributs: [
      { key: 'joueurs_engages', label: 'Joueurs engagés', type: 'nombre' },
      { key: 'premier_arrive', label: 'Premier arrivé', type: 'joueur' },
      { key: 'nettoyeur', label: 'Nettoyeur', type: 'joueur' },
    ],
    preRoll: 3, postRoll: 4, dureeDefaut: 4, sensCamp: 'porteur', ordre: 50,
  },
  {
    key: 'maul', famille: 'Maul', label: 'Maul', raccourci: 'u', niveaux: ['complet'],
    resultats: [res('avance', 'Avancée', true), res('essai', 'Essai', true), res('ecroule', 'Écroulé', false), res('penalite_pour', 'Pénalité pour', true), res('arrete', 'Arrêté', false)],
    attributs: [
      { key: 'origine', label: 'Origine', type: 'choix', options: ORIGINES },
      { key: 'metres', label: 'Mètres', type: 'nombre' },
    ],
    preRoll: 3, postRoll: 5, dureeDefaut: 8, sensCamp: 'porteur', ordre: 55,
  },
  {
    key: 'plaquage', famille: 'Défense', label: 'Plaquage', raccourci: 'p', niveaux: ['express', 'complet'],
    resultats: [
      res('dominant', 'Réussi dominant', true),
      res('passif', 'Réussi passif', true),
      res('manque', 'Manqué', false),
      res('casse', 'Cassé', false),
    ],
    attributs: [
      { key: 'haut', label: 'Haut', type: 'booleen' },
      { key: 'a_deux', label: 'À deux', type: 'booleen' },
      { key: 'second_plaqueur', label: 'Second plaqueur', type: 'joueur' },
      { key: 'contest_sol', label: 'Contest au sol', type: 'booleen' },
    ],
    preRoll: 3, postRoll: 3, dureeDefaut: 2, sensCamp: 'defense', ordre: 60,
  },
  {
    key: 'franchissement', famille: 'Attaque', label: 'Franchissement', raccourci: 'f', niveaux: ['express', 'complet'],
    resultats: [res('franchi', 'Franchi', true)],
    attributs: [
      { key: 'defenseurs_battus', label: 'Défenseurs battus', type: 'nombre' },
      { key: 'metres', label: 'Mètres', type: 'nombre' },
    ],
    preRoll: 5, postRoll: 4, dureeDefaut: 4, sensCamp: 'porteur', ordre: 70,
  },
  {
    key: 'course', famille: 'Attaque', label: 'Ballon porté', raccourci: 'v', niveaux: ['complet'],
    resultats: [res('ligne_avantage', "Ligne d'avantage gagnée", true), res('neutre', 'Neutre', true), res('recul', 'Recul', false)],
    attributs: [
      { key: 'metres', label: 'Mètres', type: 'nombre' },
      { key: 'defenseurs_battus', label: 'Défenseurs battus', type: 'nombre' },
    ],
    preRoll: 2, postRoll: 2, dureeDefaut: 2, sensCamp: 'porteur', ordre: 71,
  },
  {
    key: 'passe', famille: 'Attaque', label: 'Passe', raccourci: 'w', niveaux: ['complet'],
    resultats: [res('reussie', 'Réussie', true), res('ratee', 'Ratée', false)],
    attributs: [],
    preRoll: 2, postRoll: 2, dureeDefaut: 1, sensCamp: 'porteur', ordre: 72,
  },
  {
    key: 'offload', famille: 'Attaque', label: 'Offload', raccourci: 'h', niveaux: ['complet'],
    resultats: [res('reussi', 'Réussi', true), res('perdu', 'Perdu', false)],
    attributs: [],
    preRoll: 2, postRoll: 3, dureeDefaut: 2, sensCamp: 'porteur', ordre: 73,
  },
  {
    key: 'en_avant', famille: 'Attaque', label: 'En-avant', raccourci: 'n', niveaux: ['complet'],
    resultats: [res('commis', 'Commis', false)],
    attributs: [],
    preRoll: 3, postRoll: 2, dureeDefaut: 2, sensCamp: 'fautif', ordre: 74,
  },
  {
    key: 'jeu_au_pied', famille: 'Jeu au pied', label: 'Jeu au pied', raccourci: 'j', niveaux: ['express', 'complet'],
    resultats: [res('recupere', 'Récupéré', true), res('touche_gagnee', 'Touche gagnée', true), res('perdu', 'Perdu', false), res('contre', 'Contré', false)],
    attributs: [
      { key: 'type', label: 'Type', type: 'choix', options: opt(['chandelle', 'Chandelle'], ['diagonale', 'Diagonale'], ['rasant', 'Rasant'], ['par_dessus', 'Par-dessus'], ['touche_directe', 'Touche directe'], ['50_22', '50:22'], ['degagement', 'Dégagement']) },
      { key: 'metres', label: 'Mètres', type: 'nombre' },
    ],
    preRoll: 3, postRoll: 5, dureeDefaut: 3, sensCamp: 'porteur', ordre: 80,
  },
  {
    key: 'turnover', famille: 'Turnover', label: 'Turnover gagné', raccourci: 'g', niveaux: ['express', 'complet'],
    resultats: [res('gagne', 'Gagné', true)],
    attributs: [
      { key: 'type', label: 'Type', type: 'choix', options: opt(['grattage', 'Grattage'], ['interception', 'Interception'], ['contre', 'Contre'], ['arrache', 'Arraché'], ['en_avant_adverse', 'En-avant adverse'], ['touche_volee', 'Touche volée']) },
    ],
    preRoll: 4, postRoll: 4, dureeDefaut: 2, sensCamp: 'porteur', ordre: 90,
  },
  {
    key: 'penalite', famille: 'Discipline', label: 'Pénalité concédée', raccourci: 'x', niveaux: ['express', 'complet'],
    resultats: [res('sifflee', 'Sifflée', false)],
    attributs: [
      { key: 'motif', label: 'Motif', type: 'choix', options: MOTIFS_PENALITE, obligatoire: true },
      { key: 'provoquee_par', label: 'Provoquée par', type: 'joueur' },
    ],
    preRoll: 5, postRoll: 3, dureeDefaut: 2, sensCamp: 'fautif', ordre: 100,
  },
  {
    key: 'coup_franc', famille: 'Discipline', label: 'Coup franc concédé', raccourci: 'q', niveaux: ['complet'],
    resultats: [res('siffle', 'Sifflé', false)],
    attributs: [{ key: 'motif', label: 'Motif', type: 'choix', options: MOTIFS_PENALITE }],
    preRoll: 5, postRoll: 3, dureeDefaut: 2, sensCamp: 'fautif', ordre: 101,
  },
  {
    key: 'carton', famille: 'Discipline', label: 'Carton', raccourci: 'c', niveaux: ['express', 'complet'],
    resultats: [res('jaune', 'Jaune', false), res('rouge', 'Rouge', false), res('bleu', 'Bleu', false)],
    attributs: [{ key: 'motif', label: 'Motif', type: 'choix', options: MOTIFS_PENALITE }],
    preRoll: 10, postRoll: 3, dureeDefaut: 2, sensCamp: 'fautif', ordre: 102,
  },
  {
    key: 'entree_22', famille: 'Possession', label: 'Entrée dans les 22', raccourci: 'z', niveaux: ['express', 'complet'],
    resultats: [
      res('essai_transforme', 'Essai transformé', true, 7),
      res('essai', 'Essai', true, 5),
      res('trois_points', 'Pénalité ou drop', true, 3),
      res('sans_points', 'Sans points', false, 0),
    ],
    attributs: [],
    preRoll: 3, postRoll: 3, dureeDefaut: 20, sensCamp: 'porteur', ordre: 110,
  },
  {
    key: 'possession', famille: 'Possession', label: 'Possession', raccourci: 's', niveaux: ['complet'],
    resultats: [
      res('essai', 'Essai', true), res('points', 'Points au pied', true), res('penalite_obtenue', 'Pénalité obtenue', true),
      res('jeu_au_pied', 'Rendue au pied', false), res('turnover', 'Ballon perdu', false), res('faute', 'Faute', false),
    ],
    attributs: [
      { key: 'origine', label: 'Origine', type: 'choix', options: ORIGINES },
      { key: 'phases', label: 'Nombre de phases', type: 'nombre' },
    ],
    preRoll: 2, postRoll: 2, dureeDefaut: 30, sensCamp: 'porteur', ordre: 5,
  },
  {
    key: 'avantage', famille: 'Arbitrage', label: 'Avantage', raccourci: 'y', niveaux: ['complet'],
    resultats: [res('joue', 'Joué', true), res('non_joue', 'Non joué', false)],
    attributs: [],
    preRoll: 3, postRoll: 8, dureeDefaut: 5, sensCamp: 'porteur', ordre: 120,
  },
  {
    key: 'decision_video', famille: 'Arbitrage', label: 'Décision vidéo', niveaux: ['complet'],
    resultats: [res('confirmee', 'Confirmée', true), res('infirmee', 'Infirmée', false)],
    attributs: [],
    preRoll: 10, postRoll: 5, dureeDefaut: 30, sensCamp: 'porteur', ordre: 121,
  },
  {
    key: 'arret_blessure', famille: 'Santé', label: 'Arrêt blessure', raccourci: 'a', niveaux: ['complet'],
    resultats: [res('reste', 'Reste en jeu', true), res('sortie', 'Sortie', false)],
    attributs: [{ key: 'commotion', label: 'Protocole commotion', type: 'booleen' }],
    preRoll: 10, postRoll: 5, dureeDefaut: 60, sensCamp: 'porteur', ordre: 130,
  },
];

export function typesParNiveau(types: DefinitionTypeEvenement[], niveau: 'express' | 'complet') {
  return types.filter((t) => t.niveaux.includes(niveau)).sort((a, b) => a.ordre - b.ordre);
}

export function indexTypes(types: DefinitionTypeEvenement[]): Map<string, DefinitionTypeEvenement> {
  return new Map(types.map((t) => [t.key, t]));
}

export function pointsEvenement(type: DefinitionTypeEvenement | undefined, resultat?: string | null): number {
  if (!type || type.key === 'entree_22') return 0; // les entrées dans les 22 ne marquent pas, elles mesurent l'efficacité
  const r = type.resultats.find((x) => x.value === resultat) ?? (type.resultats.length === 1 ? type.resultats[0] : undefined);
  return r?.points ?? 0;
}

export function estSucces(type: DefinitionTypeEvenement | undefined, resultat?: string | null): boolean | null {
  if (!type) return null;
  const r = type.resultats.find((x) => x.value === resultat) ?? (type.resultats.length === 1 ? type.resultats[0] : undefined);
  return r ? r.succes : null;
}
