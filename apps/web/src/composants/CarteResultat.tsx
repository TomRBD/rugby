// Carte de résultat en image (format réseaux sociaux 1080 x 1350), générée dans le navigateur.
export async function genererCarteResultat(o: {
  club: string; adversaire: string; scoreNous: number; scoreAdv: number; date: string; competition?: string | null;
  domicile: boolean; couleur: string; logo?: string | null; marqueurs?: string[];
}): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = 1080;
  c.height = 1350;
  const g = c.getContext('2d')!;
  const fond = g.createLinearGradient(0, 0, 0, c.height);
  fond.addColorStop(0, o.couleur);
  fond.addColorStop(1, '#0b0f0d');
  g.fillStyle = fond;
  g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = 'rgba(255,255,255,.06)';
  for (let i = -c.height; i < c.width; i += 90) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + c.height, c.height); g.lineTo(i + c.height + 40, c.height); g.lineTo(i + 40, 0); g.fill(); }
  if (o.logo) {
    await new Promise<void>((res) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => { g.drawImage(img, c.width / 2 - 90, 90, 180, 180); res(); };
      img.onerror = () => res();
      img.src = o.logo!;
    });
  }
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.font = '700 46px system-ui, sans-serif';
  g.fillText('RÉSULTAT', c.width / 2, 340);
  g.font = '500 34px system-ui, sans-serif';
  g.fillText(`${new Date(o.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}${o.competition ? ` · ${o.competition}` : ''}`, c.width / 2, 395);
  const [g1, g2, s1, s2] = o.domicile ? [o.club, o.adversaire, o.scoreNous, o.scoreAdv] : [o.adversaire, o.club, o.scoreAdv, o.scoreNous];
  g.font = '800 230px system-ui, sans-serif';
  g.fillText(`${s1} - ${s2}`, c.width / 2, 700);
  g.font = '700 54px system-ui, sans-serif';
  const coupe = (t: string) => (t.length > 22 ? `${t.slice(0, 21)}…` : t);
  g.fillText(coupe(g1), c.width / 2, 820);
  g.font = '500 38px system-ui, sans-serif';
  g.fillText('contre', c.width / 2, 880);
  g.font = '700 54px system-ui, sans-serif';
  g.fillText(coupe(g2), c.width / 2, 950);
  if (o.marqueurs?.length) {
    g.font = '500 32px system-ui, sans-serif';
    g.fillText(`Essais : ${o.marqueurs.join(', ')}`.slice(0, 60), c.width / 2, 1080);
  }
  g.font = '600 30px system-ui, sans-serif';
  g.globalAlpha = 0.8;
  g.fillText(o.scoreNous > o.scoreAdv ? 'VICTOIRE' : o.scoreNous < o.scoreAdv ? 'DÉFAITE' : 'MATCH NUL', c.width / 2, 1230);
  return new Promise((res) => c.toBlob((b) => res(b!), 'image/png'));
}
