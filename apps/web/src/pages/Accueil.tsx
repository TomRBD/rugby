// Tableau de bord : bilan par équipe, prochains matchs, matchs à coder, quotas.
import { Link } from 'react-router-dom';
import { OFFRES } from '@rugby/shared';
import { useClubApi, useSession } from '../lib/session';
import { useDonnees } from '../lib/hooks';
import { dateCourte, dateHeure, valeurIndicateur } from '../lib/format';
import { t } from '../lib/i18n';
import { Chargement, Erreur, Kpi, Vide } from '../composants/ui';

export default function Accueil() {
  const { club, peut } = useSession();
  const url = useClubApi();
  const tdb = useDonnees<any[]>(peut('stats.lire') ? url('/tableau-de-bord') : null);
  const matchs = useDonnees<any[]>(url('/matchs'));
  if (!club) return <Chargement />;
  const offre = OFFRES[club.offre];
  const aCoder = (matchs.donnees ?? []).filter((m) => new Date(m.date) < new Date() && m.statut !== 'valide' && m.type !== 'observation').slice(0, 5);

  return (
    <div className="pile">
      <div className="entete-page">
        <div><h1>{club.nom}</h1><span className="muet">Offre {offre.nom}{club.cycle_facturation === 'annuel' ? ', paiement annuel' : ''}</span></div>
        {peut('match.ecrire') && <Link className="bouton primaire" to="/matchs?nouveau=1">{t('nouveauMatch')}</Link>}
      </div>

      <div className="grille">
        <Kpi libelle="Équipes" valeur={club.usage.equipes} detail={offre.maxEquipes ? `sur ${offre.maxEquipes} incluses` : 'illimitées'} />
        <Kpi libelle="Matchs" valeur={club.usage.matchs} detail={offre.maxMatchs ? `sur ${offre.maxMatchs} inclus` : 'illimités'} />
        <Kpi libelle="Vidéo stockée" valeur={`${Math.round(Number(club.usage.heures_video) * 10) / 10} h`} detail={offre.heuresVideo ? `sur ${offre.heuresVideo} h` : 'sur devis'} />
      </div>

      {aCoder.length > 0 && (
        <div className="carte">
          <h2>Matchs à coder</h2>
          <div className="tableau-conteneur"><table className="tableau"><tbody>
            {aCoder.map((m) => (
              <tr key={m.id}>
                <td>{dateCourte(m.date)}</td><td>{m.equipe_nom}</td><td>{m.adversaire_nom ?? 'Adversaire'}</td>
                <td><span className="badge">{m.nb_evenements} événements</span></td>
                <td>{m.statut_video === 'pret' ? <Link className="bouton petit primaire" to={`/matchs/${m.id}/codage`}>Coder</Link> : <Link className="bouton petit" to={`/matchs/${m.id}/video`}>Ajouter la vidéo</Link>}</td>
              </tr>
            ))}
          </tbody></table></div>
        </div>
      )}

      <Erreur message={tdb.erreur} />
      {tdb.chargement && <Chargement />}
      {tdb.donnees?.length === 0 && <Vide>Créez une équipe dans <Link to="/equipes">Équipes et saisons</Link> pour commencer, ou suivez le <Link to="/tutoriel">tutoriel</Link>.</Vide>}
      <div className="grille">
        {tdb.donnees?.map((e) => (
          <div key={e.equipe.id} className="carte pile">
            <div className="ligne entre"><h2 style={{ margin: 0 }}>{e.equipe.nom}</h2><Link to={`/saison/${e.equipe.id}`} className="bouton petit">Saison</Link></div>
            <div className="ligne">
              <span className="badge vert">{e.bilan.victoires} V</span>
              <span className="badge">{e.bilan.nuls} N</span>
              <span className="badge rouge">{e.bilan.defaites} D</span>
              <span className="muet petit">{e.bilan.pointsPour} pts marqués, {e.bilan.pointsContre} encaissés</span>
            </div>
            <table className="tableau"><tbody>
              {e.indicateurs.map((i: any) => (
                <tr key={i.key}><td>{i.label}</td><td className="num">{valeurIndicateur(i.moyenneNous, i.format)}</td></tr>
              ))}
            </tbody></table>
            {e.prochains.length > 0 && (
              <div className="petit">
                <strong>Prochains matchs</strong>
                {e.prochains.map((p: any) => <div key={p.id}><Link to={`/matchs/${p.id}`}>{dateHeure(p.date)} {p.domicile ? 'contre' : 'à'} {p.adversaire ?? 'adversaire à définir'}</Link></div>)}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
