// Lecteur HLS : vitesses 0,25x à 4x, image par image, zoom numérique, multi-angles, filigrane, dessins.
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import Hls from 'hls.js';
import { formatTimecode } from '@rugby/shared';
import { dessinerFormes, type Forme } from './Telestration';

export interface SourceVideo {
  videoId: string;
  angle: string;
  url: string;
  decalage: number;
  duree: number;
  vignettes?: string;
}

export interface ApiLecteur {
  temps(): number;
  aller(t: number): void;
  lire(): void;
  pause(): void;
  basculer(): void;
  enPause(): boolean;
  image(n: number): void;
  vitesse(v?: number): number;
  video(): HTMLVideoElement | null;
}

export const VITESSES = [0.25, 0.5, 1, 1.5, 2, 4];
const IMAGE = 1 / 25;

interface Props {
  sources: SourceVideo[];
  filigrane?: string | null;
  incrustation?: string | null;
  dessin?: Forme[] | null;
  onTemps?: (t: number) => void;
  onFin?: () => void;
  autoplay?: boolean;
  commandes?: boolean;
  qualiteMax?: number; // hauteur maximale (économie de données mobiles)
}

export const LecteurVideo = forwardRef<ApiLecteur, Props>(function LecteurVideo(
  { sources, filigrane, incrustation, dessin, onTemps, onFin, autoplay, commandes = true, qualiteMax }, ref,
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [angle, setAngle] = useState(0);
  const [t, setT] = useState(0);
  const [pause, setPause] = useState(true);
  const [vit, setVit] = useState(1);
  const [zoom, setZoom] = useState(1);
  const tempsRef = useRef(0); // temps dans la chronologie de l'angle principal
  const lectureDemandee = useRef(false);
  const source = sources[angle] ?? sources[0];

  // Chargement de la source (hls.js, ou HLS natif sur Safari / iOS)
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !source) return;
    hlsRef.current?.destroy();
    hlsRef.current = null;
    // La position est lue au moment où la vidéo est prête : un saut demandé pendant le chargement est conservé
    const pretALire = () => {
      v.currentTime = Math.max(0, tempsRef.current - (source.decalage ?? 0));
      v.playbackRate = vit;
      if (autoplay || lectureDemandee.current) void v.play().catch(() => undefined);
    };
    if (Hls.isSupported()) {
      const hls = new Hls({ capLevelToPlayerSize: true, maxBufferLength: 20, startLevel: -1 });
      hls.loadSource(source.url);
      hls.attachMedia(v);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (qualiteMax) {
          const idx = hls.levels.map((l, i) => [l.height, i] as const).filter(([h]) => h <= qualiteMax).sort((a, b) => b[0] - a[0])[0]?.[1];
          if (idx !== undefined) hls.autoLevelCapping = idx;
        }
        pretALire();
      });
      hlsRef.current = hls;
    } else if (v.canPlayType('application/vnd.apple.mpegurl')) {
      v.src = source.url;
      v.addEventListener('loadedmetadata', pretALire, { once: true });
    }
    return () => { hlsRef.current?.destroy(); hlsRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.url]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const maj = () => {
      const tp = v.currentTime + (source?.decalage ?? 0);
      tempsRef.current = tp;
      setT(tp);
      onTemps?.(tp);
    };
    const onPlay = () => setPause(false);
    const onPause = () => setPause(true);
    const onEnded = () => onFin?.();
    v.addEventListener('timeupdate', maj);
    v.addEventListener('seeked', maj);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('ended', onEnded);
    return () => {
      v.removeEventListener('timeupdate', maj);
      v.removeEventListener('seeked', maj);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('ended', onEnded);
    };
  }, [onTemps, onFin, source?.decalage]);

  // Télestration affichée par-dessus l'image
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    c.width = r.width * devicePixelRatio;
    c.height = r.height * devicePixelRatio;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    if (dessin?.length) dessinerFormes(ctx, dessin, c.width, c.height);
  }, [dessin]);

  const aller = useCallback((tp: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, tp - (source?.decalage ?? 0));
    tempsRef.current = tp;
    setT(tp);
  }, [source?.decalage]);

  const changerVitesse = useCallback((x: number) => {
    setVit(x);
    if (videoRef.current) videoRef.current.playbackRate = x;
  }, []);

  useImperativeHandle(ref, () => ({
    temps: () => tempsRef.current,
    aller,
    lire: () => { lectureDemandee.current = true; void videoRef.current?.play().catch(() => undefined); },
    pause: () => { lectureDemandee.current = false; videoRef.current?.pause(); },
    basculer: () => { const v = videoRef.current; if (v) { if (v.paused) void v.play().catch(() => undefined); else v.pause(); } },
    enPause: () => videoRef.current?.paused ?? true,
    image: (n) => { const v = videoRef.current; if (v) { v.pause(); aller(tempsRef.current + n * IMAGE); } },
    vitesse: (x) => { if (x !== undefined) changerVitesse(x); return videoRef.current?.playbackRate ?? 1; },
    video: () => videoRef.current,
  }), [aller, changerVitesse]);

  const zoomer = (e: React.MouseEvent<HTMLDivElement>) => {
    if (zoom === 1) return;
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty('--zoom-x', `${((e.clientX - r.left) / r.width) * 100}%`);
    e.currentTarget.style.setProperty('--zoom-y', `${((e.clientY - r.top) / r.height) * 100}%`);
  };

  if (!source) return <div className="lecteur" style={{ display: 'grid', placeItems: 'center', color: '#fff' }}>Aucune vidéo prête</div>;

  return (
    <div>
      <div className="lecteur" onMouseMove={zoomer}>
        <video ref={videoRef} playsInline style={{ transform: `scale(${zoom})` }} onClick={() => { const v = videoRef.current; if (v) { if (v.paused) void v.play(); else v.pause(); } }} aria-label="Vidéo du match" />
        <canvas ref={canvasRef} className="dessin" style={{ pointerEvents: 'none' }} />
        {incrustation && <div className="incrustation">{incrustation}</div>}
        {filigrane && <div className="filigrane">{filigrane}</div>}
      </div>
      {commandes && (
        <div className="commandes">
          <button className="bouton petit" onClick={() => aller(tempsRef.current - 5)} title="Reculer de 5 s (Maj + ←)">−5 s</button>
          <button className="bouton petit" onClick={() => { videoRef.current?.pause(); aller(tempsRef.current - IMAGE); }} title="Image précédente (,)">◁|</button>
          <button className="bouton petit primaire" onClick={() => { const v = videoRef.current; if (v) { if (v.paused) void v.play(); else v.pause(); } }} title="Lecture / pause (Espace)" style={{ minWidth: 70 }}>{pause ? 'Lire' : 'Pause'}</button>
          <button className="bouton petit" onClick={() => { videoRef.current?.pause(); aller(tempsRef.current + IMAGE); }} title="Image suivante (.)">|▷</button>
          <button className="bouton petit" onClick={() => aller(tempsRef.current + 5)} title="Avancer de 5 s (Maj + →)">+5 s</button>
          <span className="temps">{formatTimecode(t)} / {formatTimecode(source.duree ?? 0)}</span>
          <select className="saisie" style={{ width: 'auto' }} value={vit} onChange={(e) => changerVitesse(Number(e.target.value))} aria-label="Vitesse de lecture">
            {VITESSES.map((x) => <option key={x} value={x}>{String(x).replace('.', ',')}x</option>)}
          </select>
          <select className="saisie" style={{ width: 'auto' }} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Zoom numérique">
            {[1, 1.5, 2, 3].map((z) => <option key={z} value={z}>Zoom {String(z).replace('.', ',')}x</option>)}
          </select>
          {sources.length > 1 && (
            <select className="saisie" style={{ width: 'auto' }} value={angle} onChange={(e) => setAngle(Number(e.target.value))} aria-label="Angle de caméra">
              {sources.map((s, i) => <option key={s.videoId} value={i}>{s.angle}</option>)}
            </select>
          )}
        </div>
      )}
    </div>
  );
});
