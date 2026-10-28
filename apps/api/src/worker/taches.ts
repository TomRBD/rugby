// Traitements exécutés par le worker. Connexion administrateur : chaque requête filtre explicitement sur le club du job.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { poolAdmin } from '../lib/db.js';
import { stockage } from '../lib/stockage.js';
import { prefixeVideo } from '../routes/videos.js';
import { FFMPEG, decoderAudio, executer, ffmpegAvecProgression, sonder, type Sonde } from './ffmpeg.js';
import { decalageParSifflets, detecterSifflets } from './audio.js';
import { signerMedia } from '../lib/securite.js';

/** Vidéo transmise au service IA : URL HLS signée si l'API est joignable (GPU distant), sinon chemin local partagé. */
function videoPourIa(clubId: string, videoId: string, source: string) {
  const base = process.env.PUBLIC_API_URL;
  return base ? `${base}/media/${signerMedia(`${prefixeVideo(clubId, videoId)}/hls/`, 12 * 3600)}/master.m3u8` : source;
}

export interface Job {
  id: string;
  club_id: string | null;
  type: string;
  payload: Record<string, any>;
}

const RENDITIONS = [
  { nom: '1080p', hauteur: 1080, debit: 5000, maxrate: 6000 },
  { nom: '720p', hauteur: 720, debit: 2800, maxrate: 3200 },
  { nom: '480p', hauteur: 480, debit: 1200, maxrate: 1400 },
];

async function dossierTemporaire(prefixe: string) {
  return fs.mkdtemp(path.join(process.env.WORKER_TMP ?? os.tmpdir(), `rugby-${prefixe}-`));
}

async function majVideo(videoId: string, champs: Record<string, unknown>) {
  const cles = Object.keys(champs);
  await poolAdmin.query(`UPDATE videos SET ${cles.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`, [videoId, ...cles.map((k) => champs[k])]);
}

/** Fichier local d'une partie (direct en stockage local, sinon reconstitué depuis le stockage objet). */
async function fichierPartie(p: { cle_stockage: string }, tmp: string, i: number): Promise<string> {
  const local = stockage.cheminLocal(p.cle_stockage);
  if (local) return local;
  const dest = path.join(tmp, `partie-${i}${path.extname(p.cle_stockage)}`);
  await stockage.assemblerMorceaux(p.cle_stockage, dest);
  return dest;
}

/**
 * Transcodage HLS multi-débit (1080p / 720p / 480p selon la source) en un seul passage FFmpeg,
 * assemblage des fichiers découpés, planche de vignettes, puis détection mi-temps / arrêts longs.
 */
