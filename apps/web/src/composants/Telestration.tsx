// Télestration : flèches, zones, cercles, lignes de défense, texte, lignes 22 m / 10 m / 5 m.
// Coordonnées normalisées (0 à 1) pour un rendu identique quelle que soit la taille de l'écran.
import { useEffect, useRef, useState } from 'react';

export type Outil = 'fleche' | 'cercle' | 'zone' | 'ligne_defense' | 'texte' | 'ligne_terrain';

export interface Forme {
  outil: Outil;
  points: [number, number][];
  couleur: string;
  texte?: string;
}

const COULEURS = ['#ffd400', '#ff3b30', '#34c759', '#0a84ff', '#ffffff'];
const LIBELLES: Record<Outil, string> = {
  fleche: 'Flèche', cercle: 'Cercle', zone: 'Zone', ligne_defense: 'Ligne de défense', texte: 'Texte', ligne_terrain: 'Ligne 22 / 10 / 5 m',
};

export function dessinerFormes(ctx: CanvasRenderingContext2D, formes: Forme[], l: number, h: number) {
  const ep = Math.max(2, l / 300);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const f of formes) {
    const pts = f.points.map(([x, y]) => [x * l, y * h] as const);
    ctx.strokeStyle = f.couleur;
    ctx.fillStyle = f.couleur;
    ctx.lineWidth = ep;
    ctx.setLineDash([]);
    if (!pts.length) continue;
    const [a, b] = [pts[0], pts[pts.length - 1]];
    switch (f.outil) {
      case 'fleche': {
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        const t = ep * 6;
        ctx.beginPath();
        ctx.moveTo(b[0], b[1]);
        ctx.lineTo(b[0] - t * Math.cos(ang - 0.45), b[1] - t * Math.sin(ang - 0.45));
        ctx.lineTo(b[0] - t * Math.cos(ang + 0.45), b[1] - t * Math.sin(ang + 0.45));
        ctx.closePath(); ctx.fill();
        break;
      }
      case 'cercle': {
        ctx.beginPath();
        ctx.ellipse((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.abs(b[0] - a[0]) / 2 || ep * 8, Math.abs(b[1] - a[1]) / 2 || ep * 8, 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }
      case 'zone': {
        ctx.globalAlpha = 0.25;
        ctx.fillRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
        ctx.globalAlpha = 1;
        ctx.strokeRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
        break;
      }
      case 'ligne_defense': {
        ctx.setLineDash([ep * 3, ep * 2]);
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.stroke();
        ctx.setLineDash([]);
        for (const [x, y] of pts) { ctx.beginPath(); ctx.arc(x, y, ep * 2, 0, Math.PI * 2); ctx.fill(); }
        break;
      }
      case 'ligne_terrain': {
        ctx.setLineDash([ep * 4, ep * 3]);
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
        ctx.setLineDash([]);
        if (f.texte) { ctx.font = `bold ${ep * 7}px sans-serif`; ctx.fillText(f.texte, b[0] + ep * 2, b[1]); }
        break;
      }
      case 'texte': {
        ctx.font = `bold ${ep * 9}px sans-serif`;
        ctx.strokeStyle = 'rgba(0,0,0,.7)';
        ctx.lineWidth = ep * 1.5;
        ctx.strokeText(f.texte ?? '', a[0], a[1]);
        ctx.fillText(f.texte ?? '', a[0], a[1]);
        break;
      }
    }
  }
}

/** Calque d'édition posé sur la vidéo en pause. */
/** Capture l'image courante de la vidéo (même origine) pour dessiner dessus. */
export function captureImage(video: HTMLVideoElement): string {
  const c = document.createElement('canvas');
  c.width = video.videoWidth || 1280;
  c.height = video.videoHeight || 720;
  c.getContext('2d')!.drawImage(video, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85);
}

export function EditeurTelestration({ image, initial, onEnregistrer, onAnnuler }: { image: string; initial?: Forme[]; onEnregistrer: (f: Forme[]) => void; onAnnuler: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [formes, setFormes] = useState<Forme[]>(initial ?? []);
  const [outil, setOutil] = useState<Outil>('fleche');
  const [couleur, setCouleur] = useState(COULEURS[0]);
  const [encours, setEncours] = useState<Forme | null>(null);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    c.width = r.width * devicePixelRatio;
    c.height = r.height * devicePixelRatio;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    dessinerFormes(ctx, encours ? [...formes, encours] : formes, c.width, c.height);
  }, [formes, encours]);

  const pos = (e: React.PointerEvent): [number, number] => {
    const r = canvas.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  };

  const bas = (e: React.PointerEvent) => {
    const p = pos(e);
    if (outil === 'texte') {
      const texte = prompt('Texte à afficher');
      if (texte) setFormes((f) => [...f, { outil, points: [p], couleur, texte }]);
      return;
    }
    if (outil === 'ligne_defense') {
      // Clics successifs ; double-clic pour terminer
      setEncours((c) => (c ? { ...c, points: [...c.points, p] } : { outil, points: [p], couleur }));
      return;
    }
    if (outil === 'ligne_terrain') {
      const texte = prompt('Libellé (22 m, 10 m, 5 m)', '22 m') ?? undefined;
      setFormes((f) => [...f, { outil, points: [[0, p[1]], [1, p[1]]], couleur, texte }]);
      return;
    }
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setEncours({ outil, points: [p, p], couleur });
  };
  const deplacer = (e: React.PointerEvent) => {
    if (!encours || outil === 'ligne_defense') return;
    setEncours({ ...encours, points: [encours.points[0], pos(e)] });
  };
  const haut = () => {
    if (!encours || outil === 'ligne_defense') return;
    setFormes((f) => [...f, encours]);
    setEncours(null);
  };
  const finirLigne = () => {
    if (encours && outil === 'ligne_defense' && encours.points.length > 1) setFormes((f) => [...f, encours]);
    setEncours(null);
  };

  return (
    <div className="pile">
      <div className="ligne">
        {(Object.keys(LIBELLES) as Outil[]).map((o) => (
          <button key={o} className={`bouton petit ${outil === o ? 'primaire' : ''}`} onClick={() => { finirLigne(); setOutil(o); }}>{LIBELLES[o]}</button>
        ))}
        {COULEURS.map((c) => (
          <button key={c} onClick={() => setCouleur(c)} aria-label={`Couleur ${c}`} style={{ width: 28, height: 28, borderRadius: '50%', background: c, border: couleur === c ? '3px solid var(--texte)' : '1px solid var(--bord)', cursor: 'pointer' }} />
        ))}
        <button className="bouton petit" onClick={() => setFormes((f) => f.slice(0, -1))}>Annuler le dernier tracé</button>
      </div>
      <div className="lecteur">
        <img src={image} alt="Image figée de la vidéo" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
        <canvas
          ref={canvas}
          className="dessin"
          style={{ cursor: 'crosshair', touchAction: 'none' }}
          onPointerDown={bas} onPointerMove={deplacer} onPointerUp={haut} onDoubleClick={finirLigne}
        />
      </div>
      <div className="ligne">
        <button className="bouton primaire" onClick={() => { finirLigne(); onEnregistrer(encours && outil === 'ligne_defense' && encours.points.length > 1 ? [...formes, encours] : formes); }}>Enregistrer le dessin</button>
        <button className="bouton" onClick={onAnnuler}>Annuler</button>
        <span className="muet petit">Ligne de défense : cliquez chaque joueur, double-cliquez pour terminer.</span>
      </div>
    </div>
  );
}
