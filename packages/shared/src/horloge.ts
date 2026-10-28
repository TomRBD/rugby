// Synchronisation horloge de match <-> timecode vidéo via les deux coups d'envoi.
import type { ReperesHorloge } from './types.js';

export interface InstantMatch {
  miTemps: 1 | 2;
  /** Secondes écoulées depuis le début du match (la 2e mi-temps démarre à dureeMiTemps * 60). */
  secondes: number;
}

export function horlogeDepuisVideo(t: number, r: ReperesHorloge): InstantMatch | null {
  if (r.coupEnvoi2 != null && t >= r.coupEnvoi2) {
    return { miTemps: 2, secondes: r.dureeMiTemps * 60 + (t - r.coupEnvoi2) };
  }
  if (r.coupEnvoi1 != null && t >= r.coupEnvoi1) {
    return { miTemps: 1, secondes: t - r.coupEnvoi1 };
  }
  return null;
}

export function videoDepuisHorloge(secondesMatch: number, r: ReperesHorloge): number | null {
  const mt = r.dureeMiTemps * 60;
  if (secondesMatch >= mt && r.coupEnvoi2 != null) return r.coupEnvoi2 + (secondesMatch - mt);
  if (r.coupEnvoi1 != null) return r.coupEnvoi1 + secondesMatch;
  return null;
}

/** Affichage "12'" ou "40+3'" pour le temps additionnel. */
export function formatMinute(i: InstantMatch | null, dureeMiTemps: number): string {
  if (!i) return '';
  const m = Math.floor(i.secondes / 60);
  const fin = i.miTemps === 1 ? dureeMiTemps : dureeMiTemps * 2;
  return m >= fin ? `${fin}+${m - fin + 1}'` : `${m + 1}'`;
}

/** Index de tranche (de `taille` minutes) ; le temps additionnel reste dans la dernière tranche de la mi-temps. */
export function tranche(i: InstantMatch, dureeMiTemps: number, taille = 10): number {
  const parMiTemps = Math.ceil(dureeMiTemps / taille);
  const debut = i.miTemps === 1 ? 0 : dureeMiTemps * 60;
  const idx = Math.min(Math.floor((i.secondes - debut) / (taille * 60)), parMiTemps - 1);
  return (i.miTemps - 1) * parMiTemps + Math.max(0, idx);
}

export function libellesTranches(dureeMiTemps: number, taille = 10): string[] {
  const parMiTemps = Math.ceil(dureeMiTemps / taille);
  const out: string[] = [];
  for (let mt = 0; mt < 2; mt++) {
    for (let k = 0; k < parMiTemps; k++) {
      const a = mt * dureeMiTemps + k * taille;
      const b = Math.min(mt * dureeMiTemps + (k + 1) * taille, (mt + 1) * dureeMiTemps);
      out.push(`${a}-${b}'`);
    }
  }
  return out;
}

export function formatTimecode(s: number): string {
  const neg = s < 0;
  s = Math.abs(s);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${neg ? '-' : ''}${h > 0 ? `${h}:` : ''}${pad(m)}:${pad(sec)}`;
}
