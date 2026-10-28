// Téléversement reprenable en tâche de fond : morceaux de 8 Mo, reprise à l'offset serveur,
// continue pendant la navigation dans l'application, reprend après une coupure réseau.
import { api } from './api';

export interface EtatTeleversement {
  videoId: string;
  matchId: string;
  nom: string;
  progression: number;
  statut: 'en_cours' | 'pause' | 'termine' | 'erreur';
  erreur?: string;
}

const etats = new Map<string, EtatTeleversement>();
const abonnes = new Set<(l: EtatTeleversement[]) => void>();
const notifier = () => abonnes.forEach((f) => f([...etats.values()]));

export function etatTeleversements(f: (l: EtatTeleversement[]) => void) {
  abonnes.add(f);
  f([...etats.values()]);
  return () => { abonnes.delete(f); };
}

const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Mémorise les téléversements en cours pour les reprendre après rechargement (le fichier doit être resélectionné). */
function memoriser(cle: string, valeur: unknown) {
  try {
    const l = JSON.parse(localStorage.getItem('rugby.uploads') ?? '{}');
    if (valeur === null) delete l[cle]; else l[cle] = valeur;
    localStorage.setItem('rugby.uploads', JSON.stringify(l));
  } catch { /* ignoré */ }
}
export function televersementsInterrompus(): Record<string, { clubId: string; matchId: string; videoId: string; parties: { id: string; nom: string; taille: number }[] }> {
  try { return JSON.parse(localStorage.getItem('rugby.uploads') ?? '{}'); } catch { return {}; }
}

export async function televerser(clubId: string, matchId: string, fichiers: File[], angle = 'Principal', reprise?: { videoId: string; parties: { id: string; nom: string; taille: number }[] }) {
  // Tri par nom : les caméras numérotent leurs fichiers découpés (GOPR0001, GP010001...)
  const tries = [...fichiers].sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true }));
  let videoId: string;
  let parties: { id: string; nom: string; taille: number }[];
  if (reprise) {
    ({ videoId, parties } = reprise);
  } else {
    const r = await api(`/api/clubs/${clubId}/matchs/${matchId}/videos`, { corps: { angle, parties: tries.map((f) => ({ nom_fichier: f.name, taille: f.size })) } });
    videoId = r.video.id;
    parties = r.parties.map((p: any) => ({ id: p.id, nom: p.nom_fichier, taille: p.taille }));
    memoriser(videoId, { clubId, matchId, videoId, parties });
  }
  const total = parties.reduce((s, p) => s + p.taille, 0);
  const etat: EtatTeleversement = { videoId, matchId, nom: tries.map((f) => f.name).join(', '), progression: 0, statut: 'en_cours' };
  etats.set(videoId, etat);
  notifier();

  void (async () => {
    let envoyeAvant = 0;
    try {
      for (const p of parties) {
        const f = tries.find((x) => x.name === p.nom && x.size === p.taille);
        if (!f) throw new Error(`Fichier ${p.nom} manquant : resélectionnez-le`);
        const base = `/api/clubs/${clubId}/videos/${videoId}/parties/${p.id}`;
        let offset = (await api(base)).recu as number;
        const MORCEAU = 8 * 1024 * 1024;
        let essais = 0;
        while (offset < p.taille) {
          if (!navigator.onLine) { etat.statut = 'pause'; notifier(); await attendre(3000); continue; }
          etat.statut = 'en_cours';
          try {
            const r = await api(`${base}?offset=${offset}`, { methode: 'PUT', brut: f.slice(offset, offset + MORCEAU) });
            offset = r.recu;
            essais = 0;
          } catch (e) {
            // Reprise : on redemande l'offset réellement reçu par le serveur
            if (++essais > 8) throw e;
            await attendre(Math.min(30_000, 1000 * 2 ** essais));
            offset = (await api(base)).recu;
          }
          etat.progression = (envoyeAvant + offset) / total;
          notifier();
        }
        envoyeAvant += p.taille;
      }
      await api(`/api/clubs/${clubId}/videos/${videoId}/terminer`, { methode: 'POST', corps: {} });
      etat.statut = 'termine';
      etat.progression = 1;
      memoriser(videoId, null);
    } catch (e) {
      etat.statut = 'erreur';
      etat.erreur = (e as Error).message;
    }
    notifier();
  })();
  return videoId;
}
