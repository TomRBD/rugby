// Lecture enchaînée de clips (depuis une stat, une playlist, une recherche) avec dessins et voix off.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { formatTimecode, indexTypes, type DefinitionTypeEvenement } from '@rugby/shared';
import { LecteurVideo, type ApiLecteur, type SourceVideo } from './LecteurVideo';
import type { Forme } from './Telestration';
import { Modale } from './ui';

export interface Clip {
  id: string;
  debut: number;
  fin: number;
  titre: string;
  videoId: string;
  sousTitre?: string;
  dessin?: { temps: number; formes: Forme[]; duree: number } | null;
  voixOffUrl?: string | null;
  vu?: boolean;
}

/** Construit les clips d'une liste d'événements (pré-roll / post-roll du type). */
export function clipsDepuisEvenements(
  ids: string[], evenements: { id: string; typeKey: string; debut: number; fin: number; camp: string; resultat?: string | null }[],
  types: DefinitionTypeEvenement[], videoId: string, prePost: Record<string, { pre: number; post: number }> = {},
): Clip[] {
  const t = indexTypes(types);
  const parId = new Map(evenements.map((e) => [e.id, e]));
  return ids.map((id) => parId.get(id)).filter((e): e is NonNullable<typeof e> => !!e).sort((a, b) => a.debut - b.debut).map((e) => {
    const ty = t.get(e.typeKey);
    const pre = prePost[e.typeKey]?.pre ?? ty?.preRoll ?? 3;
    const post = prePost[e.typeKey]?.post ?? ty?.postRoll ?? 3;
    const res = ty?.resultats.find((r) => r.value === e.resultat)?.label;
    return { id: e.id, debut: Math.max(0, e.debut - pre), fin: e.fin + post, videoId, titre: `${ty?.label ?? e.typeKey}${res ? ` : ${res}` : ''}`, sousTitre: `${e.camp === 'nous' ? 'Nous' : 'Adversaire'} · ${formatTimecode(e.debut)}` };
  });
}

interface Props {
  clips: Clip[];
  sources: Record<string, SourceVideo[]>;
  filigrane?: string | null;
  onClipVu?: (clip: Clip, secondes: number) => void;
  actions?: (clip: Clip) => ReactNode;
  qualiteMax?: number;
  indexInitial?: number;
}

export function LecteurClips({ clips, sources, filigrane, onClipVu, actions, qualiteMax, indexInitial = 0 }: Props) {
  const lecteur = useRef<ApiLecteur>(null);
  const [idx, setIdx] = useState(indexInitial);
  const [auto, setAuto] = useState(true);
  const [dessinActif, setDessinActif] = useState<Forme[] | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const debutLecture = useRef(Date.now());
  const dessinFait = useRef(false);
  const clip = clips[idx];
  const sourcesClip = useMemo(() => (clip ? sources[clip.videoId] ?? [] : []), [clip, sources]);

  const signalerVu = useCallback((c: Clip) => {
    onClipVu?.(c, Math.round((Date.now() - debutLecture.current) / 1000));
  }, [onClipVu]);

  const jouer = useCallback((i: number) => {
    const c = clips[i];
    if (!c) return;
    setIdx(i);
    setDessinActif(null);
    dessinFait.current = false;
    debutLecture.current = Date.now();
    // Laisse le lecteur charger la source si elle change
    setTimeout(() => {
      lecteur.current?.aller(c.debut);
      lecteur.current?.lire();
      audio.current?.pause();
      if (c.voixOffUrl) {
        audio.current = new Audio(c.voixOffUrl);
        void audio.current.play().catch(() => undefined);
      }
    }, 50);
  }, [clips]);

  useEffect(() => { jouer(indexInitial); return () => audio.current?.pause(); }, [jouer, indexInitial]);

  const surTemps = useCallback((t: number) => {
    const c = clips[idx];
    if (!c) return;
    // Pause sur le dessin de télestration le temps de l'explication
    if (c.dessin && !dessinFait.current && t >= c.dessin.temps) {
      dessinFait.current = true;
      lecteur.current?.pause();
      setDessinActif(c.dessin.formes);
      setTimeout(() => { setDessinActif(null); lecteur.current?.lire(); }, (c.dessin.duree ?? 4) * 1000);
      return;
    }
    if (t >= c.fin) {
      signalerVu(c);
      if (auto && idx < clips.length - 1) jouer(idx + 1);
      else if (!lecteur.current?.enPause()) lecteur.current?.pause();
    }
  }, [clips, idx, auto, jouer, signalerVu]);

  if (!clips.length) return <p className="muet">Aucun clip.</p>;

  return (
    <div className="lecteur-clips">
      <div>
        <LecteurVideo ref={lecteur} sources={sourcesClip} filigrane={filigrane} incrustation={clip ? `${idx + 1}/${clips.length} · ${clip.titre}` : null}
          dessin={dessinActif} onTemps={surTemps} qualiteMax={qualiteMax} />
        <div className="ligne">
          <button className="bouton petit" disabled={idx === 0} onClick={() => jouer(idx - 1)}>Clip précédent</button>
          <button className="bouton petit" onClick={() => jouer(idx)}>Revoir</button>
          <button className="bouton petit" disabled={idx >= clips.length - 1} onClick={() => { signalerVu(clips[idx]); jouer(idx + 1); }}>Clip suivant</button>
          <label className="ligne petit" style={{ gap: 4 }}><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Enchaîner</label>
          {clip && actions?.(clip)}
        </div>
      </div>
      <div className="clip-liste" style={{ maxHeight: 460, overflowY: 'auto', alignContent: 'start' }}>
        {clips.map((c, i) => (
          <button key={c.id} className={`clip-item ${i === idx ? 'actif' : ''}`} onClick={() => jouer(i)}>
            <span className="badge">{i + 1}</span>
            <span style={{ display: 'grid' }}>
              <strong>{c.titre}</strong>
              <span className="muet petit">{c.sousTitre ?? `${formatTimecode(c.debut)} à ${formatTimecode(c.fin)}`}</span>
            </span>
            {c.vu && <span className="vu" aria-label="Vu">✓</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Fenêtre modale de clips : ouverte depuis n'importe quelle stat. */
export function ModaleClips({ titre, onFermer, ...props }: Props & { titre: string; onFermer: () => void }) {
  return (
    <Modale titre={titre} onFermer={onFermer}>
      <LecteurClips {...props} />
    </Modale>
  );
}
