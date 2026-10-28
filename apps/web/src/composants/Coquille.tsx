import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useSession } from '../lib/session';
import { definirLangue, langueCourante, t, type Langue } from '../lib/i18n';
import { appliquerTheme, themeCourant, type Theme } from '../lib/theme';
import { useEnLigne } from '../lib/hooks';
import { fileEnAttente, synchroniser } from '../lib/horsLigne';
import { etatTeleversements, type EtatTeleversement } from '../lib/televersement';

export function Coquille() {
  const { utilisateur, club, clubId, choisirClub, deconnecter, peut, roles, fonction } = useSession();
  const [ouverte, setOuverte] = useState(false);
  const [theme, setTheme] = useState<Theme>(themeCourant());
  const [langue, setLangue] = useState<Langue>(langueCourante());
  const [enAttente, setEnAttente] = useState(0);
  const [uploads, setUploads] = useState<EtatTeleversement[]>([]);
  const enLigne = useEnLigne();
  const loc = useLocation();
  useEffect(() => setOuverte(false), [loc.pathname]);

  // Synchronisation automatique de la file hors ligne au retour du réseau
  useEffect(() => {
    let actif = true;
    const tick = async () => {
      if (navigator.onLine) await synchroniser().catch(() => undefined);
      const n = (await fileEnAttente().catch(() => [])).length;
      if (actif) setEnAttente(n);
    };
    void tick();
    const id = setInterval(tick, 10_000);
    window.addEventListener('online', tick);
    return () => { actif = false; clearInterval(id); window.removeEventListener('online', tick); };
  }, []);
  useEffect(() => etatTeleversements(setUploads), []);

  const staff = roles.some((r) => r !== 'joueur');
  const liens: [string, string, boolean][] = [
    ['/', t('accueil'), staff],
    ['/matchs', t('matchs'), peut('match.lire')],
    ['/effectif', t('effectif'), peut('effectif.lire')],
    ['/equipes', t('equipes'), peut('effectif.lire')],
    ['/playlists', t('playlists'), peut('playlist.ecrire')],
    ['/adversaires', t('adversaires'), peut('match.lire')],
    ['/recherche', t('recherche'), peut('stats.lire') && fonction('ia')],
    ['/entrainements', t('entrainements'), peut('match.lire')],
    ['/sante', t('sante'), peut('sante.lire')],
    ['/joueur', t('espaceJoueur'), roles.includes('joueur')],
    ['/parametres', t('parametres'), staff],
    ['/tutoriel', t('tutoriel'), staff],
  ];

  return (
    <div className="coquille">
      <header className="barre-mobile">
        <button onClick={() => setOuverte(true)} aria-label="Ouvrir le menu">☰</button>
        <strong>{club?.nom ?? 'Rugby Analyse'}</strong>
        {!enLigne && <span className="badge orange" style={{ marginLeft: 'auto' }}>{t('horsLigne')}</span>}
      </header>
      {ouverte && <div className="voile" style={{ zIndex: 45, background: 'rgb(0 0 0 / 35%)' }} onClick={() => setOuverte(false)} />}
      <nav className={`nav ${ouverte ? 'ouverte' : ''}`} aria-label="Navigation principale">
        <div className="marque"><img src="/icone.svg" alt="" />Rugby Analyse</div>
        {utilisateur && utilisateur.clubs.length > 1 && (
          <select className="saisie" value={clubId ?? ''} onChange={(e) => choisirClub(e.target.value)} aria-label={t('club')} style={{ marginBottom: 8 }}>
            {utilisateur.clubs.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
          </select>
        )}
        {utilisateur?.clubs.length === 1 && <div className="muet petit" style={{ padding: '0 12px 8px' }}>{club?.nom}</div>}
        {liens.filter(([, , v]) => v).map(([to, label]) => (
          <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'actif' : '')}>{label}</NavLink>
        ))}
        <div className="bas">
          {!enLigne && <span className="badge orange">{t('horsLigne')}</span>}
          {enAttente > 0 && <span className="badge orange">{enAttente} {t('aSynchroniser')}</span>}
          {uploads.filter((u) => u.statut !== 'termine').map((u) => (
            <div key={u.videoId} className="petit">
              <div className="ligne entre"><span>Envoi vidéo</span><span>{Math.round(u.progression * 100)} %</span></div>
              <div className="barre-progression"><div style={{ width: `${u.progression * 100}%` }} /></div>
              {u.erreur && <span className="adv">{u.erreur}</span>}
            </div>
          ))}
          {club?.suspendu_ete && <span className="badge orange">Suspension estivale : lecture seule</span>}
          <label className="champ">
            <span>{t('theme')}</span>
            <select value={theme} onChange={(e) => { const v = e.target.value as Theme; setTheme(v); appliquerTheme(v); }}>
              <option value="auto">{t('themeAuto')}</option>
              <option value="clair">{t('themeClair')}</option>
              <option value="sombre">{t('themeSombre')}</option>
              <option value="soleil">{t('themeSoleil')}</option>
            </select>
          </label>
          <label className="champ">
            <span>{t('langue')}</span>
            <select value={langue} onChange={(e) => { const l = e.target.value as Langue; setLangue(l); definirLangue(l); location.reload(); }}>
              <option value="fr">Français</option>
              <option value="en">English</option>
            </select>
          </label>
          <span className="petit muet">{utilisateur?.nom}</span>
          {utilisateur?.mfaRecommandee && !utilisateur.mfa_actif && <NavLink to="/parametres/securite" className="badge orange">Activer la double authentification</NavLink>}
          <button className="bouton petit" onClick={deconnecter}>{t('deconnexion')}</button>
        </div>
      </nav>
      <main className="contenu" id="contenu">
        <Outlet />
      </main>
    </div>
  );
}
