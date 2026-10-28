// Statistiques d'un match : chaque chiffre ouvre les clips qui le composent.
import { useMemo, useState } from 'react';
import { LIBELLES_STATS_JOUEUR, type Indicateur, type Valeur } from '@rugby/shared';
import { api, telecharger } from '../../lib/api';
import { useClubApi, useSession } from '../../lib/session';
import { useDonnees } from '../../lib/hooks';
import { valeurIndicateur } from '../../lib/format';
import { Chargement, Erreur, Kpi, useAction } from '../../composants/ui';
import { BarresComparees, Legende, Momentum } from '../../composants/Graphiques';
import { Terrain } from '../../composants/Terrain';
import { clipsDepuisEvenements, ModaleClips } from '../../composants/LecteurClips';
import type { SourceVideo } from '../../composants/LecteurVideo';
import { useNavigate } from 'react-router-dom';

/** Sources vidéo d'un match (chargées une fois, réutilisées pour chaque ouverture de clip). */
export function useSourcesMatch(matchId: string) {
  const url = useClubApi();
  const l = useDonnees<any[]>(url(`/matchs/${matchId}/lecture`));
  return useMemo(() => {
    const prets = (l.donnees ?? []).filter((v) => v.pret) as (SourceVideo & { pret: boolean })[];
    return { sources: prets, principal: prets[0]?.videoId as string | undefined };
  }, [l.donnees]);
}

export function StatClip({ v, format, onOuvrir, titre }: { v: Valeur; format: string; onOuvrir: (ids: string[], titre: string) => void; titre: string }) {
  return (
    <button className="stat-clip" disabled={!v.ids.length} onClick={() => onOuvrir(v.ids, titre)} title={v.ids.length ? `Voir les ${v.ids.length} clip(s)` : undefined}>
      {valeurIndicateur(v.valeur, format)}
    </button>
  );
}

const COULEURS_CARTE: Record<string, string> = {
  essai: '#1565c0', penalite: '#f9a825', plaquage: '#ffffff', turnover: '#8e24aa', franchissement: '#00897b', touche: '#90caf9',
  melee: '#a1887f', jeu_au_pied: '#ffcc80', penalite_tentee: '#ffd54f', transformation: '#ffd54f', ruck: '#cfd8dc', entree_22: '#4db6ac',
};

