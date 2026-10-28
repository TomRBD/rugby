// Lecture d'une playlist partagée par lien signé, sans compte : filigrane, accusé de lecture, commentaires, questionnaire.
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useDonnees } from '../lib/hooks';
import { Chargement, useAction } from '../composants/ui';
import { LecteurClips } from '../composants/LecteurClips';
import { clipsDePlaylist } from './Playlist';

export default function PartagePublic() {
  const { jeton } = useParams();
  const action = useAction();
  const p = useDonnees<any>(`/api/public/partages/${jeton}`);
  const commentaires = useDonnees<any[]>(p.donnees ? `/api/public/partages/${jeton}/commentaires` : null, [p.donnees]);
  const [vus, setVus] = useState<Set<string>>(new Set());
  const [texte, setTexte] = useState('');
  const [reponses, setReponses] = useState<Record<string, any>>({});
  const [repondu, setRepondu] = useState(false);
  useEffect(() => {
    if (p.donnees?.club?.couleurs?.primaire) document.documentElement.style.setProperty('--primaire', p.donnees.club.couleurs.primaire);
  }, [p.donnees]);

  if (p.erreur) return <div className="page-centree"><div className="carte"><h1>Lien indisponible</h1><p>{p.erreur}</p><p className="muet">Demandez un nouveau lien à votre entraîneur.</p></div></div>;
  if (!p.donnees) return <div className="page-centree"><Chargement /></div>;
  const { club, playlist, destinataire, expireLe } = p.donnees;
  const { clips, sources } = clipsDePlaylist(playlist);

  return (
    <div className="mobile pile">
      <div className="ligne">
        {club.logo_url && <img src={club.logo_url} alt="" width={40} height={40} style={{ objectFit: 'contain' }} />}
        <div><h1 style={{ margin: 0 }}>{playlist.titre}</h1><span className="muet petit">{club.nom} · pour {destinataire} · disponible jusqu'au {new Date(expireLe).toLocaleDateString('fr-FR')}</span></div>
      </div>
      {playlist.consignes && <div className="alerte">{playlist.consignes}</div>}
      <LecteurClips clips={clips.map((c) => ({ ...c, vu: vus.has(c.id) }))} sources={sources} filigrane={destinataire} qualiteMax={720}
        onClipVu={(c, s) => { setVus((v) => new Set(v).add(c.id)); void api(`/api/public/partages/${jeton}/lectures`, { corps: { clip_id: c.id, secondes: s } }).catch(() => undefined); }} />
      <p className="muet petit">{vus.size}/{clips.length} clip(s) vus. Lecture en streaming adapté à votre connexion, sans téléchargement.</p>

      {playlist.questions?.length > 0 && !repondu && (
        <div className="carte pile">
          <h2 style={{ margin: 0 }}>Questionnaire</h2>
          {playlist.questions.map((q: any) => (
            <label key={q.question} className="champ"><span>{q.question}</span>
              {q.type === 'note' ? (
                <select value={reponses[q.question] ?? ''} onChange={(e) => setReponses({ ...reponses, [q.question]: Number(e.target.value) })}><option value="">-</option>{[1, 2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</select>
              ) : q.type === 'oui_non' ? (
                <select value={reponses[q.question] === undefined ? '' : String(reponses[q.question])} onChange={(e) => setReponses({ ...reponses, [q.question]: e.target.value === 'true' })}><option value="">-</option><option value="true">Oui</option><option value="false">Non</option></select>
              ) : <textarea rows={2} value={reponses[q.question] ?? ''} onChange={(e) => setReponses({ ...reponses, [q.question]: e.target.value })} />}
            </label>
          ))}
          <button className="bouton primaire" onClick={() => action(() => api(`/api/public/partages/${jeton}/reponses`, { corps: { reponses: Object.entries(reponses).map(([question, reponse]) => ({ question, reponse })) } }), 'Réponses envoyées').then((r) => r && setRepondu(true))}>Envoyer mes réponses</button>
        </div>
      )}

      <div className="carte pile">
        <h2 style={{ margin: 0 }}>Commentaires</h2>
        {commentaires.donnees?.map((c) => <div key={c.id} className="petit"><strong>{c.auteur}</strong> <span className="muet">{new Date(c.le).toLocaleString('fr-FR')}</span><br />{c.texte}</div>)}
        <div className="ligne">
          <input className="saisie" style={{ flex: 1 }} value={texte} onChange={(e) => setTexte(e.target.value)} placeholder="Une question pour le staff ?" aria-label="Commentaire" />
          <button className="bouton" disabled={!texte} onClick={() => action(() => api(`/api/public/partages/${jeton}/commentaires`, { corps: { texte } })).then(() => { setTexte(''); void commentaires.recharger(); })}>Envoyer</button>
        </div>
        <p className="muet petit">Vos commentaires sont visibles par l'ensemble du staff de l'équipe.</p>
      </div>
    </div>
  );
}
