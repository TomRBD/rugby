// Entraînements : séances, exercices (dont suggestions issues des matchs), présences.
import { useState } from 'react';
import { api } from '../lib/api';
import { useClubApi, useSession } from '../lib/session';
import { useDonnees } from '../lib/hooks';
import { dateHeure } from '../lib/format';
import { Champ, Chargement, Modale, Vide, useAction } from '../composants/ui';

export default function Entrainements() {
  const url = useClubApi();
  const action = useAction();
  const { peut } = useSession();
  const seances = useDonnees<any[]>(url('/entrainements'));
  const equipes = useDonnees<any[]>(url('/equipes'));
  const [edition, setEdition] = useState<any | null>(null);
  const joueurs = useDonnees<any[]>(edition?.equipe_id ? url(`/equipes/${edition.equipe_id}/joueurs`) : null);
  const enregistrer = async (e: React.FormEvent) => {
    e.preventDefault();
    const corps = { equipe_id: edition.equipe_id, date: new Date(edition.date).toISOString(), duree_minutes: Number(edition.duree_minutes), theme: edition.theme || null, exercices: edition.exercices, presences: edition.presences };
    const r = await action(() => (edition.id ? api(url(`/entrainements/${edition.id}`), { methode: 'PATCH', corps }) : api(url('/entrainements'), { corps })), 'Séance enregistrée');
    if (r) { setEdition(null); void seances.recharger(); }
  };
  if (!seances.donnees) return <Chargement />;
  return (
    <div className="pile">
      <div className="entete-page">
        <h1>Entraînements</h1>
        {peut('match.ecrire') && <button className="bouton primaire" onClick={() => setEdition({ equipe_id: equipes.donnees?.find((x) => !x.archivee)?.id ?? '', date: '', duree_minutes: 90, theme: '', exercices: [], presences: [] })}>Nouvelle séance</button>}
      </div>
      {!seances.donnees.length ? <Vide>Aucune séance planifiée.</Vide> : (
        <div className="grille">
          {seances.donnees.map((s) => (
            <button key={s.id} className="carte" style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit' }}
              onClick={() => setEdition({ ...s, date: new Date(new Date(s.date).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) })}>
              <strong>{dateHeure(s.date)}</strong><div>{s.theme ?? 'Séance'}</div>
              <div className="muet petit">{s.duree_minutes} min · {s.exercices.length} exercice(s) · {s.presences.length} présent(s)</div>
            </button>
          ))}
        </div>
      )}
      {edition && (
        <Modale titre={edition.id ? 'Séance' : 'Nouvelle séance'} onFermer={() => setEdition(null)}>
          <form className="pile" onSubmit={enregistrer}>
            <div className="formulaire">
              <Champ label="Équipe"><select value={edition.equipe_id} onChange={(e) => setEdition({ ...edition, equipe_id: e.target.value, presences: [] })}>{equipes.donnees?.map((x) => <option key={x.id} value={x.id}>{x.nom}</option>)}</select></Champ>
              <Champ label="Date et heure"><input type="datetime-local" value={edition.date} onChange={(e) => setEdition({ ...edition, date: e.target.value })} required /></Champ>
              <Champ label="Durée (min)"><input type="number" value={edition.duree_minutes} onChange={(e) => setEdition({ ...edition, duree_minutes: e.target.value })} /></Champ>
              <Champ label="Thème"><input value={edition.theme ?? ''} onChange={(e) => setEdition({ ...edition, theme: e.target.value })} placeholder="Défense, conquête…" /></Champ>
            </div>
            <h3>Exercices</h3>
            {edition.exercices.map((x: any, i: number) => (
              <div key={i} className="ligne">
                <input className="saisie" style={{ flex: 2 }} value={x.titre} onChange={(e) => setEdition({ ...edition, exercices: edition.exercices.map((y: any, j: number) => (j === i ? { ...y, titre: e.target.value } : y)) })} aria-label="Exercice" />
                <input className="saisie" type="number" style={{ width: 90 }} value={x.duree ?? ''} placeholder="min" onChange={(e) => setEdition({ ...edition, exercices: edition.exercices.map((y: any, j: number) => (j === i ? { ...y, duree: Number(e.target.value) } : y)) })} aria-label="Durée" />
                <button type="button" className="bouton petit discret" onClick={() => setEdition({ ...edition, exercices: edition.exercices.filter((_: any, j: number) => j !== i) })}>✕</button>
              </div>
            ))}
            <div><button type="button" className="bouton petit" onClick={() => setEdition({ ...edition, exercices: [...edition.exercices, { titre: '', duree: 15 }] })}>Ajouter un exercice</button></div>
            <h3>Présences ({edition.presences.length})</h3>
            <div className="grille" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 4 }}>
              {joueurs.donnees?.map((j) => (
                <label key={j.id} className="ligne petit"><input type="checkbox" checked={edition.presences.includes(j.id)}
                  onChange={(e) => setEdition({ ...edition, presences: e.target.checked ? [...edition.presences, j.id] : edition.presences.filter((x: string) => x !== j.id) })} />{j.prenom} {j.nom}</label>
              ))}
            </div>
            <div className="ligne">
              <button className="bouton primaire">Enregistrer</button>
              {edition.id && <button type="button" className="bouton danger" onClick={() => action(() => api(url(`/entrainements/${edition.id}`), { methode: 'DELETE' })).then(() => { setEdition(null); void seances.recharger(); })}>Supprimer</button>}
            </div>
          </form>
        </Modale>
      )}
    </div>
  );
}
