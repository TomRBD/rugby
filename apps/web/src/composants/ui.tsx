import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { t } from '../lib/i18n';

// Notifications éphémères
interface Toast { id: number; texte: string; erreur?: boolean }
const CtxToast = createContext<(texte: string, erreur?: boolean) => void>(() => undefined);

export function FournisseurToasts({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const afficher = useCallback((texte: string, erreur = false) => {
    const id = Date.now() + Math.random();
    setToasts((l) => [...l, { id, texte, erreur }]);
    setTimeout(() => setToasts((l) => l.filter((x) => x.id !== id)), erreur ? 7000 : 3500);
  }, []);
  return (
    <CtxToast.Provider value={afficher}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((x) => <div key={x.id} className={`toast ${x.erreur ? 'erreur' : ''}`}>{x.texte}</div>)}
      </div>
    </CtxToast.Provider>
  );
}
export const useToast = () => useContext(CtxToast);

/** Exécute une action et affiche l'erreur éventuelle. */
export function useAction() {
  const toast = useToast();
  return useCallback(async <T,>(fn: () => Promise<T>, succes?: string): Promise<T | undefined> => {
    try {
      const r = await fn();
      if (succes) toast(succes);
      return r;
    } catch (e) {
      toast((e as Error).message, true);
      return undefined;
    }
  }, [toast]);
}

export function Modale({ titre, onFermer, children, etroite }: { titre: string; onFermer: () => void; children: ReactNode; etroite?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onFermer(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onFermer]);
  return (
    <div className="voile" onMouseDown={(e) => { if (e.target === e.currentTarget) onFermer(); }}>
      <div className={`modale ${etroite ? 'etroite' : ''}`} role="dialog" aria-modal="true" aria-label={titre}>
        <div className="ligne entre" style={{ marginBottom: 12 }}>
          <h2 style={{ margin: 0 }}>{titre}</h2>
          <button className="bouton discret" onClick={onFermer} aria-label={t('fermer')}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Chargement() {
  return <p className="muet" role="status">{t('chargement')}</p>;
}

export function Erreur({ message }: { message: string | null }) {
  return message ? <div className="alerte erreur" role="alert">{message}</div> : null;
}

export function Champ({ label, children, large }: { label: string; children: ReactNode; large?: boolean }) {
  return <label className={`champ ${large ? 'large' : ''}`}><span>{label}</span>{children}</label>;
}

export function Kpi({ libelle, valeur, detail }: { libelle: string; valeur: ReactNode; detail?: ReactNode }) {
  return (
    <div className="carte kpi">
      <span className="libelle">{libelle}</span>
      <span className="chiffre">{valeur}</span>
      {detail && <span className="muet petit">{detail}</span>}
    </div>
  );
}

export function Vide({ children }: { children: ReactNode }) {
  return <div className="carte muet" style={{ textAlign: 'center', padding: 32 }}>{children}</div>;
}
