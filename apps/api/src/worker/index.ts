// Worker : file de traitements PostgreSQL (SKIP LOCKED), plusieurs jobs FFmpeg en parallèle.
import pg from 'pg';
import { config } from '../lib/config.js';
import { poolAdmin } from '../lib/db.js';
import { migrer } from '../migrate.js';
import { TACHES, type Job } from './taches.js';

const CONCURRENCE = Number(process.env.WORKER_CONCURRENCY ?? Math.max(2, Math.floor((await import('node:os')).cpus().length / 4)));
const MAX_TENTATIVES = 3;
let actifs = 0;
let arret = false;

async function prendreJob(): Promise<Job | null> {
  const r = await poolAdmin.query(
    `UPDATE jobs SET statut = 'en_cours', verrouille_le = now(), tentatives = tentatives + 1
     WHERE id = (SELECT id FROM jobs WHERE statut = 'en_attente' AND executer_apres <= now() ORDER BY cree_le FOR UPDATE SKIP LOCKED LIMIT 1)
     RETURNING id, club_id, type, payload, tentatives`);
  return r.rows[0] ?? null;
}

async function executerJob(job: Job & { tentatives: number }) {
  const t0 = Date.now();
  try {
    const tache = TACHES[job.type];
    if (!tache) throw new Error(`Type de job inconnu : ${job.type}`);
    await tache(job);
    await poolAdmin.query("UPDATE jobs SET statut = 'termine', erreur = NULL WHERE id = $1", [job.id]);
    console.log(`[worker] ${job.type} ${job.id} terminé en ${Math.round((Date.now() - t0) / 1000)} s`);
  } catch (e) {
    const message = String((e as Error).message ?? e).slice(0, 2000);
    const definitif = job.tentatives >= MAX_TENTATIVES;
    await poolAdmin.query(
      `UPDATE jobs SET statut = $2, erreur = $3, executer_apres = now() + ($4 || ' seconds')::interval WHERE id = $1`,
      [job.id, definitif ? 'echec' : 'en_attente', message, String(30 * 2 ** job.tentatives)]);
    if (definitif && job.payload.videoId && ['transcodage', 'import_url'].includes(job.type)) {
      await poolAdmin.query("UPDATE videos SET statut = 'erreur', erreur = $2 WHERE id = $1", [job.payload.videoId, message.slice(0, 500)]);
    }
    console.error(`[worker] ${job.type} ${job.id} en échec (tentative ${job.tentatives}) : ${message}`);
  }
}

async function remplir() {
  while (!arret && actifs < CONCURRENCE) {
    const job = await prendreJob();
    if (!job) return;
    actifs++;
    executerJob(job as Job & { tentatives: number }).finally(() => { actifs--; void remplir(); });
  }
}

export async function demarrerWorker() {
  await migrer();
  // Jobs restés « en cours » après un arrêt brutal : remis en file
  await poolAdmin.query("UPDATE jobs SET statut = 'en_attente' WHERE statut = 'en_cours' AND verrouille_le < now() - interval '3 hours'");
  const ecoute = new pg.Client({ connectionString: config.databaseUrl });
  await ecoute.connect();
  await ecoute.query('LISTEN jobs');
  ecoute.on('notification', () => void remplir());
  setInterval(() => void remplir(), 5000);
  console.log(`[worker] démarré, ${CONCURRENCE} traitement(s) en parallèle`);
  await remplir();
  const stop = async () => {
    arret = true;
    console.log('[worker] arrêt demandé, fin des traitements en cours...');
    while (actifs > 0) await new Promise((r) => setTimeout(r, 500));
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

await demarrerWorker();
