// Graphiques SVG légers : barres comparées, courbe de saison, momentum, radar.

export function BarresComparees({ series, onClic }: {
  series: { label: string; nous: number; adversaire: number; idsNous?: string[]; idsAdv?: string[] }[];
  onClic?: (ids: string[], titre: string) => void;
}) {
  const max = Math.max(1, ...series.flatMap((s) => [s.nous, s.adversaire]));
  const l = 640, h = 180, pad = 28;
  const bw = (l - pad) / series.length;
  return (
    <svg viewBox={`0 0 ${l} ${h + 24}`} className="graphique" style={{ width: '100%' }} role="img" aria-label="Points par tranche">
      <line className="axe" x1={pad} x2={l} y1={h} y2={h} />
      {series.map((s, i) => {
        const x = pad + i * bw;
        const hn = (s.nous / max) * (h - 20);
        const ha = (s.adversaire / max) * (h - 20);
        return (
          <g key={s.label}>
            <rect x={x + bw * 0.15} y={h - hn} width={bw * 0.32} height={hn} fill="var(--nous)" rx={2}
              style={{ cursor: s.idsNous?.length ? 'pointer' : undefined }} onClick={() => s.idsNous?.length && onClic?.(s.idsNous, `Nous ${s.label}`)}>
              <title>{`Nous ${s.label} : ${s.nous}`}</title>
            </rect>
            <rect x={x + bw * 0.5} y={h - ha} width={bw * 0.32} height={ha} fill="var(--adv)" rx={2}
              style={{ cursor: s.idsAdv?.length ? 'pointer' : undefined }} onClick={() => s.idsAdv?.length && onClic?.(s.idsAdv, `Adversaire ${s.label}`)}>
              <title>{`Adversaire ${s.label} : ${s.adversaire}`}</title>
            </rect>
            {s.nous > 0 && <text x={x + bw * 0.31} y={h - hn - 3} textAnchor="middle">{s.nous}</text>}
            {s.adversaire > 0 && <text x={x + bw * 0.66} y={h - ha - 3} textAnchor="middle">{s.adversaire}</text>}
            <text x={x + bw / 2} y={h + 16} textAnchor="middle">{s.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

export function Momentum({ points, onClic }: { points: { label: string; valeur: number; ids: string[] }[]; onClic?: (ids: string[], titre: string) => void }) {
  const l = 640, h = 140, mid = h / 2;
  const max = Math.max(1, ...points.map((p) => Math.abs(p.valeur)));
  const bw = l / (points.length || 1);
  return (
    <svg viewBox={`0 0 ${l} ${h + 20}`} className="graphique" style={{ width: '100%' }} role="img" aria-label="Momentum par tranche de 5 minutes">
      <line className="axe" x1={0} x2={l} y1={mid} y2={mid} />
      {points.map((p, i) => {
        const hh = (Math.abs(p.valeur) / max) * (mid - 6);
        return (
          <rect key={p.label} x={i * bw + 1} width={bw - 2} y={p.valeur >= 0 ? mid - hh : mid} height={hh} fill={p.valeur >= 0 ? 'var(--nous)' : 'var(--adv)'} rx={1}
            style={{ cursor: p.ids.length ? 'pointer' : undefined }} onClick={() => p.ids.length && onClic?.(p.ids, `Momentum ${p.label}`)}>
            <title>{`${p.label} : ${p.valeur > 0 ? '+' : ''}${p.valeur}`}</title>
          </rect>
        );
      })}
      {points.map((p, i) => (i % 2 === 0 ? <text key={p.label} x={i * bw + bw / 2} y={h + 14} textAnchor="middle">{p.label.split('-')[0]}</text> : null))}
    </svg>
  );
}

export function Courbe({ series, labels, format = (v: number) => String(v) }: {
  series: { nom: string; couleur: string; valeurs: (number | null)[] }[];
  labels: string[];
  format?: (v: number) => string;
}) {
  const l = 640, h = 200, px = 36, py = 16;
  const tout = series.flatMap((s) => s.valeurs).filter((v): v is number => v != null);
  if (!tout.length) return <p className="muet">Pas encore de données.</p>;
  const min = Math.min(0, ...tout), max = Math.max(...tout, 1);
  const X = (i: number) => px + (i / Math.max(1, labels.length - 1)) * (l - px - 10);
  const Y = (v: number) => h - py - ((v - min) / (max - min || 1)) * (h - 2 * py);
  return (
    <svg viewBox={`0 0 ${l} ${h + 20}`} className="graphique" style={{ width: '100%' }} role="img" aria-label="Évolution sur la saison">
      {[min, (min + max) / 2, max].map((v) => (
        <g key={v}><line className="axe" x1={px} x2={l} y1={Y(v)} y2={Y(v)} strokeDasharray="3 3" /><text x={2} y={Y(v) + 4}>{format(Math.round(v))}</text></g>
      ))}
      {series.map((s) => {
        const pts = s.valeurs.map((v, i) => (v == null ? null : [X(i), Y(v)] as const)).filter(Boolean) as (readonly [number, number])[];
        return (
          <g key={s.nom}>
            <polyline points={pts.map((p) => p.join(',')).join(' ')} fill="none" stroke={s.couleur} strokeWidth={2.5} />
            {pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={3.5} fill={s.couleur} />)}
          </g>
        );
      })}
      {labels.map((lb, i) => (labels.length <= 12 || i % Math.ceil(labels.length / 12) === 0 ? <text key={i} x={X(i)} y={h + 14} textAnchor="middle">{lb}</text> : null))}
    </svg>
  );
}

export function Radar({ axes, series }: { axes: string[]; series: { nom: string; couleur: string; valeurs: number[] }[] }) {
  const t = 300, c = t / 2, r = c - 60;
  const max = axes.map((_, i) => Math.max(0.001, ...series.map((s) => s.valeurs[i] ?? 0)));
  const point = (i: number, v: number) => {
    const a = (Math.PI * 2 * i) / axes.length - Math.PI / 2;
    const k = (v / max[i]) * r;
    return [c + Math.cos(a) * k, c + Math.sin(a) * k];
  };
  return (
    <svg viewBox={`0 0 ${t} ${t}`} className="graphique" style={{ width: '100%', maxWidth: 420 }} role="img" aria-label="Radar joueur comparé à la moyenne du poste">
      {[0.25, 0.5, 0.75, 1].map((k) => (
        <polygon key={k} className="axe" fill="none" points={axes.map((_, i) => point(i, max[i] * k).join(',')).join(' ')} />
      ))}
      {axes.map((a, i) => {
        const [x, y] = point(i, max[i] * 1.18);
        return <text key={a} x={x} y={y} textAnchor="middle" fontSize={9}>{a}</text>;
      })}
      {series.map((s) => (
        <polygon key={s.nom} points={s.valeurs.map((v, i) => point(i, v).join(',')).join(' ')} fill={s.couleur} fillOpacity={0.25} stroke={s.couleur} strokeWidth={2} />
      ))}
    </svg>
  );
}

export function Legende({ items }: { items: { nom: string; couleur: string }[] }) {
  return (
    <div className="ligne petit">
      {items.map((i) => <span key={i.nom} className="ligne" style={{ gap: 4 }}><span style={{ width: 12, height: 12, borderRadius: 3, background: i.couleur, display: 'inline-block' }} />{i.nom}</span>)}
    </div>
  );
}
