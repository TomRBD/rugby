import { construireApp } from './app.js';
import { config } from './lib/config.js';
import { migrer } from './migrate.js';

if (process.env.MIGRER_AU_DEMARRAGE !== '0') await migrer();
const app = await construireApp({ logger: true });
await app.listen({ port: config.port, host: '0.0.0.0' });
