// Applique les migrations SQL dans l'ordre, puis accorde les droits au rôle applicatif.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from './lib/config.js';

const dossier = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../migrations');

export async function migrer(url = config.databaseUrl, log = console.log) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('CREATE TABLE IF NOT EXISTS migrations (nom text PRIMARY KEY, le timestamptz NOT NULL DEFAULT now())');
    await client.query('SELECT pg_advisory_lock(424242)');
    const faites = new Set((await client.query('SELECT nom FROM migrations')).rows.map((r) => r.nom));
    for (const f of (await fs.readdir(dossier)).filter((x) => x.endsWith('.sql')).sort()) {
      if (faites.has(f)) continue;
      log(`Migration ${f}`);
      await client.query('BEGIN');
      await client.query(await fs.readFile(path.join(dossier, f), 'utf8'));
      await client.query('INSERT INTO migrations (nom) VALUES ($1)', [f]);
      await client.query('COMMIT');
    }
    const app = (await client.query("SELECT 1 FROM pg_roles WHERE rolname = 'rugby_app'")).rowCount;
    if (app) {
      await client.query('GRANT USAGE ON SCHEMA public TO rugby_app');
      await client.query('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO rugby_app');
      await client.query('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO rugby_app');
      await client.query('REVOKE ALL ON migrations FROM rugby_app');
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(424242)').catch(() => undefined);
    await client.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  migrer().then(() => console.log('Migrations à jour'), (e) => { console.error(e); process.exit(1); });
}
