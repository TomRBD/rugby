// Module santé (staff médical) : dossiers chiffrés, protocole commotion avec blocage de sélection, charge RPE et ratio aigu/chronique, import GPS.
import { useState } from 'react';
import { ETAPES_PROTOCOLE_COMMOTION } from '@rugby/shared';
import { api, ErreurApi } from '../lib/api';
import { useClubApi, useSession } from '../lib/session';
import { useDonnees } from '../lib/hooks';
import { dateCourte } from '../lib/format';
import { Champ, Chargement, Erreur, Modale, useAction } from '../composants/ui';

const ZONES: Record<string, [string, string]> = { sous_charge: ['Sous-charge', 'orange'], optimale: ['Zone optimale', 'vert'], risque: ['Risque de blessure', 'rouge'], inconnue: ['Données insuffisantes', ''] };

export default function Sante() {
  const url = useClubApi();
  const action = useAction();
  const { fonction } = useSession();
  const dossiers = useDonnees<any[]>(url('/sante/dossiers'));
  const joueurs = useDonnees<any[]>(url('/joueurs'));
  const equipes = useDonnees<any[]>(url('/equipes'));
  const matchs = useDonnees<any[]>(url('/matchs'));
  const [equipe, setEquipe] = useState('');
  const charge = useDonnees<any[]>(equipe ? url(`/equipes/${equipe}/charge`) : null);
  const [nouveau, setNouveau] = useState<any | null>(null);
  const [gps, setGps] = useState<any | null>(null);

  if (dossiers.erreur) {
    return <div className="pile"><h1>Santé</h1><Erreur message={dossiers.erreur} />
      {(dossiers.erreur.includes('double authentification')) && <p>Rendez-vous dans <a href="/parametres/securite">Paramètres, Sécurité</a>.</p>}</div>;
  }
  if (!dossiers.donnees) return <Chargement />;
  const creer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await action(() => api(url('/sante/dossiers'), { corps: { joueur_id: nouveau.joueur_id, type: nouveau.type, date: nouveau.date, contenu: { description: nouveau.description, zone: nouveau.zone || undefined, gravite: nouveau.gravite || undefined, retour_prevu: nouveau.retour_prevu || undefined } } }), 'Dossier créé')) {
      setNouveau(null);
      void dossiers.recharger();
    }
  };
  const importerGps = async (e: React.FormEvent) => {
    e.preventDefault();
    const csv = await (gps.fichier as File).text();
    const r = await action(() => api(url('/gps'), { corps: { joueur_id: gps.joueur_id, match_id: gps.match_id || undefined, decalage_video: Number(gps.decalage || 0), csv } }));
    if (r) { alert(`Import réussi : ${r.resume.distance_m} m, ${r.resume.sprints} sprints, vitesse max ${r.resume.vitesse_max_kmh} km/h`); setGps(null); }
  };

  return (
    <div className="pile">
      <div className="entete-page">
        <h1>Santé</h1>
        <div className="ligne">
          <button className="bouton primaire" onClick={() => setNouveau({ joueur_id: '', type: 'blessure', date: new Date().toISOString().slice(0, 10), description: '' })}>Nouveau dossier</button>
          {fonction('gps') && <button className="bouton" onClick={() => setGps({ joueur_id: '', match_id: '', decalage: 0, fichier: null })}>Importer GPS / cardio (CSV)</button>}
        </div>
      </div>
      <div className="alerte petit">Données de santé chiffrées séparément et visibles du seul staff médical. Chaque consultation est journalisée.</div>

      <div className="grille">
        {dossiers.donnees.map((d) => (
          <div key={d.id} className="carte pile" style={{ borderLeft: `5px solid ${d.clos ? 'var(--succes)' : d.type === 'commotion' ? 'var(--danger)' : 'var(--alerte)'}` }}>
            <div className="ligne entre"><strong>{d.prenom} {d.nom}</strong><span className={`badge ${d.clos ? 'vert' : 'rouge'}`}>{d.clos ? 'Clos' : d.type === 'commotion' ? 'Protocole commotion' : 'Blessure'}</span></div>
            <span className="muet petit">{dateCourte(d.date)}{d.contenu.zone ? ` · ${d.contenu.zone}` : ''}{d.contenu.gravite ? ` · ${d.contenu.gravite}` : ''}</span>
            <p style={{ margin: 0 }}>{d.contenu.description}</p>
            {d.type === 'commotion' && (
              <ol className="petit" style={{ paddingLeft: 18, margin: 0 }}>
                {ETAPES_PROTOCOLE_COMMOTION.map((e, i) => (
                  <li key={e} style={{ color: i < d.etape_protocole ? 'var(--succes)' : undefined }}>
                    {i < d.etape_protocole ? '✓ ' : ''}{e}
                    {!d.clos && i === d.etape_protocole && <button className="bouton petit" style={{ marginLeft: 6 }} onClick={() => action(() => api(url(`/sante/dossiers/${d.id}`), { methode: 'PATCH', corps: { etape_protocole: i + 1 } }), 'Étape validée').then(() => dossiers.recharger())}>Valider</button>}
                  </li>
                ))}
              </ol>
            )}
            {!d.clos && <button className="bouton petit" onClick={async () => {
              try { await api(url(`/sante/dossiers/${d.id}`), { methode: 'PATCH', corps: { clos: true } }); void dossiers.recharger(); } catch (e) { alert((e as ErreurApi).message); }
            }}>Autoriser la reprise</button>}
          </div>
        ))}
      </div>

      <div className="carte pile">
        <div className="ligne entre"><h2 style={{ margin: 0 }}>Charge d'entraînement (RPE x durée)</h2>
          <select className="saisie" style={{ width: 'auto' }} value={equipe} onChange={(e) => setEquipe(e.target.value)} aria-label="Équipe">
            <option value="">Choisir une équipe</option>{equipes.donnees?.filter((e) => !e.archivee).map((e) => <option key={e.id} value={e.id}>{e.nom}</option>)}
          </select>
        </div>
        {charge.donnees && (
          <div className="tableau-conteneur"><table className="tableau">
            <thead><tr><th>Joueur</th><th className="num">Charge 7 j</th><th className="num">Moyenne 28 j</th><th className="num">Ratio aigu/chronique</th><th>Zone</th><th>Fatigue</th><th>Douleurs</th><th>Dispo.</th></tr></thead>
            <tbody>
              {charge.donnees.map((j) => (
                <tr key={j.id}>
                  <td>{j.prenom} {j.nom}</td><td className="num">{j.aigue}</td><td className="num">{j.chronique}</td><td className="num"><strong>{j.ratio ?? '-'}</strong></td>
                  <td><span className={`badge ${ZONES[j.zone][1]}`}>{ZONES[j.zone][0]}</span></td>
                  <td>{j.fatigue ? `${j.fatigue}/5` : '-'}</td><td className="petit">{j.douleurs ?? ''}</td><td>{j.disponible === false ? <span className="badge rouge">Non</span> : j.disponible ? 'Oui' : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
        <p className="muet petit">Les joueurs saisissent leur RPE (1 à 10), la durée, la fatigue et leurs douleurs dans leur espace joueur après chaque séance. Zone optimale du ratio : 0,8 à 1,3.</p>
      </div>

      {nouveau && (
        <Modale titre="Nouveau dossier" onFermer={() => setNouveau(null)} etroite>
          <form className="pile" onSubmit={creer}>
            <Champ label="Joueur"><select value={nouveau.joueur_id} onChange={(e) => setNouveau({ ...nouveau, joueur_id: e.target.value })} required><option value="">Choisir…</option>{joueurs.donnees?.map((j) => <option key={j.id} value={j.id}>{j.prenom} {j.nom}</option>)}</select></Champ>
            <Champ label="Type"><select value={nouveau.type} onChange={(e) => setNouveau({ ...nouveau, type: e.target.value })}><option value="blessure">Blessure</option><option value="commotion">Commotion (protocole FFR)</option></select></Champ>
            <Champ label="Date"><input type="date" value={nouveau.date} onChange={(e) => setNouveau({ ...nouveau, date: e.target.value })} required /></Champ>
            <Champ label="Zone"><input value={nouveau.zone ?? ''} onChange={(e) => setNouveau({ ...nouveau, zone: e.target.value })} placeholder="Genou droit" /></Champ>
            <Champ label="Gravité"><select value={nouveau.gravite ?? ''} onChange={(e) => setNouveau({ ...nouveau, gravite: e.target.value })}><option value="">-</option><option value="legere">Légère</option><option value="moderee">Modérée</option><option value="grave">Grave</option></select></Champ>
            <Champ label="Retour prévu"><input type="date" value={nouveau.retour_prevu ?? ''} onChange={(e) => setNouveau({ ...nouveau, retour_prevu: e.target.value })} /></Champ>
            <Champ label="Description"><textarea rows={3} value={nouveau.description} onChange={(e) => setNouveau({ ...nouveau, description: e.target.value })} /></Champ>
            {nouveau.type === 'commotion' && <div className="alerte petit">Le joueur ne pourra plus être inscrit sur une feuille de match tant que toutes les étapes du protocole ne sont pas validées.</div>}
            <button className="bouton primaire">Créer</button>
          </form>
        </Modale>
      )}
      {gps && (
        <Modale titre="Import GPS / cardio" onFermer={() => setGps(null)} etroite>
          <form className="pile" onSubmit={importerGps}>
            <Champ label="Joueur"><select value={gps.joueur_id} onChange={(e) => setGps({ ...gps, joueur_id: e.target.value })} required><option value="">Choisir…</option>{joueurs.donnees?.map((j) => <option key={j.id} value={j.id}>{j.prenom} {j.nom}</option>)}</select></Champ>
            <Champ label="Match (facultatif)"><select value={gps.match_id} onChange={(e) => setGps({ ...gps, match_id: e.target.value })}><option value="">Aucun</option>{matchs.donnees?.map((m) => <option key={m.id} value={m.id}>{dateCourte(m.date)} {m.adversaire_nom ?? ''}</option>)}</select></Champ>
            <Champ label="Décalage avec la vidéo (s)"><input type="number" step={0.1} value={gps.decalage} onChange={(e) => setGps({ ...gps, decalage: e.target.value })} /></Champ>
            <Champ label="Fichier CSV (colonnes temps, vitesse, fréquence cardiaque)"><input type="file" accept=".csv,text/csv" onChange={(e) => setGps({ ...gps, fichier: e.target.files?.[0] })} required /></Champ>
            <button className="bouton primaire">Importer</button>
          </form>
        </Modale>
      )}
    </div>
  );
}
