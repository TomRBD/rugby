import pg from 'pg';

// Base de test remise à zéro puis migrée avant la suite
export default async function () {
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://rugby_admin:rugby_admin@localhost:5433/rugby_test';
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO public');
  await c.end();
  process.env.DATABASE_URL = url;
  const { migrer } = await import('../src/migrate.js');
  await migrer(url, () => undefined);
}
