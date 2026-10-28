import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LIBELLES_LONGUEUR } from '@rugby/shared';
import { api } from '../../lib/api';
import { useClubApi } from '../../lib/session';
import { useDonnees } from '../../lib/hooks';
import { Champ, useAction } from '../../composants/ui';

export function PlaylistsMatch({ matchId, equipeId }: { matchId: string; equipeId: string }) {
  const url = useClubApi();
  const nav = useNavigate();
  const action = useAction();
  const playlists = useDonnees<any[]>(url(`/playlists?matchId=${matchId}`));
  const types = useDonnees<any[]>(url('/taxonomie'));
  const joueurs = useDonnees<any[]>(url(`/equipes/${equipeId}/joueurs`));
  const [f, setF] = useState<any>({ titre: '', types: [] as string[], camp: '', succes: '', joueurs: [] as string[], miTemps: '', zone: '' });

  const creer = async () => {
    const filtre: any = {};
    if (f.types.length) filtre.types = f.types;
    if (f.camp) filtre.camp = f.camp;
    if (f.succes !== '') filtre.succes = f.succes === 'oui';
    if (f.joueurs.length) filtre.joueurs = f.joueurs;
    if (f.miTemps) filtre.miTemps = Number(f.miTemps);
    if (f.zone !== '') filtre.zonesLongueur = [Number(f.zone)];
    const p = await action(() => api(url('/playlists'), { corps: { titre: f.titre || 'Playlist', match_id: matchId, filtre } }), 'Playlist créée');
    if (p) nav(`/playlists/${p.id}`);
  };

  return (
    <div className="grille-2">
      <div className="carte pile">
        <div className="ligne entre"><h2 style={{ margin: 0 }}>Playlists du match</h2>
          <button className="bouton" onClick={async () => { const p = await action(() => api(url(`/matchs/${matchId}/temps-forts`), { corps: {} }), 'Temps forts générés'); if (p) nav(`/playlists/${p.id}`); }}>Temps forts automatiques</button>
        </div>
        {playlists.donnees?.map((p) => (
          <Link key={p.id} to={`/playlists/${p.id}`} className="clip-item" style={{ textDecoration: 'none' }}>
            <strong>{p.titre}</strong><span className="muet petit">{p.nb_clips} clip(s)</span>
            {p.validee && <span className="badge vert">Validée</span>}{p.nb_partages > 0 && <span className="badge bleu">Partagée</span>}
          </Link>
        ))}
        {!playlists.donnees?.length && <p className="muet">Aucune playlist. Créez-en une par filtre, depuis une statistique ou générez les temps forts.</p>}
      </div>
      <div className="carte pile">
        <h2 style={{ margin: 0 }}>Nouvelle playlist par filtre</h2>
        <Champ label="Titre"><input value={f.titre} onChange={(e) => setF({ ...f, titre: e.target.value })} placeholder="Nos touches perdues" /></Champ>
        <Champ label="Actions">
          <select multiple value={f.types} onChange={(e) => setF({ ...f, types: [...e.target.selectedOptions].map((o) => o.value) })} style={{ minHeight: 120 }}>
            {types.donnees?.map((t) => <option key={t.key} value={t.key}>{t.famille} : {t.label}</option>)}
          </select>
        </Champ>
        <div className="formulaire">
          <Champ label="Équipe"><select value={f.camp} onChange={(e) => setF({ ...f, camp: e.target.value })}><option value="">Les deux</option><option value="nous">Nous</option><option value="adversaire">Adversaire</option></select></Champ>
          <Champ label="Issue"><select value={f.succes} onChange={(e) => setF({ ...f, succes: e.target.value })}><option value="">Toutes</option><option value="oui">Réussies</option><option value="non">Ratées</option></select></Champ>
          <Champ label="Mi-temps"><select value={f.miTemps} onChange={(e) => setF({ ...f, miTemps: e.target.value })}><option value="">Les deux</option><option value="1">1re</option><option value="2">2e</option></select></Champ>
          <Champ label="Zone"><select value={f.zone} onChange={(e) => setF({ ...f, zone: e.target.value })}><option value="">Tout le terrain</option>{LIBELLES_LONGUEUR.map((l, i) => <option key={l} value={i}>{l}</option>)}</select></Champ>
        </div>
        <Champ label="Joueurs">
          <select multiple value={f.joueurs} onChange={(e) => setF({ ...f, joueurs: [...e.target.selectedOptions].map((o) => o.value) })} style={{ minHeight: 100 }}>
            {joueurs.donnees?.map((j) => <option key={j.id} value={j.id}>{j.prenom} {j.nom}</option>)}
          </select>
        </Champ>
        <button className="bouton primaire" onClick={creer}>Créer la playlist</button>
      </div>
    </div>
  );
}
