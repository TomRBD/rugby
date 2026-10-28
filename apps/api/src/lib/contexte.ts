import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { OFFRES, peut, equipesAccessibles, type Adhesion, type CodeOffre, type Fonctionnalite, type Permission, type Role } from '@rugby/shared';
import { avecClub, sansClub, type Db } from './db.js';
import { verifierJwt, type JetonSession } from './securite.js';
import { ErreurHttp, interdit, nonTrouve, quotaAtteint, requeteInvalide } from './erreurs.js';

export interface Contexte {
  clubId: string;
  utilisateurId: string;
  adhesions: (Adhesion & { joueurId: string | null })[];
  offre: CodeOffre;
  suspendu: boolean;
  session: JetonSession;
}

export function session(req: FastifyRequest): JetonSession {
  const h = req.headers.authorization;
  const jeton = h?.startsWith('Bearer ') ? h.slice(7) : undefined;
  const s = jeton ? verifierJwt(jeton) : null;
  if (!s) throw new ErreurHttp(401, 'Connexion requise', 'non_connecte');
  return s;
}

const MFA_OBLIGATOIRE = process.env.MFA_OBLIGATOIRE ? process.env.MFA_OBLIGATOIRE === '1' : process.env.NODE_ENV === 'production';
const PERMISSIONS_SENSIBLES: Permission[] = ['sante.lire', 'sante.ecrire', 'club.gerer'];

/**
 * Charge le contexte club de la requête et vérifie la permission.
 * equipeId : voir `peut` (omis = au moins une équipe, null = club entier).
 */
export async function contexte(req: FastifyRequest, permission?: Permission, equipeId?: string | null): Promise<Contexte> {
  const s = session(req);
  const clubId = (req.params as { clubId?: string }).clubId;
  if (!clubId || !z.string().uuid().safeParse(clubId).success) throw requeteInvalide('Club invalide');
  const { lignes, club, mfaActif } = await sansClub(async (db) => {
    const lignes = (await db.query('SELECT * FROM f_mes_adhesions($1) WHERE club_id = $2', [s.sub, clubId])).rows;
    const u = (await db.query('SELECT mfa_actif FROM utilisateurs WHERE id = $1', [s.sub])).rows[0];
    return { lignes, mfaActif: !!u?.mfa_actif, club: null as null | { offre: CodeOffre; suspendu_ete: boolean } };
  });
  // Aucune adhésion : le club est invisible (404 et non 403, pour ne rien révéler)
  if (!lignes.length) throw nonTrouve('Club');
  const infos = await avecClub(clubId, async (db) => (await db.query('SELECT offre, suspendu_ete FROM clubs WHERE id = $1', [clubId])).rows[0]);
  const ctx: Contexte = {
    clubId,
    utilisateurId: s.sub,
    adhesions: lignes.map((l) => ({ role: l.role as Role, equipeId: l.equipe_id, joueurId: l.joueur_id })),
    offre: (infos ?? club)?.offre ?? 'decouverte',
    suspendu: !!infos?.suspendu_ete,
    session: s,
  };
  if (permission) {
    if (!peut(ctx.adhesions, permission, equipeId)) throw interdit();
    if (PERMISSIONS_SENSIBLES.includes(permission)) {
      if (mfaActif && !s.mfa) throw new ErreurHttp(401, 'Code de double authentification requis', 'mfa_requise');
      if (!mfaActif && MFA_OBLIGATOIRE) throw new ErreurHttp(403, 'Activez la double authentification pour accéder à cette section', 'mfa_a_activer');
    }
    if (ctx.suspendu && /\.ecrire$/.test(permission)) throw new ErreurHttp(423, 'Abonnement en suspension estivale : lecture seule', 'suspendu');
  }
  return ctx;
}

export function exigerFonction(ctx: Contexte, f: Fonctionnalite) {
  if (!OFFRES[ctx.offre].fonctionnalites.includes(f)) {
    throw quotaAtteint(`Fonction non incluse dans l'offre ${OFFRES[ctx.offre].nom}`);
  }
}

export function exigerPermission(ctx: Contexte, p: Permission, equipeId?: string | null) {
  if (!peut(ctx.adhesions, p, equipeId)) throw interdit();
}

/** Clause SQL limitant aux équipes accessibles ; renvoie [sql, params] à concaténer. */
export function filtreEquipes(ctx: Contexte, p: Permission, colonne: string, params: unknown[]): string {
  const eq = equipesAccessibles(ctx.adhesions, p);
  if (eq === null) return 'TRUE';
  params.push(eq);
  return `${colonne} = ANY($${params.length}::uuid[])`;
}

export const avec = <T>(ctx: Contexte, fn: (db: Db) => Promise<T>) => avecClub(ctx.clubId, fn);

export async function journaliser(db: Db, ctx: Contexte, action: string, cible?: string, cibleId?: string, details?: unknown) {
  await db.query('INSERT INTO journal (club_id, utilisateur_id, action, cible, cible_id, details) VALUES ($1,$2,$3,$4,$5,$6)', [
    ctx.clubId, ctx.utilisateurId, action, cible ?? null, cibleId ?? null, details ? JSON.stringify(details) : null,
  ]);
}

export function valider<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const p = r.error.issues[0];
    throw requeteInvalide(`${p.path.join('.') || 'requête'} : ${p.message}`);
  }
  return r.data;
}

/** Équipe d'un match, avec contrôle d'accès à cette équipe. */
export async function matchAccessible(db: Db, ctx: Contexte, matchId: string, p: Permission) {
  const m = (await db.query('SELECT * FROM matchs WHERE id = $1', [matchId])).rows[0];
  if (!m) throw nonTrouve('Match');
  exigerPermission(ctx, p, m.equipe_id);
  return m;
}

export const uuid = z.string().uuid();
export const params = <T extends z.ZodRawShape>(req: FastifyRequest, shape: T) => valider(z.object(shape), req.params);
