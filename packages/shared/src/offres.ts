// Offres commerciales : quotas et feature flags par plan.

export type CodeOffre = 'decouverte' | 'club' | 'club_plus' | 'pro';

export type Fonctionnalite =
  | 'codage_complet'
  | 'partage'
  | 'app_joueur'
  | 'analyse_adverse'
  | 'rapports_perso'
  | 'ia'
  | 'multi_angles'
  | 'gps'
  | 'tracking'
  | 'api'
  | 'sante'
  | 'codage_live'
  | 'collaboratif';

export interface Offre {
  code: CodeOffre;
  nom: string;
  prixMensuel: number | null; // en euros, null = sur devis
  prixAnnuel: number | null; // deux mois offerts
  maxEquipes: number | null; // null = illimité
  maxMatchs: number | null;
  heuresVideo: number | null;
  fonctionnalites: Fonctionnalite[];
}

const BASE_CLUB: Fonctionnalite[] = ['codage_complet', 'partage', 'app_joueur', 'codage_live', 'collaboratif', 'sante'];

export const OFFRES: Record<CodeOffre, Offre> = {
  decouverte: {
    code: 'decouverte', nom: 'Découverte', prixMensuel: 0, prixAnnuel: 0,
    maxEquipes: 1, maxMatchs: 3, heuresVideo: 5, fonctionnalites: [],
  },
  club: {
    code: 'club', nom: 'Club', prixMensuel: 29, prixAnnuel: 290,
    maxEquipes: 2, maxMatchs: null, heuresVideo: 50, fonctionnalites: BASE_CLUB,
  },
  club_plus: {
    code: 'club_plus', nom: 'Club+', prixMensuel: 59, prixAnnuel: 590,
    maxEquipes: null, maxMatchs: null, heuresVideo: 200,
    fonctionnalites: [...BASE_CLUB, 'analyse_adverse', 'rapports_perso', 'ia'],
  },
  pro: {
    code: 'pro', nom: 'Pro', prixMensuel: null, prixAnnuel: null,
    maxEquipes: null, maxMatchs: null, heuresVideo: null,
    fonctionnalites: [...BASE_CLUB, 'analyse_adverse', 'rapports_perso', 'ia', 'multi_angles', 'gps', 'tracking', 'api'],
  },
};

export function offreAutorise(code: CodeOffre, f: Fonctionnalite): boolean {
  return OFFRES[code].fonctionnalites.includes(f);
}
