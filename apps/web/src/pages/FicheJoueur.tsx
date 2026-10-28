import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { LIBELLES_STATS_JOUEUR } from '@rugby/shared';
import { api, telecharger } from '../lib/api';
import { useClubApi, useSession } from '../lib/session';
import { useDonnees } from '../lib/hooks';
import { dateCourte, LIBELLES_STATUT_JOUEUR } from '../lib/format';
import { Chargement, Erreur, Modale, useAction } from '../composants/ui';
import { Courbe, Legende, Radar } from '../composants/Graphiques';
import { Consentements, FormulaireJoueur } from './Effectif';

const AXES_RADAR = ['plaquages_reussis', 'plaquages_dominants', 'ballons_portes', 'metres', 'franchissements', 'defenseurs_battus', 'turnovers', 'rucks_premier_arrive', 'penalites_provoquees'];

export function ObjectifsJoueur({ joueur, peutModifier, onMaj }: { joueur: any; peutModifier: boolean; onMaj: () => void }) {
  const url = useClubApi();
  const action = useAction();
  const [liste, setListe] = useState<{ key: string; cible: number }[]>(joueur.objectifs_perso ?? []);
  const enregistrer = async () => {
    await action(() => api(url(`/joueurs/${joueur.id}/objectifs`), { methode: 'PUT', corps: liste }), 'Objectifs enregistrés');
    onMaj();
  };
  if (!peutModifier) return liste.length ? <ul>{liste.map((o) => <li key={o.key}>{LIBELLES_STATS_JOUEUR[o.key] ?? o.key} : {o.cible} par match</li>)}</ul> : <p className="muet">Aucun objectif fixé.</p>;
  return (
    <div className="pile">
      {liste.map((o, i) => (
        <div key={i} className="ligne">
          <select className="saisie" style={{ maxWidth: 260 }} value={o.key} onChange={(e) => setListe(liste.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}>
            {Object.entries(LIBELLES_STATS_JOUEUR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <input className="saisie" type="number" style={{ maxWidth: 100 }} value={o.cible} onChange={(e) => setListe(liste.map((x, j) => (j === i ? { ...x, cible: Number(e.target.value) } : x)))} aria-label="Cible par match" />
          <button className="bouton petit discret" onClick={() => setListe(liste.filter((_, j) => j !== i))}>Retirer</button>
        </div>
      ))}
      <div className="ligne">
        <button className="bouton petit" onClick={() => setListe([...liste, { key: 'plaquages_reussis', cible: 10 }])}>Ajouter un objectif</button>
        <button className="bouton petit primaire" onClick={enregistrer}>Enregistrer</button>
      </div>
    </div>
  );
}

export default function FicheJoueur() {
  const { id } = useParams();
  const url = useClubApi();
  const nav = useNavigate();
  const { peut } = useSession();
  const action = useAction();
  const s = useDonnees<any>(url(`/joueurs/${id}/stats`));
  const [edition, setEdition] = useState(false);
  if (s.erreur) return <Erreur message={s.erreur} />;
  if (!s.donnees) return <Chargement />;
  const { joueur, parMatch, par80, moyennePoste } = s.donnees;
  const cumuls: Record<string, number> = {};
  for (const m of parMatch) for (const [k, v] of Object.entries(m.valeurs as Record<string, any>)) cumuls[k] = (cumuls[k] ?? 0) + (v.valeur ?? 0);
  const minutes = parMatch.reduce((a: number, m: any) => a + m.tempsDeJeu, 0);

  const exporter = async () => {
    const d = await action(() => api(url(`/joueurs/${id}/export`)));
    if (!d) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' }));
    a.download = `donnees-${joueur.prenom}-${joueur.nom}.json`;
    a.click();
  };
  const effacer = async () => {
    if (!confirm('Anonymiser définitivement ce joueur ? Ses statistiques collectives restent, son identité et ses données personnelles sont supprimées.')) return;
    if (await action(() => api(url(`/joueurs/${id}/effacement`), { corps: {} }), 'Joueur anonymisé')) nav('/effectif');
  };

  return (
    <div className="pile">
      <div className="entete-page">
        <div>
          <h1>{joueur.prenom} {joueur.nom}</h1>
          <span className="muet">{joueur.poste_principal ?? 'Poste non renseigné'} · {LIBELLES_STATUT_JOUEUR[joueur.statut]} · {parMatch.length} match(s), {Math.round(minutes)} min</span>
        </div>
        <div className="ligne">
          <button className="bouton" onClick={() => telecharger(url(`/joueurs/${id}/rapport.pdf`), 'rapport.pdf')}>Rapport PDF</button>
          {peut('effectif.ecrire') && <button className="bouton" onClick={() => setEdition(true)}>Modifier</button>}
        </div>
      </div>

      <div className="grille-2">
        <div className="carte">
          <h2>Profil sur 80 minutes comparé au poste</h2>
          <Radar axes={AXES_RADAR.map((k) => LIBELLES_STATS_JOUEUR[k].replace('Plaquages ', 'Plaq. '))}
            series={[
              { nom: 'Moyenne du poste', couleur: 'var(--texte-2)', valeurs: AXES_RADAR.map((k) => moyennePoste[k] ?? 0) },
              { nom: joueur.prenom, couleur: 'var(--nous)', valeurs: AXES_RADAR.map((k) => par80[k] ?? 0) },
            ]} />
          <Legende items={[{ nom: joueur.prenom, couleur: 'var(--nous)' }, { nom: `Moyenne ${joueur.poste_principal ?? 'du poste'}`, couleur: 'var(--texte-2)' }]} />
        </div>
        <div className="carte">
          <h2>Indice de contribution par match</h2>
          <Courbe labels={parMatch.map((m: any) => dateCourte(m.date).replace(/ \d{4}$/, ''))}
            series={[{ nom: 'Contribution', couleur: 'var(--nous)', valeurs: parMatch.map((m: any) => m.contribution) }]} />
          <h3>Totaux</h3>
          <div className="tableau-conteneur"><table className="tableau"><tbody>
            {Object.entries(LIBELLES_STATS_JOUEUR).filter(([k]) => cumuls[k]).map(([k, v]) => (
              <tr key={k}><td>{v}</td><td className="num">{cumuls[k]}</td><td className="num muet">{par80[k] ?? 0} / 80 min</td></tr>
            ))}
          </tbody></table></div>
        </div>
      </div>

      <div className="carte tableau-conteneur">
        <h2>Match par match</h2>
        <table className="tableau">
          <thead><tr><th>Date</th><th>Adversaire</th><th className="num">Min.</th><th className="num">Pts</th><th className="num">Plaquages</th><th className="num">Franch.</th><th className="num">Turnovers</th><th className="num">Pén. conc.</th><th className="num">Contribution</th></tr></thead>
          <tbody>
            {parMatch.map((m: any) => (
              <tr key={m.matchId} className="cliquable" onClick={() => nav(`/matchs/${m.matchId}/stats`)}>
                <td>{dateCourte(m.date)}</td><td>{m.adversaire ?? '-'}</td><td className="num">{m.tempsDeJeu}</td>
                <td className="num">{m.valeurs.points?.valeur ?? 0}</td>
                <td className="num">{m.valeurs.plaquages_reussis?.valeur ?? 0}/{m.valeurs.plaquages_tentes?.valeur ?? 0}</td>
                <td className="num">{m.valeurs.franchissements?.valeur ?? 0}</td><td className="num">{m.valeurs.turnovers?.valeur ?? 0}</td>
                <td className="num">{m.valeurs.penalites_concedees?.valeur ?? 0}</td><td className="num">{m.contribution}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grille-2">
        <div className="carte"><h2>Objectifs individuels</h2><ObjectifsJoueur joueur={joueur} peutModifier={peut('effectif.ecrire')} onMaj={() => void s.recharger()} /></div>
        <div className="carte">
          <h2>Consentements et données personnelles</h2>
          <Consentements joueur={{ ...joueur, mineur: joueur.date_naissance && new Date(joueur.date_naissance) > new Date(Date.now() - 18 * 365.25 * 86400000) }} onMaj={() => void s.recharger()} />
          <div className="ligne" style={{ marginTop: 12 }}>
            {peut('export') && <button className="bouton petit" onClick={exporter}>Exporter ses données (RGPD)</button>}
            {peut('club.gerer', null) && <button className="bouton petit danger" onClick={effacer}>Effacer et anonymiser</button>}
          </div>
        </div>
      </div>
      <p><Link to="/effectif">Retour à l'effectif</Link></p>
      {edition && <Modale titre="Modifier le joueur" onFermer={() => setEdition(false)}><FormulaireJoueur initial={joueur} onFini={() => { setEdition(false); void s.recharger(); }} /></Modale>}
    </div>
  );
}
