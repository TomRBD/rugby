// Types du domaine partagés entre l'API, le worker et le front.

export type Camp = 'nous' | 'adversaire';
export type NiveauCodage = 'express' | 'complet';
export type FormatJeu = 'XV' | '7';

export type TypeAttribut = 'choix' | 'nombre' | 'booleen' | 'texte' | 'joueur';

export interface OptionChoix {
  value: string;
  label: string;
}

export interface DefinitionAttribut {
  key: string;
  label: string;
  type: TypeAttribut;
  options?: OptionChoix[];
  /** Raccourci clavier (chiffre) facultatif pour les choix fréquents. */
  obligatoire?: boolean;
}

export interface DefinitionResultat {
  value: string;
  label: string;
  /** Issue favorable à l'équipe qui porte l'événement (sert aux % de réussite). */
  succes: boolean;
  /** Points marqués par l'équipe qui porte l'événement avec ce résultat. */
  points?: number;
}

export interface DefinitionTypeEvenement {
  key: string;
  famille: string;
  label: string;
  /** Touche du clavier en codage post-match (configurable par le club). */
  raccourci?: string;
  niveaux: NiveauCodage[];
  resultats: DefinitionResultat[];
  attributs: DefinitionAttribut[];
  /** Secondes de vidéo ajoutées avant/après le clip. */
  preRoll: number;
  postRoll: number;
  /** Durée par défaut d'un événement codé d'une seule touche. */
  dureeDefaut: number;
  /** Sens du camp : "porteur" = l'équipe qui réalise l'action, "fautif" = l'équipe sanctionnée. */
  sensCamp?: 'porteur' | 'fautif' | 'defense';
  ordre: number;
}

/** Événement codé, tel que manipulé par le calcul des stats. */
export interface Evenement {
  id: string;
  typeKey: string;
  camp: Camp;
  /** Joueurs de notre club impliqués (le premier est l'acteur principal). */
  joueurs: string[];
  /** Numéro du joueur adverse si l'événement est adverse. */
  numeroAdverse?: number | null;
  resultat?: string | null;
  attributs: Record<string, unknown>;
  debut: number; // secondes vidéo
  fin: number; // secondes vidéo
  /** Coordonnées terrain en mètres dans le sens d'attaque de "nous" (x : 0 = notre ligne d'essai, 100 = ligne adverse ; y : 0 à 70). */
  x?: number | null;
  y?: number | null;
}

export interface ReperesHorloge {
  /** Durée d'une mi-temps en minutes (40 en XV séniors, 7 à 7, 30 à 35 chez les jeunes). */
  dureeMiTemps: number;
  /** Timecode vidéo (s) du coup d'envoi de la 1re mi-temps. */
  coupEnvoi1?: number | null;
  /** Timecode vidéo (s) du coup d'envoi de la 2e mi-temps. */
  coupEnvoi2?: number | null;
}

export type TypeChangement =
  | 'remplacement'
  | 'temporaire_commotion'
  | 'temporaire_saignement'
  | 'retour'
  | 'carton_jaune'
  | 'carton_rouge'
  | 'carton_bleu';

export interface ChangementFeuille {
  id?: string;
  type: TypeChangement;
  minute: number;
  joueurSortant?: string | null;
  joueurEntrant?: string | null;
}

export interface LigneFeuille {
  joueurId: string;
  numero: number;
  titulaire: boolean;
}
