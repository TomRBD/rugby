import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { OFFRES, peut as peutRbac, type Adhesion, type CodeOffre, type Fonctionnalite, type Permission, type Role } from '@rugby/shared';
import { api, definirJeton, jeton } from './api';
import { definirLangue, type Langue } from './i18n';

export interface ClubResume {
  id: string;
  nom: string;
  slug: string;
  roles: { role: Role; equipeId: string | null; joueurId: string | null }[];
}

export interface Utilisateur {
  id: string;
  nom: string;
  email: string | null;
  telephone: string | null;
  mfa_actif: boolean;
  mfaRecommandee: boolean;
  langue: Langue;
  clubs: ClubResume[];
}

export interface ClubDetail {
  id: string;
  nom: string;
  slug: string;
  offre: CodeOffre;
  couleurs: { primaire: string; secondaire: string };
  suspendu_ete: boolean;
  config: Record<string, any>;
  usage: { equipes: number; matchs: number; heures_video: number };
  page_publique: boolean;
  [k: string]: any;
}

interface Session {
  utilisateur: Utilisateur | null;
  club: ClubDetail | null;
  clubId: string | null;
  chargement: boolean;
  connecter: (jeton: string, u: Utilisateur) => void;
  deconnecter: () => void;
  choisirClub: (id: string) => void;
  recharger: () => Promise<void>;
  peut: (p: Permission, equipeId?: string | null) => boolean;
  fonction: (f: Fonctionnalite) => boolean;
  roles: Role[];
  joueurIds: string[];
}

const Ctx = createContext<Session>(null as unknown as Session);

export function FournisseurSession({ children }: { children: ReactNode }) {
  const [utilisateur, setUtilisateur] = useState<Utilisateur | null>(null);
  const [club, setClub] = useState<ClubDetail | null>(null);
  const [clubId, setClubId] = useState<string | null>(() => { try { return localStorage.getItem('rugby.club'); } catch { return null; } });
  const [chargement, setChargement] = useState(!!jeton());

  const recharger = useCallback(async () => {
    if (!jeton()) { setChargement(false); return; }
    try {
      const u = await api<Utilisateur>('/api/moi');
      setUtilisateur(u);
      if (u.langue) definirLangue(u.langue);
      const id = u.clubs.find((c) => c.id === clubId)?.id ?? u.clubs[0]?.id ?? null;
      setClubId(id);
      if (id) setClub(await api<ClubDetail>(`/api/clubs/${id}`));
    } catch (e) {
      // Hors ligne : on garde la session locale pour le codage live
      if (!navigator.onLine) {
        try {
          const c = JSON.parse(localStorage.getItem('rugby.session') ?? 'null');
          if (c) { setUtilisateur(c.utilisateur); setClub(c.club); }
        } catch { /* ignoré */ }
      } else {
        definirJeton(null);
        setUtilisateur(null);
      }
    } finally {
      setChargement(false);
    }
  }, [clubId]);

  useEffect(() => { void recharger(); }, [recharger]);
  useEffect(() => {
    try {
      if (clubId) localStorage.setItem('rugby.club', clubId);
      if (utilisateur && club) localStorage.setItem('rugby.session', JSON.stringify({ utilisateur, club }));
    } catch { /* ignoré */ }
  }, [clubId, utilisateur, club]);

  const valeur = useMemo<Session>(() => {
    const roles = utilisateur?.clubs.find((c) => c.id === clubId)?.roles ?? [];
    const adhesions: Adhesion[] = roles.map((r) => ({ role: r.role, equipeId: r.equipeId }));
    return {
      utilisateur, club, clubId, chargement,
      connecter: (j, u) => { definirJeton(j); setUtilisateur(u); setChargement(true); setClubId(u.clubs[0]?.id ?? null); setTimeout(() => void recharger(), 0); },
      deconnecter: () => { definirJeton(null); setUtilisateur(null); setClub(null); try { localStorage.removeItem('rugby.session'); } catch { /* ignoré */ } },
      choisirClub: (id) => { setClubId(id); setClub(null); setChargement(true); },
      recharger,
      peut: (p, e) => peutRbac(adhesions, p, e),
      fonction: (f) => !!club && OFFRES[club.offre].fonctionnalites.includes(f),
      roles: [...new Set(roles.map((r) => r.role))],
      joueurIds: roles.map((r) => r.joueurId).filter((x): x is string => !!x),
    };
  }, [utilisateur, club, clubId, chargement, recharger]);

  return <Ctx.Provider value={valeur}>{children}</Ctx.Provider>;
}

export const useSession = () => useContext(Ctx);

/** Préfixe des routes API du club courant. */
export function useClubApi() {
  const { clubId } = useSession();
  return (chemin: string) => `/api/clubs/${clubId}${chemin}`;
}
