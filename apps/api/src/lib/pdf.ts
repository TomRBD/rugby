// Outils de mise en page PDF (rapports en un clic).
import PDFDocument from 'pdfkit';
import { LARGEUR, LONGUEUR } from '@rugby/shared';

export type Doc = PDFKit.PDFDocument;

export function nouveauDoc(titre: string): { doc: Doc; fin: () => Promise<Buffer> } {
  const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: titre, Producer: 'Rugby Analyse' } });
  const morceaux: Buffer[] = [];
  doc.on('data', (b: Buffer) => morceaux.push(b));
  const fin = () => new Promise<Buffer>((res) => { doc.on('end', () => res(Buffer.concat(morceaux))); doc.end(); });
  return { doc, fin };
}

export function entete(doc: Doc, club: { nom: string; couleurs?: { primaire?: string } }, titre: string, sousTitre?: string) {
  const couleur = club.couleurs?.primaire ?? '#0b5d3b';
  doc.rect(0, 0, doc.page.width, 70).fill(couleur);
  doc.fillColor('#ffffff').fontSize(18).font('Helvetica-Bold').text(titre, 40, 20, { width: doc.page.width - 80 });
  doc.fontSize(10).font('Helvetica').text(`${club.nom}${sousTitre ? `  ·  ${sousTitre}` : ''}`, 40, 45);
  doc.fillColor('#111111').moveDown(3);
  doc.y = 90;
}

export function section(doc: Doc, titre: string) {
  if (doc.y > doc.page.height - 120) doc.addPage();
  doc.moveDown(0.6).font('Helvetica-Bold').fontSize(12).fillColor('#0b5d3b').text(titre).fillColor('#111111').font('Helvetica').fontSize(9.5).moveDown(0.3);
}

export function tableau(doc: Doc, entetes: string[], lignes: (string | number | null | undefined)[][], largeurs?: number[], couleurs?: (string | null)[][]) {
  const x0 = 40;
  const total = doc.page.width - 80;
  const l = largeurs ?? entetes.map(() => total / entetes.length);
  const hauteur = 16;
  const ligne = (vals: (string | number | null | undefined)[], gras: boolean, fond?: string, coul?: (string | null)[]) => {
    if (doc.y > doc.page.height - 60) doc.addPage();
    const y = doc.y;
    if (fond) doc.rect(x0, y - 2, total, hauteur).fill(fond).fillColor('#111111');
    let x = x0;
    vals.forEach((v, i) => {
      doc.font(gras ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(coul?.[i] ?? '#111111')
        .text(v == null ? '' : String(v), x + 4, y + 2, { width: l[i] - 8, height: hauteur, ellipsis: true, lineBreak: false });
      x += l[i];
    });
    doc.fillColor('#111111');
    doc.y = y + hauteur;
  };
  ligne(entetes, true, '#e6efe9');
  lignes.forEach((v, i) => ligne(v, false, i % 2 ? '#f7f7f7' : undefined, couleurs?.[i]));
  doc.x = x0;
  doc.moveDown(0.5);
}

/** Terrain vu de dessus avec les événements localisés (x : 0 à 100 m, y : 0 à 70 m). */
export function terrain(doc: Doc, points: { x: number; y: number; couleur: string; forme?: 'rond' | 'croix' }[], legende: { label: string; couleur: string }[]) {
  const largeur = doc.page.width - 80;
  const echelle = largeur / (LONGUEUR + 20); // 10 m d'en-but de chaque côté
  const h = (LARGEUR) * echelle;
  if (doc.y + h + 30 > doc.page.height - 40) doc.addPage();
  const x0 = 40, y0 = doc.y;
  doc.rect(x0, y0, largeur, h).fill('#2f7d43');
  doc.strokeColor('#ffffff').lineWidth(1);
  const xm = (m: number) => x0 + (m + 10) * echelle;
  for (const m of [0, 100]) doc.moveTo(xm(m), y0).lineTo(xm(m), y0 + h).stroke();
  for (const m of [22, 50, 78]) doc.moveTo(xm(m), y0).lineTo(xm(m), y0 + h).stroke();
  doc.dash(3, { space: 3 });
  for (const m of [5, 40, 60, 95]) doc.moveTo(xm(m), y0).lineTo(xm(m), y0 + h).stroke();
  for (const w of [5, 15, 55, 65]) doc.moveTo(xm(0), y0 + w * echelle).lineTo(xm(100), y0 + w * echelle).stroke();
  doc.undash();
  for (const p of points) {
    const px = xm(p.x), py = y0 + p.y * echelle;
    if (p.forme === 'croix') {
      doc.strokeColor(p.couleur).lineWidth(2).moveTo(px - 3, py - 3).lineTo(px + 3, py + 3).moveTo(px + 3, py - 3).lineTo(px - 3, py + 3).stroke();
    } else {
      doc.circle(px, py, 3.2).fillAndStroke(p.couleur, '#ffffff');
    }
  }
  doc.strokeColor('#111111').lineWidth(1);
  doc.y = y0 + h + 6;
  let lx = x0;
  for (const l of legende) {
    doc.circle(lx + 4, doc.y + 4, 3.5).fill(l.couleur);
    doc.fillColor('#111111').fontSize(8.5).text(l.label, lx + 11, doc.y, { lineBreak: false });
    lx += doc.widthOfString(l.label) + 30;
  }
  doc.x = x0;
  doc.moveDown(1.2);
  doc.fontSize(7.5).fillColor('#555555').text('Sens d\'attaque de notre équipe : de gauche à droite.').fillColor('#111111').fontSize(9.5);
}

export function paragraphe(doc: Doc, texte: string) {
  doc.font('Helvetica').fontSize(9.5).text(texte, { align: 'left' }).moveDown(0.3);
}

export function puces(doc: Doc, items: string[], couleur = '#111111') {
  for (const i of items.filter(Boolean)) doc.fillColor(couleur).text(`•  ${i}`, { indent: 6 });
  doc.fillColor('#111111').moveDown(0.3);
}