export function StatsMatch({ matchId }: { matchId: string }) {
  const url = useClubApi();
  const nav = useNavigate();
  const action = useAction();
  const { club } = useSession();
  const d = useDonnees<any>(url(`/matchs/${matchId}/stats`));
  const types = useDonnees<any[]>(url('/taxonomie'));
  const { sources, principal } = useSourcesMatch(matchId);
  const [clips, setClips] = useState<{ ids: string[]; titre: string } | null>(null);
  const [typeCarte, setTypeCarte] = useState('essai');
  const [campCarte, setCampCarte] = useState<'' | 'nous' | 'adversaire'>('');
  const [famille, setFamille] = useState('');

  const listeClips = useMemo(() => {
    if (!clips || !d.donnees || !types.donnees || !principal) return [];
    return clipsDepuisEvenements(clips.ids, d.donnees.evenements, types.donnees, principal, club?.config?.prePost);
  }, [clips, d.donnees, types.donnees, principal, club]);

  if (d.erreur) return <Erreur message={d.erreur} />;
  if (!d.donnees || !types.donnees) return <Chargement />;
  const { stats, objectifs, evenements, feuille, match, resume, exercices } = d.donnees;
  const ouvrir = (ids: string[], titre: string) => {
    if (!principal) return alert('Aucune vidéo prête pour ce match : les clips seront disponibles après le traitement de la vidéo.');
    setClips({ ids, titre });
  };
  const noms: Record<string, string> = Object.fromEntries(feuille.map((f: any) => [f.joueurId, `${f.numero}. ${f.prenom} ${f.nom}`]));
  const familles = [...new Set(stats.indicateurs.map((i: Indicateur) => i.famille))] as string[];
  const nomAdv = match.adversaire_nom ?? 'Adversaire';
  const pointsCarte = evenements.filter((e: any) => e.x != null && e.typeKey === typeCarte && (!campCarte || e.camp === campCarte)).map((e: any) => ({
    id: e.id, x: e.x, y: e.y, couleur: e.camp === 'nous' ? (COULEURS_CARTE[e.typeKey] ?? '#fff') : '#ef5350',
    forme: (types.donnees!.find((t) => t.key === e.typeKey)?.resultats.find((r: any) => r.value === e.resultat)?.succes === false ? 'croix' : 'rond') as 'croix' | 'rond',
    titre: `${e.camp === 'nous' ? 'Nous' : nomAdv} ${e.resultat ?? ''}`,
  }));
  const creerPlaylist = async (ids: string[], titre: string) => {
    const p = await action(() => api(url('/playlists'), { corps: { titre, match_id: matchId, evenements: ids } }), 'Playlist créée');
    if (p) nav(`/playlists/${p.id}`);
  };
  const colonnesJoueurs = ['points', 'plaquages_reussis', 'plaquages_manques', 'ballons_portes', 'metres', 'franchissements', 'defenseurs_battus', 'turnovers', 'rucks_premier_arrive', 'penalites_concedees', 'penalites_provoquees'];

  return (
    <div className="pile">
      <div className="ligne">
        <button className="bouton petit" onClick={() => telecharger(url(`/matchs/${matchId}/export?format=csv`), 'stats-match.csv')}>Export CSV</button>
        <button className="bouton petit" onClick={() => telecharger(url(`/matchs/${matchId}/export?format=xlsx`), 'stats-match.xlsx')}>Export Excel</button>
        <button className="bouton petit" onClick={() => telecharger(url(`/matchs/${matchId}/export?format=xlsx&quoi=joueurs`), 'stats-joueurs.xlsx')}>Joueurs (Excel)</button>
        <button className="bouton petit" onClick={() => telecharger(url(`/matchs/${matchId}/export?format=csv&quoi=evenements`), 'evenements.csv')}>Événements (CSV)</button>
        <button className="bouton petit" onClick={() => telecharger(url(`/matchs/${matchId}/rapport.pdf`), 'rapport.pdf')}>Rapport PDF</button>
      </div>

      {stats.alertes.filter((a: any) => a.niveau === 'alerte').length > 0 && (
        <div className="alerte">
          <strong>Contrôles de cohérence</strong>
          <ul className="petit" style={{ margin: '4px 0 0' }}>{stats.alertes.filter((a: any) => a.niveau === 'alerte').slice(0, 8).map((a: any, i: number) => (
            <li key={i}>{a.message}{a.evenementId && <> <button className="stat-clip" onClick={() => ouvrir([a.evenementId], a.message)}>voir</button></>}</li>
          ))}</ul>
        </div>
      )}

      <div className="carte"><h2>Résumé automatique</h2><p style={{ margin: 0 }}>{resume}</p></div>

      <div className="grille">
        <Kpi libelle={`${match.equipe_nom} - ${nomAdv}`} valeur={<><StatClip v={stats.indicateurs.find((i: Indicateur) => i.key === 'points').nous} format="nombre" onOuvrir={ouvrir} titre="Nos points" /> - <StatClip v={stats.indicateurs.find((i: Indicateur) => i.key === 'points').adversaire} format="nombre" onOuvrir={ouvrir} titre="Points adverses" /></>}
          detail={`Mi-temps ${stats.parMiTemps[0].nous.valeur ?? 0} - ${stats.parMiTemps[0].adversaire.valeur ?? 0}`} />
        <Kpi libelle="Essais" valeur={<><StatClip v={stats.indicateurs.find((i: Indicateur) => i.key === 'essais').nous} format="nombre" onOuvrir={ouvrir} titre="Nos essais" /> - <StatClip v={stats.indicateurs.find((i: Indicateur) => i.key === 'essais').adversaire} format="nombre" onOuvrir={ouvrir} titre="Essais encaissés" /></>} />
        <Kpi libelle="Objectifs atteints" valeur={`${objectifs.filter((o: any) => o.atteint).length}/${objectifs.filter((o: any) => o.atteint !== null).length}`} />
      </div>

      <div className="carte">
        <h2>Tableau de bord après-match : objectifs</h2>
        <div className="grille" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 8 }}>
          {objectifs.map((o: any) => (
            <div key={o.key + o.camp} className="carte" style={{ padding: 10, borderLeft: `5px solid ${o.atteint == null ? 'var(--bord)' : o.atteint ? 'var(--succes)' : 'var(--danger)'}` }}>
              <div className="petit muet">{o.label}</div>
              <div className="ligne entre">
                <span style={{ fontSize: '1.4rem' }}><StatClip v={{ valeur: o.valeur, ids: o.ids }} format={o.format} onOuvrir={ouvrir} titre={o.label} /></span>
                <span className="petit muet">objectif {valeurIndicateur(o.cible, o.format)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grille-2">
        <div className="carte">
          <h2>Points par tranche de 10 minutes</h2>
          <BarresComparees onClic={ouvrir} series={stats.parTranche.map((t: any) => ({ label: t.label, nous: t.nous.valeur ?? 0, adversaire: t.adversaire.valeur ?? 0, idsNous: t.nous.ids, idsAdv: t.adversaire.ids }))} />
          <Legende items={[{ nom: match.equipe_nom, couleur: 'var(--nous)' }, { nom: nomAdv, couleur: 'var(--adv)' }]} />
        </div>
        <div className="carte">
          <h2>Momentum par 5 minutes</h2>
          <Momentum points={stats.momentum} onClic={ouvrir} />
          <p className="muet petit">Au-dessus de l'axe : temps fort pour nous. Cliquez une barre pour voir les actions.</p>
        </div>
      </div>

      <div className="grille-2">
        <div className="carte">
          <div className="ligne entre"><h2 style={{ margin: 0 }}>Indicateurs</h2>
            <select className="saisie" style={{ width: 'auto' }} value={famille} onChange={(e) => setFamille(e.target.value)} aria-label="Famille">
              <option value="">Toutes les familles</option>{familles.map((f) => <option key={f}>{f}</option>)}
            </select>
          </div>
          <div className="tableau-conteneur"><table className="tableau">
            <thead><tr><th>Indicateur</th><th className="num nous">{match.equipe_nom}</th><th className="num adv">{nomAdv}</th></tr></thead>
            <tbody>
              {stats.indicateurs.filter((i: Indicateur) => (!famille || i.famille === famille) && (i.nous.valeur != null || i.adversaire.valeur != null)).map((i: Indicateur) => (
                <tr key={i.key}>
                  <td>{i.label}</td>
                  <td className="num"><StatClip v={i.nous} format={i.format} onOuvrir={ouvrir} titre={`${i.label} : ${match.equipe_nom}`} /></td>
                  <td className="num"><StatClip v={i.adversaire} format={i.format} onOuvrir={ouvrir} titre={`${i.label} : ${nomAdv}`} /></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
        <div className="carte">
          <div className="ligne entre"><h2 style={{ margin: 0 }}>Carte du terrain</h2>
            <div className="ligne">
              <select className="saisie" style={{ width: 'auto' }} value={typeCarte} onChange={(e) => setTypeCarte(e.target.value)} aria-label="Type d'action">
                {types.donnees.filter((t) => evenements.some((e: any) => e.typeKey === t.key && e.x != null)).map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
              <select className="saisie" style={{ width: 'auto' }} value={campCarte} onChange={(e) => setCampCarte(e.target.value as any)} aria-label="Équipe">
                <option value="">Les deux équipes</option><option value="nous">{match.equipe_nom}</option><option value="adversaire">{nomAdv}</option>
              </select>
            </div>
          </div>
          <Terrain points={pointsCarte} onPoint={(id) => ouvrir([id], 'Action')} />
          <div className="ligne"><span className="muet petit">{pointsCarte.length} action(s) localisée(s). Croix : échec. Cliquez un point pour voir le clip.</span>
            {pointsCarte.length > 0 && <button className="stat-clip" onClick={() => ouvrir(pointsCarte.map((p: any) => p.id), 'Carte')}>Tout voir</button>}</div>
          {stats.repartitions.filter((r: any) => r.lignes.length).map((r: any) => (
            <details key={r.key}>
              <summary><strong>{r.label}</strong></summary>
              <table className="tableau"><tbody>{r.lignes.map((l: any) => (
                <tr key={l.label}><td>{l.label}</td><td className="num"><StatClip v={l.nous} format="nombre" onOuvrir={ouvrir} titre={`${r.label} : ${l.label}`} /></td><td className="num"><StatClip v={l.adversaire} format="nombre" onOuvrir={ouvrir} titre={`${r.label} : ${l.label} (adversaire)`} /></td></tr>
              ))}</tbody></table>
            </details>
          ))}
        </div>
      </div>

      <div className="carte">
        <h2>Statistiques individuelles</h2>
        <div className="tableau-conteneur"><table className="tableau">
          <thead><tr><th>Joueur</th><th className="num">Min.</th>{colonnesJoueurs.map((k) => <th key={k} className="num" title={LIBELLES_STATS_JOUEUR[k]}>{LIBELLES_STATS_JOUEUR[k].replace('Plaquages ', 'Plaq. ').replace('Pénalités ', 'Pén. ')}</th>)}<th className="num">Contribution</th></tr></thead>
          <tbody>
            {stats.joueurs.filter((j: any) => noms[j.joueurId] || Object.keys(j.valeurs).length).map((j: any) => (
              <tr key={j.joueurId}>
                <td><button className="stat-clip" style={{ textDecoration: 'none' }} onClick={() => nav(`/joueurs/${j.joueurId}`)}>{noms[j.joueurId] ?? 'Hors feuille'}</button></td>
                <td className="num">{j.tempsDeJeu}</td>
                {colonnesJoueurs.map((k) => <td key={k} className="num">{j.valeurs[k] ? <StatClip v={j.valeurs[k]} format="nombre" onOuvrir={ouvrir} titre={`${noms[j.joueurId]} : ${LIBELLES_STATS_JOUEUR[k]}`} /> : <span className="muet">0</span>}</td>)}
                <td className="num"><strong>{j.contribution}</strong></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>

      {exercices.length > 0 && (
        <div className="carte">
          <h2>Suggestions d'exercices</h2>
          {exercices.map((x: any) => <div key={x.indicateur}><strong>{x.indicateur}</strong><ul>{x.exercices.map((e: string) => <li key={e}>{e}</li>)}</ul></div>)}
        </div>
      )}

      {clips && (
        <ModaleClips titre={clips.titre} onFermer={() => setClips(null)} clips={listeClips} sources={Object.fromEntries(principal ? [[principal, sources]] : [])}
          actions={() => <button className="bouton petit" onClick={() => creerPlaylist(clips.ids, clips.titre)}>Créer une playlist</button>} />
      )}
    </div>
  );
}
