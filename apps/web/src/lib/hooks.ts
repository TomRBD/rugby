import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

/** Chargement d'une ressource API avec rechargement manuel. */
export function useDonnees<T>(chemin: string | null, deps: unknown[] = []) {
  const [donnees, setDonnees] = useState<T | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [chargement, setChargement] = useState(!!chemin);
  const version = useRef(0);
  const charger = useCallback(async () => {
    if (!chemin) return;
    const v = ++version.current;
    setChargement(true);
    try {
      const d = await api<T>(chemin);
      if (v === version.current) { setDonnees(d); setErreur(null); }
    } catch (e) {
      if (v === version.current) setErreur((e as Error).message);
    } finally {
      if (v === version.current) setChargement(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chemin, ...deps]);
  useEffect(() => { void charger(); }, [charger]);
  return { donnees, erreur, chargement, recharger: charger, setDonnees };
}

export function useEnLigne() {
  const [enLigne, setEnLigne] = useState(navigator.onLine);
  useEffect(() => {
    const on = () => setEnLigne(true);
    const off = () => setEnLigne(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return enLigne;
}

/** Raccourcis clavier ignorés pendant la saisie dans un champ. */
export function useRaccourcis(gestion: (e: KeyboardEvent) => void, actif = true) {
  const ref = useRef(gestion);
  ref.current = gestion;
  useEffect(() => {
    if (!actif) return;
    const h = (e: KeyboardEvent) => {
      const cible = e.target as HTMLElement;
      if (cible.closest('input, textarea, select, [contenteditable="true"]')) return;
      ref.current(e);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [actif]);
}
