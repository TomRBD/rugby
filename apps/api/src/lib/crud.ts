// Routes CRUD génériques pour les tables simples du club (toujours via RLS + contrôle de rôle).
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Permission } from '@rugby/shared';
import { avec, contexte, exigerPermission, filtreEquipes, journaliser, valider, uuid, type Contexte } from './contexte.js';
import type { Db } from './db.js';
import { nonTrouve } from './erreurs.js';

interface OptionsCrud<S extends z.ZodObject<any>> {
  chemin: string; // ex. /api/clubs/:clubId/joueurs
  table: string;
  schema: S;
  lire: Permission;
  ecrire: Permission;
  ordre?: string;
  colonnesJson?: string[];
  /** Colonne d'équipe pour le cloisonnement par équipe ('id' pour la table equipes). */
  colonneEquipe?: string;
  avantCreation?: (db: Db, ctx: Contexte, data: z.infer<S>) => Promise<void>;
  apresEcriture?: (db: Db, ctx: Contexte, ligne: Record<string, any>) => Promise<void>;
  selection?: string; // SELECT personnalisé (alias t)
}

export function crud<S extends z.ZodObject<any>>(app: FastifyInstance, o: OptionsCrud<S>) {
  const sel = o.selection ?? `SELECT t.* FROM ${o.table} t`;
  const ser = (k: string, v: unknown) => (o.colonnesJson?.includes(k) ? JSON.stringify(v) : v);

  app.get(o.chemin, async (req) => {
    const ctx = await contexte(req, o.lire);
    const p: unknown[] = [];
    const where = o.colonneEquipe ? filtreEquipes(ctx, o.lire, `t.${o.colonneEquipe}`, p) : 'TRUE';
    return avec(ctx, async (db) => (await db.query(`${sel} WHERE ${where} ORDER BY ${o.ordre ?? 't.id'}`, p)).rows);
  });

  app.get(`${o.chemin}/:id`, async (req) => {
    const ctx = await contexte(req, o.lire);
    const { id } = valider(z.object({ id: uuid }), req.params);
    return avec(ctx, async (db) => {
      const l = (await db.query(`${sel} WHERE t.id = $1`, [id])).rows[0];
      if (!l) throw nonTrouve();
      if (o.colonneEquipe) exigerPermission(ctx, o.lire, l[o.colonneEquipe]);
      return l;
    });
  });

  app.post(o.chemin, async (req) => {
    const ctx = await contexte(req, o.ecrire);
    const data = valider(o.schema, req.body);
    if (o.colonneEquipe && o.colonneEquipe !== 'id') exigerPermission(ctx, o.ecrire, (data as any)[o.colonneEquipe]);
    else if (o.colonneEquipe === 'id') exigerPermission(ctx, o.ecrire, null);
    return avec(ctx, async (db) => {
      await o.avantCreation?.(db, ctx, data);
      const cles = Object.keys(data).filter((k) => (data as any)[k] !== undefined);
      const r = await db.query(
        `INSERT INTO ${o.table} (club_id${cles.map((k) => `, ${k}`).join('')}) VALUES ($1${cles.map((_, i) => `, $${i + 2}`).join('')}) RETURNING *`,
        [ctx.clubId, ...cles.map((k) => ser(k, (data as any)[k]))],
      );
      await o.apresEcriture?.(db, ctx, r.rows[0]);
      return r.rows[0];
    });
  });

  app.patch(`${o.chemin}/:id`, async (req) => {
    const ctx = await contexte(req, o.ecrire);
    const { id } = valider(z.object({ id: uuid }), req.params);
    const data = valider(o.schema.partial(), req.body);
    return avec(ctx, async (db) => {
      const avant = (await db.query(`SELECT * FROM ${o.table} WHERE id = $1`, [id])).rows[0];
      if (!avant) throw nonTrouve();
      if (o.colonneEquipe) exigerPermission(ctx, o.ecrire, avant[o.colonneEquipe]);
      const cles = Object.keys(data).filter((k) => (data as any)[k] !== undefined);
      if (!cles.length) return avant;
      const r = await db.query(
        `UPDATE ${o.table} SET ${cles.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`,
        [id, ...cles.map((k) => ser(k, (data as any)[k]))],
      );
      await o.apresEcriture?.(db, ctx, r.rows[0]);
      return r.rows[0];
    });
  });

  app.delete(`${o.chemin}/:id`, async (req) => {
    const ctx = await contexte(req, o.ecrire);
    const { id } = valider(z.object({ id: uuid }), req.params);
    return avec(ctx, async (db) => {
      const avant = (await db.query(`SELECT * FROM ${o.table} WHERE id = $1`, [id])).rows[0];
      if (!avant) throw nonTrouve();
      if (o.colonneEquipe) exigerPermission(ctx, o.ecrire, avant[o.colonneEquipe]);
      await db.query(`DELETE FROM ${o.table} WHERE id = $1`, [id]);
      await journaliser(db, ctx, 'suppression', o.table, id);
      return { ok: true };
    });
  });
}
