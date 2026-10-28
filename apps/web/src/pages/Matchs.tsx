import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useClubApi, useSession } from '../lib/session';
import { useDonnees } from '../lib/hooks';
import { dateHeure } from '../lib/format';
import { t } from '../lib/i18n';
import { Champ, Chargement, Erreur, Modale, Vide, useAction } from '../composants/ui';

const STATUTS: Record<string, [string, string]> = {
  a_coder: ['À coder', 'orange'], en_cours: ['Codage en cours', 'bleu'], code: ['Codé', 'vert'], valide: ['Validé', 'vert'],
};

export function FormulaireMatch({ onFini, initial }: { onFini: (id: string) => void; initial?: any }) {
  const url = useClubApi();
  const action = useAction();
  const { fonction } = useSession();
  const equipes = useDonnees<any[]>(url('/equipes'));
  const adversaires = useDonnees<any[]>(url('/adversaires'));
  const [f, setF] = useState<any>(initial ?? { equipe_id: '', adversaire_id: '', nouvelAdversaire: '', date: '', domicile: true, type: 'officiel', competition: '', niveau_codage: 'express', arbitre: '', terrain: '', meteo: '' });
  useEffect(() => {
    if (!f.equipe_id && equipes.donnees?.length) setF((x: any) => ({ ...x, equipe_id: equipes.donnees!.find((e) => !e.archivee)?.id ?? '' }));
  }, [equipes.donnees, f.equipe_id]);
  const maj = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value });
  const enregistrer = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await action(async () => {
      let adversaire_id = f.adversaire_id || null;
      if (f.nouvelAdversaire) adversaire_id = (await api(url('/adversaires'), { corps: { nom: f.nouvelAdversaire } })).id;
      const corps = {
        equipe_id: f.equipe_id, adversaire_id, date: new Date(f.date).toISOString(), domicile: f.domicile, type: f.type,
        competition: f.competition || null, niveau_codage: f.niveau_codage, arbitre: f.arbitre || null, terrain: f.terrain || null, meteo: f.meteo || null,
      };
      return initial?.id ? api(url(`/matchs/${initial.id}`), { methode: 'PATCH', corps }) : api(url('/matchs'), { corps });
    }, 'Match enregistré');
    if (r) onFini(r.id);
  };
  return (
    <form className="formulaire" onSubmit={enregistrer}>
      <Champ label="Équipe"><select value={f.equipe_id} onChange={maj('equipe_id')} required>{equipes.donnees?.filter((e) => !e.archivee).map((e) => <option key={e.id} value={e.id}>{e.nom}</option>)}</select></Champ>
      <Champ label="Type">
        <select value={f.type} onChange={maj('type')}>
          <option value="officiel">Officiel</option><option value="amical">Amical</option>
          {fonction('analyse_adverse') && <option value="observation">Observation d'un adversaire</option>}
        </select>
      </Champ>
      <Champ label="Adversaire">
        <select value={f.adversaire_id ?? ''} onChange={maj('adversaire_id')}><option value="">Nouveau ou non renseigné</option>{adversaires.donnees?.map((a) => <option key={a.id} value={a.id}>{a.nom}</option>)}</select>
      </Champ>
      {!f.adversaire_id && <Champ label="Nouvel adversaire"><input value={f.nouvelAdversaire ?? ''} onChange={maj('nouvelAdversaire')} placeholder="Nom du club adverse" /></Champ>}
      <Champ label="Date et heure"><input type="datetime-local" value={f.date} onChange={maj('date')} required /></Champ>
      <Champ label="Compétition"><input value={f.competition ?? ''} onChange={maj('competition')} placeholder="Fédérale 2, poule 4" /></Champ>
      <Champ label="Niveau de codage">
        <select value={f.niveau_codage} onChange={maj('niveau_codage')}>
          <option value="express">Express (environ 15 actions, 45 min)</option>
          <option value="complet" disabled={!fonction('codage_complet')}>Complet{fonction('codage_complet') ? '' : ' (offre Club)'}</option>
        </select>
      </Champ>
      <Champ label="Arbitre"><input value={f.arbitre ?? ''} onChange={maj('arbitre')} /></Champ>
      <Champ label="Terrain"><input value={f.terrain ?? ''} onChange={maj('terrain')} /></Champ>
      <Champ label="Météo"><input value={f.meteo ?? ''} onChange={maj('meteo')} placeholder="Pluie, vent fort" /></Champ>
      <label className="ligne"><input type="checkbox" checked={f.domicile} onChange={maj('domicile')} /> À domicile</label>
      <div className="large"><button className="bouton primaire">Enregistrer</button></div>
    </form>
  );
}

