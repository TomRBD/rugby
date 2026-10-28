// App joueur (mobile, installable, hors ligne) : mes playlists, mes stats, mes objectifs, compo annoncée, consignes, suivi RPE.
import { useEffect, useState } from 'react';
import { NavLink, Route, Routes, useParams } from 'react-router-dom';
import { LIBELLES_STATS_JOUEUR } from '@rugby/shared';
import { api } from '../lib/api';
import { useClubApi, useSession } from '../lib/session';
import { useDonnees, useEnLigne } from '../lib/hooks';
import { cacherMatch, matchEnCache } from '../lib/horsLigne';
import { dateCourte, dateHeure } from '../lib/format';
import { Champ, Chargement, Erreur, useAction } from '../composants/ui';
import { LecteurClips } from '../composants/LecteurClips';
import { Courbe } from '../composants/Graphiques';
import { clipsDePlaylist } from './Playlist';
import { Consentements } from './Effectif';

/** Données de l'espace joueur, mises en cache pour une consultation sans réseau. */
function useEspace() {
  const url = useClubApi();
  const { clubId } = useSession();
  const [d, setD] = useState<any | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const charger = async () => {
    try {
      const r = await api(url('/moi/joueur'));
      setD(r);
      void cacherMatch(`joueur/${clubId}`, r);
    } catch (e) {
      const c = await matchEnCache(`joueur/${clubId}`).catch(() => undefined);
      if (c) setD(c); else setErreur((e as Error).message);
    }
  };
  useEffect(() => { void charger(); }, [clubId]); // eslint-disable-line react-hooks/exhaustive-deps
  return { d, erreur, recharger: charger };
}

function Accueil({ d }: { d: any }) {
  const url = useClubApi();
  const prochain = d.prochains[0];
  const compo = useDonnees<any>(prochain?.compo_annoncee ? url(`/moi/matchs/${prochain.id}/compo`) : null);
  const aVoir = d.playlists.filter((p: any) => !p.vue);
  return (
    <div className="pile">
      {aVoir.length > 0 && <div className="alerte ok"><strong>{aVoir.length} playlist(s) à regarder</strong> : {aVoir.map((p: any) => p.titre).join(', ')}</div>}
      {prochain ? (
        <div className="carte pile">
          <h2 style={{ margin: 0 }}>Prochain match</h2>
          <div><strong>{dateHeure(prochain.date)}</strong> {prochain.domicile ? 'contre' : 'à'} {prochain.adversaire ?? 'adversaire'}</div>
          {prochain.compo_annoncee ? (
            prochain.numero ? <div className="alerte ok">Vous êtes {prochain.titulaire ? 'titulaire' : 'remplaçant'} avec le numéro <strong>{prochain.numero}</strong>{prochain.poste ? ` (${prochain.poste})` : ''}.</div>
              : <div className="alerte">Vous n'êtes pas sur la feuille de match.</div>
          ) : <span className="muet">Composition pas encore annoncée.</span>}
          {prochain.consignes && <div><strong>Consignes</strong><p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{prochain.consignes}</p></div>}
          {compo.donnees && (
            <details><summary>Composition complète</summary>
              <table className="tableau"><tbody>{compo.donnees.feuille.map((f: any) => <tr key={f.numero}><td className="num">{f.numero}</td><td>{f.prenom} {f.nom}{f.capitaine ? ' (cap.)' : ''}</td><td className="muet petit">{f.poste ?? ''}</td></tr>)}</tbody></table>
            </details>
          )}
        </div>
      ) : <div className="carte muet">Aucun match à venir.</div>}
    </div>
  );
}

function Playlists({ d }: { d: any }) {
  return (
    <div className="clip-liste">
      {d.playlists.map((p: any) => (
        <NavLink key={p.partage_id} to={`/joueur/playlists/${p.partage_id}`} className="clip-item" style={{ textDecoration: 'none' }}>
          <span style={{ display: 'grid' }}><strong>{p.titre}</strong><span className="muet petit">{p.nb_clips} clip(s) · {dateCourte(p.cree_le)}</span></span>
          {p.vue ? <span className="vu">✓ vue</span> : <span className="badge bleu" style={{ marginLeft: 'auto' }}>Nouvelle</span>}
        </NavLink>
      ))}
      {!d.playlists.length && <p className="muet">Aucune playlist reçue.</p>}
    </div>
  );
}

