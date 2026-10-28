// Avancement d'un match : checklist des étapes (feuille, vidéo, coups d'envoi, codage, partage)
// et détail du traitement vidéo en cours (étape, pourcentage, temps restant, worker actif).
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useClubApi, useSession } from '../lib/session';
import { api } from '../lib/api';
import { useAction } from './ui';
import { useDonnees } from '../lib/hooks';
import { etatTeleversements, type EtatTeleversement } from '../lib/televersement';

type Etat = 'fait' | 'en_cours' | 'a_faire' | 'erreur';

const ETAPES_VIDEO: { cle: string; label: string }[] = [
  { cle: 'envoi', label: 'Envoi du fichier' },
  { cle: 'file', label: 'En file d\'attente' },
  { cle: 'analyse', label: 'Lecture du fichier' },
  { cle: 'conversion', label: 'Conversion 1080p, 720p, 480p' },
  { cle: 'vignettes', label: 'Vignettes de la timeline' },
  { cle: 'publication', label: 'Mise en ligne' },
  { cle: 'ia', label: 'Détection coups d\'envoi et temps morts' },
];

const duree = (s: number) => (s < 90 ? 'moins de 2 min' : s < 3600 ? `environ ${Math.round(s / 60)} min` : `environ ${Math.floor(s / 3600)} h ${String(Math.round((s % 3600) / 60)).padStart(2, '0')}`);
const taille = (o: number) => (o > 1e9 ? `${(o / 1e9).toFixed(1).replace('.', ',')} Go` : `${Math.round(o / 1e6)} Mo`);

function Pastille({ etat }: { etat: Etat }) {
  const s: Record<Etat, [string, string]> = { fait: ['✓', 'var(--succes)'], en_cours: ['…', 'var(--nous)'], a_faire: ['', 'var(--bord)'], erreur: ['!', 'var(--danger)'] };
  return (
    <span aria-hidden style={{ width: 24, height: 24, borderRadius: '50%', display: 'inline-grid', placeItems: 'center', flex: 'none', fontWeight: 800,
      background: etat === 'a_faire' ? 'transparent' : s[etat][1], border: `2px solid ${s[etat][1]}`, color: '#fff' }}>{s[etat][0]}</span>
  );
}

/** Étapes d'une vidéo, déduites de son statut, de l'envoi en cours et des jobs. */
function etapesVideo(v: any, envoiLocal: EtatTeleversement | undefined): { cle: string; label: string; etat: Etat; detail?: string }[] {
  const ordre = ETAPES_VIDEO.map((e) => e.cle);
  const jobIa = v.jobs.find((j: any) => j.type === 'analyse_ia');
  let courante: string;
  if (v.statut === 'televersement') courante = 'envoi';
  else if (v.statut === 'en_attente') courante = 'file';
  else if (v.statut === 'transcodage') courante = v.etape === 'assemblage' ? 'analyse' : v.etape ?? 'analyse';
  else if (v.statut === 'pret' && jobIa && ['en_attente', 'en_cours'].includes(jobIa.statut)) courante = 'ia';
  // En erreur : l'étape qui a échoué est la dernière enregistrée par le worker
  else if (v.statut === 'erreur') courante = v.etape === 'assemblage' ? 'analyse' : v.etape && ordre.includes(v.etape) ? v.etape : 'analyse';
  else courante = 'fin';
  const idx = courante === 'fin' ? ordre.length : ordre.indexOf(courante);
  return ETAPES_VIDEO.map((e, i) => {
    let etat: Etat = i < idx ? 'fait' : i === idx ? 'en_cours' : 'a_faire';
    if (v.statut === 'erreur' && i === idx) etat = 'erreur';
    let detail: string | undefined;
    if (e.cle === 'envoi' && etat === 'en_cours') {
      const recu = envoiLocal ? envoiLocal.progression : v.envoi ? v.envoi.recu / v.envoi.taille : 0;
      detail = `${Math.round(recu * 100)} %${v.envoi ? ` de ${taille(v.envoi.taille)}` : ''}${envoiLocal?.statut === 'pause' ? ' (en pause, reprise automatique)' : !envoiLocal ? ' (envoi lancé depuis un autre onglet ou interrompu)' : ''}`;
    }
    if (e.cle === 'file' && etat === 'en_cours') {
      const j = v.jobs.find((x: any) => x.type === 'transcodage' && x.statut === 'en_attente');
      detail = j?.devant ? `${j.devant} traitement(s) avant celui-ci` : 'démarre dans quelques secondes';
    }
    if (e.cle === 'analyse' && etat === 'en_cours') detail = v.etape === 'assemblage' ? 'assemblage des fichiers découpés' : undefined;
    if (e.cle === 'conversion' && etat === 'en_cours') {
      detail = `${Math.round(Math.min(1, v.progression / 0.9) * 100)} %${v.resteSecondes != null ? `, reste ${duree(v.resteSecondes)}` : ', estimation du temps restant en cours'}`;
    }
    if (e.cle === 'ia' && jobIa?.statut === 'echec') { etat = 'erreur'; detail = 'détection impossible (le codage reste possible)'; }
    if (e.cle === 'ia' && !jobIa && i >= idx) detail = 'facultatif';
    return { ...e, etat, detail };
  });
}

