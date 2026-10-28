// Page publique optionnelle du club : résultats et calendrier, sans vidéo ni donnée individuelle.
import { useParams } from 'react-router-dom';
import { useDonnees } from '../lib/hooks';
import { dateCourte } from '../lib/format';
import { Chargement } from '../composants/ui';

export default function PagePublique() {
  const { slug } = useParams();
  const d = useDonnees<any>(`/api/public/clubs/${slug}`);
  if (d.erreur) return <div className="page-centree"><div className="carte"><h1>Page introuvable</h1></div></div>;
  if (!d.donnees) return <div className="page-centree"><Chargement /></div>;
  const { club, matchs } = d.donnees;
  const passes = matchs.filter((m: any) => new Date(m.date) < new Date());
  const avenir = matchs.filter((m: any) => new Date(m.date) >= new Date()).reverse();
  return (
    <div className="mobile pile">
      <div className="ligne" style={{ background: club.couleurs?.primaire, color: '#fff', padding: 16, borderRadius: 12 }}>
        {club.logo_url && <img src={club.logo_url} alt="" width={56} height={56} style={{ objectFit: 'contain' }} />}
        <div><h1 style={{ margin: 0 }}>{club.nom}</h1><span>{[club.comite, club.poule].filter(Boolean).join(' · ')}</span></div>
      </div>
      {avenir.length > 0 && (
        <div className="carte"><h2>Prochains matchs</h2>
          {avenir.map((m: any, i: number) => <div key={i} className="ligne entre"><span>{dateCourte(m.date)} · {m.equipe}</span><span>{m.domicile ? 'contre' : 'à'} {m.adversaire ?? '?'}</span></div>)}
        </div>
      )}
      <div className="carte"><h2>Résultats</h2>
        <table className="tableau"><tbody>
          {passes.map((m: any, i: number) => (
            <tr key={i}><td>{dateCourte(m.date)}</td><td>{m.equipe}</td><td>{m.domicile ? 'contre' : 'à'} {m.adversaire ?? '?'}</td>
              <td className="num">{m.score_nous != null ? <span className={`badge ${m.score_nous > m.score_adv ? 'vert' : m.score_nous < m.score_adv ? 'rouge' : ''}`}>{m.score_nous} - {m.score_adv}</span> : '-'}</td></tr>
          ))}
        </tbody></table>
      </div>
      <p className="muet petit" style={{ textAlign: 'center' }}>Propulsé par Rugby Analyse</p>
    </div>
  );
}