export default function Matchs() {
  const url = useClubApi();
  const nav = useNavigate();
  const { peut } = useSession();
  const [params, setParams] = useSearchParams();
  const matchs = useDonnees<any[]>(url('/matchs'));
  const [filtre, setFiltre] = useState('');
  const creation = params.get('nouveau') === '1';
  const liste = (matchs.donnees ?? []).filter((m) => !filtre || m.equipe_id === filtre || m.type === filtre);
  const equipes = [...new Map((matchs.donnees ?? []).map((m) => [m.equipe_id, m.equipe_nom])).entries()];

  return (
    <div className="pile">
      <div className="entete-page">
        <h1>{t('matchs')}</h1>
        {peut('match.ecrire') && <button className="bouton primaire" onClick={() => setParams({ nouveau: '1' })}>{t('nouveauMatch')}</button>}
      </div>
      <div className="ligne">
        <select className="saisie" style={{ maxWidth: 240 }} value={filtre} onChange={(e) => setFiltre(e.target.value)} aria-label="Filtrer">
          <option value="">Tous les matchs</option>
          {equipes.map(([id, nom]) => <option key={id} value={id}>{nom}</option>)}
          <option value="observation">Observations d'adversaires</option>
        </select>
      </div>
      <Erreur message={matchs.erreur} />
      {matchs.chargement && !matchs.donnees ? <Chargement /> : !liste.length ? <Vide>{t('aucunMatch')}</Vide> : (
        <div className="carte tableau-conteneur">
          <table className="tableau">
            <thead><tr><th>Date</th><th>Équipe</th><th>Adversaire</th><th>Score</th><th>Vidéo</th><th>Codage</th><th></th></tr></thead>
            <tbody>
              {liste.map((m) => (
                <tr key={m.id} className="cliquable" onClick={() => nav(`/matchs/${m.id}`)}>
                  <td>{dateHeure(m.date)}</td>
                  <td>{m.equipe_nom}{m.type !== 'officiel' && <span className="badge" style={{ marginLeft: 6 }}>{m.type === 'amical' ? 'Amical' : 'Observation'}</span>}</td>
                  <td>{m.domicile ? 'contre' : 'à'} {m.adversaire_nom ?? '?'}</td>
                  <td>{m.score_nous != null ? `${m.score_nous} - ${m.score_adv}` : '-'}</td>
                  <td>{m.statut_video ? <span className={`badge ${m.statut_video === 'pret' ? 'vert' : m.statut_video === 'erreur' ? 'rouge' : 'orange'}`}>{m.statut_video === 'pret' ? 'Prête' : m.statut_video}</span> : <span className="muet">Aucune</span>}</td>
                  <td><span className={`badge ${STATUTS[m.statut][1]}`}>{STATUTS[m.statut][0]}</span> <span className="muet petit">{m.nb_evenements} év.</span></td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {m.statut_video === 'pret' && peut('codage.ecrire', m.equipe_id) && <Link className="bouton petit primaire" to={`/matchs/${m.id}/codage`}>Coder</Link>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {creation && (
        <Modale titre={t('nouveauMatch')} onFermer={() => setParams({})}>
          <FormulaireMatch onFini={(id) => nav(`/matchs/${id}`)} />
        </Modale>
      )}
    </div>
  );
}
