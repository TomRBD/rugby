// Paramètres du club : informations, fenêtres de codage (taxonomie), objectifs et pondérations, membres et invitations,
// abonnement, sécurité (double authentification), journal des actions sensibles.
import { useEffect, useState } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import QRCode from 'qrcode';
import {
  LIBELLES_ROLES, LIBELLES_STATS_JOUEUR, OBJECTIFS_DEFAUT, OFFRES, POIDS_CONTRIBUTION_DEFAUT, type DefinitionTypeEvenement, type Role,
} from '@rugby/shared';
import { api, definirJeton } from '../lib/api';
import { useClubApi, useSession } from '../lib/session';
import { useDonnees } from '../lib/hooks';
import { Champ, Chargement, Erreur, Modale, useAction } from '../composants/ui';

export function ModaleInvitation({ initial, onFermer }: { initial?: { role?: Role; joueurId?: string; libelle?: string }; onFermer: () => void }) {
  const url = useClubApi();
  const action = useAction();
  const equipes = useDonnees<any[]>(url('/equipes'));
  const [f, setF] = useState({ role: initial?.role ?? 'entraineur', equipeId: '' });
  const [lien, setLien] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const creer = async () => {
    const r = await action(() => api(url('/invitations'), { corps: { role: f.role, equipeId: f.equipeId || null, joueurId: initial?.joueurId ?? null } }));
    if (r) { setLien(r.lien); setQr(await QRCode.toDataURL(r.lien, { width: 240, margin: 1 })); }
  };
  return (
    <Modale titre={initial?.libelle ? `Inviter ${initial.libelle}` : 'Inviter un membre'} onFermer={onFermer} etroite>
      {!lien ? (
        <div className="pile">
          {!initial?.joueurId && (
            <Champ label="Rôle"><select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as Role })}>
              {(Object.keys(LIBELLES_ROLES) as Role[]).filter((r) => r !== 'joueur').map((r) => <option key={r} value={r}>{LIBELLES_ROLES[r]}</option>)}
            </select></Champ>
          )}
          {!initial?.joueurId && (
            <Champ label="Équipe (vide = tout le club)"><select value={f.equipeId} onChange={(e) => setF({ ...f, equipeId: e.target.value })}>
              <option value="">Tout le club</option>{equipes.donnees?.map((e) => <option key={e.id} value={e.id}>{e.nom}</option>)}
            </select></Champ>
          )}
          <p className="muet petit">Lien valable 14 jours, utilisable une fois. La personne peut créer son compte avec un simple numéro de téléphone.</p>
          <button className="bouton primaire" onClick={creer}>Créer le lien d'invitation</button>
        </div>
      ) : (
        <div className="pile" style={{ justifyItems: 'center' }}>
          {qr && <img src={qr} alt="QR code d'invitation" width={240} />}
          <code style={{ wordBreak: 'break-all' }} className="petit">{lien}</code>
          <div className="ligne">
            <button className="bouton" onClick={() => navigator.clipboard.writeText(lien)}>Copier le lien</button>
            {'share' in navigator && <button className="bouton" onClick={() => navigator.share({ title: 'Invitation Rugby Analyse', url: lien })}>Partager</button>}
          </div>
        </div>
      )}
    </Modale>
  );
}

