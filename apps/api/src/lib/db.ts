import pg from 'pg';
import { config } from './config.js';

// Les numeric/bigint reviennent en nombres JS (tailles de fichiers < 2^53)
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));
pg.types.setTypeParser(1082, (v) => v); // date -> chaîne AAAA-MM-JJ

/** Connexion administrateur : migrations, worker, recherches système. Contourne la RLS (propriétaire des tables). */
export const poolAdmin = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });
/** Connexion applicative : rôle sans privilège, soumis aux politiques RLS par club. */
export const poolApp = new pg.Pool({ connectionString: config.appDatabaseUrl, max: 30 });

// Une connexion inactive coupée par le réseau (Docker Desktop, pare-feu, redémarrage de PostgreSQL) ne doit pas
// arrêter le processus : le pool la retire et en ouvre une nouvelle à la prochaine requête.
for (const [nom, pool] of [['admin', poolAdmin], ['app', poolApp]] as const) {
  pool.on('error', (e) => console.error(`[db] connexion ${nom} perdue, elle sera rouverte : ${e.message}`));
}

export type Db = pg.PoolClient;

/** Exécute fn dans une transaction où seules les lignes du club sont visibles. */
export async function avecClub<T>(clubId: string, fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await poolApp.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.club_id', $1, true)", [clubId]);
    const r = await fn(client);
    await client.query('COMMIT');
    return r;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

/** Transaction hors contexte club (utilisateurs, fonctions SECURITY DEFINER). */
export async function sansClub<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await poolApp.connect();
  try {
    await client.query('BEGIN');
    const r = await fn(client);
    await client.query('COMMIT');
    return r;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

export async function fermerPools() {
  await Promise.all([poolAdmin.end(), poolApp.end()]);
}
