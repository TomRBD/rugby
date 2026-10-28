// Montage d'une playlist : ordre, bornes, notes, télestration, voix off, validation, partage, export MP4.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import { formatTimecode } from '@rugby/shared';
import { api } from '../lib/api';
import { useClubApi, useSession } from '../lib/session';
import { useDonnees } from '../lib/hooks';
import { Champ, Chargement, Erreur, Modale, useAction } from '../composants/ui';
import { LecteurVideo, type ApiLecteur, type SourceVideo } from '../composants/LecteurVideo';
import { LecteurClips, type Clip } from '../composants/LecteurClips';
import { captureImage, EditeurTelestration } from '../composants/Telestration';

export function clipsDePlaylist(p: any): { clips: Clip[]; sources: Record<string, SourceVideo[]>; filigrane: string | null } {
  const sources: Record<string, SourceVideo[]> = {};
  let filigrane: string | null = null;
  for (const [vid, s] of Object.entries<any>(p.sources ?? {})) if (s.pret) { sources[vid] = [s]; filigrane ??= s.filigrane ?? null; }
  const clips: Clip[] = p.clips.map((c: any) => ({
    id: c.id, debut: c.debut, fin: c.fin, videoId: c.video_id, titre: c.titre ?? 'Clip', sousTitre: c.note ?? undefined,
    dessin: c.dessin, voixOffUrl: c.voixOffUrl,
  }));
  return { clips, sources, filigrane };
}

function Partage({ playlist, onFermer }: { playlist: any; onFermer: () => void }) {
  const url = useClubApi();
  const action = useAction();
  const joueurs = useDonnees<any[]>(playlist.equipe_id ? url(`/equipes/${playlist.equipe_id}/joueurs`) : url('/joueurs'));
  const [f, setF] = useState({ destinataire: 'joueur', joueurs: [] as string[], libelle: '', joursValidite: 14, telechargement: false });
  const [liens, setLiens] = useState<any[] | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const partager = async () => {
    const r = await action(() => api(url(`/playlists/${playlist.id}/partages`), { corps: f }), 'Partage créé, les joueurs sont notifiés');
    if (r) {
      setLiens(r.liens);
      if (r.liens.length === 1) setQr(await QRCode.toDataURL(r.liens[0].lien, { width: 220, margin: 1 }));
    }
  };
  return (
    <Modale titre="Partager la playlist" onFermer={onFermer} etroite>
      {!liens ? (
        <div className="pile">
          <Champ label="Destinataires">
            <select value={f.destinataire} onChange={(e) => setF({ ...f, destinataire: e.target.value })}>
              <option value="joueur">Un joueur</option><option value="groupe">Un groupe de joueurs</option>
              <option value="equipe" disabled={!playlist.equipe_id}>Toute l'équipe</option><option value="lien">Lien générique</option>
            </select>
          </Champ>
          {(f.destinataire === 'joueur' || f.destinataire === 'groupe') && (
            <Champ label="Joueurs">
              <select multiple={f.destinataire === 'groupe'} value={f.destinataire === 'groupe' ? f.joueurs : f.joueurs[0] ?? ''} style={{ minHeight: f.destinataire === 'groupe' ? 140 : undefined }}
                onChange={(e) => setF({ ...f, joueurs: [...e.target.selectedOptions].map((o) => o.value) })}>
                {f.destinataire === 'joueur' && <option value="">Choisir…</option>}
                {joueurs.donnees?.map((j) => <option key={j.id} value={j.id}>{j.prenom} {j.nom}</option>)}
              </select>
            </Champ>
          )}
          {f.destinataire === 'lien' && <Champ label="Libellé (affiché en filigrane)"><input value={f.libelle} onChange={(e) => setF({ ...f, libelle: e.target.value })} placeholder="Avants, staff…" /></Champ>}
          <Champ label="Validité (jours)"><input type="number" min={1} max={90} value={f.joursValidite} onChange={(e) => setF({ ...f, joursValidite: Number(e.target.value) })} /></Champ>
          <label className="ligne"><input type="checkbox" checked={f.telechargement} onChange={(e) => setF({ ...f, telechargement: e.target.checked })} /> Autoriser le téléchargement</label>
          <p className="muet petit">Lien signé et expirable, révocable à tout moment. Le nom du destinataire est incrusté en filigrane sur la vidéo.</p>
          <button className="bouton primaire" onClick={partager}>Partager</button>
        </div>
      ) : (
        <div className="pile">
          {qr && <img src={qr} alt="QR code du lien" style={{ width: 220, justifySelf: 'center' }} />}
          {liens.map((l) => (
            <div key={l.lien} className="ligne">
              <span style={{ flex: 1 }}><strong>{l.libelle}</strong><br /><span className="petit muet" style={{ wordBreak: 'break-all' }}>{l.lien}</span></span>
              <button className="bouton petit" onClick={() => navigator.clipboard.writeText(l.lien)}>Copier</button>
            </div>
          ))}
        </div>
      )}
    </Modale>
  );
}