function LecturePlaylist() {
  const { partageId } = useParams();
  const url = useClubApi();
  const p = useDonnees<any>(url(`/moi/playlists/${partageId}`));
  const [vus, setVus] = useState<Set<string>>(new Set());
  if (p.erreur) return <Erreur message={p.erreur} />;
  if (!p.donnees) return <Chargement />;
  const { clips, sources, filigrane } = clipsDePlaylist(p.donnees);
  return (
    <div className="pile">
      <h2 style={{ margin: 0 }}>{p.donnees.titre}</h2>
      {p.donnees.consignes && <div className="alerte">{p.donnees.consignes}</div>}
      {/* 720p maximum : lecture fluide en 4G, sans téléchargement complet (HLS adaptatif) */}
      <LecteurClips clips={clips.map((c) => ({ ...c, vu: vus.has(c.id) }))} sources={sources} filigrane={filigrane} qualiteMax={720}
        onClipVu={(c, s) => { setVus((v) => new Set(v).add(c.id)); void api(url(`/moi/playlists/${partageId}/lectures`), { corps: { clip_id: c.id, secondes: s } }).catch(() => undefined); }} />
    </div>
  );
}

function MesStats({ d }: { d: any }) {
  const url = useClubApi();
  const joueur = d.joueurs[0];
  const s = useDonnees<any>(joueur ? url(`/joueurs/${joueur.id}/stats`) : null);
  if (!joueur) return null;
  if (!s.donnees) return <Chargement />;
  const totaux: Record<string, number> = {};
  for (const m of s.donnees.parMatch) for (const [k, v] of Object.entries<any>(m.valeurs)) totaux[k] = (totaux[k] ?? 0) + (v.valeur ?? 0);
  const objectifs: any[] = joueur.objectifs_perso ?? [];
  return (
    <div className="pile">
      <div className="carte">
        <h2>Mon indice de contribution</h2>
        <Courbe labels={s.donnees.parMatch.map((m: any) => dateCourte(m.date).replace(/ \d{4}$/, ''))} series={[{ nom: 'Contribution', couleur: 'var(--nous)', valeurs: s.donnees.parMatch.map((m: any) => m.contribution) }]} />
      </div>
      {objectifs.length > 0 && (
        <div className="carte">
          <h2>Mes objectifs (par match)</h2>
          {objectifs.map((o) => {
            const moy = s.donnees.parMatch.length ? Math.round(((totaux[o.key] ?? 0) / s.donnees.parMatch.length) * 10) / 10 : 0;
            return <div key={o.key} className="ligne entre"><span>{LIBELLES_STATS_JOUEUR[o.key] ?? o.key}</span><span className={`badge ${moy >= o.cible ? 'vert' : 'orange'}`}>{moy} / {o.cible}</span></div>;
          })}
        </div>
      )}
      <div className="carte">
        <h2>Mes totaux de la saison</h2>
        <table className="tableau"><tbody>
          {Object.entries(LIBELLES_STATS_JOUEUR).filter(([k]) => totaux[k]).map(([k, v]) => <tr key={k}><td>{v}</td><td className="num">{totaux[k]}</td></tr>)}
        </tbody></table>
      </div>
    </div>
  );
}

