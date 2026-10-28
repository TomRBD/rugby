import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { useClubApi, useSession } from '../../lib/session';
import { useDonnees } from '../../lib/hooks';
import { televerser, televersementsInterrompus } from '../../lib/televersement';
import { Champ, useAction } from '../../composants/ui';

const STATUTS: Record<string, string> = {
  televersement: 'Envoi en cours', en_attente: 'En file d\'attente', transcodage: 'Traitement', pret: 'Prête', erreur: 'Erreur', archive: 'Archivée (480p)',
};

/** Télécharge les segments 480p dans le cache du service worker pour une lecture sans réseau. */
async function rendreDisponibleHorsLigne(urlMaster: string, progression: (p: number) => void) {
  const base = urlMaster.replace(/master\.m3u8$/, '');
  const master = await (await fetch(urlMaster)).text();
  const rendition = master.split('\n').filter((l) => l && !l.startsWith('#')).pop() ?? '480p/index.m3u8';
  const index = await (await fetch(base + rendition)).text();
  const dossier = rendition.replace(/index\.m3u8$/, '');
  const urls = [urlMaster, base + rendition, ...index.split('\n').filter((l) => l && !l.startsWith('#')).map((s) => base + dossier + s)];
  const sw = await navigator.serviceWorker?.ready;
  if (!sw?.active) throw new Error('Mode hors ligne indisponible dans ce navigateur');
  return new Promise<void>((res) => {
    const h = (e: MessageEvent) => {
      if (e.data?.type !== 'progression-media') return;
      progression(e.data.fait / e.data.total);
      if (e.data.fait === e.data.total) { navigator.serviceWorker.removeEventListener('message', h); res(); }
    };
    navigator.serviceWorker.addEventListener('message', h);
    sw.active!.postMessage({ type: 'cacher-media', urls });
  });
}

