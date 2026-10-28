import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useSession } from './lib/session';
import { Coquille } from './composants/Coquille';
import { Chargement } from './composants/ui';
import { Connexion, Inscription, Invitation } from './pages/Connexion';

// Pages chargées à la demande : ouverture rapide même sur un PC modeste
const Accueil = lazy(() => import('./pages/Accueil'));
const Effectif = lazy(() => import('./pages/Effectif'));
const FicheJoueur = lazy(() => import('./pages/FicheJoueur'));
const Equipes = lazy(() => import('./pages/Equipes'));
const Matchs = lazy(() => import('./pages/Matchs'));
const Match = lazy(() => import('./pages/Match'));
const Codage = lazy(() => import('./pages/Codage'));
const CodageLive = lazy(() => import('./pages/CodageLive'));
const Playlists = lazy(() => import('./pages/Playlists'));
const Playlist = lazy(() => import('./pages/Playlist'));
const Saison = lazy(() => import('./pages/Saison'));
const Adversaires = lazy(() => import('./pages/Adversaires'));
const Recherche = lazy(() => import('./pages/Recherche'));
const Sante = lazy(() => import('./pages/Sante'));
const Entrainements = lazy(() => import('./pages/Entrainements'));
const Parametres = lazy(() => import('./pages/Parametres'));
const EspaceJoueur = lazy(() => import('./pages/EspaceJoueur'));
const PartagePublic = lazy(() => import('./pages/PartagePublic'));
const PagePublique = lazy(() => import('./pages/PagePublique'));
const Tutoriel = lazy(() => import('./pages/Tutoriel'));

export function App() {
  const { utilisateur, chargement, roles } = useSession();
  const seulementJoueur = roles.length > 0 && roles.every((r) => r === 'joueur');
  return (
    <Suspense fallback={<div className="contenu"><Chargement /></div>}>
      <Routes>
        <Route path="/p/:jeton" element={<PartagePublic />} />
        <Route path="/club/:slug" element={<PagePublique />} />
        <Route path="/invitation/:jeton" element={<Invitation />} />
        {chargement ? (
          <Route path="*" element={<div className="contenu"><Chargement /></div>} />
        ) : !utilisateur ? (
          <>
            <Route path="/inscription" element={<Inscription />} />
            <Route path="*" element={<Connexion />} />
          </>
        ) : (
          <Route element={<Coquille />}>
            <Route index element={seulementJoueur ? <Navigate to="/joueur" replace /> : <Accueil />} />
            <Route path="/joueur/*" element={<EspaceJoueur />} />
            <Route path="/effectif" element={<Effectif />} />
            <Route path="/joueurs/:id" element={<FicheJoueur />} />
            <Route path="/equipes" element={<Equipes />} />
            <Route path="/matchs" element={<Matchs />} />
            <Route path="/matchs/:id/codage" element={<Codage />} />
            <Route path="/matchs/:id/live" element={<CodageLive />} />
            <Route path="/matchs/:id/*" element={<Match />} />
            <Route path="/playlists" element={<Playlists />} />
            <Route path="/playlists/:id" element={<Playlist />} />
            <Route path="/saison/:equipeId" element={<Saison />} />
            <Route path="/adversaires/*" element={<Adversaires />} />
            <Route path="/recherche" element={<Recherche />} />
            <Route path="/sante" element={<Sante />} />
            <Route path="/entrainements" element={<Entrainements />} />
            <Route path="/parametres/*" element={<Parametres />} />
            <Route path="/tutoriel" element={<Tutoriel />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        )}
      </Routes>
    </Suspense>
  );
}
