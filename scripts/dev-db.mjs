// Démarre la base de développement : binaires PostgreSQL locaux sous Linux, sinon Docker (Windows, macOS).
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const action = process.argv[2] ?? 'start';
const binairesLinux = process.platform === 'linux' && existsSync('/usr/lib/postgresql') && readdirSync('/usr/lib/postgresql').length > 0;
const dockerPresent = spawnSync('docker', ['version'], { stdio: 'ignore', shell: true }).status === 0;

if (binairesLinux && !dockerPresent) {
  execSync(`bash scripts/dev-db.sh ${action}`, { cwd: racine, stdio: 'inherit' });
} else if (dockerPresent) {
  const cmd = action === 'stop'
    ? 'docker compose -f docker-compose.dev.yml stop'
    : 'docker compose -f docker-compose.dev.yml up -d --wait';
  execSync(cmd, { cwd: racine, stdio: 'inherit' });
  if (action !== 'stop') console.log('PostgreSQL prêt sur le port 5433 (bases rugby et rugby_test)');
} else {
  console.error(`Aucune base PostgreSQL disponible.
- Recommandé : installez Docker Desktop (https://www.docker.com/products/docker-desktop/), lancez-le, puis relancez : npm run db:start
- Ou installez PostgreSQL 16 nativement, exécutez deploy/init-db-dev.sql avec l'utilisateur postgres,
  puis indiquez le port dans un fichier .env à la racine (copie de .env.example) : DATABASE_URL et APP_DATABASE_URL.`);
  process.exit(1);
}
