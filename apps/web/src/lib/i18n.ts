// Traductions de l'interface (français par défaut, anglais disponible).
// Les termes rugby de la taxonomie restent ceux du club (données configurables).
export type Langue = 'fr' | 'en';

const D = {
  accueil: ['Tableau de bord', 'Dashboard'],
  matchs: ['Matchs', 'Matches'],
  effectif: ['Effectif', 'Squad'],
  equipes: ['Équipes et saisons', 'Teams and seasons'],
  playlists: ['Playlists', 'Playlists'],
  adversaires: ['Adversaires', 'Opponents'],
  recherche: ['Recherche', 'Search'],
  sante: ['Santé', 'Medical'],
  entrainements: ['Entraînements', 'Training'],
  parametres: ['Paramètres', 'Settings'],
  tutoriel: ['Tutoriel', 'Tutorial'],
  espaceJoueur: ['Mon espace joueur', 'My player area'],
  deconnexion: ['Se déconnecter', 'Log out'],
  connexion: ['Connexion', 'Log in'],
  inscription: ['Créer un compte club', 'Create a club account'],
  identifiant: ['Email ou téléphone', 'Email or phone'],
  motDePasse: ['Mot de passe', 'Password'],
  seConnecter: ['Se connecter', 'Log in'],
  enregistrer: ['Enregistrer', 'Save'],
  annuler: ['Annuler', 'Cancel'],
  supprimer: ['Supprimer', 'Delete'],
  ajouter: ['Ajouter', 'Add'],
  fermer: ['Fermer', 'Close'],
  chargement: ['Chargement…', 'Loading…'],
  horsLigne: ['Hors ligne', 'Offline'],
  aSynchroniser: ['à synchroniser', 'to sync'],
  theme: ['Affichage', 'Display'],
  themeAuto: ['Automatique', 'Automatic'],
  themeClair: ['Clair', 'Light'],
  themeSombre: ['Sombre', 'Dark'],
  themeSoleil: ['Plein soleil (contraste élevé)', 'Bright sun (high contrast)'],
  langue: ['Langue', 'Language'],
  club: ['Club', 'Club'],
  nouveauMatch: ['Nouveau match', 'New match'],
  aucunMatch: ['Aucun match pour le moment', 'No match yet'],
} satisfies Record<string, [string, string]>;

export type CleTraduction = keyof typeof D;

let langue: Langue = ((): Langue => {
  try { return (localStorage.getItem('rugby.langue') as Langue) || 'fr'; } catch { return 'fr'; }
})();

export function definirLangue(l: Langue) {
  langue = l;
  try { localStorage.setItem('rugby.langue', l); } catch { /* ignoré */ }
  document.documentElement.lang = l;
}
export const langueCourante = () => langue;
export const t = (k: CleTraduction) => D[k][langue === 'en' ? 1 : 0];
