// RBAC : rôles cumulables, portée club entier ou équipe.

export type Role =
  | 'admin'
  | 'entraineur'
  | 'entraineur_adjoint'
  | 'analyste'
  | 'joueur'
  | 'medical'
  | 'dirigeant';

export const LIBELLES_ROLES: Record<Role, string> = {
  admin: 'Administrateur club',
  entraineur: 'Entraîneur principal',
  entraineur_adjoint: 'Entraîneur adjoint',
  analyste: 'Analyste / codeur',
  joueur: 'Joueur',
  medical: 'Staff médical',
  dirigeant: 'Dirigeant',
};

export type Permission =
  | 'club.gerer' // paramètres, facturation, membres
  | 'effectif.lire'
  | 'effectif.ecrire'
  | 'match.lire'
  | 'match.ecrire'
  | 'video.ecrire'
  | 'codage.ecrire'
  | 'stats.lire'
  | 'playlist.ecrire'
  | 'partage.valider'
  | 'export'
  | 'sante.lire'
  | 'sante.ecrire'
  | 'taxonomie.ecrire'
  | 'adverse.ecrire';

const STAFF_ECRITURE: Permission[] = [
  'effectif.lire', 'effectif.ecrire', 'match.lire', 'match.ecrire', 'video.ecrire', 'codage.ecrire',
  'stats.lire', 'playlist.ecrire', 'export', 'adverse.ecrire',
];

export const PERMISSIONS: Record<Role, Permission[]> = {
  admin: [...STAFF_ECRITURE, 'club.gerer', 'partage.valider', 'taxonomie.ecrire'],
  entraineur: [...STAFF_ECRITURE, 'partage.valider', 'taxonomie.ecrire'],
  entraineur_adjoint: [...STAFF_ECRITURE],
  analyste: ['effectif.lire', 'match.lire', 'match.ecrire', 'video.ecrire', 'codage.ecrire', 'stats.lire', 'playlist.ecrire', 'adverse.ecrire'],
  joueur: [],
  medical: ['effectif.lire', 'match.lire', 'sante.lire', 'sante.ecrire'],
  dirigeant: ['effectif.lire', 'match.lire', 'stats.lire', 'export'],
};

export interface Adhesion {
  role: Role;
  equipeId: string | null; // null = tout le club
}

/**
 * Vrai si l'un des rôles cumulés donne la permission.
 * - equipeId omis : au moins une adhésion (club ou équipe) suffit, la route filtre ensuite par équipe.
 * - equipeId null : action à l'échelle du club, il faut une adhésion club entier.
 * - equipeId fourni : adhésion club entier ou sur cette équipe.
 */
export function peut(adhesions: Adhesion[], permission: Permission, equipeId?: string | null): boolean {
  return adhesions.some((a) => {
    if (!PERMISSIONS[a.role].includes(permission)) return false;
    if (equipeId === undefined) return true;
    if (equipeId === null) return a.equipeId === null;
    return a.equipeId === null || a.equipeId === equipeId;
  });
}

/** Équipes accessibles pour une permission ; null = toutes les équipes du club. */
export function equipesAccessibles(adhesions: Adhesion[], permission: Permission): string[] | null {
  const utiles = adhesions.filter((a) => PERMISSIONS[a.role].includes(permission));
  if (utiles.some((a) => a.equipeId === null)) return null;
  return [...new Set(utiles.map((a) => a.equipeId as string))];
}

/** Rôles dont l'accès doit être protégé par une double authentification. */
export const ROLES_MFA: Role[] = ['admin', 'medical'];
