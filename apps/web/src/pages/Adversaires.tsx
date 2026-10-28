// Analyse adverse : fiche adversaire, joueurs identifiés par numéro, rapport automatique, playlist « préparation », échanges entre clubs.
import { useState } from 'react';
import { Link, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { api, telecharger } from '../lib/api';
import { useClubApi, useSession } from '../lib/session';
import { useDonnees } from '../lib/hooks';
import { dateCourte, valeurIndicateur } from '../lib/format';
import { Chargement, Erreur, Modale, Vide, useAction } from '../composants/ui';
import { LecteurVideo, type SourceVideo } from '../composants/LecteurVideo';

function Liste() {
  const url = useClubApi();
  const action = useAction();
  const a = useDonnees<any[]>(url('/adversaires'));
  const [nom, setNom] = useState('');
  return (
    <div className="pile">
      <div className="entete-page"><h1>Adversaires</h1></div>
      <div className="carte ligne">
        <input className="saisie" style={{ maxWidth: 300 }} value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Nom d'un nouvel adversaire" aria-label="Nom" />
        <button className="bouton primaire" disabled={!nom} onClick={() => action(() => api(url('/adversaires'), { corps: { nom } }), 'Adversaire ajouté').then(() => { setNom(''); void a.recharger(); })}>Ajouter</button>
      </div>
      {!a.donnees ? <Chargement /> : !a.donnees.length ? <Vide>Aucun adversaire enregistré.</Vide> : (
        <div className="grille">
          {a.donnees.map((x) => <Link key={x.id} to={`/adversaires/${x.id}`} className="carte" style={{ textDecoration: 'none', color: 'inherit' }}><h3 style={{ margin: 0 }}>{x.nom}</h3><span className="muet petit">{x.ville ?? ''}</span></Link>)}
        </div>
      )}
      <Echanges />
    </div>
  );
}

function Echanges() {
  const url = useClubApi();
  const action = useAction();
  const { fonction, peut, clubId } = useSession();
  const e = useDonnees<any>(fonction('analyse_adverse') ? url('/echanges') : null);
  const matchs = useDonnees<any[]>(url('/matchs'));
  const [demande, setDemande] = useState({ club_cible: '', match_offert_id: '', message: '' });
  const [video, setVideo] = useState<SourceVideo | null>(null);
  if (!fonction('analyse_adverse') || !e.donnees) return null;
  const clubClubs: any[] = e.donnees.clubsPoule;
  const echanges: any[] = e.donnees.echanges;
  return (
    <div className="carte pile">
      <h2 style={{ margin: 0 }}>Échange de vidéos avec les clubs de la poule</h2>
      <p className="muet petit">Chaque club propose un de ses matchs ; l'échange n'a lieu qu'avec l'accord des deux clubs et reste révocable.</p>
      {peut('club.gerer', null) && clubClubs.length > 0 && (
        <div className="formulaire">
          <label className="champ"><span>Club</span><select value={demande.club_cible} onChange={(ev) => setDemande({ ...demande, club_cible: ev.target.value })}><option value="">Choisir…</option>{clubClubs.map((c: any) => <option key={c.id} value={c.id}>{c.nom}</option>)}</select></label>
          <label className="champ"><span>Match proposé en échange</span><select value={demande.match_offert_id} onChange={(ev) => setDemande({ ...demande, match_offert_id: ev.target.value })}><option value="">Choisir…</option>{matchs.donnees?.filter((m) => m.statut_video === 'pret').map((m) => <option key={m.id} value={m.id}>{dateCourte(m.date)} {m.adversaire_nom ?? ''}</option>)}</select></label>
          <label className="champ"><span>Message</span><input value={demande.message} onChange={(ev) => setDemande({ ...demande, message: ev.target.value })} /></label>
          <div><button className="bouton" disabled={!demande.club_cible || !demande.match_offert_id} onClick={() => action(() => api(url('/echanges'), { corps: demande }), 'Demande envoyée').then(() => e.recharger())}>Demander</button></div>
        </div>
      )}
      {!clubClubs.length && <p className="muet petit">Renseignez votre poule dans les paramètres pour voir les clubs de la même poule.</p>}
      {echanges.map((x: any) => (
        <div key={x.id} className="ligne entre petit carte" style={{ padding: 10 }}>
          <span>{x.club_demandeur_nom} → {x.club_cible_nom} · <span className="badge">{x.statut}</span> {x.message && <em>« {x.message} »</em>}</span>
          <span className="ligne">
            {x.statut === 'demande' && peut('club.gerer', null) && x.club_cible === clubId && (
              <select className="saisie" style={{ width: 'auto' }} value="" onChange={(ev) => ev.target.value && action(() => api(url(`/echanges/${x.id}/repondre`), { corps: { accepter: true, match_cible_id: ev.target.value } }), 'Échange accepté').then(() => e.recharger())} aria-label="Accepter avec le match">
                <option value="">Accepter en partageant…</option>{matchs.donnees?.filter((m) => m.statut_video === 'pret').map((m) => <option key={m.id} value={m.id}>{dateCourte(m.date)} {m.adversaire_nom ?? ''}</option>)}
              </select>
            )}
            {x.statut === 'accepte' && <button className="bouton petit" onClick={async () => { const v = await action(() => api(url(`/echanges/${x.id}/video`))); if (v?.url) setVideo(v); }}>Voir la vidéo reçue</button>}
            {['demande', 'accepte'].includes(x.statut) && peut('club.gerer', null) && <button className="bouton petit danger" onClick={() => action(() => api(url(`/echanges/${x.id}/revoquer`), { corps: {} })).then(() => e.recharger())}>Révoquer</button>}
          </span>
        </div>
      ))}
      {video && <Modale titre="Vidéo reçue" onFermer={() => setVideo(null)}><LecteurVideo sources={[video]} autoplay /></Modale>}
    </div>
  );
}

function Fiche() {
  const { id } = useParams();
  const url = useClubApi();
  const nav = useNavigate();
  const action = useAction();
  const { fonction } = useSession();
  const adv = useDonnees<any>(url(`/adversaires/${id}`));
  const joueurs = useDonnees<any[]>(url('/joueurs-adverses'));
  const rapport = useDonnees<any>(fonction('analyse_adverse') ? url(`/adversaires/${id}/rapport`) : null);
  const equipes = useDonnees<any[]>(url('/equipes'));
  const [nouveau, setNouveau] = useState({ numero: '', nom: '', poste: '' });
  if (adv.erreur) return <Erreur message={adv.erreur} />;
  if (!adv.donnees) return <Chargement />;
  const mesJoueurs = (joueurs.donnees ?? []).filter((j) => j.adversaire_id === id);
  const r = rapport.donnees;
  return (
    <div className="pile">
      <div className="entete-page">
        <h1>{adv.donnees.nom}</h1>
        {fonction('analyse_adverse') && (
          <div className="ligne">
            <button className="bouton" onClick={() => telecharger(url(`/adversaires/${id}/rapport.pdf`), 'rapport-adverse.pdf')}>Rapport adverse PDF</button>
            <select className="saisie" style={{ width: 'auto' }} value="" onChange={async (e) => {
              if (!e.target.value) return;
              const p = await action(() => api(url(`/adversaires/${id}/playlist-preparation`), { corps: { equipe_id: e.target.value } }), 'Playlist préparation créée');
              if (p) nav(`/playlists/${p.id}`);
            }} aria-label="Créer la playlist préparation">
              <option value="">Playlist « préparation » pour…</option>
              {equipes.donnees?.filter((x) => !x.archivee).map((x) => <option key={x.id} value={x.id}>{x.nom}</option>)}
            </select>
          </div>
        )}
      </div>
      {!fonction('analyse_adverse') && <div className="alerte">Le rapport adverse automatique est inclus dans l'offre Club+.</div>}
      {r && (
        <>
          <div className="grille">
            <div className="carte"><h3>Points forts</h3>{r.pointsForts.length ? <ul>{r.pointsForts.map((x: string) => <li key={x}>{x}</li>)}</ul> : <p className="muet">Pas assez de données.</p>}</div>
            <div className="carte"><h3>Points faibles</h3>{r.pointsFaibles.length ? <ul>{r.pointsFaibles.map((x: string) => <li key={x}>{x}</li>)}</ul> : <p className="muet">Pas assez de données.</p>}</div>
            <div className="carte"><h3>Schémas récurrents</h3>{r.schemas.length ? <ul>{r.schemas.map((x: string) => <li key={x}>{x}</li>)}</ul> : <p className="muet">Codez au moins 4 actions d'un même type.</p>}</div>
          </div>
          <div className="grille-2">
            <div className="carte tableau-conteneur">
              <h3>Moyennes de l'adversaire ({r.nbMatchs} match(s))</h3>
              <table className="tableau"><tbody>
                {r.indicateurs.filter((i: any) => i.moyenneAdversaire != null).map((i: any) => <tr key={i.key}><td>{i.label}</td><td className="num">{valeurIndicateur(i.moyenneAdversaire, i.format)}</td></tr>)}
              </tbody></table>
            </div>
            <div className="carte">
              <h3>Joueurs clés</h3>
              <table className="tableau"><tbody>
                {r.joueursCles.map((j: any) => <tr key={j.numero}><td><strong>n° {j.numero}</strong> {j.nom ?? ''}</td><td className="muet petit">{Object.entries(j.detail).map(([k, n]) => `${k.replace(/_/g, ' ')} ${n}`).join(', ')}</td></tr>)}
              </tbody></table>
              <h3>Matchs analysés</h3>
              {r.matchs.map((m: any) => <div key={m.id}><Link to={`/matchs/${m.id}/stats`}>{dateCourte(m.date)} {m.type === 'observation' ? '(observation)' : ''}</Link> {m.score.nous} - {m.score.adversaire}</div>)}
            </div>
          </div>
        </>
      )}
      <div className="carte pile">
        <h2 style={{ margin: 0 }}>Joueurs identifiés</h2>
        <table className="tableau"><tbody>
          {mesJoueurs.map((j) => <tr key={j.id}><td className="num">{j.numero}</td><td>{j.nom ?? '-'}</td><td className="muet">{j.poste ?? ''}</td>
            <td><button className="bouton petit discret" onClick={() => action(() => api(url(`/joueurs-adverses/${j.id}`), { methode: 'DELETE' })).then(() => joueurs.recharger())}>✕</button></td></tr>)}
        </tbody></table>
        <div className="ligne">
          <input className="saisie" type="number" style={{ width: 90 }} placeholder="N°" value={nouveau.numero} onChange={(e) => setNouveau({ ...nouveau, numero: e.target.value })} aria-label="Numéro" />
          <input className="saisie" style={{ maxWidth: 200 }} placeholder="Nom (si connu)" value={nouveau.nom} onChange={(e) => setNouveau({ ...nouveau, nom: e.target.value })} aria-label="Nom" />
          <input className="saisie" style={{ maxWidth: 160 }} placeholder="Poste" value={nouveau.poste} onChange={(e) => setNouveau({ ...nouveau, poste: e.target.value })} aria-label="Poste" />
          <button className="bouton" disabled={!nouveau.numero} onClick={() => action(() => api(url('/joueurs-adverses'), { corps: { adversaire_id: id, numero: Number(nouveau.numero), nom: nouveau.nom || null, poste: nouveau.poste || null } })).then(() => { setNouveau({ numero: '', nom: '', poste: '' }); void joueurs.recharger(); })}>Ajouter</button>
        </div>
      </div>
    </div>
  );
}

export default function Adversaires() {
  return (
    <Routes>
      <Route index element={<Liste />} />
      <Route path=":id" element={<Fiche />} />
    </Routes>
  );
}
