// Temps de jeu calculé depuis la feuille de match (titulaires + changements + cartons).
import type { ChangementFeuille, LigneFeuille } from './types.js';

export interface Intervalle {
  debut: number; // minute
  fin: number; // minute
}

export interface ResultatTempsDeJeu {
  minutes: Record<string, number>;
  intervalles: Record<string, Intervalle[]>;
}

/** Durée d'exclusion temporaire d'un carton jaune (10 min en XV, 2 min à 7). */
export function dureeCartonJaune(dureeMiTemps: number): number {
  return dureeMiTemps <= 10 ? 2 : 10;
}

export function calculerTempsDeJeu(
  feuille: LigneFeuille[],
  changements: ChangementFeuille[],
  dureeMiTemps: number,
): ResultatTempsDeJeu {
  const finMatch = dureeMiTemps * 2;
  const enJeu = new Map<string, number>(); // joueur -> minute d'entrée en cours
  const intervalles: Record<string, Intervalle[]> = {};
  const exclusDefinitivement = new Set<string>();

  for (const l of feuille) {
    intervalles[l.joueurId] = [];
    if (l.titulaire) enJeu.set(l.joueurId, 0);
  }

  const sortir = (j: string | null | undefined, m: number) => {
    if (!j || !enJeu.has(j)) return;
    const debut = enJeu.get(j)!;
    enJeu.delete(j);
    (intervalles[j] ??= []).push({ debut, fin: Math.min(Math.max(m, debut), finMatch) });
  };
  const entrer = (j: string | null | undefined, m: number) => {
    if (!j || enJeu.has(j) || exclusDefinitivement.has(j)) return;
    intervalles[j] ??= [];
    enJeu.set(j, Math.min(m, finMatch));
  };

  // Les retours de carton jaune sont des événements synthétiques insérés dans la chronologie.
  type Etape = { minute: number; ordre: number; action: () => void };
  const etapes: Etape[] = [];
  changements.forEach((c, idx) => {
    switch (c.type) {
      case 'remplacement':
      case 'temporaire_commotion':
      case 'temporaire_saignement':
      case 'retour':
        etapes.push({ minute: c.minute, ordre: idx, action: () => { sortir(c.joueurSortant, c.minute); entrer(c.joueurEntrant, c.minute); } });
        break;
      case 'carton_jaune': {
        const retour = c.minute + dureeCartonJaune(dureeMiTemps);
        etapes.push({ minute: c.minute, ordre: idx, action: () => sortir(c.joueurSortant, c.minute) });
        etapes.push({ minute: retour, ordre: idx + 0.5, action: () => { if (retour < finMatch) entrer(c.joueurSortant, retour); } });
        break;
      }
      case 'carton_rouge':
      case 'carton_bleu':
        etapes.push({
          minute: c.minute, ordre: idx,
          action: () => { sortir(c.joueurSortant, c.minute); if (c.joueurSortant) exclusDefinitivement.add(c.joueurSortant); },
        });
        // Un carton bleu (suspicion de commotion) autorise un remplacement : codé comme un changement séparé.
        if (c.type === 'carton_bleu' && c.joueurEntrant) {
          etapes.push({ minute: c.minute, ordre: idx + 0.1, action: () => entrer(c.joueurEntrant, c.minute) });
        }
        break;
    }
  });
  etapes.sort((a, b) => a.minute - b.minute || a.ordre - b.ordre).forEach((e) => e.action());
  for (const j of [...enJeu.keys()]) sortir(j, finMatch);

  const minutes: Record<string, number> = {};
  for (const [j, ivs] of Object.entries(intervalles)) {
    minutes[j] = Math.round(ivs.reduce((s, iv) => s + (iv.fin - iv.debut), 0) * 10) / 10;
  }
  return { minutes, intervalles };
}

export function estSurLeTerrain(r: ResultatTempsDeJeu, joueurId: string, minute: number): boolean {
  return (r.intervalles[joueurId] ?? []).some((iv) => minute >= iv.debut && minute <= iv.fin);
}

export function tailleFeuilleParDefaut(format: 'XV' | '7'): { titulaires: number; remplacants: number } {
  return format === '7' ? { titulaires: 7, remplacants: 5 } : { titulaires: 15, remplacants: 8 };
}
