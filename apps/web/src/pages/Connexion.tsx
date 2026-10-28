import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { LIBELLES_ROLES, type Role } from '@rugby/shared';
import { api, ErreurApi } from '../lib/api';
import { useSession } from '../lib/session';
import { useDonnees } from '../lib/hooks';
import { t } from '../lib/i18n';
import { Champ, Chargement, Erreur } from '../composants/ui';

export function Connexion() {
  const { connecter } = useSession();
  const [identifiant, setIdentifiant] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [codeMfa, setCodeMfa] = useState('');
  const [mfa, setMfa] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const soumettre = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnvoi(true);
    setErreur(null);
    try {
      const r = await api('/api/auth/connexion', { corps: { identifiant, motDePasse, codeMfa: codeMfa || undefined } });
      connecter(r.jeton, r.utilisateur);
    } catch (err) {
      if (err instanceof ErreurApi && err.code === 'mfa_requise') setMfa(true);
      else setErreur((err as Error).message);
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <div className="page-centree">
      <form className="carte pile" onSubmit={soumettre}>
        <div className="ligne"><img src="/icone.svg" alt="" width={40} /><h1 style={{ margin: 0 }}>Rugby Analyse</h1></div>
        <p className="muet">Codage vidéo, statistiques et partage aux joueurs pour les clubs de Régionale 1 à Fédérale 1.</p>
        <Champ label={t('identifiant')}><input autoComplete="username" value={identifiant} onChange={(e) => setIdentifiant(e.target.value)} required /></Champ>
        <Champ label={t('motDePasse')}><input type="password" autoComplete="current-password" value={motDePasse} onChange={(e) => setMotDePasse(e.target.value)} required /></Champ>
        {mfa && <Champ label="Code de double authentification (6 chiffres)"><input inputMode="numeric" autoComplete="one-time-code" value={codeMfa} onChange={(e) => setCodeMfa(e.target.value)} autoFocus required /></Champ>}
        <Erreur message={erreur} />
        <button className="bouton primaire" disabled={envoi}>{t('seConnecter')}</button>
        <p className="petit">Pas encore de compte ? <Link to="/inscription">{t('inscription')}</Link></p>
        <p className="petit muet">Compte de démonstration : demo@rugby-analyse.fr / demo-rugby (après chargement du match de démo).</p>
      </form>
    </div>
  );
}

export function Inscription() {
  const { connecter } = useSession();
  const nav = useNavigate();
  const [f, setF] = useState({ nom: '', identifiant: '', motDePasse: '', club: '', comite: '', poule: '' });
  const [erreur, setErreur] = useState<string | null>(null);
  const maj = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const soumettre = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const ident = f.identifiant.includes('@') ? { email: f.identifiant } : { telephone: f.identifiant };
      const r = await api('/api/auth/inscription', { corps: { nom: f.nom, motDePasse: f.motDePasse, ...ident, club: { nom: f.club, comite: f.comite || undefined, poule: f.poule || undefined } } });
      connecter(r.jeton, r.utilisateur);
      nav('/tutoriel');
    } catch (err) {
      setErreur((err as Error).message);
    }
  };
  return (
    <div className="page-centree">
      <form className="carte pile" onSubmit={soumettre}>
        <h1>{t('inscription')}</h1>
        <p className="muet petit">Offre Découverte gratuite : 1 équipe, 3 matchs, codage Express.</p>
        <Champ label="Votre nom"><input value={f.nom} onChange={maj('nom')} required minLength={2} /></Champ>
        <Champ label={t('identifiant')}><input value={f.identifiant} onChange={maj('identifiant')} required /></Champ>
        <Champ label={`${t('motDePasse')} (8 caractères minimum)`}><input type="password" minLength={8} value={f.motDePasse} onChange={maj('motDePasse')} required /></Champ>
        <Champ label="Nom du club"><input value={f.club} onChange={maj('club')} required minLength={2} /></Champ>
        <Champ label="Comité régional (facultatif)"><input value={f.comite} onChange={maj('comite')} /></Champ>
        <Champ label="Poule (facultatif)"><input value={f.poule} onChange={maj('poule')} /></Champ>
        <Erreur message={erreur} />
        <button className="bouton primaire">Créer le club</button>
        <p className="petit"><Link to="/">J'ai déjà un compte</Link></p>
      </form>
    </div>
  );
}

export function Invitation() {
  const { jeton } = useParams();
  const { utilisateur, connecter } = useSession();
  const nav = useNavigate();
  const { donnees, erreur, chargement } = useDonnees<any>(`/api/invitations/${jeton}`);
  const [f, setF] = useState({ nom: '', identifiant: '', motDePasse: '' });
  const [err, setErr] = useState<string | null>(null);
  const accepter = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const ident = f.identifiant.includes('@') ? { email: f.identifiant } : { telephone: f.identifiant };
      const r = await api(`/api/invitations/${jeton}/accepter`, { corps: utilisateur ? {} : { nom: f.nom, motDePasse: f.motDePasse, ...ident } });
      connecter(r.jeton, r.utilisateur);
      nav(donnees?.role === 'joueur' ? '/joueur' : '/');
    } catch (x) {
      setErr((x as Error).message);
    }
  };
  if (chargement) return <div className="page-centree"><Chargement /></div>;
  return (
    <div className="page-centree">
      <form className="carte pile" onSubmit={accepter}>
        <h1>Invitation</h1>
        <Erreur message={erreur ? 'Invitation invalide, expirée ou déjà utilisée.' : null} />
        {donnees && (
          <>
            <p><strong>{donnees.club}</strong> vous invite comme <strong>{LIBELLES_ROLES[donnees.role as Role]}</strong>
              {donnees.equipe ? ` (${donnees.equipe})` : ''}{donnees.prenom ? ` pour ${donnees.prenom} ${donnees.nom}` : ''}.</p>
            {!utilisateur && (
              <>
                <Champ label="Votre nom"><input value={f.nom} onChange={(e) => setF({ ...f, nom: e.target.value })} required minLength={2} /></Champ>
                <Champ label="Email ou téléphone (un numéro suffit)"><input value={f.identifiant} onChange={(e) => setF({ ...f, identifiant: e.target.value })} required /></Champ>
                <Champ label="Mot de passe (8 caractères minimum)"><input type="password" minLength={8} value={f.motDePasse} onChange={(e) => setF({ ...f, motDePasse: e.target.value })} required /></Champ>
              </>
            )}
            <Erreur message={err} />
            <button className="bouton primaire">Accepter l'invitation</button>
          </>
        )}
      </form>
    </div>
  );
}
