// Stockage local (IndexedDB) : données de match en cache et file d'événements à synchroniser.
// Le codage live fonctionne entièrement sans réseau ; la synchro rejoue la file au retour du réseau.
import { api } from './api';

const BASE = 'rugby-hors-ligne';
const VERSION = 1;

function ouvrir(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(BASE, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('matchs')) db.createObjectStore('matchs');
      if (!db.objectStoreNames.contains('file')) db.createObjectStore('file', { keyPath: 'id' });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await ouvrir();
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => res(req ? (req as IDBRequest<T>).result : undefined);
    t.onerror = () => rej(t.error);
  });
}

export const cacherMatch = (cle: string, donnees: unknown) => tx('matchs', 'readwrite', (s) => s.put(donnees, cle));
export const matchEnCache = <T>(cle: string) => tx<T>('matchs', 'readonly', (s) => s.get(cle));

export interface EvenementEnFile {
  id: string;
  clubId: string;
  matchId: string;
  evenement: Record<string, unknown>;
  le: number;
}

export const enfiler = (e: EvenementEnFile) => tx('file', 'readwrite', (s) => s.put(e));
export const fileEnAttente = async (matchId?: string) => {
  const tout = ((await tx<EvenementEnFile[]>('file', 'readonly', (s) => s.getAll())) ?? []);
  return matchId ? tout.filter((e) => e.matchId === matchId) : tout;
};
const retirer = (ids: string[]) => tx('file', 'readwrite', (s) => { ids.forEach((id) => s.delete(id)); });

let enCours = false;
/** Envoie la file par lots ; un lot rejoué est sans effet (identifiants générés côté client). */
export async function synchroniser(): Promise<{ envoyes: number; restants: number; conflits: Record<string, unknown>[] }> {
  const conflits: Record<string, unknown>[] = [];
  if (enCours || !navigator.onLine) return { envoyes: 0, restants: (await fileEnAttente()).length, conflits };
  enCours = true;
  let envoyes = 0;
  try {
    const file = await fileEnAttente();
    const parMatch = new Map<string, EvenementEnFile[]>();
    for (const e of file) parMatch.set(`${e.clubId}/${e.matchId}`, [...(parMatch.get(`${e.clubId}/${e.matchId}`) ?? []), e]);
    for (const [cle, evs] of parMatch) {
      const [clubId, matchId] = cle.split('/');
      // Seule la dernière version locale de chaque événement est envoyée
      const derniers = new Map<string, EvenementEnFile>();
      for (const e of evs.sort((a, b) => a.le - b.le)) derniers.set(String(e.evenement.id), e);
      const lot = [...derniers.values()];
      for (let i = 0; i < lot.length; i += 500) {
        const tranche = lot.slice(i, i + 500);
        const r = await api<{ conflits: Record<string, unknown>[] }>(`/api/clubs/${clubId}/matchs/${matchId}/evenements/sync`, { corps: { evenements: tranche.map((e) => e.evenement) } });
        conflits.push(...r.conflits);
        await retirer(evs.filter((e) => tranche.some((t) => t.evenement.id === e.evenement.id)).map((e) => e.id));
        envoyes += tranche.length;
      }
    }
  } finally {
    enCours = false;
  }
  return { envoyes, restants: (await fileEnAttente()).length, conflits };
}

export function uuid(): string {
  return crypto.randomUUID?.() ?? 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
