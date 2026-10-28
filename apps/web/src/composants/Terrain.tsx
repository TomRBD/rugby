// Terrain vu de dessus : saisie d'une position au clic et carte des événements.
// Repère : x = 0 notre ligne d'essai, 100 la ligne adverse ; y = 0 à 70.
import { BORNES_LARGEUR, BORNES_LONGUEUR } from '@rugby/shared';

export interface PointTerrain {
  id?: string;
  x: number;
  y: number;
  couleur?: string;
  forme?: 'rond' | 'croix' | 'carre';
  titre?: string;
}

interface Props {
  points?: PointTerrain[];
  selection?: { x: number; y: number } | null;
  onClic?: (x: number, y: number) => void;
  onPoint?: (id: string) => void;
  grille?: boolean;
  hauteurMax?: number;
}

const M = 10; // en-buts
const L = 100 + 2 * M;
const H = 70;

export function Terrain({ points = [], selection, onClic, onPoint, grille = true, hauteurMax }: Props) {
  const clic = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!onClic) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * L - M;
    const y = ((e.clientY - r.top) / r.height) * H;
    onClic(Math.round(Math.min(100, Math.max(0, x)) * 2) / 2, Math.round(Math.min(70, Math.max(0, y)) * 2) / 2);
  };
  return (
    <svg viewBox={`0 0 ${L} ${H}`} className={`terrain ${onClic ? 'cliquable' : ''}`} onClick={clic} style={hauteurMax ? { maxHeight: hauteurMax } : undefined}
      role={onClic ? 'button' : 'img'} aria-label={onClic ? 'Cliquer pour placer l\'action sur le terrain' : 'Carte du terrain'}>
      <rect x={0} y={0} width={L} height={H} fill="var(--terrain)" />
      <rect x={0} y={0} width={M} height={H} fill="rgb(0 0 0 / 12%)" />
      <rect x={L - M} y={0} width={M} height={H} fill="rgb(0 0 0 / 12%)" />
      {grille && BORNES_LONGUEUR.slice(1, -1).map((b) => <line key={`l${b}`} x1={b + M} x2={b + M} y1={0} y2={H} stroke="rgb(255 255 255 / 18%)" strokeWidth={0.25} />)}
      {grille && BORNES_LARGEUR.slice(1, -1).map((b) => <line key={`w${b}`} x1={M} x2={L - M} y1={b} y2={b} stroke="rgb(255 255 255 / 18%)" strokeWidth={0.25} strokeDasharray="1 1" />)}
      {[0, 22, 50, 78, 100].map((m) => <line key={m} x1={m + M} x2={m + M} y1={0} y2={H} stroke="#fff" strokeWidth={m === 50 ? 0.5 : 0.4} />)}
      {[5, 40, 60, 95].map((m) => <line key={m} x1={m + M} x2={m + M} y1={0} y2={H} stroke="#fff" strokeWidth={0.3} strokeDasharray="1.5 1.5" />)}
      <text x={M + 2} y={4} fontSize={2.6} fill="#fff" opacity={0.8}>Nos 22</text>
      <text x={L - M - 2} y={4} fontSize={2.6} fill="#fff" opacity={0.8} textAnchor="end">22 adverses</text>
      <text x={L / 2} y={H - 2} fontSize={2.4} fill="#fff" opacity={0.7} textAnchor="middle">Sens d'attaque →</text>
      {points.map((p, i) => {
        const cx = p.x + M;
        const c = p.couleur ?? '#fff';
        const cle = p.id ?? i;
        const props = { onClick: (e: React.MouseEvent) => { if (p.id && onPoint) { e.stopPropagation(); onPoint(p.id); } }, style: { cursor: p.id && onPoint ? 'pointer' : undefined } };
        return p.forme === 'croix' ? (
          <g key={cle} {...props}><title>{p.titre}</title><path d={`M${cx - 1.3} ${p.y - 1.3}L${cx + 1.3} ${p.y + 1.3}M${cx + 1.3} ${p.y - 1.3}L${cx - 1.3} ${p.y + 1.3}`} stroke={c} strokeWidth={0.7} /></g>
        ) : p.forme === 'carre' ? (
          <rect key={cle} {...props} x={cx - 1.1} y={p.y - 1.1} width={2.2} height={2.2} fill={c} stroke="#000" strokeWidth={0.2}><title>{p.titre}</title></rect>
        ) : (
          <circle key={cle} {...props} cx={cx} cy={p.y} r={1.3} fill={c} stroke="#000" strokeWidth={0.2}><title>{p.titre}</title></circle>
        );
      })}
      {selection && <circle cx={selection.x + M} cy={selection.y} r={2} fill="none" stroke="#ffd400" strokeWidth={0.6} />}
    </svg>
  );
}
