// Vue 2D du tracking (V2) : positions estimées par la vidéo, correction des numéros lus par OCR, métriques avec marge d'erreur.
import { useMemo, useState } from 'react';
import { formatTimecode } from '@rugby/shared';
import { api } from '../../lib/api';
import { useClubApi, useSession } from '../../lib/session';
import { useDonnees } from '../../lib/hooks';
import { Chargement, Erreur, useAction } from '../../composants/ui';
import { Terrain } from '../../composants/Terrain';

function positionA(positions: [number, number, number][], t: number) {
  // Recherche dichotomique de la dernière position connue avant t (2 s de tolérance)
  let a = 0, b = positions.length - 1;
  if (b < 0 || positions[0][0] > t) return null;
  while (a < b) { const m = (a + b + 1) >> 1; if (positions[m][0] <= t) a = m; else b = m - 1; }
  return t - positions[a][0] <= 2 ? positions[a] : null;
}

export function TrackingMatch({ matchId, feuille }: { matchId: string; feuille: any[] }) {
  const url = useClubApi();
  const action = useAction();
  const { fonction } = useSession();
  const pistes = useDonnees<any[]>(fonction('tracking') ? url(`/matchs/${matchId}/tracking`) : null);
  const [t, setT] = useState(0);
  const fin = useMemo(() => Math.max(0, ...(pistes.donnees ?? []).map((p) => p.positions.at(-1)?.[0] ?? 0)), [pistes.donnees]);
  if (!fonction('tracking')) return <div className="alerte">Le tracking des joueurs est inclus dans l'offre Pro.</div>;
  if (pistes.erreur) return <Erreur message={pistes.erreur} />;
  if (!pistes.donnees) return <Chargement />;
  if (!pistes.donnees.length) return <div className="carte muet">Aucune donnée de tracking : lancez « Tracking des joueurs » dans l'onglet Vidéo (service IA sur GPU).</div>;
  const points = pistes.donnees.map((p) => {
    const pos = positionA(p.positions, t);
    return pos ? { id: p.id, x: pos[1], y: pos[2], couleur: p.camp === 'nous' ? '#64a8f0' : p.camp === 'adversaire' ? '#f07070' : '#ffffff', titre: p.numero ? `n° ${p.numero}` : `piste ${p.piste}` } : null;
  }).filter(Boolean) as any[];
  const corriger = (id: string, corps: any) => action(() => api(url(`/tracking/${id}`), { methode: 'PATCH', corps })).then(() => pistes.recharger());

  return (
    <div className="grille-2">
      <div className="carte pile">
        <h2 style={{ margin: 0 }}>Vue 2D</h2>
        <Terrain points={points} />
        <input type="range" min={0} max={fin} step={0.2} value={t} onChange={(e) => setT(Number(e.target.value))} aria-label="Instant" />
        <span className="muet petit">{formatTimecode(t)} · {points.length} joueur(s) visibles. Positions estimées depuis une seule caméra : précision de l'ordre de 1 à 3 m.</span>
      </div>
      <div className="carte tableau-conteneur">
        <h2>Pistes et métriques estimées</h2>
        <table className="tableau">
          <thead><tr><th>Piste</th><th>Équipe</th><th>N°</th><th>Joueur</th><th className="num">Distance</th><th className="num">Vitesse max</th></tr></thead>
          <tbody>
            {pistes.donnees.map((p) => (
              <tr key={p.id}>
                <td className="muet">{p.piste}</td>
                <td><select className="saisie" style={{ minHeight: 30 }} value={p.camp ?? ''} onChange={(e) => corriger(p.id, { camp: e.target.value })} aria-label="Équipe"><option value="">?</option><option value="nous">Nous</option><option value="adversaire">Adversaire</option></select></td>
                <td><input className="saisie" style={{ width: 60, minHeight: 30 }} type="number" defaultValue={p.numero ?? ''} onBlur={(e) => corriger(p.id, { numero: e.target.value ? Number(e.target.value) : null })} aria-label="Numéro" />
                  {p.confiance_numero != null && p.confiance_numero < 1 && <span className="badge orange" title="Numéro lu automatiquement : à vérifier">OCR {Math.round(p.confiance_numero * 100)} %</span>}</td>
                <td>{p.camp === 'nous' && (
                  <select className="saisie" style={{ minHeight: 30 }} value={p.joueur_id ?? ''} onChange={(e) => corriger(p.id, { joueur_id: e.target.value || null })} aria-label="Joueur">
                    <option value="">-</option>{feuille.map((f) => <option key={f.joueurId} value={f.joueurId}>{f.numero}. {f.nom}</option>)}
                  </select>
                )}</td>
                <td className="num">{p.metriques.distance_m} m <span className="muet petit">± {p.metriques.distance_marge_m}</span></td>
                <td className="num">{p.metriques.vitesse_max_kmh} km/h <span className="muet petit">± {p.metriques.vitesse_max_marge_kmh}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