function VoixOff({ clipId, onFini }: { clipId: string; onFini: () => void }) {
  const url = useClubApi();
  const action = useAction();
  const [enreg, setEnreg] = useState<MediaRecorder | null>(null);
  const demarrer = async () => {
    const flux = await navigator.mediaDevices.getUserMedia({ audio: true });
    const r = new MediaRecorder(flux);
    const morceaux: Blob[] = [];
    r.ondataavailable = (e) => morceaux.push(e.data);
    r.onstop = async () => {
      flux.getTracks().forEach((t) => t.stop());
      await action(() => api(url(`/clips/${clipId}/voix-off`), { methode: 'PUT', brut: new Blob(morceaux, { type: 'audio/webm' }) }), 'Voix off enregistrée');
      onFini();
    };
    r.start();
    setEnreg(r);
  };
  return enreg ? <button className="bouton petit primaire" onClick={() => { enreg.stop(); setEnreg(null); }}>Arrêter l'enregistrement</button>
    : <button className="bouton petit" onClick={() => void demarrer().catch((e) => alert(e.message))}>Voix off</button>;
}

export default function Playlist() {
  const { id } = useParams();
  const url = useClubApi();
  const nav = useNavigate();
  const action = useAction();
  const { peut } = useSession();
  const p = useDonnees<any>(url(`/playlists/${id}`));
  const suivi = useDonnees<any>(url(`/playlists/${id}/suivi`));
  const [partage, setPartage] = useState(false);
  const [mode, setMode] = useState<'lecture' | 'montage'>('lecture');
  const [dessin, setDessin] = useState<{ clip: any; image: string; temps: number } | null>(null);
  const [exportEnCours, setExportEnCours] = useState<any | null>(null);
  const [commentaire, setCommentaire] = useState('');
  const lecteurMontage = useRef<ApiLecteur>(null);
  const [clipMontage, setClipMontage] = useState<any | null>(null);
  const donnees = useMemo(() => (p.donnees ? clipsDePlaylist(p.donnees) : null), [p.donnees]);

  useEffect(() => {
    if (!exportEnCours || exportEnCours.statut === 'termine' || exportEnCours.statut === 'echec') return;
    const t = setInterval(async () => setExportEnCours(await api(url(`/exports/${exportEnCours.id}`))), 3000);
    return () => clearInterval(t);
  }, [exportEnCours, url]);

  if (p.erreur) return <Erreur message={p.erreur} />;
  if (!p.donnees || !donnees) return <Chargement />;
  const pl = p.donnees;
  const maj = (corps: any, msg?: string) => action(() => api(url(`/playlists/${id}`), { methode: 'PATCH', corps }), msg).then((r) => r && p.setDonnees(r));
  const deplacer = (i: number, d: number) => {
    const ordre = pl.clips.map((c: any) => c.id);
    const [x] = ordre.splice(i, 1);
    ordre.splice(i + d, 0, x);
    void maj({ ordre });
  };
  const majClip = (cid: string, corps: any) => action(() => api(url(`/clips/${cid}`), { methode: 'PATCH', corps })).then(() => p.recharger());

  return (
    <div className="pile">
      <div className="entete-page">
        <div>
          <input className="saisie" style={{ fontSize: '1.4rem', fontWeight: 700, border: 0, background: 'transparent', padding: 0 }} defaultValue={pl.titre}
            onBlur={(e) => e.target.value !== pl.titre && maj({ titre: e.target.value })} aria-label="Titre de la playlist" />
          <div className="ligne petit">
            <span className="badge">{pl.clips.length} clip(s)</span>
            {pl.validee ? <span className="badge vert">Validée par l'entraîneur</span> : <span className="badge orange">À valider avant partage</span>}
          </div>
        </div>
        <div className="ligne">
          <div className="camp-bascule">
            <button className={mode === 'lecture' ? 'actif nous' : ''} onClick={() => setMode('lecture')}>Lecture</button>
            <button className={mode === 'montage' ? 'actif nous' : ''} onClick={() => setMode('montage')}>Montage</button>
          </div>
          {peut('partage.valider', pl.equipe_id) && <button className="bouton" onClick={() => maj({ validee: !pl.validee }, pl.validee ? 'Validation retirée' : 'Playlist validée')}>{pl.validee ? 'Retirer la validation' : 'Valider'}</button>}
          <button className="bouton primaire" onClick={() => setPartage(true)}>Partager</button>
          {peut('export') && (
            <select className="saisie" style={{ width: 'auto' }} value="" onChange={async (e) => {
              const [format, fil] = e.target.value.split('|');
              if (!format) return;
              const r = await action(() => api(url(`/playlists/${id}/export`), { corps: { format, filigrane: fil || undefined } }), 'Export lancé');
              if (r) setExportEnCours(r);
            }} aria-label="Exporter en MP4">
              <option value="">Exporter en MP4…</option><option value="16:9|">16:9 (YouTube, écran)</option><option value="9:16|">9:16 (réseaux sociaux)</option>
            </select>
          )}
          <button className="bouton danger" onClick={() => confirm('Supprimer cette playlist ?') && action(() => api(url(`/playlists/${id}`), { methode: 'DELETE' })).then(() => nav('/playlists'))}>Supprimer</button>
        </div>
      </div>

      {exportEnCours && (
        <div className={`alerte ${exportEnCours.statut === 'termine' ? 'ok' : exportEnCours.statut === 'echec' ? 'erreur' : ''}`}>
          Export {exportEnCours.format} : {exportEnCours.statut === 'termine' ? <a href={exportEnCours.url}>télécharger le MP4</a> : exportEnCours.statut === 'echec' ? exportEnCours.erreur : 'en cours de fabrication…'}
        </div>
      )}

      {mode === 'lecture' ? (
        <div className="carte"><LecteurClips clips={donnees.clips} sources={donnees.sources} /></div>
      ) : (
        <div className="grille-2">
          <div className="carte pile">
            {clipMontage ? (
              <>
                <h3 style={{ margin: 0 }}>{clipMontage.titre}</h3>
                {dessin ? (
                  <EditeurTelestration image={dessin.image} initial={dessin.clip.dessin?.formes}
                    onAnnuler={() => setDessin(null)}
                    onEnregistrer={(formes) => { void majClip(dessin.clip.id, { dessin: formes.length ? { temps: dessin.temps, formes, duree: 4 } : null }); setDessin(null); }} />
                ) : (
                  <>
                    <LecteurVideo ref={lecteurMontage} sources={donnees.sources[clipMontage.video_id] ?? []} dessin={null} />
                    <div className="ligne">
                      <button className="bouton petit" onClick={() => majClip(clipMontage.id, { debut: lecteurMontage.current!.temps() })}>Début ici</button>
                      <button className="bouton petit" onClick={() => majClip(clipMontage.id, { fin: lecteurMontage.current!.temps() })}>Fin ici</button>
                      <button className="bouton petit" onClick={() => {
                        const v = lecteurMontage.current?.video();
                        if (v) { v.pause(); setDessin({ clip: clipMontage, image: captureImage(v), temps: lecteurMontage.current!.temps() }); }
                      }}>Dessiner sur l'image</button>
                      <VoixOff clipId={clipMontage.id} onFini={() => p.recharger()} />
                      <button className="bouton petit" onClick={() => {
                        const t = lecteurMontage.current!.temps();
                        void maj({ ajouterClip: { video_id: clipMontage.video_id, debut: Math.max(0, t - 5), fin: t + 5, titre: 'Séquence ajoutée' } }, 'Clip ajouté');
                      }}>Nouveau clip ici</button>
                    </div>
                  </>
                )}
              </>
            ) : <p className="muet">Choisissez un clip à droite pour ajuster ses bornes, dessiner ou enregistrer une voix off.</p>}
          </div>
          <div className="carte pile">
            <Champ label="Consignes aux joueurs">
              <textarea rows={2} defaultValue={pl.consignes ?? ''} onBlur={(e) => e.target.value !== (pl.consignes ?? '') && maj({ consignes: e.target.value || null }, 'Consignes enregistrées')} />
            </Champ>
            <div className="liste-ev" style={{ maxHeight: 420 }}>
              {pl.clips.map((c: any, i: number) => (
                <div key={c.id} className={`ev-ligne ${clipMontage?.id === c.id ? 'selection' : ''}`} style={{ gridTemplateColumns: '28px 1fr auto' }}
                  onClick={() => { setClipMontage(c); setTimeout(() => lecteurMontage.current?.aller(c.debut), 100); }}>
                  <span className="badge">{i + 1}</span>
                  <span>
                    <input className="saisie" style={{ minHeight: 28, padding: '2px 6px' }} defaultValue={c.titre ?? ''} onClick={(e) => e.stopPropagation()} onBlur={(e) => e.target.value !== c.titre && majClip(c.id, { titre: e.target.value })} aria-label="Titre du clip" />
                    <span className="petit muet">{formatTimecode(c.debut)} à {formatTimecode(c.fin)} {c.dessin && '· dessin'} {c.voix_off_cle && '· voix off'}</span>
                  </span>
                  <span className="ligne" style={{ gap: 2 }} onClick={(e) => e.stopPropagation()}>
                    <button className="bouton petit discret" disabled={i === 0} onClick={() => deplacer(i, -1)} aria-label="Monter">↑</button>
                    <button className="bouton petit discret" disabled={i === pl.clips.length - 1} onClick={() => deplacer(i, 1)} aria-label="Descendre">↓</button>
                    <button className="bouton petit discret" onClick={() => action(() => api(url(`/clips/${c.id}`), { methode: 'DELETE' })).then(() => p.recharger())} aria-label="Retirer">✕</button>
                  </span>
                </div>
              ))}
            </div>
            <QuestionsPlaylist questions={pl.questions} onEnregistrer={(questions) => maj({ questions }, 'Questionnaire enregistré')} />
          </div>
        </div>
      )}

      {suivi.donnees && (
        <div className="grille-2">
          <div className="carte">
            <h2>Suivi de visionnage</h2>
            <table className="tableau">
              <thead><tr><th>Destinataire</th><th>Ouvert le</th><th className="num">Clips vus</th><th className="num">Temps</th><th></th></tr></thead>
              <tbody>
                {suivi.donnees.partages.map((s: any) => (
                  <tr key={s.id}>
                    <td>{s.libelle} {s.revoque_le && <span className="badge rouge">Révoqué</span>}</td>
                    <td>{s.premiere_lecture ? new Date(s.premiere_lecture).toLocaleString('fr-FR') : <span className="muet">Pas encore</span>}</td>
                    <td className="num">{s.clips_vus}/{pl.clips.length}</td>
                    <td className="num">{Math.round(s.secondes_vues / 60)} min</td>
                    <td>{!s.revoque_le && <button className="bouton petit" onClick={() => action(() => api(url(`/partages/${s.id}/revoquer`), { corps: {} }), 'Lien révoqué').then(() => suivi.recharger())}>Révoquer</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {suivi.donnees.reponses.length > 0 && (
              <>
                <h3>Réponses au questionnaire</h3>
                {suivi.donnees.reponses.map((r: any) => (
                  <div key={r.id} className="petit"><strong>{r.libelle}</strong> : {r.reponses.map((x: any) => `${x.question} ${String(x.reponse)}`).join(' · ')}</div>
                ))}
              </>
            )}
          </div>
          <div className="carte pile">
            <h2 style={{ margin: 0 }}>Commentaires</h2>
            {suivi.donnees.commentaires.map((c: any) => <div key={c.id} className="petit"><strong>{c.auteur}</strong> <span className="muet">{new Date(c.le).toLocaleString('fr-FR')}</span><br />{c.texte}</div>)}
            <div className="ligne">
              <input className="saisie" style={{ flex: 1 }} value={commentaire} onChange={(e) => setCommentaire(e.target.value)} placeholder="Votre commentaire (visible des destinataires)" />
              <button className="bouton" disabled={!commentaire} onClick={() => action(() => api(url(`/playlists/${id}/commentaires`), { corps: { texte: commentaire } })).then(() => { setCommentaire(''); void suivi.recharger(); })}>Envoyer</button>
            </div>
          </div>
        </div>
      )}
      {partage && <Partage playlist={pl} onFermer={() => { setPartage(false); void suivi.recharger(); }} />}
    </div>
  );
}

function QuestionsPlaylist({ questions, onEnregistrer }: { questions: any[]; onEnregistrer: (q: any[]) => void }) {
  const [liste, setListe] = useState<any[]>(questions ?? []);
  return (
    <details>
      <summary><strong>Questionnaire ({liste.length})</strong></summary>
      <div className="pile" style={{ marginTop: 8 }}>
        {liste.map((q, i) => (
          <div key={i} className="ligne">
            <input className="saisie" style={{ flex: 1 }} value={q.question} onChange={(e) => setListe(liste.map((x, j) => (j === i ? { ...x, question: e.target.value } : x)))} aria-label="Question" />
            <select className="saisie" style={{ width: 'auto' }} value={q.type} onChange={(e) => setListe(liste.map((x, j) => (j === i ? { ...x, type: e.target.value } : x)))} aria-label="Type de réponse">
              <option value="texte">Texte</option><option value="note">Note de 1 à 5</option><option value="oui_non">Oui / non</option>
            </select>
            <button className="bouton petit discret" onClick={() => setListe(liste.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
        <div className="ligne">
          <button className="bouton petit" onClick={() => setListe([...liste, { question: '', type: 'texte' }])}>Ajouter une question</button>
          <button className="bouton petit primaire" onClick={() => onEnregistrer(liste.filter((q) => q.question))}>Enregistrer</button>
        </div>
      </div>
    </details>
  );
}
