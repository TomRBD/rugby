// Feuille de match : titulaires 1 à 15, remplaçants 16 à 23 (paramétrable), changements et cartons, temps de jeu calculé.
import { useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { useClubApi, useSession } from '../../lib/session';
import { POSTE_PAR_NUMERO } from '../../lib/format';
import { useAction } from '../../composants/ui';

const TYPES_CHANGEMENT: Record<string, string> = {
  remplacement: 'Remplacement définitif', temporaire_commotion: 'Temporaire (commotion)', temporaire_saignement: 'Temporaire (saignement)',
  retour: 'Retour du joueur remplacé', carton_jaune: 'Carton jaune', carton_rouge: 'Carton rouge', carton_bleu: 'Carton bleu',
};

export function FeuilleMatch({ donnees, onMaj }: { donnees: any; onMaj: () => void }) {
  const url = useClubApi();
  const action = useAction();
  const { peut } = useSession();
  const { match, feuille, changements, effectif, tempsDeJeu } = donnees;
  const ecriture = peut('match.ecrire', match.equipe_id);
  const nbTotal = match.equipe_format === '7' ? 12 : 23;
  const nbTit = match.equipe_format === '7' ? 7 : 15;
  const [lignes, setLignes] = useState<Record<number, string>>(() => Object.fromEntries(feuille.map((l: any) => [l.numero, l.joueurId])));
  const [capitaine, setCapitaine] = useState<string | null>(feuille.find((l: any) => l.capitaine)?.joueurId ?? null);
  const [chg, setChg] = useState({ type: 'remplacement', minute: '', joueur_sortant: '', joueur_entrant: '' });
  const noms = useMemo(() => Object.fromEntries(effectif.map((j: any) => [j.id, `${j.prenom} ${j.nom}`])), [effectif]);
  const utilises = new Set(Object.values(lignes));

  const enregistrer = async (forcer = false) => {
    const corps = {
      forcer,
      lignes: Object.entries(lignes).filter(([, j]) => j).map(([n, j]) => ({ joueur_id: j, numero: Number(n), titulaire: Number(n) <= nbTit, poste: POSTE_PAR_NUMERO[Number(n)] ?? null, capitaine: capitaine === j })),
    };
    try {
      await api(url(`/matchs/${match.id}/feuille`), { methode: 'PUT', corps });
      onMaj();
    } catch (e) {
      const msg = (e as Error).message;
      if (msg.includes('Confirmez pour forcer') && confirm(`${msg}\n\nLes sélectionner quand même ?`)) return enregistrer(true);
      alert(msg);
    }
  };
  const proposer = () => {
    // Pré-remplissage : numéros habituels des joueurs disponibles
    const l: Record<number, string> = {};
    for (const j of effectif.filter((x: any) => x.statut === 'disponible' && x.numero_habituel && x.numero_habituel <= nbTotal)) if (!l[j.numero_habituel]) l[j.numero_habituel] = j.id;
    setLignes(l);
  };
  const ajouterChangement = async () => {
    const r = await action(() => api(url(`/matchs/${match.id}/changements`), { corps: { type: chg.type, minute: Number(chg.minute), joueur_sortant: chg.joueur_sortant || null, joueur_entrant: chg.joueur_entrant || null } }), 'Changement ajouté');
    if (r) { setChg({ ...chg, minute: '', joueur_sortant: '', joueur_entrant: '' }); onMaj(); }
  };

  return (
    <div className="grille-2">
      <div className="carte">
        <div className="ligne entre">
          <h2 style={{ margin: 0 }}>Feuille de match</h2>
          {ecriture && (
            <div className="ligne">
              <button className="bouton petit" onClick={proposer}>Pré-remplir</button>
              <button className="bouton petit primaire" onClick={() => enregistrer()}>Enregistrer la feuille</button>
              {feuille.length > 0 && !match.compo_annoncee && (
                <button className="bouton petit" onClick={() => action(() => api(url(`/matchs/${match.id}/annoncer-compo`), { corps: {} }), 'Composition annoncée aux joueurs').then(onMaj)}>Annoncer aux joueurs</button>
              )}
              {match.compo_annoncee && <span className="badge vert">Annoncée</span>}
            </div>
          )}
        </div>
        <div className="tableau-conteneur">
          <table className="tableau">
            <thead><tr><th>N°</th><th>Poste</th><th>Joueur</th><th className="num">Temps de jeu</th><th>Cap.</th></tr></thead>
            <tbody>
              {Array.from({ length: nbTotal }, (_, i) => i + 1).map((n) => (
                <tr key={n} style={n === nbTit + 1 ? { borderTop: '3px solid var(--bord)' } : undefined}>
                  <td className="num"><strong>{n}</strong></td>
                  <td className="muet petit">{n <= nbTit ? POSTE_PAR_NUMERO[n] ?? '' : 'Remplaçant'}</td>
                  <td>
                    {ecriture ? (
                      <select className="saisie" value={lignes[n] ?? ''} onChange={(e) => setLignes({ ...lignes, [n]: e.target.value })} aria-label={`Joueur numéro ${n}`}>
                        <option value="">-</option>
                        {effectif.filter((j: any) => j.id === lignes[n] || !utilises.has(j.id)).map((j: any) => (
                          <option key={j.id} value={j.id}>{j.prenom} {j.nom}{j.statut !== 'disponible' ? ` (${j.statut})` : ''}</option>
                        ))}
                      </select>
                    ) : noms[lignes[n]] ?? '-'}
                  </td>
                  <td className="num">{lignes[n] && tempsDeJeu.minutes[lignes[n]] !== undefined ? `${tempsDeJeu.minutes[lignes[n]]} min` : ''}</td>
                  <td>{lignes[n] && <input type="radio" name="capitaine" checked={capitaine === lignes[n]} onChange={() => setCapitaine(lignes[n])} disabled={!ecriture} aria-label="Capitaine" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="carte pile">
        <h2 style={{ margin: 0 }}>Changements et cartons</h2>
        <table className="tableau">
          <tbody>
            {changements.map((c: any) => (
              <tr key={c.id}>
                <td className="num">{c.minute}'</td>
                <td><span className={`badge ${c.type.startsWith('carton') ? (c.type === 'carton_jaune' ? 'orange' : c.type === 'carton_bleu' ? 'bleu' : 'rouge') : ''}`}>{TYPES_CHANGEMENT[c.type]}</span></td>
                <td>{c.joueurSortant && <>↓ {noms[c.joueurSortant]}</>} {c.joueurEntrant && <>↑ {noms[c.joueurEntrant]}</>}</td>
                <td>{ecriture && !c.evenementId && <button className="bouton petit discret" onClick={() => action(() => api(url(`/matchs/${match.id}/changements/${c.id}`), { methode: 'DELETE' })).then(onMaj)} aria-label="Supprimer">✕</button>}
                  {c.evenementId && <span className="muet petit">codé</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!changements.length && <p className="muet">Aucun changement saisi.</p>}
        {ecriture && feuille.length > 0 && (
          <div className="formulaire">
            <label className="champ"><span>Type</span><select value={chg.type} onChange={(e) => setChg({ ...chg, type: e.target.value })}>{Object.entries(TYPES_CHANGEMENT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="champ"><span>Minute</span><input type="number" min={0} max={100} value={chg.minute} onChange={(e) => setChg({ ...chg, minute: e.target.value })} /></label>
            <label className="champ"><span>{chg.type.startsWith('carton') ? 'Joueur sanctionné' : 'Sortant'}</span>
              <select value={chg.joueur_sortant} onChange={(e) => setChg({ ...chg, joueur_sortant: e.target.value })}><option value="">-</option>{feuille.map((l: any) => <option key={l.joueurId} value={l.joueurId}>{l.numero}. {l.prenom} {l.nom}</option>)}</select>
            </label>
            {!['carton_jaune', 'carton_rouge'].includes(chg.type) && (
              <label className="champ"><span>Entrant</span>
                <select value={chg.joueur_entrant} onChange={(e) => setChg({ ...chg, joueur_entrant: e.target.value })}><option value="">-</option>{feuille.map((l: any) => <option key={l.joueurId} value={l.joueurId}>{l.numero}. {l.prenom} {l.nom}</option>)}</select>
              </label>
            )}
            <div><button className="bouton primaire" disabled={chg.minute === ''} onClick={ajouterChangement}>Ajouter</button></div>
          </div>
        )}
        <p className="muet petit">Le temps de jeu est recalculé automatiquement (carton jaune : {match.duree_mi_temps <= 10 ? 2 : 10} min d'exclusion).</p>
      </div>
    </div>
  );
}
