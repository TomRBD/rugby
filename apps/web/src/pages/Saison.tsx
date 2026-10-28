// Tableau de bord de saison : courbes, comparaisons match/match et match/moyenne, classement des joueurs, comparaison des saisons.
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { telecharger, api } from '../lib/api';
import { useClubApi } from '../lib/session';
import { useDonnees } from '../lib/hooks';
import { dateCourte, valeurIndicateur } from '../lib/format';
import { Chargement, Erreur, Modale, useAction } from '../composants/ui';
import { Courbe, Legende } from '../composants/Graphiques';

export default function Saison() {
  const { equipeId } = useParams();
  const url = useClubApi();
  const action = useAction();
  const s = useDonnees<any>(url(`/equipes/${equipeId}/saison`));
  const comparaison = useDonnees<any[]>(url('/comparaison-saisons'));
  const [indic, setIndic] = useState('plaquages_reussis');
  const [comparer, setComparer] = useState<[string, string]>(['', '']);
  const [cycle, setCycle] = useState(false);
  const [appreciations, setAppreciations] = useState<Record<string, string>>({});
  if (s.erreur) return <Erreur message={s.erreur} />;
  if (!s.donnees) return <Chargement />;
  const { matchs, indicateurs, joueurs } = s.donnees;
  const courant = indicateurs.find((i: any) => i.key === indic);
  const idx = (id: string) => matchs.findIndex((m: any) => m.id === id);
  const [a, b] = comparer.map(idx);

  const rapportCycle = async () => {
    const blob = await action(() => api<Blob>(url(`/equipes/${equipeId}/rapport-fin-cycle.pdf`), { corps: { appreciations } }));
    if (blob) window.open(URL.createObjectURL(blob));
  };

  return (
    <div className="pile">
      <div className="entete-page">
        <h1>Saison : {matchs.length} match(s) codé(s)</h1>
        <div className="ligne">
          <button className="bouton" onClick={() => telecharger(url(`/equipes/${equipeId}/rapport-saison.pdf`), 'saison.pdf')}>Rapport de saison PDF</button>
          <button className="bouton" onClick={() => setCycle(true)}>Bilan de fin de cycle (jeunes)</button>
        </div>
      </div>

      <div className="carte">
        <div className="ligne entre"><h2 style={{ margin: 0 }}>Évolution</h2>
          <select className="saisie" style={{ width: 'auto' }} value={indic} onChange={(e) => setIndic(e.target.value)} aria-label="Indicateur">
            {indicateurs.map((i: any) => <option key={i.key} value={i.key}>{i.famille} : {i.label}</option>)}
          </select>
        </div>
        {courant && (
          <>
            <Courbe labels={matchs.map((m: any) => dateCourte(m.date).replace(/ \d{4}$/, ''))}
              series={[{ nom: 'Nous', couleur: 'var(--nous)', valeurs: courant.serieNous }, { nom: 'Adversaires', couleur: 'var(--adv)', valeurs: courant.serieAdversaire }]} />
            <Legende items={[{ nom: `Nous (moyenne ${valeurIndicateur(courant.moyenneNous, courant.format)})`, couleur: 'var(--nous)' }, { nom: `Adversaires (moyenne ${valeurIndicateur(courant.moyenneAdversaire, courant.format)})`, couleur: 'var(--adv)' }]} />
          </>
        )}
      </div>

      <div className="grille-2">
        <div className="carte">
          <h2>Résultats et objectifs</h2>
          <table className="tableau">
            <thead><tr><th>Date</th><th>Adversaire</th><th>Score</th><th>Objectifs</th></tr></thead>
            <tbody>
              {matchs.map((m: any) => (
                <tr key={m.id}>
                  <td><Link to={`/matchs/${m.id}/stats`}>{dateCourte(m.date)}</Link></td>
                  <td>{m.domicile ? '' : '@ '}{m.adversaire ?? '-'}</td>
                  <td><span className={`badge ${m.score.nous > m.score.adversaire ? 'vert' : m.score.nous < m.score.adversaire ? 'rouge' : ''}`}>{m.score.nous} - {m.score.adversaire}</span></td>
                  <td>{m.objectifs.map((o: any) => <span key={o.key} title={o.key} style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, marginRight: 2, background: o.atteint == null ? 'var(--bord)' : o.atteint ? 'var(--succes)' : 'var(--danger)' }} />)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="carte pile">
          <h2 style={{ margin: 0 }}>Comparer deux matchs (ou un match à la moyenne)</h2>
          <div className="ligne">
            {[0, 1].map((k) => (
              <select key={k} className="saisie" style={{ flex: 1 }} value={comparer[k]} onChange={(e) => setComparer((c) => (k === 0 ? [e.target.value, c[1]] : [c[0], e.target.value]) as [string, string])} aria-label={`Match ${k + 1}`}>
                <option value="">{k === 0 ? 'Choisir un match' : 'Moyenne de la saison'}</option>
                {matchs.map((m: any) => <option key={m.id} value={m.id}>{dateCourte(m.date)} {m.adversaire ?? ''}</option>)}
              </select>
            ))}
          </div>
          {a >= 0 && (
            <table className="tableau"><thead><tr><th>Indicateur</th><th className="num">Match 1</th><th className="num">{b >= 0 ? 'Match 2' : 'Moyenne'}</th></tr></thead>
              <tbody>
                {indicateurs.filter((i: any) => i.serieNous[a] != null).map((i: any) => {
                  const v1 = i.serieNous[a];
                  const v2 = b >= 0 ? i.serieNous[b] : i.moyenneNous;
                  const mieux = v2 == null ? null : i.sens === 'haut' ? v1 > v2 : v1 < v2;
                  return <tr key={i.key}><td>{i.label}</td><td className="num" style={{ color: mieux == null || v1 === v2 ? undefined : mieux ? 'var(--succes)' : 'var(--danger)' }}>{valeurIndicateur(v1, i.format)}</td><td className="num">{valeurIndicateur(v2, i.format)}</td></tr>;
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="carte tableau-conteneur">
        <h2>Joueurs sur la saison</h2>
        <table className="tableau">
          <thead><tr><th>Joueur</th><th>Poste</th><th className="num">Matchs</th><th className="num">Minutes</th><th className="num">Essais</th><th className="num">Plaquages</th><th className="num">Franch.</th><th className="num">Turnovers</th><th className="num">Contribution</th></tr></thead>
          <tbody>
            {joueurs.map((j: any) => (
              <tr key={j.joueurId}>
                <td><Link to={`/joueurs/${j.joueurId}`}>{j.nom ?? '?'}</Link></td><td className="muet">{j.poste ?? ''}</td>
                <td className="num">{j.matchs}</td><td className="num">{Math.round(j.minutes)}</td><td className="num">{j.valeurs.essais ?? 0}</td>
                <td className="num">{j.valeurs.plaquages_reussis ?? 0}/{j.valeurs.plaquages_tentes ?? 0}</td><td className="num">{j.valeurs.franchissements ?? 0}</td>
                <td className="num">{j.valeurs.turnovers ?? 0}</td><td className="num"><strong>{Math.round(j.contribution * 10) / 10}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {comparaison.donnees && comparaison.donnees.length > 1 && (
        <div className="carte tableau-conteneur">
          <h2>Comparaison des saisons (club)</h2>
          <table className="tableau">
            <thead><tr><th>Indicateur</th>{comparaison.donnees.map((c) => <th key={c.saison} className="num">{c.saison} ({c.nbMatchs})</th>)}</tr></thead>
            <tbody>
              {(comparaison.donnees.find((c) => c.indicateurs.length)?.indicateurs ?? []).map((i: any) => (
                <tr key={i.key}><td>{i.label}</td>{comparaison.donnees!.map((c) => <td key={c.saison} className="num">{valeurIndicateur(c.indicateurs.find((x: any) => x.key === i.key)?.moyenneNous, i.format)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {cycle && (
        <Modale titre="Bilan de fin de cycle" onFermer={() => setCycle(false)}>
          <p className="muet">Ajoutez une appréciation pour chaque joueur (facultatif), puis générez le PDF.</p>
          <div className="pile">
            {joueurs.map((j: any) => (
              <label key={j.joueurId} className="champ"><span>{j.nom}</span>
                <textarea rows={2} value={appreciations[j.joueurId] ?? ''} onChange={(e) => setAppreciations({ ...appreciations, [j.joueurId]: e.target.value })} />
              </label>
            ))}
            <button className="bouton primaire" onClick={rapportCycle}>Générer le PDF</button>
          </div>
        </Modale>
      )}
    </div>
  );
}
