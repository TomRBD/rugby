import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { z } from 'zod';
import { TAXONOMIE_DEFAUT, ROLES_MFA, type Role } from '@rugby/shared';
import { avecClub, sansClub, type Db } from '../lib/db.js';
import {
  creerJwt, hacherJeton, hacherMotDePasse, secretTotp, verifierMotDePasse, verifierTotp,
} from '../lib/securite.js';
import { session, valider } from '../lib/contexte.js';
import { ErreurHttp, nonTrouve, requeteInvalide } from '../lib/erreurs.js';

const identifiant = z.object({
  email: z.string().email().optional(),
  telephone: z.string().regex(/^\+?[0-9 .]{8,20}$/, 'numéro invalide').optional(),
}).refine((x) => x.email || x.telephone, 'email ou téléphone requis');

export function slugifier(s: string) {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

const normaliserTel = (t?: string) => (t ? t.replace(/[ .]/g, '') : undefined);

/** Crée un club, sa saison courante, sa taxonomie par défaut et l'adhésion administrateur. */
export async function creerClub(utilisateurId: string, nom: string, extra: { comite?: string; poule?: string } = {}) {
  const clubId = crypto.randomUUID();
  const slug = `${slugifier(nom)}-${clubId.slice(0, 6)}`;
  await avecClub(clubId, async (db) => {
    await db.query('INSERT INTO clubs (id, nom, slug, comite, poule) VALUES ($1,$2,$3,$4,$5)', [clubId, nom, slug, extra.comite ?? null, extra.poule ?? null]);
    const now = new Date();
    const annee = now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
    await db.query('INSERT INTO saisons (club_id, libelle, debut, fin) VALUES ($1,$2,$3,$4)', [clubId, `${annee}-${annee + 1}`, `${annee}-07-01`, `${annee + 1}-06-30`]);
    await copierTaxonomie(db, clubId);
    await db.query("INSERT INTO adhesions (club_id, utilisateur_id, role) VALUES ($1,$2,'admin')", [clubId, utilisateurId]);
  });
  return { clubId, slug };
}

export async function copierTaxonomie(db: Db, clubId: string) {
  for (const t of TAXONOMIE_DEFAUT) {
    await db.query('INSERT INTO types_evenements (club_id, key, definition) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [clubId, t.key, JSON.stringify(t)]);
  }
}

async function profil(db: Db, utilisateurId: string) {
  const u = (await db.query('SELECT id, email, telephone, nom, mfa_actif, langue FROM utilisateurs WHERE id = $1', [utilisateurId])).rows[0];
  if (!u) throw nonTrouve('Utilisateur');
  const adh = (await db.query('SELECT * FROM f_mes_adhesions($1)', [utilisateurId])).rows;
  const clubs = new Map<string, { id: string; nom: string; slug: string; roles: { role: Role; equipeId: string | null; joueurId: string | null }[] }>();
  for (const a of adh) {
    if (!clubs.has(a.club_id)) clubs.set(a.club_id, { id: a.club_id, nom: a.club_nom, slug: a.club_slug, roles: [] });
    clubs.get(a.club_id)!.roles.push({ role: a.role, equipeId: a.equipe_id, joueurId: a.joueur_id });
  }
  const mfaRecommandee = adh.some((a) => ROLES_MFA.includes(a.role));
  return { ...u, clubs: [...clubs.values()], mfaRecommandee };
}

export default async function routesAuth(app: FastifyInstance) {
  app.post('/api/auth/inscription', async (req) => {
    const b = valider(z.object({
      nom: z.string().min(2),
      motDePasse: z.string().min(8, '8 caractères minimum'),
      club: z.object({ nom: z.string().min(2), comite: z.string().optional(), poule: z.string().optional() }).optional(),
    }).and(identifiant), req.body);
    const id = await sansClub(async (db) => {
      const existe = await db.query('SELECT 1 FROM utilisateurs WHERE email = $1 OR telephone = $2', [b.email ?? null, normaliserTel(b.telephone) ?? null]);
      if (existe.rowCount) throw requeteInvalide('Un compte existe déjà avec cet identifiant');
      return (await db.query('INSERT INTO utilisateurs (email, telephone, mot_de_passe, nom) VALUES ($1,$2,$3,$4) RETURNING id',
        [b.email?.toLowerCase() ?? null, normaliserTel(b.telephone) ?? null, hacherMotDePasse(b.motDePasse), b.nom])).rows[0].id;
    });
    if (b.club) await creerClub(id, b.club.nom, b.club);
    return { jeton: creerJwt({ sub: id, mfa: false }), utilisateur: await sansClub((db) => profil(db, id)) };
  });

  app.post('/api/auth/connexion', async (req) => {
    const b = valider(z.object({ identifiant: z.string().min(3), motDePasse: z.string(), codeMfa: z.string().optional() }), req.body);
    const ident = b.identifiant.includes('@') ? b.identifiant.toLowerCase() : normaliserTel(b.identifiant);
    const u = await sansClub(async (db) => (await db.query('SELECT * FROM utilisateurs WHERE email = $1 OR telephone = $1', [ident])).rows[0]);
    if (!u || !verifierMotDePasse(b.motDePasse, u.mot_de_passe)) throw new ErreurHttp(401, 'Identifiant ou mot de passe incorrect');
    if (u.mfa_actif) {
      if (!b.codeMfa) throw new ErreurHttp(401, 'Code de double authentification requis', 'mfa_requise');
      if (!verifierTotp(u.mfa_secret, b.codeMfa)) throw new ErreurHttp(401, 'Code de double authentification incorrect', 'mfa_invalide');
    }
    return { jeton: creerJwt({ sub: u.id, mfa: !!u.mfa_actif }), utilisateur: await sansClub((db) => profil(db, u.id)) };
  });

  app.get('/api/moi', async (req) => sansClub((db) => profil(db, session(req).sub)));

  app.patch('/api/moi', async (req) => {
    const s = session(req);
    const b = valider(z.object({ nom: z.string().min(2).optional(), langue: z.enum(['fr', 'en']).optional(), motDePasse: z.string().min(8).optional() }), req.body);
    await sansClub(async (db) => {
      if (b.nom) await db.query('UPDATE utilisateurs SET nom = $2 WHERE id = $1', [s.sub, b.nom]);
      if (b.langue) await db.query('UPDATE utilisateurs SET langue = $2 WHERE id = $1', [s.sub, b.langue]);
      if (b.motDePasse) await db.query('UPDATE utilisateurs SET mot_de_passe = $2 WHERE id = $1', [s.sub, hacherMotDePasse(b.motDePasse)]);
    });
    return sansClub((db) => profil(db, s.sub));
  });

  // Double authentification (TOTP, compatible Google Authenticator, FreeOTP...)
  app.post('/api/moi/mfa/preparer', async (req) => {
    const s = session(req);
    const secret = secretTotp();
    const u = await sansClub(async (db) => {
      await db.query('UPDATE utilisateurs SET mfa_secret = $2, mfa_actif = false WHERE id = $1', [s.sub, secret]);
      return (await db.query('SELECT email, telephone FROM utilisateurs WHERE id = $1', [s.sub])).rows[0];
    });
    const label = encodeURIComponent(`Rugby Analyse:${u.email ?? u.telephone}`);
    return { secret, otpauth: `otpauth://totp/${label}?secret=${secret}&issuer=Rugby%20Analyse` };
  });

  app.post('/api/moi/mfa/activer', async (req) => {
    const s = session(req);
    const { code } = valider(z.object({ code: z.string().length(6) }), req.body);
    const u = await sansClub(async (db) => (await db.query('SELECT mfa_secret FROM utilisateurs WHERE id = $1', [s.sub])).rows[0]);
    if (!u?.mfa_secret || !verifierTotp(u.mfa_secret, code)) throw requeteInvalide('Code incorrect');
    await sansClub((db) => db.query('UPDATE utilisateurs SET mfa_actif = true WHERE id = $1', [s.sub]));
    return { jeton: creerJwt({ sub: s.sub, mfa: true }) };
  });

  // Création d'un club supplémentaire par un utilisateur connecté
  app.post('/api/clubs', async (req) => {
    const s = session(req);
    const b = valider(z.object({ nom: z.string().min(2), comite: z.string().optional(), poule: z.string().optional() }), req.body);
    return creerClub(s.sub, b.nom, b);
  });

  // Invitations (lien ou QR code). Téléphone accepté sans email.
  app.get('/api/invitations/:jeton', async (req) => {
    const { jeton } = req.params as { jeton: string };
    const clubId = await sansClub(async (db) => (await db.query('SELECT f_club_de_invitation($1) AS c', [hacherJeton(jeton)])).rows[0].c);
    if (!clubId) throw nonTrouve('Invitation');
    return avecClub(clubId, async (db) => {
      const i = (await db.query(
        `SELECT i.role, i.expire_le, i.utilisee_le, c.nom AS club, e.nom AS equipe, j.prenom, j.nom
         FROM invitations i JOIN clubs c ON c.id = i.club_id LEFT JOIN equipes e ON e.id = i.equipe_id LEFT JOIN joueurs j ON j.id = i.joueur_id
         WHERE i.jeton_hash = $1`, [hacherJeton(jeton)])).rows[0];
      if (!i || i.utilisee_le || new Date(i.expire_le) < new Date()) throw nonTrouve('Invitation');
      return i;
    });
  });

  app.post('/api/invitations/:jeton/accepter', async (req) => {
    const { jeton } = req.params as { jeton: string };
    const h = hacherJeton(jeton);
    // Soit l'utilisateur est connecté, soit il crée son compte (email ou téléphone)
    let utilisateurId: string | null = null;
    if (req.headers.authorization) utilisateurId = session(req).sub;
    const clubId = await sansClub(async (db) => (await db.query('SELECT f_club_de_invitation($1) AS c', [h])).rows[0].c);
    if (!clubId) throw nonTrouve('Invitation');
    const valide = await avecClub(clubId, async (db) => (await db.query('SELECT 1 FROM invitations WHERE jeton_hash = $1 AND utilisee_le IS NULL AND expire_le > now()', [h])).rowCount);
    if (!valide) throw nonTrouve('Invitation');
    if (!utilisateurId) {
      const b = valider(z.object({ nom: z.string().min(2), motDePasse: z.string().min(8) }).and(identifiant), req.body);
      utilisateurId = await sansClub(async (db) => {
        const existe = await db.query('SELECT 1 FROM utilisateurs WHERE email = $1 OR telephone = $2', [b.email ?? null, normaliserTel(b.telephone) ?? null]);
        if (existe.rowCount) throw requeteInvalide('Un compte existe déjà : connectez-vous puis rouvrez le lien');
        return (await db.query('INSERT INTO utilisateurs (email, telephone, mot_de_passe, nom) VALUES ($1,$2,$3,$4) RETURNING id',
          [b.email?.toLowerCase() ?? null, normaliserTel(b.telephone) ?? null, hacherMotDePasse(b.motDePasse), b.nom])).rows[0].id as string;
      });
    }
    await avecClub(clubId, async (db) => {
      const i = (await db.query('SELECT * FROM invitations WHERE jeton_hash = $1 FOR UPDATE', [h])).rows[0];
      if (!i || i.utilisee_le || new Date(i.expire_le) < new Date()) throw nonTrouve('Invitation');
      await db.query(
        `INSERT INTO adhesions (club_id, utilisateur_id, role, equipe_id, joueur_id) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
        [clubId, utilisateurId, i.role, i.equipe_id, i.joueur_id],
      );
      await db.query('UPDATE invitations SET utilisee_le = now() WHERE id = $1', [i.id]);
      await db.query("INSERT INTO journal (club_id, utilisateur_id, action, cible, cible_id) VALUES ($1,$2,'invitation_acceptee','invitation',$3)", [clubId, utilisateurId, i.id]);
    });
    return { jeton: creerJwt({ sub: utilisateurId, mfa: false }), utilisateur: await sansClub((db) => profil(db, utilisateurId!)) };
  });
}
