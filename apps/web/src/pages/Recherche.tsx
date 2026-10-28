// Recherche en langage naturel : « plaquages manqués de Dupont en 2e mi-temps », « touches perdues dans nos 22 ».
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatTimecode } from '@rugby/shared';
import { api } from '../lib/api';
import { useClubApi } from '../lib/session';
import { useDonnees } from '../lib/hooks';
import { dateCourte } from '../lib/format';
import { Erreur, useAction } from '../composants/ui';
import { ModaleClips, type Clip } from '../composants/LecteurClips';
import type { SourceVideo } from '../composants/LecteurVideo';

const EXEMPLES = ['plaquages manqués en 2e mi-temps', 'touches perdues dans nos 22', 'essais adverses', 'turnovers gagnés', 'pénalités concédées hors-jeu'];

export default function Recherche() {
  const url = useClubApi();
  const nav = useNavigate();
  const action = useAction();
  const types = useDonnees<any[]>(url('/taxonomie'));
  const [q, setQ] = useState('');
  const [r, setR] = useState<any | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [lecture, setLecture] = useState<{ clips: Clip[]; sources: Record<string, SourceVideo[]> } | null>(null);
  const chercher = async (texte = q) => {
    setQ(texte);
    try { setR(await api(url(`/recherche?q=${encodeURIComponent(texte)}`))); setErreur(null); } catch (e) { setErreur((e as Error).message); }
  };
  const resume = useMemo(() => {
    if (!r) return '';
    const f = r.filtre;
    const morceaux = [];
    if (f.types) morceaux.push(f.types.map((k: string) => types.donnees?.find((t) => t.key === k)?.label ?? k).join(', '));
    if (f.succes === false) morceaux.push('ratés');
    if (f.succes === true) morceaux.push('réussis');
    if (f.resultats) morceaux.push(`résultat ${f.resultats.join(', ')}`);
    if (f.camp) morceaux.push(f.camp === 'nous' ? 'notre équipe' : 'adversaire');
    if (f.miTemps) morceaux.push(`${f.miTemps === 1 ? '1re' : '2e'} mi-temps`);
    if (f.zonesLongueur) morceaux.push(f.zonesLongueur[0] === 0 ? 'dans nos 22' : 'dans les 22 adverses');
    if (f.joueurs) morceaux.push(`${f.joueurs.length} joueur(s)`);
    if (f.numeros) morceaux.push(`n° ${f.numeros.join(', ')}`);
    return morceaux.join(' · ');
  }, [r, types.donnees]);

  const tout = async () => {
    // Regroupe par match pour charger chaque vidéo une seule fois
    const parMatch = new Map<string, any[]>();
    for (const e of r.resultats) parMatch.set(e.matchId, [...(parMatch.get(e.matchId) ?? []), e]);
    const sources: Record<string, SourceVideo[]> = {};
    const clips: Clip[] = [];
    await action(async () => {
      for (const [matchId, evs] of parMatch) {
        const lec = (await api<any[]>(url(`/matchs/${matchId}/lecture`))).filter((v) => v.pret);
        if (!lec.length) continue;
        sources[lec[0].videoId] = lec;
        for (const e of evs) {
          const t = types.donnees?.find((x) => x.key === e.typeKey);
          clips.push({ id: e.id, debut: Math.max(0, e.debut - (t?.preRoll ?? 3)), fin: e.fin + (t?.postRoll ?? 3), videoId: lec[0].videoId, titre: t?.label ?? e.typeKey, sousTitre: `${dateCourte(e.date)} ${e.adversaire ?? ''} · ${formatTimecode(e.debut)}` });
        }
      }
    });
    setLecture({ clips, sources });
  };

  return (
    <div className="pile">
      <h1>Recherche</h1>
      <form className="carte ligne" onSubmit={(e) => { e.preventDefault(); void chercher(); }}>
        <input className="saisie" style={{ flex: 1, fontSize: '1.05rem' }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ex. : plaquages manqués du 7 en 2e mi-temps" aria-label="Recherche" autoFocus />
        <button className="bouton primaire">Chercher</button>
      </form>
      <div className="ligne petit">{EXEMPLES.map((x) => <button key={x} className="bouton petit" onClick={() => chercher(x)}>{x}</button>)}</div>
      <Erreur message={erreur} />
      {r && (
        <div className="carte pile">
          <div className="ligne entre">
            <span><strong>{r.total}</strong> action(s) · <span className="muet">{resume || 'aucun critère reconnu'}</span></span>
            {r.total > 0 && <div className="ligne">
              <button className="bouton primaire" onClick={tout}>Voir les clips</button>
              <button className="bouton" onClick={async () => {
                const p = await action(() => api(url('/playlists'), { corps: { titre: q, evenements: r.resultats.map((e: any) => e.id) } }), 'Playlist créée');
                if (p) nav(`/playlists/${p.id}`);
              }}>Créer une playlist</button>
            </div>}
          </div>
          <table className="tableau"><tbody>
            {r.resultats.slice(0, 200).map((e: any) => (
              <tr key={e.id} className="cliquable" onClick={() => nav(`/matchs/${e.matchId}/stats`)}>
                <td>{dateCourte(e.date)}</td><td>{e.adversaire ?? ''}</td><td>{types.donnees?.find((t) => t.key === e.typeKey)?.label}</td>
                <td>{e.resultat ?? ''}</td><td className={e.camp === 'nous' ? 'nous' : 'adv'}>{e.camp === 'nous' ? 'Nous' : 'Adversaire'}</td><td>{formatTimecode(e.debut)}</td>
              </tr>
            ))}
          </tbody></table>
        </div>
      )}
      {lecture && <ModaleClips titre={q} onFermer={() => setLecture(null)} clips={lecture.clips} sources={lecture.sources} />}
    </div>
  );
}
