import type { FormatIndicateur } from '@rugby/shared';

export const dateCourte = (d: string | Date) => new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
export const dateHeure = (d: string | Date) => new Date(d).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function valeurIndicateur(v: number | null | undefined, f: FormatIndicateur | string): string {
  if (v == null) return '-';
  switch (f) {
    case 'pourcentage': return `${v} %`;
    case 'metres': return `${v} m`;
    case 'secondes': return `${v} s`;
    default: return String(v);
  }
}

export const LIBELLES_STATUT_JOUEUR: Record<string, string> = {
  disponible: 'Disponible', blesse: 'Blessé', suspendu: 'Suspendu', absent: 'Absent', prete: 'Prêté',
};

export const POSTES = ['Pilier gauche', 'Talonneur', 'Pilier droit', 'Deuxième ligne', 'Troisième ligne aile', 'Troisième ligne centre',
  'Demi de mêlée', 'Demi d\'ouverture', 'Ailier', 'Centre', 'Arrière'];

export const POSTE_PAR_NUMERO: Record<number, string> = {
  1: 'Pilier gauche', 2: 'Talonneur', 3: 'Pilier droit', 4: 'Deuxième ligne', 5: 'Deuxième ligne', 6: 'Troisième ligne aile',
  7: 'Troisième ligne aile', 8: 'Troisième ligne centre', 9: 'Demi de mêlée', 10: 'Demi d\'ouverture', 11: 'Ailier', 12: 'Centre',
  13: 'Centre', 14: 'Ailier', 15: 'Arrière',
};