export function Avancement({ matchId, onVideoPrete }: { matchId: string; onVideoPrete?: () => void }) {
  const url = useClubApi();
  const action = useAction();
  const { peut } = useSession();
  const a = useDonnees<any>(url(`/matchs/${matchId}/avancement`));
  const [envois, setEnvois] = useState<EtatTeleversement[]>([]);
  const [ouvert, setOuvert] = useState(true);
  const statutsPrecedents = useRef<string>('');
  useEffect(() => etatTeleversements(setEnvois), []);

  const envoisMatch = envois.filter((x) => x.matchId === matchId);
  const enTraitement = envoisMatch.some((x) => x.statut !== 'termine')
    || !!a.donnees?.videos.some((v: any) => ['televersement', 'en_attente', 'transcodage'].includes(v.statut))
    || !!a.donnees?.jobs.some((j: any) => ['en_attente', 'en_cours'].includes(j.statut));
  // Un envoi qui démarre ou se termine dans cet onglet : mise à jour immédiate
  const signatureEnvois = envoisMatch.map((x) => `${x.videoId}:${x.statut}`).join();
  useEffect(() => { if (signatureEnvois) void a.recharger(); }, [signatureEnvois]); // eslint-disable-line react-hooks/exhaustive-deps
  // Rafraîchissement toutes les 3 s pendant un traitement, sinon toutes les 30 s
  useEffect(() => {
    const t = setInterval(() => void a.recharger(), enTraitement ? 3000 : 30000);
    return () => clearInterval(t);
  }, [enTraitement, a]);
  useEffect(() => {
    const s = (a.donnees?.videos ?? []).map((v: any) => v.statut).join();
    if (statutsPrecedents.current && statutsPrecedents.current !== s && s.includes('pret')) onVideoPrete?.();
    statutsPrecedents.current = s;
  }, [a.donnees, onVideoPrete]);

  if (!a.donnees) return null;
  const { videos, checklist: c, worker } = a.donnees;
  const vPrete = videos.some((v: any) => v.statut === 'pret');
  const vEnCours = videos.find((v: any) => ['televersement', 'en_attente', 'transcodage', 'erreur'].includes(v.statut));
  const attenteSansWorker = !worker.actif && videos.some((v: any) => ['en_attente', 'transcodage'].includes(v.statut));

  const etapes: { label: string; etat: Etat; detail: string; lien?: string; action?: string }[] = [
    { label: 'Feuille de match', etat: c.feuille ? 'fait' : 'a_faire', detail: c.feuille ? `${c.feuille} joueurs` : 'facultative, utile pour le temps de jeu et les stats par joueur', lien: `/matchs/${matchId}`, action: 'Remplir' },
    { label: 'Vidéo', etat: vPrete ? 'fait' : videos.some((v: any) => v.statut === 'erreur') ? 'erreur' : vEnCours ? 'en_cours' : 'a_faire', detail: vPrete ? 'prête à coder' : videos.some((v: any) => v.statut === 'erreur') ? 'traitement en échec (détail ci-dessous)' : vEnCours ? 'traitement en cours (détail ci-dessous)' : 'à envoyer', lien: videos.length ? undefined : `/matchs/${matchId}/video`, action: 'Envoyer' },
    { label: 'Coups d\'envoi placés', etat: c.coupsEnvoi === 2 ? 'fait' : c.coupsEnvoi === 1 || c.propositions ? 'en_cours' : 'a_faire', detail: c.coupsEnvoi === 2 ? 'horloge du match synchronisée' : `${c.coupsEnvoi}/2${c.propositions ? `, ${c.propositions} proposition(s) de l'IA à valider` : ''}`, lien: vPrete ? `/matchs/${matchId}/codage` : undefined, action: 'Placer' },
    { label: 'Codage', etat: ['code', 'valide'].includes(c.statut) ? 'fait' : c.evenements ? 'en_cours' : 'a_faire', detail: c.evenements ? `${c.evenements} actions codées${c.aCompleter ? `, ${c.aCompleter} à compléter` : ''}` : 'aucune action codée', lien: vPrete ? `/matchs/${matchId}/codage` : undefined, action: c.evenements ? 'Continuer' : 'Coder' },
    { label: 'Statistiques', etat: c.evenements ? 'fait' : 'a_faire', detail: c.evenements ? 'calculées à chaque action codée' : 'apparaissent dès la première action codée', lien: c.evenements ? `/matchs/${matchId}/stats` : undefined, action: 'Voir' },
    { label: 'Playlists et partage', etat: c.playlists ? 'fait' : 'a_faire', detail: c.playlists ? `${c.playlists} playlist(s)` : 'après le codage', lien: c.evenements ? `/matchs/${matchId}/playlists` : undefined, action: 'Créer' },
  ];
  const faites = etapes.filter((e) => e.etat === 'fait').length;

  return (
    <div className="carte pile" aria-live="polite">
      <button className="ligne entre" style={{ background: 'none', border: 0, padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', width: '100%' }} onClick={() => setOuvert(!ouvert)} aria-expanded={ouvert}>
        <strong>Avancement du match : {faites}/{etapes.length} étapes</strong>
        <span className="ligne petit muet">{enTraitement && <span className="badge bleu">Traitement en cours</span>}{ouvert ? 'Masquer' : 'Afficher'}</span>
      </button>
      <div className="barre-progression"><div style={{ width: `${(faites / etapes.length) * 100}%` }} /></div>
      {ouvert && (
        <>
          <div className="grille" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
            {etapes.map((e, i) => (
              <div key={e.label} className="ligne" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                <Pastille etat={e.etat} />
                <div>
                  <div><strong>{i + 1}. {e.label}</strong> {e.lien && (e.etat === 'a_faire' || e.etat === 'erreur' || e.label === 'Codage') && <Link to={e.lien} className="petit">{e.action}</Link>}</div>
                  <div className="muet petit">{e.detail}</div>
                </div>
              </div>
            ))}
          </div>

          {worker.ffmpegErreur && (
            <div className="alerte erreur">
              <strong>FFmpeg n'est pas disponible pour le worker</strong> : les vidéos attendent en file sans être abîmées. {worker.ffmpegErreur}
            </div>
          )}
          {attenteSansWorker && (
            <div className="alerte erreur">
              <strong>Aucun worker vidéo ne tourne</strong> : la vidéo restera en attente. Lancez dans un terminal <code>npm run dev:worker</code> (FFmpeg doit être installé).
            </div>
          )}

          {videos.filter((v: any) => v.statut !== 'pret' || v.jobs.some((j: any) => j.type === 'analyse_ia' && ['en_attente', 'en_cours'].includes(j.statut))).map((v: any) => (
            <div key={v.id} className="carte" style={{ background: 'var(--surface-2)' }}>
              <div className="ligne entre petit"><strong>Vidéo {v.angle}{v.duree ? ` (${Math.round(v.duree / 60)} min)` : ''}</strong>
                {worker.actif && <span className="muet">{worker.nombre} worker(s) actif(s), {worker.traitementsEnCours}/{worker.places} traitement(s) en cours</span>}</div>
              <ol style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', display: 'grid', gap: 6 }}>
                {etapesVideo(v, envois.find((x) => x.videoId === v.id)).map((e) => (
                  <li key={e.cle} className="ligne" style={{ flexWrap: 'nowrap' }}>
                    <Pastille etat={e.etat} />
                    <span style={{ fontWeight: e.etat === 'en_cours' ? 700 : 400, opacity: e.etat === 'a_faire' ? 0.6 : 1 }}>{e.label}</span>
                    {e.detail && <span className="muet petit">{e.detail}</span>}
                  </li>
                ))}
              </ol>
              {v.statut === 'transcodage' && v.etape === 'conversion' && <div className="barre-progression" style={{ marginTop: 8 }}><div style={{ width: `${Math.min(100, (v.progression / 0.9) * 100)}%` }} /></div>}
              {v.erreur && (
                <div className="alerte erreur pile" style={{ marginTop: 8 }}>
                  <span>{v.erreur.includes('introuvable') ? v.erreur : `Le traitement a échoué : ${v.erreur}`}</span>
                  {v.statut === 'erreur' && peut('video.ecrire') && (
                    <div><button className="bouton primaire petit" onClick={() => action(() => api(url(`/videos/${v.id}/relancer`), { corps: {} }), 'Traitement relancé').then(() => a.recharger())}>
                      Relancer le traitement
                    </button> <span className="muet petit">La vidéo déjà envoyée est réutilisée, inutile de la renvoyer.</span></div>
                  )}
                </div>
              )}
              {v.statut === 'transcodage' && <p className="muet petit" style={{ margin: '8px 0 0' }}>Vous pouvez fermer cette page : le traitement continue sur le serveur.</p>}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
