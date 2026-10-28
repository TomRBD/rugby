import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { ErreurHttp } from './lib/erreurs.js';
import { config } from './lib/config.js';
import routesAuth from './routes/auth.js';
import routesClub from './routes/club.js';
import routesEffectif from './routes/effectif.js';
import routesMatchs from './routes/matchs.js';
import routesVideos from './routes/videos.js';
import routesCodage from './routes/codage.js';
import routesStats from './routes/stats.js';
import routesPlaylists from './routes/playlists.js';
import routesPublic from './routes/public.js';
import routesJoueur from './routes/joueur.js';
import routesSante from './routes/sante.js';
import routesIa from './routes/ia.js';
import routesEchanges from './routes/echanges.js';
import routesRapports from './routes/rapports.js';
import { poolApp } from './lib/db.js';

export async function construireApp(options: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 25 * 1024 * 1024, trustProxy: true });
  await app.register(cors, { origin: [config.publicWebUrl, /^http:\/\/localhost(:\d+)?$/], credentials: true });
  await app.register(websocket);

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ErreurHttp) return reply.code(err.statut).send({ erreur: err.message, code: err.code });
    const e = err as { statusCode?: number; validation?: unknown; code?: string; message: string };
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ erreur: e.message });
    // Violation de contrainte PostgreSQL : message lisible plutôt qu'une erreur 500
    if (e.code === '23505') return reply.code(409).send({ erreur: 'Cet élément existe déjà (doublon)' });
    if (e.code === '23503') return reply.code(400).send({ erreur: 'Référence invalide' });
    if (e.code === '42501') return reply.code(404).send({ erreur: 'Ressource introuvable' }); // RLS
    req.log.error(err);
    return reply.code(500).send({ erreur: 'Erreur interne' });
  });

  app.get('/api/etat', async () => {
    await poolApp.query('SELECT 1');
    return { ok: true, version: '1.0.0' };
  });

  for (const r of [routesAuth, routesClub, routesEffectif, routesMatchs, routesVideos, routesCodage, routesStats, routesPlaylists,
    routesPublic, routesJoueur, routesSante, routesIa, routesEchanges, routesRapports]) {
    await app.register(r);
  }
  return app;
}