export function VideosMatch({ donnees, onMaj }: { donnees: any; onMaj: () => void }) {
  const url = useClubApi();
  const action = useAction();
  const { clubId, peut, fonction } = useSession();
  const { match, videos } = donnees;
  const ecriture = peut('video.ecrire', match.equipe_id);
  const [angle, setAngle] = useState('Principal');
  const [lien, setLien] = useState('');
  const [horsLigne, setHorsLigne] = useState<Record<string, number>>({});
  const jobs = useDonnees<any[]>(url(`/matchs/${match.id}/jobs`));
  const interrompus = Object.values(televersementsInterrompus()).filter((u) => u.matchId === match.id);

  // Suivi du traitement serveur
  useEffect(() => {
    if (!videos.some((v: any) => ['en_attente', 'transcodage', 'televersement'].includes(v.statut))) return;
    const id = setInterval(() => { onMaj(); void jobs.recharger(); }, 4000);
    return () => clearInterval(id);
  }, [videos, onMaj, jobs]);

  const choisir = async (fichiers: FileList | null, reprise?: any) => {
    if (!fichiers?.length) return;
    await action(() => televerser(clubId!, match.id, [...fichiers], angle, reprise), 'Envoi lancé en tâche de fond : vous pouvez continuer à naviguer');
    onMaj();
  };

  return (
    <div className="pile">
      {ecriture && (
        <div className="carte pile">
          <h2 style={{ margin: 0 }}>Ajouter la vidéo du match</h2>
          <p className="muet petit">MP4, MOV, MKV, AVI en H.264 ou H.265 jusqu'en 4K. Sélectionnez tous les fichiers découpés par la caméra (tranches de 4 Go) : ils sont assemblés automatiquement dans l'ordre de leur nom. L'envoi reprend tout seul après une coupure.</p>
          <div className="formulaire">
            <Champ label="Angle de caméra">
              <input value={angle} onChange={(e) => setAngle(e.target.value)} list="angles" disabled={!fonction('multi_angles') && videos.length > 0} />
              <datalist id="angles"><option>Principal</option><option>Tribune</option><option>Derrière les poteaux</option><option>Drone</option></datalist>
            </Champ>
            <Champ label="Fichiers vidéo (carte SD, disque, téléphone)">
              <input type="file" accept="video/*,.mkv,.mts" multiple onChange={(e) => choisir(e.target.files)} />
            </Champ>
          </div>
          {interrompus.map((u) => (
            <div key={u.videoId} className="alerte">
              Envoi interrompu ({u.parties.map((p) => p.nom).join(', ')}). Resélectionnez le ou les mêmes fichiers pour reprendre là où il s'était arrêté :
              <input type="file" accept="video/*" multiple onChange={(e) => choisir(e.target.files, u)} style={{ marginLeft: 8 }} />
            </div>
          ))}
          <div className="formulaire">
            <Champ label="Ou importer depuis un lien (YouTube ou Vimeo non listé, Drive, Dropbox, export Veo, Pixellot, Spiideo, Hudl)">
              <input type="url" value={lien} onChange={(e) => setLien(e.target.value)} placeholder="https://" />
            </Champ>
            <div><button className="bouton" disabled={!lien} onClick={() => action(() => api(url(`/matchs/${match.id}/videos/import`), { corps: { url: lien, angle } }), 'Import lancé').then(() => { setLien(''); onMaj(); })}>Importer</button></div>
          </div>
        </div>
      )}

      {videos.map((v: any) => (
        <div key={v.id} className="carte pile">
          <div className="ligne entre">
            <h3 style={{ margin: 0 }}>{v.angle} <span className={`badge ${v.statut === 'pret' ? 'vert' : v.statut === 'erreur' ? 'rouge' : 'orange'}`}>{STATUTS[v.statut]}</span></h3>
            <span className="muet petit">{v.duree ? `${Math.round(v.duree / 60)} min` : ''} {v.hauteur ? `· source ${v.hauteur}p` : ''} {v.renditions?.length ? `· ${v.renditions.join(', ')}` : ''}</span>
          </div>
          {['transcodage', 'en_attente'].includes(v.statut) && <div className="barre-progression" aria-label="Progression du traitement"><div style={{ width: `${(v.progression ?? 0) * 100}%` }} /></div>}
          {v.erreur && <div className="alerte erreur">{v.erreur}</div>}
          {ecriture && (
            <div className="ligne">
              {v.angle !== 'Principal' && (
                <>
                  <label className="ligne petit">Décalage (s) <input className="saisie" type="number" step={0.04} style={{ width: 100 }} defaultValue={v.decalage}
                    onBlur={(e) => action(() => api(url(`/videos/${v.id}`), { methode: 'PATCH', corps: { decalage: Number(e.target.value) } }), 'Décalage enregistré')} /></label>
                  <button className="bouton petit" onClick={() => action(() => api(url(`/videos/${v.id}/synchroniser`), { corps: {} }), 'Synchronisation par le sifflet lancée').then(onMaj)}>Synchroniser automatiquement</button>
                </>
              )}
              <label className="ligne petit"><input type="checkbox" defaultChecked={v.conserver_original}
                onChange={(e) => action(() => api(url(`/videos/${v.id}`), { methode: 'PATCH', corps: { conserver_original: e.target.checked } }))} />Conserver le fichier original</label>
              {v.statut === 'pret' && 'serviceWorker' in navigator && (
                <button className="bouton petit" onClick={async () => {
                  const l = await api(url(`/videos/${v.id}/lecture`));
                  await action(() => rendreDisponibleHorsLigne(l.url, (p) => setHorsLigne((h) => ({ ...h, [v.id]: p }))), 'Vidéo disponible hors ligne');
                }}>{horsLigne[v.id] !== undefined ? `Hors ligne : ${Math.round(horsLigne[v.id] * 100)} %` : 'Rendre disponible hors ligne'}</button>
              )}
              <button className="bouton petit danger" onClick={() => confirm('Supprimer cette vidéo ?') && action(() => api(url(`/videos/${v.id}`), { methode: 'DELETE' }), 'Vidéo supprimée').then(onMaj)}>Supprimer</button>
            </div>
          )}
        </div>
      ))}

      {videos.some((v: any) => v.statut === 'pret') && ecriture && (
        <div className="carte pile">
          <h2 style={{ margin: 0 }}>Assistance IA</h2>
          <p className="muet petit">Les détections sont des propositions avec un score de confiance : rien n'est ajouté au codage sans votre validation (dans l'écran de codage).</p>
          <div className="ligne">
            <button className="bouton" disabled={!fonction('ia')} onClick={() => action(() => api(url(`/matchs/${match.id}/analyse-ia`), { corps: { analyses: ['temps_morts', 'coups_envoi', 'phases_arretees'] } }), 'Analyse lancée').then(() => jobs.recharger())}>
              Détecter temps morts, coups d'envoi et arrêts de jeu
            </button>
            <button className="bouton" disabled={!fonction('tracking')} onClick={() => action(() => api(url(`/matchs/${match.id}/analyse-ia`), { corps: { analyses: ['tracking'] } }), 'Tracking lancé').then(() => jobs.recharger())}>
              Tracking des joueurs
            </button>
            {!fonction('ia') && <span className="badge">Offre Club+</span>}
            <Link className="bouton" to={`/matchs/${match.id}/codage`}>Voir les propositions</Link>
          </div>
          {!!jobs.donnees?.length && (
            <table className="tableau petit"><tbody>
              {jobs.donnees.map((j) => <tr key={j.id}><td>{j.type}</td><td><span className={`badge ${j.statut === 'termine' ? 'vert' : j.statut === 'echec' ? 'rouge' : 'orange'}`}>{j.statut}</span></td><td className="muet">{j.erreur ?? ''}</td></tr>)}
            </tbody></table>
          )}
        </div>
      )}
    </div>
  );
}
