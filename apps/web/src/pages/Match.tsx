import { useState } from 'react';
import { Link, NavLink, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { api, telecharger } from '../lib/api';
import { useClubApi, useSession } from '../lib/session';
import { useDonnees } from '../lib/hooks';
import { dateHeure } from '../lib/format';
import { Chargement, Erreur, Modale, useAction } from '../composants/ui';
import { FormulaireMatch } from './Matchs';
import { FeuilleMatch } from './match/FeuilleMatch';
import { VideosMatch } from './match/VideosMatch';
import { StatsMatch } from './match/StatsMatch';
import { PlaylistsMatch } from './match/PlaylistsMatch';
import { genererCarteResultat } from '../composants/CarteResultat';
import { TrackingMatch } from './match/TrackingMatch';

export default function Match() {
  const { id } = useParams();
  const url = useClubApi();
  const nav = useNavigate();
  const action = useAction();
  const { peut, club } = useSession();
  const m = useDonnees<any>(url(`/matchs/${id}/complet`));
  const [edition, setEdition] = useState(false);
  if (m.erreur) return <Erreur message={m.erreur} />;
  if (!m.donnees) return <Chargement />;
  const { match, stats, videos } = m.donnees;
  const videoPrete = videos.some((v: any) => v.statut === 'pret');
  const supprimer = async () => {
    if (!confirm('Supprimer ce match, ses événements codés et ses vidéos ?')) return;
    if (await action(() => api(url(`/matchs/${id}`), { methode: 'DELETE' }), 'Match supprimé')) nav('/matchs');
  };

  return (
    <div className="pile">
      <div className="entete-page">
        <div>
          <h1>{match.equipe_nom} {match.domicile ? 'contre' : 'à'} {match.adversaire_nom ?? 'adversaire'}</h1>
          <span className="muet">{dateHeure(match.date)}{match.competition ? ` · ${match.competition}` : ''} · Codage {match.niveau_codage === 'express' ? 'Express' : 'Complet'}</span>
        </div>
        <div className="ligne">
          <span className="chiffre" aria-label="Score codé">{stats.score.nous} - {stats.score.adversaire}</span>
          {videoPrete && peut('codage.ecrire', match.equipe_id) && <Link className="bouton primaire" to={`/matchs/${id}/codage`}>Coder (post-match)</Link>}
          {peut('codage.ecrire', match.equipe_id) && <Link className="bouton" to={`/matchs/${id}/live`}>Codage live</Link>}
          {peut('stats.lire', match.equipe_id) && <button className="bouton" onClick={() => telecharger(url(`/matchs/${id}/rapport.pdf`), 'rapport.pdf')}>Rapport PDF</button>}
          <button className="bouton" onClick={async () => {
            const marqueurs = m.donnees.evenements.filter((e: any) => e.typeKey === 'essai' && e.camp === 'nous')
              .map((e: any) => m.donnees.feuille.find((f: any) => f.joueurId === e.joueurs[0])?.nom).filter(Boolean);
            const blob = await genererCarteResultat({
              club: club?.nom ?? match.equipe_nom, adversaire: match.adversaire_nom ?? 'Adversaire', scoreNous: match.score_nous ?? stats.score.nous,
              scoreAdv: match.score_adv ?? stats.score.adversaire, date: match.date, competition: match.competition, domicile: match.domicile,
              couleur: club?.couleurs?.primaire ?? '#0b5d3b', logo: club?.logo_url, marqueurs,
            });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = 'resultat.png';
            a.click();
          }}>Carte de résultat</button>
        </div>
      </div>
      <nav className="onglets" aria-label="Sections du match">
        <NavLink end to={`/matchs/${id}`} className={({ isActive }) => (isActive ? 'actif' : '')}>Infos et feuille de match</NavLink>
        <NavLink to={`/matchs/${id}/video`} className={({ isActive }) => (isActive ? 'actif' : '')}>Vidéo</NavLink>
        {peut('stats.lire', match.equipe_id) && <NavLink to={`/matchs/${id}/stats`} className={({ isActive }) => (isActive ? 'actif' : '')}>Statistiques</NavLink>}
        {peut('playlist.ecrire', match.equipe_id) && <NavLink to={`/matchs/${id}/playlists`} className={({ isActive }) => (isActive ? 'actif' : '')}>Playlists</NavLink>}
        {peut('stats.lire', match.equipe_id) && <NavLink to={`/matchs/${id}/tracking`} className={({ isActive }) => (isActive ? 'actif' : '')}>Tracking 2D</NavLink>}
      </nav>
      <Routes>
        <Route index element={
          <div className="pile">
            <div className="carte">
              <div className="ligne entre"><h2 style={{ margin: 0 }}>Informations</h2>
                {peut('match.ecrire', match.equipe_id) && <div className="ligne"><button className="bouton petit" onClick={() => setEdition(true)}>Modifier</button><button className="bouton petit danger" onClick={supprimer}>Supprimer</button></div>}
              </div>
              <div className="grille petit" style={{ marginTop: 10 }}>
                <span>Arbitre : {match.arbitre ?? '-'}</span><span>Terrain : {match.terrain ?? '-'}</span><span>Météo : {match.meteo ?? '-'}</span>
                <span>Score saisi : {match.score_nous != null ? `${match.score_nous} - ${match.score_adv} (mi-temps ${match.score_nous_mt ?? '?'} - ${match.score_adv_mt ?? '?'})` : 'non saisi'}</span>
              </div>
              {peut('match.ecrire', match.equipe_id) && <ScoreEtBilan match={match} onMaj={() => void m.recharger()} />}
            </div>
            <FeuilleMatch donnees={m.donnees} onMaj={() => void m.recharger()} />
          </div>
        } />
        <Route path="video" element={<VideosMatch donnees={m.donnees} onMaj={() => void m.recharger()} />} />
        <Route path="stats" element={<StatsMatch matchId={id!} />} />
        <Route path="playlists" element={<PlaylistsMatch matchId={id!} equipeId={match.equipe_id} />} />
        <Route path="tracking" element={<TrackingMatch matchId={id!} feuille={m.donnees.feuille} />} />
      </Routes>
      {edition && (
        <Modale titre="Modifier le match" onFermer={() => setEdition(false)}>
          <FormulaireMatch initial={{ ...match, date: new Date(new Date(match.date).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16), nouvelAdversaire: '' }}
            onFini={() => { setEdition(false); void m.recharger(); }} />
        </Modale>
      )}
    </div>
  );
}

function ScoreEtBilan({ match, onMaj }: { match: any; onMaj: () => void }) {
  const url = useClubApi();
  const action = useAction();
  const [f, setF] = useState({
    score_nous_mt: match.score_nous_mt ?? '', score_adv_mt: match.score_adv_mt ?? '', score_nous: match.score_nous ?? '', score_adv: match.score_adv ?? '',
    points_positifs: [0, 1, 2].map((i) => match.points_positifs?.[i] ?? ''), axes_travail: [0, 1, 2].map((i) => match.axes_travail?.[i] ?? ''),
    consignes: match.consignes ?? '',
  });
  const n = (v: any) => (v === '' ? null : Number(v));
  const enregistrer = () => action(() => api(url(`/matchs/${match.id}`), {
    methode: 'PATCH',
    corps: {
      score_nous_mt: n(f.score_nous_mt), score_adv_mt: n(f.score_adv_mt), score_nous: n(f.score_nous), score_adv: n(f.score_adv),
      points_positifs: f.points_positifs.filter(Boolean), axes_travail: f.axes_travail.filter(Boolean), consignes: f.consignes || null,
    },
  }), 'Enregistré').then(onMaj);
  const num = (k: 'score_nous_mt' | 'score_adv_mt' | 'score_nous' | 'score_adv', label: string) => (
    <label className="champ"><span>{label}</span><input type="number" min={0} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>
  );
  return (
    <details style={{ marginTop: 12 }}>
      <summary><strong>Score officiel, bilan et consignes</strong></summary>
      <div className="formulaire" style={{ marginTop: 10 }}>
        {num('score_nous_mt', 'Nous à la pause')}{num('score_adv_mt', 'Adversaire à la pause')}{num('score_nous', 'Nous score final')}{num('score_adv', 'Adversaire score final')}
        {[0, 1, 2].map((i) => <label key={`p${i}`} className="champ"><span>Point positif {i + 1}</span><input value={f.points_positifs[i]} onChange={(e) => setF({ ...f, points_positifs: f.points_positifs.map((x, j) => (j === i ? e.target.value : x)) })} /></label>)}
        {[0, 1, 2].map((i) => <label key={`a${i}`} className="champ"><span>Axe de travail {i + 1}</span><input value={f.axes_travail[i]} onChange={(e) => setF({ ...f, axes_travail: f.axes_travail.map((x, j) => (j === i ? e.target.value : x)) })} /></label>)}
        <label className="champ large"><span>Consignes aux joueurs (visibles dans l'app joueur)</span><textarea rows={3} value={f.consignes} onChange={(e) => setF({ ...f, consignes: e.target.value })} /></label>
        <div className="large"><button className="bouton primaire" onClick={enregistrer}>Enregistrer</button></div>
      </div>
    </details>
  );
}
