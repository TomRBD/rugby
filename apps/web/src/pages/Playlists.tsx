import { Link } from 'react-router-dom';
import { useClubApi } from '../lib/session';
import { useDonnees } from '../lib/hooks';
import { dateCourte } from '../lib/format';
import { Chargement, Vide } from '../composants/ui';

const TYPES: Record<string, string> = { theme: 'Thème', preparation: 'Préparation', temps_forts: 'Temps forts', individuelle: 'Individuelle' };

export default function Playlists() {
  const url = useClubApi();
  const p = useDonnees<any[]>(url('/playlists'));
  if (!p.donnees) return <Chargement />;
  return (
    <div className="pile">
      <div className="entete-page"><h1>Playlists</h1></div>
      <p className="muet">Créez une playlist depuis une statistique (bouton « Créer une playlist » dans la lecture des clips), par filtre dans l'onglet Playlists d'un match, ou depuis un rapport adverse.</p>
      {!p.donnees.length ? <Vide>Aucune playlist pour le moment.</Vide> : (
        <div className="carte tableau-conteneur">
          <table className="tableau">
            <thead><tr><th>Titre</th><th>Type</th><th className="num">Clips</th><th>Statut</th><th>Créée le</th></tr></thead>
            <tbody>
              {p.donnees.map((x) => (
                <tr key={x.id}>
                  <td><Link to={`/playlists/${x.id}`}><strong>{x.titre}</strong></Link></td>
                  <td>{TYPES[x.type]}</td><td className="num">{x.nb_clips}</td>
                  <td>{x.validee ? <span className="badge vert">Validée</span> : <span className="badge">Brouillon</span>} {x.nb_partages > 0 && <span className="badge bleu">{x.nb_partages} partage(s)</span>}</td>
                  <td>{dateCourte(x.cree_le)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