function InfosClub() {
  const url = useClubApi();
  const action = useAction();
  const { club, recharger } = useSession();
  const [f, setF] = useState<any>(null);
  useEffect(() => { if (club) setF({ nom: club.nom, comite: club.comite ?? '', poule: club.poule ?? '', logo_url: club.logo_url ?? '', primaire: club.couleurs.primaire, secondaire: club.couleurs.secondaire, stades: (club.stades ?? []).join(', '), page_publique: club.page_publique }); }, [club]);
  if (!f || !club) return <Chargement />;
  const enregistrer = () => action(() => api(url(''), { methode: 'PATCH', corps: {
    nom: f.nom, comite: f.comite || null, poule: f.poule || null, logo_url: f.logo_url || null, couleurs: { primaire: f.primaire, secondaire: f.secondaire },
    stades: f.stades.split(',').map((s: string) => s.trim()).filter(Boolean), page_publique: f.page_publique,
  } }), 'Club enregistré').then(() => recharger());
  return (
    <div className="carte formulaire">
      <Champ label="Nom du club"><input value={f.nom} onChange={(e) => setF({ ...f, nom: e.target.value })} /></Champ>
      <Champ label="Comité régional"><input value={f.comite} onChange={(e) => setF({ ...f, comite: e.target.value })} /></Champ>
      <Champ label="Poule (permet l'échange de vidéos)"><input value={f.poule} onChange={(e) => setF({ ...f, poule: e.target.value })} /></Champ>
      <Champ label="Logo (URL)"><input value={f.logo_url} onChange={(e) => setF({ ...f, logo_url: e.target.value })} /></Champ>
      <Champ label="Couleur principale"><input type="color" value={f.primaire} onChange={(e) => setF({ ...f, primaire: e.target.value })} /></Champ>
      <Champ label="Couleur secondaire"><input type="color" value={f.secondaire} onChange={(e) => setF({ ...f, secondaire: e.target.value })} /></Champ>
      <Champ label="Stades (séparés par des virgules)" large><input value={f.stades} onChange={(e) => setF({ ...f, stades: e.target.value })} /></Champ>
      <label className="ligne large"><input type="checkbox" checked={f.page_publique} onChange={(e) => setF({ ...f, page_publique: e.target.checked })} />
        Page publique des résultats {f.page_publique && <a href={`/club/${club.slug}`} target="_blank" rel="noreferrer">/club/{club.slug}</a>}</label>
      <div className="large"><button className="bouton primaire" onClick={enregistrer}>Enregistrer</button></div>
    </div>
  );
}

