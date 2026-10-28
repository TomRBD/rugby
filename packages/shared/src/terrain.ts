// Géométrie du terrain : grille 5 bandes en largeur x 6 zones en longueur.
// Repère : x = 0 sur notre ligne d'essai, 100 sur la ligne adverse ; y = 0 à 70 en largeur.

export const LONGUEUR = 100;
export const LARGEUR = 70;

export const BORNES_LONGUEUR = [0, 22, 40, 50, 60, 78, 100];
export const LIBELLES_LONGUEUR = ['Nos 22', 'Nos 22-40', 'Notre moitié', 'Moitié adverse', 'Adverse 40-22', '22 adverses'];
export const BORNES_LARGEUR = [0, 5, 15, 55, 65, 70];
export const LIBELLES_LARGEUR = ['5 m gauche', '15 m gauche', 'Centre', '15 m droite', '5 m droite'];

function indexBorne(v: number, bornes: number[]): number {
  for (let i = 1; i < bornes.length; i++) if (v < bornes[i]) return i - 1;
  return bornes.length - 2;
}

export function zoneDepuisCoordonnees(x: number, y: number): { longueur: number; largeur: number } {
  return {
    longueur: indexBorne(Math.max(0, Math.min(LONGUEUR, x)), BORNES_LONGUEUR),
    largeur: indexBorne(Math.max(0, Math.min(LARGEUR, y)), BORNES_LARGEUR),
  };
}

export function libelleZone(x: number, y: number): string {
  const z = zoneDepuisCoordonnees(x, y);
  return `${LIBELLES_LONGUEUR[z.longueur]}, ${LIBELLES_LARGEUR[z.largeur]}`;
}

/** Ramène un événement adverse dans le repère de l'équipe qui agit (utile pour les cartes adverses). */
export function inverserRepere(x: number, y: number): { x: number; y: number } {
  return { x: LONGUEUR - x, y: LARGEUR - y };
}
