import type { Db } from './db.js';

export type TypeJob = 'transcodage' | 'import_url' | 'analyse_ia' | 'synchro_angles' | 'export_video' | 'purge_club' | 'archivage_saison';

/** Met un traitement en file (dans la transaction courante : il n'existe que si la transaction aboutit). */
export async function enfiler(db: Db, clubId: string | null, type: TypeJob, payload: Record<string, unknown>) {
  const r = await db.query('INSERT INTO jobs (club_id, type, payload) VALUES ($1, $2, $3) RETURNING id', [clubId, type, JSON.stringify(payload)]);
  await db.query("SELECT pg_notify('jobs', $1)", [type]);
  return r.rows[0].id as string;
}
