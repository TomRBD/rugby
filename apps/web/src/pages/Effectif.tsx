import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useClubApi, useSession } from '../lib/session';
import { useDonnees } from '../lib/hooks';
import { LIBELLES_STATUT_JOUEUR, POSTES } from '../lib/format';
import { Champ, Chargement, Erreur, Modale, useAction } from '../composants/ui';
import { ModaleInvitation } from './Parametres';

const VIDE = {
  prenom: '', nom: '', date_naissance: '', poste_principal: '', postes_secondaires: [] as string[], pied_fort: '', taille_cm: '', poids_kg: '',
  licence: '', categorie: '', statut: 'disponible', numero_habituel: '', responsable_legal_nom: '', responsable_legal_contact: '',
};

export function FormulaireJoueur({ initial, onFini }: { initial?: any; onFini: () => void }) {
  const url = useClubApi();
  const action = useAction();
  const [f, setF] = useState<any>(() => ({ ...VIDE, ...Object.fromEntries(Object.entries(initial ?? {}).map(([k, v]) => [k, v ?? ''])) }));
  const maj = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const mineur = f.date_naissance && new Date(f.date_naissance) > new Date(Date.now() - 18 * 365.25 * 86400000);
  const enregistrer = async (e: React.FormEvent) => {
    e.preventDefault();
    const num = (x: string) => (x === '' ? null : Number(x));
    const corps = {
      prenom: f.prenom, nom: f.nom, date_naissance: f.date_naissance || null, poste_principal: f.poste_principal || null,
      postes_secondaires: f.postes_secondaires, pied_fort: f.pied_fort || null, taille_cm: num(f.taille_cm), poids_kg: num(f.poids_kg),
      licence: f.licence || null, categorie: f.categorie || null, statut: f.statut, numero_habituel: num(f.numero_habituel),
      responsable_legal_nom: f.responsable_legal_nom || null, responsable_legal_contact: f.responsable_legal_contact || null,
    };
    const r = await action(() => (initial?.id ? api(url(`/joueurs/${initial.id}`), { methode: 'PATCH', corps }) : api(url('/joueurs'), { corps })), 'Joueur enregistré');
    if (r) onFini();
  };
  return (
    <form className="formulaire" onSubmit={enregistrer}>
      <Champ label="Prénom"><input value={f.prenom} onChange={maj('prenom')} required /></Champ>
      <Champ label="Nom"><input value={f.nom} onChange={maj('nom')} required /></Champ>
      <Champ label="Date de naissance"><input type="date" value={f.date_naissance} onChange={maj('date_naissance')} /></Champ>
      <Champ label="Numéro habituel"><input type="number" min={1} max={99} value={f.numero_habituel} onChange={maj('numero_habituel')} /></Champ>
      <Champ label="Poste principal">
        <select value={f.poste_principal} onChange={maj('poste_principal')}><option value="">Non renseigné</option>{POSTES.map((p) => <option key={p}>{p}</option>)}</select>
      </Champ>
      <Champ label="Postes secondaires">
        <select multiple value={f.postes_secondaires} onChange={(e) => setF({ ...f, postes_secondaires: [...e.target.selectedOptions].map((o) => o.value) })} style={{ minHeight: 80 }}>
          {POSTES.map((p) => <option key={p}>{p}</option>)}
        </select>
      </Champ>
      <Champ label="Pied fort">
        <select value={f.pied_fort} onChange={maj('pied_fort')}><option value="">Non renseigné</option><option value="droit">Droit</option><option value="gauche">Gauche</option><option value="les_deux">Les deux</option></select>
      </Champ>
      <Champ label="Taille (cm)"><input type="number" value={f.taille_cm} onChange={maj('taille_cm')} /></Champ>
      <Champ label="Poids (kg)"><input type="number" value={f.poids_kg} onChange={maj('poids_kg')} /></Champ>
      <Champ label="Licence FFR"><input value={f.licence} onChange={maj('licence')} /></Champ>
      <Champ label="Catégorie"><input value={f.categorie} onChange={maj('categorie')} placeholder="Séniors, Crabos, M16..." /></Champ>
      <Champ label="Statut">
        <select value={f.statut} onChange={maj('statut')}>{Object.entries(LIBELLES_STATUT_JOUEUR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
      </Champ>
      {mineur && (
        <>
          <Champ label="Responsable légal"><input value={f.responsable_legal_nom} onChange={maj('responsable_legal_nom')} required /></Champ>
          <Champ label="Contact du responsable légal"><input value={f.responsable_legal_contact} onChange={maj('responsable_legal_contact')} required /></Champ>
        </>
      )}
      <div className="large ligne"><button className="bouton primaire">Enregistrer</button></div>
    </form>
  );
}

export function Consentements({ joueur, onMaj }: { joueur: any; onMaj: () => void }) {
  const url = useClubApi();
  const action = useAction();
  const { utilisateur } = useSession();
  const historique = useDonnees<any[]>(url(`/joueurs/${joueur.id}/consentements`), [joueur.consentement_image, joueur.consentement_parental]);
  const changer = async (type: 'image' | 'parental', accorde: boolean) => {
    const par = prompt(`Nom de la personne qui ${accorde ? 'donne' : 'retire'} ce consentement`, type === 'parental' ? joueur.responsable_legal_nom ?? '' : `${joueur.prenom} ${joueur.nom}`) ?? '';
    if (par.length < 2) return;
    await action(() => api(url(`/joueurs/${joueur.id}/consentements`), { corps: { type, accorde, par } }), 'Consentement mis à jour');
    onMaj();
    void historique.recharger();
  };
  return (
    <div className="pile">
      <div className="ligne">
        <span>Droit à l'image : {joueur.consentement_image ? <span className="badge vert">accordé</span> : <span className="badge rouge">non accordé</span>}</span>
        <button className="bouton petit" onClick={() => changer('image', !joueur.consentement_image)}>{joueur.consentement_image ? 'Révoquer' : 'Enregistrer l\'accord'}</button>
      </div>
      {joueur.mineur && (
        <div className="ligne">
          <span>Consentement parental : {joueur.consentement_parental ? <span className="badge vert">accordé</span> : <span className="badge rouge">non accordé</span>}</span>
          <button className="bouton petit" onClick={() => changer('parental', !joueur.consentement_parental)}>{joueur.consentement_parental ? 'Révoquer' : 'Enregistrer l\'accord'}</button>
        </div>
      )}
      {!!historique.donnees?.length && (
        <details><summary className="petit">Historique ({historique.donnees.length})</summary>
          <ul className="petit">{historique.donnees.map((c) => <li key={c.id}>{new Date(c.le).toLocaleString('fr-FR')} : {c.type} {c.accorde ? 'accordé' : 'révoqué'} par {c.par}</li>)}</ul>
        </details>
      )}
      <span className="muet petit">Connecté en tant que {utilisateur?.nom}. Sans consentement, le joueur est exclu des exports publics.</span>
    </div>
  );
}

export default function Effectif() {
  const url = useClubApi();
  const nav = useNavigate();
  const { peut } = useSession();
  const joueurs = useDonnees<any[]>(url('/joueurs'));
  const equipes = useDonnees<any[]>(url('/equipes'));
  const [filtre, setFiltre] = useState({ texte: '', equipe: '', statut: '', archives: false });
  const [edition, setEdition] = useState<any | null>(null);
  const [invitation, setInvitation] = useState<any | null>(null);
  const liste = useMemo(() => (joueurs.donnees ?? []).filter((j) =>
    (filtre.archives || !j.archive) &&
    (!filtre.statut || j.statut === filtre.statut) &&
    (!filtre.equipe || j.equipes.includes(filtre.equipe)) &&
    (!filtre.texte || `${j.prenom} ${j.nom} ${j.poste_principal ?? ''}`.toLowerCase().includes(filtre.texte.toLowerCase()))), [joueurs.donnees, filtre]);

  return (
    <div className="pile">
      <div className="entete-page">
        <h1>Effectif</h1>
        {peut('effectif.ecrire') && <button className="bouton primaire" onClick={() => setEdition({})}>Ajouter un joueur</button>}
      </div>
      <div className="carte ligne">
        <input className="saisie" style={{ maxWidth: 260 }} placeholder="Rechercher un joueur" value={filtre.texte} onChange={(e) => setFiltre({ ...filtre, texte: e.target.value })} aria-label="Rechercher" />
        <select className="saisie" style={{ maxWidth: 200 }} value={filtre.equipe} onChange={(e) => setFiltre({ ...filtre, equipe: e.target.value })} aria-label="Équipe">
          <option value="">Toutes les équipes</option>{equipes.donnees?.map((e) => <option key={e.id} value={e.id}>{e.nom} ({e.saison})</option>)}
        </select>
        <select className="saisie" style={{ maxWidth: 180 }} value={filtre.statut} onChange={(e) => setFiltre({ ...filtre, statut: e.target.value })} aria-label="Statut">
          <option value="">Tous les statuts</option>{Object.entries(LIBELLES_STATUT_JOUEUR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label className="ligne petit" style={{ gap: 4 }}><input type="checkbox" checked={filtre.archives} onChange={(e) => setFiltre({ ...filtre, archives: e.target.checked })} />Archivés</label>
      </div>
      <Erreur message={joueurs.erreur} />
      {joueurs.chargement && !joueurs.donnees ? <Chargement /> : (
        <div className="carte tableau-conteneur">
          <table className="tableau">
            <thead><tr><th>N°</th><th>Joueur</th><th>Poste</th><th>Âge</th><th>Statut</th><th>Image</th><th></th></tr></thead>
            <tbody>
              {liste.map((j) => (
                <tr key={j.id} className="cliquable" onClick={() => nav(`/joueurs/${j.id}`)}>
                  <td className="num">{j.numero_habituel ?? ''}</td>
                  <td><strong>{j.prenom} {j.nom}</strong>{j.mineur && <span className="badge bleu" style={{ marginLeft: 6 }}>Mineur</span>}</td>
                  <td>{j.poste_principal ?? '-'}</td>
                  <td>{j.date_naissance ? Math.floor((Date.now() - new Date(j.date_naissance).getTime()) / (365.25 * 86400000)) : '-'}</td>
                  <td><span className={`badge ${j.statut === 'disponible' ? 'vert' : j.statut === 'blesse' ? 'rouge' : 'orange'}`}>{LIBELLES_STATUT_JOUEUR[j.statut]}</span></td>
                  <td>{j.consentement_image && (!j.mineur || j.consentement_parental) ? '✓' : <span className="adv">Non</span>}</td>
                  <td onClick={(e) => e.stopPropagation()} className="ligne">
                    {peut('effectif.ecrire') && <button className="bouton petit" onClick={() => setEdition(j)}>Modifier</button>}
                    {peut('club.gerer', null) && <button className="bouton petit" onClick={() => setInvitation({ role: 'joueur', joueurId: j.id, libelle: `${j.prenom} ${j.nom}` })}>Inviter</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!liste.length && <p className="muet">Aucun joueur.</p>}
        </div>
      )}
      {edition && (
        <Modale titre={edition.id ? `${edition.prenom} ${edition.nom}` : 'Nouveau joueur'} onFermer={() => setEdition(null)}>
          <FormulaireJoueur initial={edition.id ? edition : undefined} onFini={() => { setEdition(null); void joueurs.recharger(); }} />
          {edition.id && <><h3 style={{ marginTop: 20 }}>Consentements</h3><Consentements joueur={edition} onMaj={() => void joueurs.recharger()} /></>}
        </Modale>
      )}
      {invitation && <ModaleInvitation initial={invitation} onFermer={() => setInvitation(null)} />}
    </div>
  );
}
