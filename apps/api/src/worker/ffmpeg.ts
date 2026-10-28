import { spawn } from 'node:child_process';

export const FFMPEG = process.env.FFMPEG_PATH ?? 'ffmpeg';
export const FFPROBE = process.env.FFPROBE_PATH ?? 'ffprobe';

export function messageIntrouvable(cmd: string) {
  return `${cmd} introuvable sur la machine du worker. Installez FFmpeg (Windows : winget install Gyan.FFmpeg, puis rouvrez le terminal ; `
    + `macOS : brew install ffmpeg ; Linux : apt install ffmpeg) ou indiquez son chemin dans .env (FFMPEG_PATH et FFPROBE_PATH), puis relancez le worker.`;
}

/** Vérifie que ffmpeg et ffprobe se lancent. */
export async function verifierFfmpeg(): Promise<string | null> {
  for (const cmd of [FFMPEG, FFPROBE]) {
    try {
      await executer(cmd, ['-version']);
    } catch (e) {
      return (e as Error).message;
    }
  }
  return null;
}

export interface Sonde {
  duree: number;
  largeur: number;
  hauteur: number;
  audio: boolean;
  rotation: number;
}

export function executer(cmd: string, args: string[], surSortie?: (ligne: string) => void): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let reste = '';
    p.stdout.on('data', (d: Buffer) => {
      const t = d.toString();
      stdout += t.length < 1e6 ? t : '';
      if (surSortie) {
        const lignes = (reste + t).split('\n');
        reste = lignes.pop() ?? '';
        lignes.forEach(surSortie);
      }
    });
    p.stderr.on('data', (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-200_000);
    });
    p.on('error', (e: NodeJS.ErrnoException) => reject(e.code === 'ENOENT' ? new Error(messageIntrouvable(cmd)) : e));
    p.on('close', (code) => (code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${cmd} a échoué (${code}) : ${stderr.slice(-1500)}`))));
  });
}

export async function sonder(fichier: string): Promise<Sonde> {
  const { stdout } = await executer(FFPROBE, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', fichier]);
  const j = JSON.parse(stdout);
  const v = j.streams.find((s: any) => s.codec_type === 'video');
  if (!v) throw new Error('Aucune piste vidéo détectée');
  const rotation = Math.abs(Number(v.tags?.rotate ?? v.side_data_list?.find((s: any) => s.rotation !== undefined)?.rotation ?? 0));
  const [l, h] = rotation === 90 || rotation === 270 ? [v.height, v.width] : [v.width, v.height];
  return { duree: Number(j.format.duration ?? v.duration ?? 0), largeur: l, hauteur: h, audio: j.streams.some((s: any) => s.codec_type === 'audio'), rotation };
}

/** Lance ffmpeg avec suivi de progression (0 à 1) à partir de la durée attendue. */
export function ffmpegAvecProgression(args: string[], duree: number, progression: (p: number) => void) {
  let derniere = 0;
  return executer(FFMPEG, ['-hide_banner', '-y', '-progress', 'pipe:1', '-nostats', ...args], (l) => {
    const m = l.match(/^out_time_(?:ms|us)=(\d+)/);
    if (m && duree > 0) {
      const p = Math.min(0.999, Number(m[1]) / 1e6 / duree);
      if (p - derniere > 0.01) {
        derniere = p;
        progression(p);
      }
    }
  });
}

/** Décode l'audio en PCM mono 16 bits pour l'analyse (sifflet, synchro des angles). */
export async function decoderAudio(fichier: string, frequence = 8000): Promise<Int16Array> {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, ['-v', 'error', '-i', fichier, '-vn', '-ac', '1', '-ar', String(frequence), '-f', 's16le', 'pipe:1'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const morceaux: Buffer[] = [];
    let err = '';
    p.stdout.on('data', (d: Buffer) => morceaux.push(d));
    p.stderr.on('data', (d: Buffer) => { err += d.toString(); });
    p.on('error', reject);
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(err.slice(-500)));
      const b = Buffer.concat(morceaux);
      resolve(new Int16Array(b.buffer, b.byteOffset, Math.floor(b.length / 2)));
    });
  });
}
