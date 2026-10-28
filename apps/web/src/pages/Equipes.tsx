import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useClubApi, useSession } from '../lib/session';
import { useDonnees } from '../lib/hooks';
import { dateCourte } from '../lib/format';
import { Champ, Chargement, Modale, useAction } from '../composants/ui';

const CATEGORIES: [string, string][] = [['seniors', 'Séniors'], ['feminines', 'Féminines'], ['reichel', 'Reichel (M21)'], ['crabos', 'Crabos (M18)'], ['m16', 'M16'], ['m18', 'M18'], ['m21', 'M21'], ['cadettes', 'Cadettes'], ['juniors', 'Juniors']];

export default function Equipes() {
  const url = useClubApi();
  const action = useAction();
  const { peut, recharger: rechargerSession } = useSession();
  const saisons = useDonnees<any[]>(url('/saisons'));
  const equipes = useDonnees<any[]>(url('/equipes'));
  const joueurs = useDonnees<any[]>(url('/joueurs'));
  const [nouvelle, setNouvelle] = useState<any | null>(null);
  const [rattachement, setRattachement] = useState<any | null>(null);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [saison, setSaison] = useState<any | null>(null);

  const creerEquipe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await action(() => api(url('/equipes'), { corps: nouvelle }), 'Équipe créée')) {
      setNouvelle(null);
      void equipes.recharger();
      void rechargerSession();
    }
  };
  const ouvrirRattachement = async (eq: any) => {
    const l = await api<any[]>(url(`/equipes/${eq.id}/joueurs`));
    setSelection(new Set(l.map((j) => j.id)));
    setRattachement(eq);
  };
  const enregistrerRattachement = async () => {
    if (await action(() => api(url(`/equipes/${rattachement.id}/joueurs`), { methode: 'PUT', corps: { joueurs: [...selection] } }), 'Effectif de l\'équipe enregistré')) {
      setRattachement(null);
      void equipes.recharger();
    }
  };
  const archiver = async (s: any) => {
    if (!confirm(`Archiver la saison ${s.libelle} ? Les vidéos passent en stockage froid (480p conservé) et les équipes sont archivées.`)) return;
    await action(() => api(url('/jobs/archivage'), { corps: { saisonId: s.id } }), 'Archivage lancé');
  };

  if (!saisons.donnees || !equipes.donnees) return <Chargement />;
  return (
    <div className="pile">
      <div className="entete-page">
        <h1>Équipes et saisons</h1>
        <div className="ligne">
          {peut('club.gerer', null) && <button className="bouton" onClick={() => setSaison({ libelle: '', debut: '', fin: '' })}>Nouvelle saison</button>}
          {peut('club.gerer', null) && <button className="bouton primaire" onClick={() => setNouvelle({ saison_id: saisons.donnees![0]?.id, nom: '', categorie: 'seniors', format: 'XV' })}>Nouvelle équipe</button>}
        </div>
      </div>
      {saisons.donnees.map((s) => (
        <div key={s.id} className="carte">
          <div className="ligne entre">
            <h2 style={{ margin: 0 }}>Saison {s.libelle} {s.archivee && <span className="badge">Archivée</span>}</h2>
            <span className="muet petit">{dateCourte(s.debut)} au {dateCourte(s.fin)}</span>
            {peut('club.gerer', null) && !s.archivee && <button className="bouton petit" onClick={() => archiver(s)}>Archiver la saison</button>}
          </div>
          <div className="tableau-conteneur"><table className="tableau">
            <thead><tr><th>Équipe</th><th>Catégorie</th><th>Format</th><th className="num">Mi-temps</th><th className="num">Joueurs</th><th></th></tr></thead>
            <tbody>
              {equipes.donnees!.filter((e) => e.saison_id === s.id).map((e) => (
                <tr key={e.id}>
                  <td><strong>{e.nom}</strong>{e.archivee && <span className="badge" style={{ marginLeft: 6 }}>Archivée</span>}</td>
                  <td>{CATEGORIES.find(([k]) => k === e.categorie)?.[1] ?? e.categorie}</td>
                  <td>{e.format === '7' ? 'Rugby à 7' : 'XV'}</td>
                  <td className="num">{e.duree_mi_temps} min</td>
                  <td className="num">{e.nb_joueurs}</td>
                  <td className="ligne">
                    <Link className="bouton petit" to={`/saison/${e.id}`}>Statistiques</Link>
                    {peut('effectif.ecrire', e.id) && <button className="bouton petit" onClick={() => ouvrirRattachement(e)}>Composer l'effectif</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      ))}
      {nouvelle && (
        <Modale titre="Nouvelle équipe" onFermer={() => setNouvelle(null)} etroite>
          <form className="pile" onSubmit={creerEquipe}>
            <Champ label="Nom"><input value={nouvelle.nom} onChange={(e) => setNouvelle({ ...nouvelle, nom: e.target.value })} placeholder="Séniors A" required /></Champ>
            <Champ label="Saison"><select value={nouvelle.saison_id} onChange={(e) => setNouvelle({ ...nouvelle, saison_id: e.target.value })}>{saisons.donnees!.map((s) => <option key={s.id} value={s.id}>{s.libelle}</option>)}</select></Champ>
            <Champ label="Catégorie"><select value={nouvelle.categorie} onChange={(e) => setNouvelle({ ...nouvelle, categorie: e.target.value })}>{CATEGORIES.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Champ>
            <Champ label="Format"><select value={nouvelle.format} onChange={(e) => setNouvelle({ ...nouvelle, format: e.target.value })}><option value="XV">Rugby à XV</option><option value="7">Rugby à 7</option></select></Champ>
            <p className="muet petit">Durée de mi-temps et taille de la feuille ajustées automatiquement (7 : 2 x 7 min, 7 titulaires, 5 remplaçants).</p>
            <button className="bouton primaire">Créer</button>
          </form>
        </Modale>
      )}
      {saison && (
        <Modale titre="Nouvelle saison" onFermer={() => setSaison(null)} etroite>
          <form className="pile" onSubmit={async (e) => { e.preventDefault(); if (await action(() => api(url('/saisons'), { corps: saison }), 'Saison créée')) { setSaison(null); void saisons.recharger(); } }}>
            <Champ label="Libellé"><input value={saison.libelle} onChange={(e) => setSaison({ ...saison, libelle: e.target.value })} placeholder="2027-2028" required /></Champ>
            <Champ label="Début"><input type="date" value={saison.debut} onChange={(e) => setSaison({ ...saison, debut: e.target.value })} required /></Champ>
            <Champ label="Fin"><input type="date" value={saison.fin} onChange={(e) => setSaison({ ...saison, fin: e.target.value })} required /></Champ>
            <button className="bouton primaire">Créer</button>
          </form>
        </Modale>
      )}
      {rattachement && (
        <Modale titre={`Effectif : ${rattachement.nom}`} onFermer={() => setRattachement(null)}>
          <p className="muet">{selection.size} joueur(s) sélectionné(s)</p>
          <div className="grille" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 6 }}>
            {joueurs.donnees?.filter((j) => !j.archive).map((j) => (
              <label key={j.id} className="ligne carte" style={{ padding: 8, gap: 8 }}>
                <input type="checkbox" checked={selection.has(j.id)} onChange={(e) => { const s = new Set(selection); if (e.target.checked) s.add(j.id); else s.delete(j.id); setSelection(s); }} />
                {j.prenom} {j.nom} <span className="muet petit">{j.poste_principal ?? ''}</span>
              </label>
            ))}
          </div>
          <div className="ligne" style={{ marginTop: 12 }}><button className="bouton primaire" onClick={enregistrerRattachement}>Enregistrer</button></div>
        </Modale>
      )}
    </div>
  );
}
