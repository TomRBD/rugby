// Détection du sifflet de l'arbitre : énergie dans la bande 2,5 à 4,5 kHz, soutenue et dominante.

/** Filtre passe-bande biquad (RBJ), appliqué en place sur une copie flottante. */
function passeBande(x: Float32Array, fs: number, f0: number, q: number): Float32Array {
  const w0 = (2 * Math.PI * f0) / fs;
  const alpha = Math.sin(w0) / (2 * q);
  const b0 = alpha, b2 = -alpha, a0 = 1 + alpha, a1 = -2 * Math.cos(w0), a2 = 1 - alpha;
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = (b0 * x[i] + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

export interface Sifflet {
  debut: number;
  fin: number;
  confiance: number;
}

export function detecterSifflets(pcm: Int16Array, fs = 8000): Sifflet[] {
  const x = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) x[i] = pcm[i] / 32768;
  const bande = passeBande(x, fs, 3400, 1.6);
  const fen = Math.floor(fs * 0.05); // fenêtres de 50 ms
  const n = Math.floor(x.length / fen);
  const ratio = new Float32Array(n);
  const energie = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    let eb = 0, et = 0;
    for (let i = k * fen; i < (k + 1) * fen; i++) { eb += bande[i] * bande[i]; et += x[i] * x[i]; }
    ratio[k] = et > 1e-9 ? eb / et : 0;
    energie[k] = Math.sqrt(eb / fen);
  }
  // Seuil adaptatif : énergie de bande nettement au-dessus du niveau médian
  const tri = Array.from(energie).sort((a, b) => a - b);
  const mediane = tri[Math.floor(tri.length / 2)] ?? 0;
  const seuil = Math.max(mediane * 6, 0.01);
  const sifflets: Sifflet[] = [];
  let debut = -1;
  for (let k = 0; k <= n; k++) {
    const actif = k < n && ratio[k] > 0.55 && energie[k] > seuil;
    if (actif && debut < 0) debut = k;
    if (!actif && debut >= 0) {
      const duree = (k - debut) * 0.05;
      if (duree >= 0.25 && duree <= 4) {
        let r = 0;
        for (let i = debut; i < k; i++) r += ratio[i];
        const confiance = Math.min(0.99, (r / (k - debut)) * Math.min(1, duree / 0.6));
        sifflets.push({ debut: debut * 0.05, fin: k * 0.05, confiance: Math.round(confiance * 100) / 100 });
      }
      debut = -1;
    }
  }
  return sifflets;
}

/** Décalage (s) à ajouter aux temps de B pour s'aligner sur A, par vote sur les écarts entre sifflets. */
export function decalageParSifflets(a: Sifflet[], b: Sifflet[], tolerance = 0.15): { decalage: number; votes: number } | null {
  const votes = new Map<number, number>();
  for (const sa of a) for (const sb of b) {
    const d = Math.round((sa.debut - sb.debut) / tolerance);
    votes.set(d, (votes.get(d) ?? 0) + 1);
  }
  let meilleur: [number, number] | null = null;
  for (const [d, n] of votes) if (!meilleur || n > meilleur[1]) meilleur = [d, n];
  if (!meilleur || meilleur[1] < 3) return null;
  // Affinage : moyenne des écarts dans la case gagnante
  const ecarts: number[] = [];
  for (const sa of a) for (const sb of b) if (Math.round((sa.debut - sb.debut) / tolerance) === meilleur[0]) ecarts.push(sa.debut - sb.debut);
  return { decalage: Math.round((ecarts.reduce((s, x) => s + x, 0) / ecarts.length) * 100) / 100, votes: meilleur[1] };
}