function Taxonomie() {
  const url = useClubApi();
  const action = useAction();
  const t = useDonnees<DefinitionTypeEvenement[]>(url('/taxonomie'));
  const [edition, setEdition] = useState<string | null>(null);
  if (!t.donnees) return <Chargement />;
  const enregistrer = async (def: DefinitionTypeEvenement) => {
    if (await action(() => api(url(`/taxonomie/${def.key}`), { methode: 'PUT', corps: def }), 'Bouton enregistré')) { setEdition(null); void t.recharger(); }
  };
  return (
    <div className="pile">
      <div className="ligne">
        <button className="bouton" onClick={() => setEdition('nouveau')}>Ajouter un type d'action</button>
        <button className="bouton danger" onClick={() => confirm('Revenir à la taxonomie par défaut ?') && action(() => api(url('/taxonomie/reinitialiser'), { corps: {} }), 'Taxonomie réinitialisée').then(() => t.recharger())}>Réinitialiser</button>
      </div>
      <div className="carte tableau-conteneur">
        <table className="tableau">
          <thead><tr><th>Famille</th><th>Action</th><th>Touche</th><th>Niveaux</th><th>Résultats</th><th className="num">Avant / après</th><th></th></tr></thead>
          <tbody>
            {t.donnees.map((d) => (
              <tr key={d.key}>
                <td className="muet">{d.famille}</td><td><strong>{d.label}</strong></td><td>{d.raccourci && <kbd>{d.raccourci.toUpperCase()}</kbd>}</td>
                <td>{d.niveaux.map((n) => <span key={n} className="badge" style={{ marginRight: 4 }}>{n}</span>)}</td>
                <td className="petit">{d.resultats.map((r) => r.label).join(', ')}</td>
                <td className="num">{d.preRoll} s / {d.postRoll} s</td>
                <td className="ligne"><button className="bouton petit" onClick={() => setEdition(d.key)}>Modifier</button>
                  <button className="bouton petit discret" onClick={() => action(() => api(url(`/taxonomie/${d.key}`), { methode: 'DELETE' }), 'Désactivé').then(() => t.recharger())}>Désactiver</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edition && (
        <EditeurType initial={edition === 'nouveau' ? undefined : t.donnees.find((d) => d.key === edition)} onFermer={() => setEdition(null)} onEnregistrer={enregistrer} />
      )}
    </div>
  );
}

function EditeurType({ initial, onFermer, onEnregistrer }: { initial?: DefinitionTypeEvenement; onFermer: () => void; onEnregistrer: (d: DefinitionTypeEvenement) => void }) {
  const [d, setD] = useState<DefinitionTypeEvenement>(initial ?? {
    key: '', famille: 'Attaque', label: '', raccourci: '', niveaux: ['complet'], resultats: [{ value: 'reussi', label: 'Réussi', succes: true }],
    attributs: [], preRoll: 3, postRoll: 3, dureeDefaut: 2, sensCamp: 'porteur', ordre: 200,
  });
  const [json, setJson] = useState(false);
  return (
    <Modale titre={initial ? `Modifier : ${initial.label}` : 'Nouveau type d\'action'} onFermer={onFermer}>
      <div className="formulaire">
        <Champ label="Libellé"><input value={d.label} onChange={(e) => setD({ ...d, label: e.target.value, key: initial ? d.key : e.target.value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') })} /></Champ>
        <Champ label="Famille"><input value={d.famille} onChange={(e) => setD({ ...d, famille: e.target.value })} /></Champ>
        <Champ label="Touche clavier"><input maxLength={1} value={d.raccourci ?? ''} onChange={(e) => setD({ ...d, raccourci: e.target.value.toLowerCase() })} /></Champ>
        <Champ label="Secondes avant le clip"><input type="number" value={d.preRoll} onChange={(e) => setD({ ...d, preRoll: Number(e.target.value) })} /></Champ>
        <Champ label="Secondes après le clip"><input type="number" value={d.postRoll} onChange={(e) => setD({ ...d, postRoll: Number(e.target.value) })} /></Champ>
        <Champ label="Équipe portée"><select value={d.sensCamp} onChange={(e) => setD({ ...d, sensCamp: e.target.value as any })}><option value="porteur">Celle qui réalise l'action</option><option value="defense">Celle qui défend</option><option value="fautif">Celle qui commet la faute</option></select></Champ>
        <label className="ligne"><input type="checkbox" checked={d.niveaux.includes('express')} onChange={(e) => setD({ ...d, niveaux: e.target.checked ? ['express', 'complet'] : ['complet'] })} /> Présent en Express</label>
      </div>
      <h3>Résultats</h3>
      {d.resultats.map((r, i) => (
        <div key={i} className="ligne">
          <input className="saisie" style={{ flex: 1 }} value={r.label} onChange={(e) => setD({ ...d, resultats: d.resultats.map((x, j) => (j === i ? { ...x, label: e.target.value, value: initial?.resultats[i]?.value ?? e.target.value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_') } : x)) })} aria-label="Résultat" />
          <label className="ligne petit"><input type="checkbox" checked={r.succes} onChange={(e) => setD({ ...d, resultats: d.resultats.map((x, j) => (j === i ? { ...x, succes: e.target.checked } : x)) })} />Réussite</label>
          <input className="saisie" type="number" style={{ width: 80 }} placeholder="pts" value={r.points ?? ''} onChange={(e) => setD({ ...d, resultats: d.resultats.map((x, j) => (j === i ? { ...x, points: e.target.value === '' ? undefined : Number(e.target.value) } : x)) })} aria-label="Points" />
          <button className="bouton petit discret" onClick={() => setD({ ...d, resultats: d.resultats.filter((_, j) => j !== i) })}>✕</button>
        </div>
      ))}
      <button className="bouton petit" onClick={() => setD({ ...d, resultats: [...d.resultats, { value: `r${d.resultats.length + 1}`, label: '', succes: true }] })}>Ajouter un résultat</button>
      <h3>Attributs ({d.attributs.length})</h3>
      <button className="bouton petit" onClick={() => setJson(!json)}>{json ? 'Masquer' : 'Modifier les attributs (avancé)'}</button>
      {json && <textarea className="saisie" rows={8} style={{ fontFamily: 'monospace', width: '100%' }} defaultValue={JSON.stringify(d.attributs, null, 2)}
        onBlur={(e) => { try { setD({ ...d, attributs: JSON.parse(e.target.value) }); } catch { alert('JSON invalide'); } }} />}
      <div className="ligne" style={{ marginTop: 12 }}><button className="bouton primaire" disabled={!d.key || !d.label} onClick={() => onEnregistrer(d)}>Enregistrer</button></div>
    </Modale>
  );
}

function Analyse() {
  const url = useClubApi();
  const action = useAction();
  const { club, recharger } = useSession();
  const types = useDonnees<DefinitionTypeEvenement[]>(url('/taxonomie'));
  const [objectifs, setObjectifs] = useState<any[]>(club?.config?.objectifs ?? OBJECTIFS_DEFAUT);
  const [poids, setPoids] = useState<Record<string, number>>(club?.config?.poids ?? POIDS_CONTRIBUTION_DEFAUT);
  const [indicateurs, setIndicateurs] = useState<string>((club?.config?.modelesRapport?.apresMatch?.indicateurs ?? []).join(', '));
  const enregistrer = () => action(() => api(url(''), { methode: 'PATCH', corps: { config: {
    objectifs, poids, modelesRapport: indicateurs.trim() ? { apresMatch: { indicateurs: indicateurs.split(',').map((s) => s.trim()).filter(Boolean) } } : undefined,
  } } }), 'Paramètres d\'analyse enregistrés').then(() => recharger());
  return (
    <div className="grille-2">
      <div className="carte pile">
        <h2 style={{ margin: 0 }}>Objectifs par match (tableau de bord après-match)</h2>
        <p className="muet petit">Jusqu'à 10 indicateurs, affichés en vert ou rouge après chaque match. Modifiables match par match.</p>
        {objectifs.map((o, i) => (
          <div key={i} className="ligne">
            <input className="saisie" style={{ flex: 1 }} value={o.key} onChange={(e) => setObjectifs(objectifs.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} aria-label="Indicateur" list="indicateurs" />
            <select className="saisie" style={{ width: 'auto' }} value={o.camp} onChange={(e) => setObjectifs(objectifs.map((x, j) => (j === i ? { ...x, camp: e.target.value } : x)))} aria-label="Équipe"><option value="nous">Nous</option><option value="adversaire">Adversaire</option></select>
            <input className="saisie" type="number" style={{ width: 90 }} value={o.cible} onChange={(e) => setObjectifs(objectifs.map((x, j) => (j === i ? { ...x, cible: Number(e.target.value) } : x)))} aria-label="Cible" />
            <button className="bouton petit discret" onClick={() => setObjectifs(objectifs.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
        <datalist id="indicateurs">{['points', 'essais', 'possession', 'melees', 'touches', 'renvois', 'rucks_gagnes', 'rucks_rapides', 'plaquages_reussis', 'plaquages_dominants', 'turnovers', 'penalites', 'cartons', 'points_par_entree', 'jap_recuperes', 'buteur'].map((k) => <option key={k} value={k} />)}</datalist>
        {objectifs.length < 10 && <button className="bouton petit" onClick={() => setObjectifs([...objectifs, { key: 'points', camp: 'nous', cible: 20 }])}>Ajouter</button>}
        <Champ label="Indicateurs du rapport après-match (clés séparées par des virgules, vide = modèle par défaut)"><input value={indicateurs} onChange={(e) => setIndicateurs(e.target.value)} /></Champ>
      </div>
      <div className="carte pile">
        <h2 style={{ margin: 0 }}>Pondération de l'indice de contribution</h2>
        <div className="formulaire">
          {Object.entries(poids).map(([k, v]) => (
            <Champ key={k} label={LIBELLES_STATS_JOUEUR[k] ?? k}><input type="number" step={0.5} value={v} onChange={(e) => setPoids({ ...poids, [k]: Number(e.target.value) })} /></Champ>
          ))}
        </div>
        <p className="muet petit">Pré-roll et post-roll par type d'action : modifiables dans Fenêtres de codage ({types.donnees?.length ?? 0} types).</p>
      </div>
      <div><button className="bouton primaire" onClick={enregistrer}>Enregistrer</button></div>
    </div>
  );
}

function Membres() {
  const url = useClubApi();
  const action = useAction();
  const m = useDonnees<any[]>(url('/membres'));
  const [inv, setInv] = useState(false);
  if (m.erreur) return <Erreur message={m.erreur} />;
  if (!m.donnees) return <Chargement />;
  return (
    <div className="pile">
      <div><button className="bouton primaire" onClick={() => setInv(true)}>Inviter (lien ou QR code)</button></div>
      <div className="carte tableau-conteneur">
        <table className="tableau">
          <thead><tr><th>Nom</th><th>Contact</th><th>Rôle</th><th>Équipe</th><th>Double auth.</th><th></th></tr></thead>
          <tbody>
            {m.donnees.map((a) => (
              <tr key={a.id}>
                <td>{a.nom}</td><td className="petit">{a.email ?? a.telephone}</td><td>{LIBELLES_ROLES[a.role as Role]}</td><td>{a.equipe ?? 'Tout le club'}</td>
                <td>{a.mfa_actif ? <span className="badge vert">Active</span> : ['admin', 'medical'].includes(a.role) ? <span className="badge orange">À activer</span> : '-'}</td>
                <td><button className="bouton petit discret" onClick={() => confirm('Retirer ce rôle ?') && action(() => api(url(`/membres/${a.id}`), { methode: 'DELETE' }), 'Rôle retiré').then(() => m.recharger())}>Retirer</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muet petit">Les rôles sont cumulables : invitez la même personne plusieurs fois pour lui donner plusieurs rôles. Les joueurs s'invitent depuis l'effectif.</p>
      {inv && <ModaleInvitation onFermer={() => { setInv(false); void m.recharger(); }} />}
    </div>
  );
}

function Abonnement() {
  const url = useClubApi();
  const action = useAction();
  const { club, recharger } = useSession();
  if (!club) return <Chargement />;
  const changer = (corps: any, msg: string) => action(() => api(url('/abonnement'), { corps }), msg).then(() => recharger());
  return (
    <div className="pile">
      <div className="grille">
        {Object.values(OFFRES).map((o) => (
          <div key={o.code} className="carte pile" style={{ outline: club.offre === o.code ? '3px solid var(--primaire)' : undefined }}>
            <h3 style={{ margin: 0 }}>{o.nom}</h3>
            <div className="chiffre" style={{ fontSize: '1.5rem' }}>{o.prixMensuel === null ? 'Sur devis' : o.prixMensuel === 0 ? 'Gratuit' : `${o.prixMensuel} € / mois`}</div>
            {o.prixAnnuel ? <span className="muet petit">ou {o.prixAnnuel} € par an</span> : null}
            <ul className="petit" style={{ paddingLeft: 18, margin: 0 }}>
              <li>{o.maxEquipes ?? 'Équipes illimitées'}{o.maxEquipes ? ' équipe(s)' : ''}</li>
              <li>{o.maxMatchs ? `${o.maxMatchs} matchs` : 'Matchs illimités'}</li>
              <li>{o.heuresVideo ? `${o.heuresVideo} h de vidéo` : 'Vidéo sur devis'}</li>
              {o.fonctionnalites.includes('partage') && <li>Partage aux joueurs, app joueur</li>}
              {o.fonctionnalites.includes('analyse_adverse') && <li>Analyse adverse, rapports personnalisés, IA</li>}
              {o.fonctionnalites.includes('tracking') && <li>Multi-angles, GPS, tracking, API</li>}
            </ul>
            {club.offre !== o.code && <button className="bouton" onClick={() => changer({ offre: o.code }, `Offre ${o.nom} activée`)}>Choisir</button>}
          </div>
        ))}
      </div>
      <div className="carte pile">
        <label className="ligne"><input type="checkbox" checked={club.cycle_facturation === 'annuel'} onChange={(e) => changer({ cycle_facturation: e.target.checked ? 'annuel' : 'mensuel' }, 'Cycle de facturation modifié')} /> Paiement annuel (deux mois offerts)</label>
        <label className="ligne"><input type="checkbox" checked={club.suspendu_ete} onChange={(e) => changer({ suspendu_ete: e.target.checked }, e.target.checked ? 'Suspension estivale activée' : 'Abonnement réactivé')} /> Suspension estivale (accès en lecture seule, facturation suspendue)</label>
        <div className="ligne">
          <button className="bouton" onClick={async () => {
            const d = await action(() => api(url('/export-complet')));
            if (!d) return;
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([JSON.stringify(d)], { type: 'application/json' }));
            a.download = `export-${club.slug}.json`;
            a.click();
          }}>Exporter toutes les données du club</button>
          {club.suppression_prevue ? (
            <><span className="badge rouge">Suppression prévue le {new Date(club.suppression_prevue).toLocaleDateString('fr-FR')}</span>
              <button className="bouton" onClick={() => action(() => api(url('/reactivation'), { corps: {} }), 'Abonnement réactivé').then(() => recharger())}>Annuler la résiliation</button></>
          ) : (
            <button className="bouton danger" onClick={() => confirm('Résilier ? Exportez vos données : elles seront supprimées définitivement dans 90 jours.') && action(() => api(url('/resiliation'), { corps: {} }), 'Résiliation enregistrée').then(() => recharger())}>Résilier l'abonnement</button>
          )}
        </div>
      </div>
    </div>
  );
}

function Securite() {
  const action = useAction();
  const { utilisateur, recharger } = useSession();
  const [secret, setSecret] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const preparer = async () => {
    const r = await action(() => api('/api/moi/mfa/preparer', { corps: {} }));
    if (r) setSecret({ secret: r.secret, qr: await QRCode.toDataURL(r.otpauth, { width: 200, margin: 1 }) });
  };
  const activer = async () => {
    const r = await action(() => api('/api/moi/mfa/activer', { corps: { code } }), 'Double authentification activée');
    if (r) { definirJeton(r.jeton); setSecret(null); void recharger(); }
  };
  return (
    <div className="carte pile" style={{ maxWidth: 560 }}>
      <h2 style={{ margin: 0 }}>Double authentification</h2>
      <p className="muet">Obligatoire pour les administrateurs et le staff médical. Utilisez une application d'authentification (FreeOTP, Google Authenticator, Aegis…).</p>
      {utilisateur?.mfa_actif ? <span className="badge vert">Active sur votre compte</span> : !secret ? (
        <button className="bouton primaire" onClick={preparer}>Activer</button>
      ) : (
        <div className="pile">
          <img src={secret.qr} alt="QR code à scanner" width={200} />
          <code className="petit">{secret.secret}</code>
          <Champ label="Code à 6 chiffres affiché par l'application"><input inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} /></Champ>
          <button className="bouton primaire" disabled={code.length !== 6} onClick={activer}>Confirmer</button>
        </div>
      )}
    </div>
  );
}

function Journal() {
  const url = useClubApi();
  const j = useDonnees<any[]>(url('/journal'));
  if (j.erreur) return <Erreur message={j.erreur} />;
  if (!j.donnees) return <Chargement />;
  return (
    <div className="carte tableau-conteneur">
      <table className="tableau">
        <thead><tr><th>Date</th><th>Utilisateur</th><th>Action</th><th>Cible</th></tr></thead>
        <tbody>{j.donnees.map((l) => <tr key={l.id}><td>{new Date(l.le).toLocaleString('fr-FR')}</td><td>{l.utilisateur ?? '-'}</td><td>{l.action.replace(/_/g, ' ')}</td><td className="muet petit">{l.cible ?? ''}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

export default function Parametres() {
  const { peut } = useSession();
  const admin = peut('club.gerer', null);
  const onglets: [string, string, boolean][] = [
    ['', 'Club', admin], ['codage', 'Fenêtres de codage', peut('taxonomie.ecrire')], ['analyse', 'Objectifs et indices', admin],
    ['membres', 'Membres et rôles', admin], ['abonnement', 'Abonnement', admin], ['securite', 'Sécurité', true], ['journal', 'Journal', admin],
  ];
  return (
    <div className="pile">
      <h1>Paramètres</h1>
      <nav className="onglets">
        {onglets.filter(([, , v]) => v).map(([to, label]) => <NavLink key={to} end to={`/parametres${to ? `/${to}` : ''}`} className={({ isActive }) => (isActive ? 'actif' : '')}>{label}</NavLink>)}
      </nav>
      <Routes>
        <Route index element={admin ? <InfosClub /> : <Securite />} />
        <Route path="codage" element={<Taxonomie />} />
        <Route path="analyse" element={<Analyse />} />
        <Route path="membres" element={<Membres />} />
        <Route path="abonnement" element={<Abonnement />} />
        <Route path="securite" element={<Securite />} />
        <Route path="journal" element={<Journal />} />
      </Routes>
    </div>
  );
}