export async function transcodage(job: Job) {
  const { videoId } = job.payload;
  const v = (await poolAdmin.query('SELECT * FROM videos WHERE id = $1 AND club_id = $2', [videoId, job.club_id])).rows[0];
  if (!v) return;
  const parties = (await poolAdmin.query('SELECT * FROM video_parties WHERE video_id = $1 ORDER BY ordre', [videoId])).rows;
  await majVideo(videoId, { statut: 'transcodage', progression: 0, erreur: null, etape: parties.length > 1 ? 'assemblage' : 'analyse', traitement_debut: null });
  const tmp = await dossierTemporaire('transcodage');
  try {
    const fichiers: string[] = [];
    const sondes: Sonde[] = [];
    for (const [i, p] of parties.entries()) {
      const f = await fichierPartie(p, tmp, i);
      const s = await sonder(f);
      await poolAdmin.query('UPDATE video_parties SET duree = $2 WHERE id = $1', [p.id, s.duree]);
      fichiers.push(f);
      sondes.push(s);
    }
    const duree = sondes.reduce((a, s) => a + s.duree, 0);
    const hauteurSource = Math.max(...sondes.map((s) => s.hauteur));
    // La durée est connue dès l'analyse : l'interface peut estimer le temps restant pendant la conversion
    await majVideo(videoId, { duree, hauteur: hauteurSource, etape: 'conversion', traitement_debut: new Date() });
    const audio = sondes.every((s) => s.audio);
    let rends = RENDITIONS.filter((r) => r.hauteur <= hauteurSource + 8);
    if (!rends.length) rends = [RENDITIONS[2]];

    const entree: string[] = [];
    if (fichiers.length > 1) {
      const liste = path.join(tmp, 'liste.txt');
      await fs.writeFile(liste, fichiers.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
      entree.push('-f', 'concat', '-safe', '0', '-i', liste);
    } else {
      entree.push('-i', fichiers[0]);
    }
    const sortie = path.join(tmp, 'hls');
    await fs.mkdir(sortie, { recursive: true });
    const n = rends.length;
    const filtre = `[0:v]fps=fps='min(source_fps,30)',split=${n}${rends.map((_, i) => `[s${i}]`).join('')};` +
      rends.map((r, i) => `[s${i}]scale=-2:${r.hauteur}:flags=bicubic,format=yuv420p[v${i}]`).join(';');
    const args = [...entree, '-filter_complex', filtre];
    rends.forEach((r, i) => {
      args.push('-map', `[v${i}]`, `-c:v:${i}`, 'libx264', `-b:v:${i}`, `${r.debit}k`, `-maxrate:v:${i}`, `${r.maxrate}k`, `-bufsize:v:${i}`, `${r.maxrate * 2}k`);
      if (audio) args.push('-map', 'a:0');
    });
    if (audio) args.push('-c:a', 'aac', '-b:a', '96k', '-ac', '2');
    args.push(
      '-preset', process.env.X264_PRESET ?? 'veryfast', '-profile:v', 'main', '-threads', '0',
      '-force_key_frames', 'expr:gte(t,n_forced*2)', '-sc_threshold', '0',
      '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod', '-hls_flags', 'independent_segments',
      '-master_pl_name', 'master.m3u8',
      '-var_stream_map', rends.map((r, i) => (audio ? `v:${i},a:${i},name:${r.nom}` : `v:${i},name:${r.nom}`)).join(' '),
      '-hls_segment_filename', path.join(sortie, '%v', 'seg%05d.ts'),
      path.join(sortie, '%v', 'index.m3u8'),
    );
    for (const r of rends) await fs.mkdir(path.join(sortie, r.nom), { recursive: true });
    await ffmpegAvecProgression(args, duree, (p) => { void majVideo(videoId, { progression: Math.round(p * 90) / 100 }); });
    await majVideo(videoId, { etape: 'vignettes', progression: 0.92 });

    // Planche de vignettes (1 image / 10 s) pour le survol de la timeline
    const plusBasse = rends[rends.length - 1].nom;
    const nbVignettes = Math.max(1, Math.ceil(duree / 10));
    const colonnes = 20;
    const lignes = Math.ceil(nbVignettes / colonnes);
    await executer(FFMPEG, ['-hide_banner', '-y', '-i', path.join(sortie, plusBasse, 'index.m3u8'),
      '-vf', `fps=1/10,scale=160:90:force_original_aspect_ratio=decrease,pad=160:90:(ow-iw)/2:(oh-ih)/2,tile=${colonnes}x${lignes}`,
      '-frames:v', '1', '-q:v', '5', path.join(sortie, 'vignettes.jpg')]).catch(() => undefined);
    await fs.writeFile(path.join(sortie, 'vignettes.json'), JSON.stringify({ intervalle: 10, colonnes, largeur: 160, hauteur: 90 }));

    await majVideo(videoId, { etape: 'publication', progression: 0.95 });
    await stockage.televerserDossier(sortie, `${prefixeVideo(job.club_id!, videoId)}/hls`);
    const largeur = Math.max(...sondes.map((s) => s.largeur));
    await majVideo(videoId, {
      statut: 'pret', progression: 1, duree, largeur, hauteur: hauteurSource, etape: 'pret',
      renditions: JSON.stringify(rends.map((r) => r.nom)),
    });
    if (!v.conserver_original) await stockage.supprimerPrefixe(`${prefixeVideo(job.club_id!, videoId)}/original`);
    // Détection automatique des mi-temps et arrêts longs (propositions à valider)
    await poolAdmin.query("INSERT INTO jobs (club_id, type, payload) VALUES ($1, 'analyse_ia', $2)",
      [job.club_id, JSON.stringify({ matchId: v.match_id, videoId, analyses: ['temps_morts', 'coups_envoi'], automatique: true })]);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

/** Import depuis un lien : yt-dlp si disponible (YouTube, Vimeo...), sinon téléchargement HTTP direct. */
export async function importUrl(job: Job) {
  const { videoId, url } = job.payload;
  const v = (await poolAdmin.query('SELECT * FROM videos WHERE id = $1 AND club_id = $2', [videoId, job.club_id])).rows[0];
  if (!v) return;
  await majVideo(videoId, { statut: 'transcodage', progression: 0 });
  const tmp = await dossierTemporaire('import');
  try {
    let direct = String(url);
    // Liens de partage courants convertis en téléchargement direct
    if (/dropbox\.com/.test(direct)) direct = direct.replace(/[?&]dl=0/, '').replace(/(\?|$)/, (m) => (m === '?' ? '?dl=1&' : '?dl=1'));
    const drive = direct.match(/drive\.google\.com\/file\/d\/([^/]+)/);
    if (drive) direct = `https://drive.google.com/uc?export=download&id=${drive[1]}`;
    const fichier = path.join(tmp, 'source.mp4');
    const ytdlp = process.env.YTDLP_PATH ?? 'yt-dlp';
    const plateforme = /youtube\.com|youtu\.be|vimeo\.com/.test(direct);
    if (plateforme) {
      await executer(ytdlp, ['-f', 'bv*[height<=1080]+ba/b[height<=1080]/b', '--merge-output-format', 'mp4', '-o', fichier, direct]);
    } else {
      const r = await fetch(direct, { redirect: 'follow' });
      if (!r.ok || !r.body) throw new Error(`Téléchargement impossible (${r.status})`);
      const { Readable } = await import('node:stream');
      const { pipeline } = await import('node:stream/promises');
      const { createWriteStream } = await import('node:fs');
      await pipeline(Readable.fromWeb(r.body as any), createWriteStream(fichier));
    }
    const taille = (await fs.stat(fichier)).size;
    const cle = `${prefixeVideo(job.club_id!, videoId)}/original/00.mp4`;
    await stockage.televerserFichier(fichier, cle);
    await poolAdmin.query('INSERT INTO video_parties (club_id, video_id, ordre, nom_fichier, taille, recu, cle_stockage) VALUES ($1,$2,0,$3,$4,$4,$5)',
      [job.club_id, videoId, path.basename(new URL(url).pathname) || 'import.mp4', taille, cle]);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
  await transcodage(job);
}

async function sourceAnalyse(clubId: string, videoId: string, tmp: string): Promise<string> {
  // Analyse sur la rendition la plus légère
  const v = (await poolAdmin.query('SELECT renditions FROM videos WHERE id = $1', [videoId])).rows[0];
  const r = (v?.renditions as string[] | undefined)?.slice(-1)[0] ?? '480p';
  const prefixe = `${prefixeVideo(clubId, videoId)}/hls/${r}`;
  const local = stockage.cheminLocal(`${prefixe}/index.m3u8`);
  if (local) return local;
  const dossier = path.join(tmp, r);
  await fs.mkdir(dossier, { recursive: true });
  const index = await stockage.lireTexte(`${prefixe}/index.m3u8`);
  if (!index) throw new Error('Rendition introuvable');
  await fs.writeFile(path.join(dossier, 'index.m3u8'), index);
  for (const seg of index.split('\n').filter((l) => l && !l.startsWith('#'))) {
    await stockage.telechargerVersFichier(`${prefixe}/${seg}`, path.join(dossier, seg));
  }
  return path.join(dossier, 'index.m3u8');
}

/** Périodes de faible mouvement (temps morts, mi-temps) par freezedetect sur une image réduite. */
async function periodesStatiques(source: string, dureeMin: number): Promise<{ debut: number; fin: number }[]> {
  const { stderr } = await executer(FFMPEG, ['-hide_banner', '-i', source, '-an', '-vf', `fps=4,scale=192:-2,freezedetect=n=-45dB:d=${dureeMin}`, '-f', 'null', '-']);
  const out: { debut: number; fin: number }[] = [];
  let debut: number | null = null;
  for (const l of stderr.split('\n')) {
    const a = l.match(/freeze_start: ([\d.]+)/);
    const b = l.match(/freeze_end: ([\d.]+)/);
    if (a) debut = Number(a[1]);
    if (b && debut != null) { out.push({ debut, fin: Number(b[1]) }); debut = null; }
  }
  return out;
}

export async function analyseIa(job: Job) {
  const { matchId, videoId, analyses } = job.payload as { matchId: string; videoId: string; analyses: string[] };
  const v = (await poolAdmin.query('SELECT * FROM videos WHERE id = $1 AND club_id = $2', [videoId, job.club_id])).rows[0];
  if (!v) return;
  const tmp = await dossierTemporaire('ia');
  const propositions: { type: string; debut: number; fin: number; confiance: number; details: Record<string, unknown> }[] = [];
  try {
    const source = await sourceAnalyse(job.club_id!, videoId, tmp);
    const statiques = analyses.some((a) => ['temps_morts', 'coups_envoi'].includes(a)) ? await periodesStatiques(source, 20) : [];
    const sifflets = analyses.some((a) => ['coups_envoi', 'phases_arretees'].includes(a)) ? detecterSifflets(await decoderAudio(source)) : [];

    if (analyses.includes('temps_morts')) {
      for (const s of statiques) {
        const d = s.fin - s.debut;
        const type = d >= 300 ? 'mi_temps' : 'temps_mort';
        propositions.push({ type, debut: s.debut, fin: s.fin, confiance: Math.min(0.95, 0.5 + d / 600), details: { duree: Math.round(d), methode: 'mouvement' } });
      }
    }
    if (analyses.includes('coups_envoi')) {
      // 1re mi-temps : premier sifflet net suivi de jeu ; 2e : premier sifflet après la plus longue pause du milieu de vidéo
      const premier = sifflets.find((s) => s.confiance > 0.5 && !statiques.some((p) => s.debut >= p.debut && s.debut <= p.fin - 5));
      if (premier) propositions.push({ type: 'coup_envoi_1', debut: premier.debut, fin: premier.fin, confiance: premier.confiance * 0.8, details: { methode: 'sifflet' } });
      const duree = v.duree ?? 0;
      const pause = statiques.filter((p) => p.debut > duree * 0.3 && p.fin < duree * 0.75).sort((a, b) => b.fin - b.debut - (a.fin - a.debut))[0];
      if (pause) {
        const reprise = sifflets.find((s) => s.debut >= pause.fin - 10 && s.debut <= pause.fin + 120);
        const t = reprise?.debut ?? pause.fin;
        propositions.push({ type: 'coup_envoi_2', debut: t, fin: t + 1, confiance: reprise ? Math.min(0.9, reprise.confiance) : 0.4, details: { methode: reprise ? 'pause + sifflet' : 'pause', pause } });
      }
    }
    if (analyses.includes('phases_arretees')) {
      if (process.env.IA_SERVICE_URL) {
        // Service GPU : détection mêlée / touche / coup d'envoi par modèle de vision
        const r = await fetch(`${process.env.IA_SERVICE_URL}/phases`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ video: videoPourIa(job.club_id!, videoId, source), duree: v.duree }),
        });
        if (!r.ok) throw new Error(`Service IA : ${r.status}`);
        for (const p of (await r.json()) as any[]) propositions.push({ type: p.type, debut: p.debut, fin: p.fin, confiance: p.confiance, details: { methode: 'vision' } });
      } else {
        // Repli sans GPU : chaque coup de sifflet suivi d'un arrêt est proposé comme arrêt de jeu à qualifier
        for (const s of sifflets.filter((x) => x.confiance > 0.6)) {
          propositions.push({ type: 'arret_jeu', debut: Math.max(0, s.debut - 2), fin: s.fin + 6, confiance: s.confiance * 0.6, details: { methode: 'sifflet' } });
        }
      }
    }
    if (analyses.includes('tracking') && process.env.IA_SERVICE_URL) {
      const r = await fetch(`${process.env.IA_SERVICE_URL}/tracking`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ video: videoPourIa(job.club_id!, videoId, source) }),
      });
      if (!r.ok) throw new Error(`Service IA : ${r.status}`);
      const pistes = (await r.json()) as { piste: number; camp?: string; numero?: number; confiance_numero?: number; positions: number[][] }[];
      await poolAdmin.query('DELETE FROM tracking WHERE match_id = $1 AND club_id = $2', [matchId, job.club_id]);
      for (const p of pistes) {
        await poolAdmin.query('INSERT INTO tracking (club_id, match_id, piste, camp, numero, confiance_numero, positions) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [job.club_id, matchId, p.piste, p.camp ?? null, p.numero ?? null, p.confiance_numero ?? null, JSON.stringify(p.positions)]);
      }
    }
    // Les propositions remplacent les précédentes non traitées du même type
    const types = [...new Set(propositions.map((p) => p.type))];
    await poolAdmin.query("DELETE FROM propositions_ia WHERE match_id = $1 AND club_id = $2 AND statut = 'en_attente' AND type = ANY($3)", [matchId, job.club_id, types]);
    for (const p of propositions) {
      await poolAdmin.query('INSERT INTO propositions_ia (club_id, match_id, video_id, type, debut, fin, confiance, details) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [job.club_id, matchId, videoId, p.type, p.debut, p.fin, Math.round(p.confiance * 100) / 100, JSON.stringify(p.details)]);
    }
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

/** Synchronisation d'un angle secondaire sur le principal par les coups de sifflet communs. */
export async function synchroAngles(job: Job) {
  const { videoId, referenceId } = job.payload;
  const tmp = await dossierTemporaire('synchro');
  try {
    const a = detecterSifflets(await decoderAudio(await sourceAnalyse(job.club_id!, referenceId, path.join(tmp, 'a'))));
    const b = detecterSifflets(await decoderAudio(await sourceAnalyse(job.club_id!, videoId, path.join(tmp, 'b'))));
    const r = decalageParSifflets(a, b);
    if (!r) throw new Error('Synchronisation impossible : pas assez de coups de sifflet communs, placez un repère manuellement');
    const ref = (await poolAdmin.query('SELECT decalage FROM videos WHERE id = $1', [referenceId])).rows[0];
    await majVideo(videoId, { decalage: (ref?.decalage ?? 0) + r.decalage });
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

const echapperTexte = (t: string) => t.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\u2019").replace(/%/g, '\\%');

/** Export MP4 d'une playlist : incrustations (titre, score, filigrane), 16:9 ou 9:16. */
export async function exportVideo(job: Job) {
  const { exportId } = job.payload;
  const e = (await poolAdmin.query('SELECT * FROM exports_video WHERE id = $1 AND club_id = $2', [exportId, job.club_id])).rows[0];
  if (!e) return;
  await poolAdmin.query("UPDATE exports_video SET statut = 'en_cours' WHERE id = $1", [exportId]);
  const p = (await poolAdmin.query('SELECT p.*, c.nom AS club FROM playlists p JOIN clubs c ON c.id = p.club_id WHERE p.id = $1', [e.playlist_id])).rows[0];
  const clips = (await poolAdmin.query('SELECT * FROM playlist_clips WHERE playlist_id = $1 ORDER BY ordre', [e.playlist_id])).rows;
  const match = p.match_id ? (await poolAdmin.query('SELECT m.*, a.nom AS adversaire FROM matchs m LEFT JOIN adversaires a ON a.id = m.adversaire_id WHERE m.id = $1', [p.match_id])).rows[0] : null;
  const police = process.env.FONT_PATH ?? '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
  const tmp = await dossierTemporaire('export');
  try {
    const segments: string[] = [];
    const sources = new Map<string, string>();
    for (const [i, c] of clips.entries()) {
      if (!sources.has(c.video_id)) sources.set(c.video_id, await sourceAnalyseHd(job.club_id!, c.video_id, path.join(tmp, `v${sources.size}`)));
      const vertical = e.format === '9:16';
      const textes = [
        `drawtext=fontfile=${police}:text='${echapperTexte(c.titre ?? p.titre)}':x=24:y=24:fontsize=${vertical ? 34 : 30}:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=10`,
        match && match.score_nous != null ? `drawtext=fontfile=${police}:text='${echapperTexte(`${p.club} ${match.score_nous} - ${match.score_adv} ${match.adversaire ?? ''}`)}':x=w-tw-24:y=24:fontsize=26:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=8` : null,
        e.filigrane ? `drawtext=fontfile=${police}:text='${echapperTexte(e.filigrane)}':x=(w-tw)/2:y=h-th-40:fontsize=28:fontcolor=white@0.35` : null,
      ].filter(Boolean);
      const cadrage = vertical ? 'crop=ih*9/16:ih,scale=1080:1920' : 'scale=-2:720';
      const seg = path.join(tmp, `seg${String(i).padStart(3, '0')}.mp4`);
      await executer(FFMPEG, ['-hide_banner', '-y', '-ss', String(c.debut), '-to', String(c.fin), '-i', sources.get(c.video_id)!,
        '-vf', [cadrage, ...textes].join(','), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
        '-af', 'aresample=async=1', '-movflags', '+faststart', seg]);
      segments.push(seg);
    }
    if (!segments.length) throw new Error('Playlist vide');
    const liste = path.join(tmp, 'liste.txt');
    await fs.writeFile(liste, segments.map((s) => `file '${s}'`).join('\n'));
    const final = path.join(tmp, 'export.mp4');
    await executer(FFMPEG, ['-hide_banner', '-y', '-f', 'concat', '-safe', '0', '-i', liste, '-c', 'copy', '-movflags', '+faststart', final]);
    const cle = `clubs/${job.club_id}/exports/${exportId}.mp4`;
    await stockage.televerserFichier(final, cle);
    await poolAdmin.query("UPDATE exports_video SET statut = 'termine', cle_stockage = $2 WHERE id = $1", [exportId, cle]);
  } catch (err) {
    await poolAdmin.query("UPDATE exports_video SET statut = 'echec', erreur = $2 WHERE id = $1", [exportId, String((err as Error).message).slice(0, 500)]);
    throw err;
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

async function sourceAnalyseHd(clubId: string, videoId: string, tmp: string) {
  const v = (await poolAdmin.query('SELECT renditions FROM videos WHERE id = $1', [videoId])).rows[0];
  const r = (v?.renditions as string[]).includes('720p') ? '720p' : (v?.renditions as string[])[0];
  const local = stockage.cheminLocal(`${prefixeVideo(clubId, videoId)}/hls/${r}/index.m3u8`);
  return local ?? sourceAnalyse(clubId, videoId, tmp);
}

/** Archivage froid d'une saison : seules les versions 480p sont conservées. */
export async function archivageSaison(job: Job) {
  const { saisonId } = job.payload;
  const videos = (await poolAdmin.query(
    `SELECT v.* FROM videos v JOIN matchs m ON m.id = v.match_id JOIN equipes e ON e.id = m.equipe_id
     WHERE e.saison_id = $1 AND v.club_id = $2 AND v.statut = 'pret'`, [saisonId, job.club_id])).rows;
  for (const v of videos) {
    const base = `${prefixeVideo(job.club_id!, v.id)}/hls`;
    const garder = (v.renditions as string[]).slice(-1)[0];
    for (const r of v.renditions as string[]) if (r !== garder) await stockage.supprimerPrefixe(`${base}/${r}`);
    const master = await stockage.lireTexte(`${base}/master.m3u8`);
    if (master) {
      const lignes = master.split('\n');
      const out: string[] = [];
      for (let i = 0; i < lignes.length; i++) {
        if (lignes[i].startsWith('#EXT-X-STREAM-INF') && !lignes[i + 1]?.startsWith(`${garder}/`)) { i++; continue; }
        out.push(lignes[i]);
      }
      await stockage.ecrire(`${base}/master.m3u8`, out.join('\n'));
    }
    await stockage.supprimerPrefixe(`${prefixeVideo(job.club_id!, v.id)}/original`);
    await poolAdmin.query("UPDATE videos SET statut = 'archive', renditions = $2 WHERE id = $1", [v.id, JSON.stringify([garder])]);
  }
  await poolAdmin.query('UPDATE saisons SET archivee = true WHERE id = $1 AND club_id = $2', [saisonId, job.club_id]);
  await poolAdmin.query('UPDATE equipes SET archivee = true WHERE saison_id = $1 AND club_id = $2', [saisonId, job.club_id]);
}

/** Suppression définitive 90 jours après la fin d'abonnement (sauf réactivation). */
export async function purgeClub(job: Job) {
  const c = (await poolAdmin.query('SELECT * FROM clubs WHERE id = $1', [job.club_id])).rows[0];
  if (!c || !c.suppression_prevue || new Date(c.suppression_prevue) > new Date()) return;
  await stockage.supprimerPrefixe(`clubs/${c.id}`);
  await poolAdmin.query('DELETE FROM clubs WHERE id = $1', [c.id]);
}

export const TACHES: Record<string, (job: Job) => Promise<void>> = {
  transcodage, import_url: importUrl, analyse_ia: analyseIa, synchro_angles: synchroAngles,
  export_video: exportVideo, archivage_saison: archivageSaison, purge_club: purgeClub,
};