function Suivi({ d, onMaj }: { d: any; onMaj: () => void }) {
  const url = useClubApi();
  const action = useAction();
  const [f, setF] = useState({ date: new Date().toISOString().slice(0, 10), type: 'entrainement', rpe: 5, duree_minutes: 90, fatigue: 3, douleurs: '', disponible: true });
  const envoyer = async () => {
    if (await action(() => api(url('/moi/suivi'), { corps: { ...f, douleurs: f.douleurs || null } }), 'Merci, c\'est enregistré')) onMaj();
  };
  return (
    <div className="pile">
      <div className="carte pile">
        <h2 style={{ margin: 0 }}>Comment s'est passée la séance ?</h2>
        <div className="formulaire">
          <Champ label="Date"><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Champ>
          <Champ label="Séance"><select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="entrainement">Entraînement</option><option value="match">Match</option><option value="autre">Autre</option></select></Champ>
          <Champ label="Durée (min)"><input type="number" value={f.duree_minutes} onChange={(e) => setF({ ...f, duree_minutes: Number(e.target.value) })} /></Champ>
        </div>
        <Champ label={`Difficulté ressentie (RPE) : ${f.rpe} / 10`}><input type="range" min={1} max={10} value={f.rpe} onChange={(e) => setF({ ...f, rpe: Number(e.target.value) })} /></Champ>
        <Champ label={`Fatigue : ${f.fatigue} / 5`}><input type="range" min={1} max={5} value={f.fatigue} onChange={(e) => setF({ ...f, fatigue: Number(e.target.value) })} /></Champ>
        <Champ label="Douleurs (facultatif)"><input value={f.douleurs} onChange={(e) => setF({ ...f, douleurs: e.target.value })} placeholder="Ischio droit, épaule…" /></Champ>
        <label className="ligne"><input type="checkbox" checked={f.disponible} onChange={(e) => setF({ ...f, disponible: e.target.checked })} /> Disponible pour le prochain match</label>
        <button className="bouton primaire" onClick={envoyer}>Envoyer</button>
      </div>
      <div className="carte">
        <h3>Mes dernières saisies</h3>
        {d.suivi.map((s: any) => <div key={s.id} className="petit">{dateCourte(s.date)} : RPE {s.rpe ?? '-'}, {s.duree_minutes ?? '-'} min, fatigue {s.fatigue ?? '-'}/5 {s.disponible ? '' : '(indisponible)'}</div>)}
      </div>
    </div>
  );
}

function MesDonnees({ d, onMaj }: { d: any; onMaj: () => void }) {
  const url = useClubApi();
  const action = useAction();
  const joueur = d.joueurs[0];
  if (!joueur) return null;
  const mineur = joueur.date_naissance && new Date(joueur.date_naissance) > new Date(Date.now() - 18 * 365.25 * 86400000);
  return (
    <div className="carte pile">
      <h2 style={{ margin: 0 }}>Mes données et consentements</h2>
      <Consentements joueur={{ ...joueur, mineur }} onMaj={onMaj} />
      <div className="ligne">
        <button className="bouton" onClick={async () => {
          const r = await action(() => api(url(`/joueurs/${joueur.id}/export`)));
          if (!r) return;
          const a = document.createElement('a');
          a.href = URL.createObjectURL(new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' }));
          a.download = 'mes-donnees.json';
          a.click();
        }}>Télécharger mes données</button>
        <button className="bouton danger" onClick={() => confirm('Demander l\'effacement de vos données personnelles ? Vos statistiques collectives seront anonymisées.') && action(() => api(url(`/joueurs/${joueur.id}/effacement`), { corps: {} }), 'Données effacées')}>Effacer mes données</button>
      </div>
    </div>
  );
}

export default function EspaceJoueur() {
  const { d, erreur, recharger } = useEspace();
  const enLigne = useEnLigne();
  if (erreur) return <Erreur message={erreur} />;
  if (!d) return <Chargement />;
  const j = d.joueurs[0];
  return (
    <div className="mobile pile" style={{ padding: 0 }}>
      <div className="ligne entre">
        <h1 style={{ margin: 0 }}>{j ? `${j.prenom} ${j.nom}` : 'Mon espace'}</h1>
        {!enLigne && <span className="badge orange">Hors ligne</span>}
      </div>
      <nav className="onglets">
        {[['', 'Accueil'], ['playlists', 'Mes clips'], ['stats', 'Mes stats'], ['suivi', 'Suivi'], ['donnees', 'Mes données']].map(([to, l]) => (
          <NavLink key={to} end to={`/joueur${to ? `/${to}` : ''}`} className={({ isActive }) => (isActive ? 'actif' : '')}>{l}</NavLink>
        ))}
      </nav>
      <Routes>
        <Route index element={<Accueil d={d} />} />
        <Route path="playlists" element={<Playlists d={d} />} />
        <Route path="playlists/:partageId" element={<LecturePlaylist />} />
        <Route path="stats" element={<MesStats d={d} />} />
        <Route path="suivi" element={<Suivi d={d} onMaj={recharger} />} />
        <Route path="donnees" element={<MesDonnees d={d} onMaj={recharger} />} />
      </Routes>
    </div>
  );
}
