// Timeline du match : événements (nous en haut, adversaire en bas), périodes, aperçu au survol.
import { useEffect, useState } from 'react';
import { formatTimecode } from '@rugby/shared';

interface Props {
  duree: number;
  temps: number;
  evenements: { id: string; debut: number; camp: string; typeKey: string }[];
  periodes?: { debut: number; fin: number; libelle?: string }[];
  vignettes?: string;
  onAller: (t: number) => void;
  onSelection?: (id: string) => void;
}

export function Timeline({ duree, temps, evenements, periodes = [], vignettes, onAller, onSelection }: Props) {
  const [survol, setSurvol] = useState<{ x: number; t: number } | null>(null);
  const [meta, setMeta] = useState<{ intervalle: number; colonnes: number; largeur: number; hauteur: number } | null>(null);
  useEffect(() => {
    if (!vignettes) return;
    fetch(vignettes.replace('vignettes.jpg', 'vignettes.json')).then((r) => (r.ok ? r.json() : null)).then(setMeta).catch(() => undefined);
  }, [vignettes]);
  const pct = (t: number) => `${(Math.min(Math.max(t, 0), duree) / (duree || 1)) * 100}%`;
  const tempsDepuis = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, t: ((e.clientX - r.left) / r.width) * duree };
  };
  const idx = survol && meta ? Math.floor(survol.t / meta.intervalle) : 0;
  return (
    <div
      className="timeline"
      role="slider" aria-label="Position dans la vidéo" aria-valuemin={0} aria-valuemax={Math.round(duree)} aria-valuenow={Math.round(temps)} tabIndex={0}
      onClick={(e) => onAller(tempsDepuis(e).t)}
      onMouseMove={(e) => setSurvol(tempsDepuis(e))}
      onMouseLeave={() => setSurvol(null)}
      onKeyDown={(e) => { if (e.key === 'ArrowLeft') onAller(temps - 10); if (e.key === 'ArrowRight') onAller(temps + 10); }}
    >
      {periodes.map((p, i) => <div key={i} className="periode" style={{ left: pct(p.debut), width: `calc(${pct(p.fin)} - ${pct(p.debut)})` }} title={p.libelle} />)}
      {evenements.map((e) => (
        <div key={e.id} className={`marque-ev ${e.camp}`} style={{ left: pct(e.debut) }} title={`${e.typeKey} ${formatTimecode(e.debut)}`}
          onClick={(ev) => { ev.stopPropagation(); onAller(e.debut); onSelection?.(e.id); }} />
      ))}
      <div className="tete" style={{ left: pct(temps) }} />
      {survol && (
        <>
          {vignettes && meta && (
            <div className="apercu" style={{
              left: survol.x, width: meta.largeur, height: meta.hauteur, backgroundImage: `url(${vignettes})`,
              backgroundPosition: `-${(idx % meta.colonnes) * meta.largeur}px -${Math.floor(idx / meta.colonnes) * meta.hauteur}px`,
            }} />
          )}
          <span style={{ position: 'absolute', left: survol.x + 6, top: 2, fontSize: 11, fontWeight: 700, pointerEvents: 'none' }}>{formatTimecode(survol.t)}</span>
        </>
      )}
    </div>
  );
}
