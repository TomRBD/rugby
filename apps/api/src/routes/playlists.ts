import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { appliquerFiltre, indexTypes } from '@rugby/shared';
import { avec, contexte, exigerFonction, exigerPermission, filtreEquipes, journaliser, matchAccessible, valider, uuid, type Contexte } from '../lib/contexte.js';
import type { Db } from '../lib/db.js';
import { nonTrouve, requeteInvalide } from '../lib/erreurs.js';
import { chargerMatch, configClub, typesDuClub, videoPrincipale } from '../lib/donneesMatch.js';
import { hacherJeton, jetonAleatoire, signerMedia } from '../lib/securite.js';
import { config } from '../lib/config.js';
import { enfiler } from '../lib/jobs.js';
import { notifierJoueurs } from '../lib/notifications.js';
import { stockage } from '../lib/stockage.js';
import { urlLecture } from './videos.js';

const filtreSchema = z.object({
  types: z.array(z.string()).optional(), camp: z.enum(['nous', 'adversaire']).optional(), joueurs: z.array(uuid).optional(),
  numeros: z.array(z.number().int()).optional(), resultats: z.array(z.string()).optional(), succes: z.boolean().optional(),
  miTemps: z.union([z.literal(1), z.literal(2)]).optional(), zonesLongueur: z.array(z.number().int().min(0).max(5)).optional(),
  attributs: z.record(z.string()).optional(),
});

/** Clips (avec pré-roll/post-roll du type, éventuellement surchargés par le club) pour une liste d'événements. */
export async function clipsDepuisEvenements(db: Db, evenementIds: string[]) {
  if (!evenementIds.length) return [];
  const types = indexTypes(await typesDuClub(db));
  const prePost = (await configClub(db)).prePost;
  const evs = (await db.query('SELECT * FROM evenements WHERE id = ANY($1::uuid[]) AND NOT supprime', [evenementIds])).rows;
  const videos = new Map<string, any>();
  const out = [];
  for (const id of evenementIds) {
    const e = evs.find((x) => x.id === id);
    if (!e) continue;
    if (!videos.has(e.match_id)) videos.set(e.match_id, await videoPrincipale(db, e.match_id));
    const v = videos.get(e.match_id);
    if (!v) continue;
    const t = types.get(e.type_key);
    const pre = prePost[e.type_key]?.pre ?? t?.preRoll ?? 3;
    const post = prePost[e.type_key]?.post ?? t?.postRoll ?? 3;
    out.push({ evenement_id: e.id, video_id: v.id, debut: Math.max(0, e.debut - pre), fin: Math.min(v.duree ?? Infinity, e.fin + post), titre: t?.label ?? e.type_key });
  }
  return out;
}

async function ajouterClips(db: Db, ctx: Contexte, playlistId: string, clips: Awaited<ReturnType<typeof clipsDepuisEvenements>>) {
  const max = Number((await db.query('SELECT coalesce(max(ordre), -1) AS m FROM playlist_clips WHERE playlist_id = $1', [playlistId])).rows[0].m);
  for (const [i, c] of clips.entries()) {
    await db.query(
      'INSERT INTO playlist_clips (club_id, playlist_id, evenement_id, video_id, debut, fin, ordre, titre) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [ctx.clubId, playlistId, c.evenement_id, c.video_id, c.debut, c.fin, max + 1 + i, c.titre],
    );
  }
}

export async function detailPlaylist(db: Db, clubId: string, id: string, filigrane?: string) {
  const p = (await db.query('SELECT * FROM playlists WHERE id = $1', [id])).rows[0];
  if (!p) throw nonTrouve('Playlist');
  const clips = (await db.query(
    `SELECT c.*, e.type_key, e.camp, e.resultat, e.joueurs, e.commentaire AS commentaire_evenement
     FROM playlist_clips c LEFT JOIN evenements e ON e.id = c.evenement_id WHERE c.playlist_id = $1 ORDER BY c.ordre`, [id])).rows;
  const videoIds = [...new Set(clips.map((c) => c.video_id))];
  const videos = videoIds.length ? (await db.query('SELECT * FROM videos WHERE id = ANY($1::uuid[])', [videoIds])).rows : [];
  const sources = Object.fromEntries(videos.map((v) => [v.id, urlLecture(clubId, v, filigrane)]));
  const voix = Object.fromEntries(clips.filter((c) => c.voix_off_cle).map((c) => [c.id, `/media/${signerMedia(c.voix_off_cle)}/`]));
  return { ...p, clips: clips.map((c) => ({ ...c, voixOffUrl: voix[c.id] ?? null })), sources };
}

export default async function routesPlaylists(app: FastifyInstance) {
  app.get('/api/clubs/:clubId/playlists', async (req) => {
    const ctx = await contexte(req, 'match.lire');
    const { matchId, equipeId } = req.query as { matchId?: string; equipeId?: string };
    const p: unknown[] = [];
    const w = [`(p.equipe_id IS NULL OR ${filtreEquipes(ctx, 'match.lire', 'p.equipe_id', p)})`];
    if (matchId) { p.push(matchId); w.push(`p.match_id = $${p.length}`); }
    if (equipeId) { p.push(equipeId); w.push(`p.equipe_id = $${p.length}`); }
    return avec(ctx, async (db) => (await db.query(
      `SELECT p.*, (SELECT count(*) FROM playlist_clips c WHERE c.playlist_id = p.id)::int AS nb_clips,
              (SELECT count(*) FROM partages s WHERE s.playlist_id = p.id AND s.revoque_le IS NULL)::int AS nb_partages
       FROM playlists p WHERE ${w.join(' AND ')} ORDER BY p.cree_le DESC`, p)).rows);
  });

  app.get('/api/clubs/:clubId/playlists/:id', async (req) => {
    const ctx = await contexte(req, 'match.lire');
    const { id } = valider(z.object({ id: uuid }), req.params);
    return avec(ctx, async (db) => {
      const d = await detailPlaylist(db, ctx.clubId, id);
      if (d.equipe_id) exigerPermission(ctx, 'match.lire', d.equipe_id);
      return d;
    });
  });

  // Création : à partir d'une liste d'événements (clic sur une stat), d'un filtre, ou vide
  app.post('/api/clubs/:clubId/playlists', async (req) => {
    const ctx = await contexte(req, 'playlist.ecrire');
    const b = valider(z.object({
      titre: z.string().min(1), equipe_id: uuid.nullable().optional(), match_id: uuid.nullable().optional(),
      type: z.enum(['theme', 'preparation', 'temps_forts', 'individuelle']).default('theme'),
      consignes: z.string().nullable().optional(),
      questions: z.array(z.object({ question: z.string(), type: z.enum(['texte', 'note', 'oui_non']) })).optional(),
      evenements: z.array(uuid).optional(), filtre: filtreSchema.optional(),
    }), req.body);
    return avec(ctx, async (db) => {
      let equipeId = b.equipe_id ?? null;
      if (b.match_id) equipeId = (await matchAccessible(db, ctx, b.match_id, 'playlist.ecrire')).equipe_id;
      if (equipeId) exigerPermission(ctx, 'playlist.ecrire', equipeId);
      const p = (await db.query(
        `INSERT INTO playlists (club_id, equipe_id, match_id, titre, type, filtre, consignes, questions, auteur_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [ctx.clubId, equipeId, b.match_id ?? null, b.titre, b.type, b.filtre ? JSON.stringify(b.filtre) : null, b.consignes ?? null, JSON.stringify(b.questions ?? []), ctx.utilisateurId],
      )).rows[0];
      let ids = b.evenements ?? [];
      if (b.filtre && b.match_id) {
        const m = (await chargerMatch(db, b.match_id))!;
        ids = appliquerFiltre(m.evenements, b.filtre, m.types, { dureeMiTemps: m.match.duree_mi_temps, coupEnvoi1: m.match.coup_envoi_1, coupEnvoi2: m.match.coup_envoi_2 }).map((e) => e.id);
      }
      await ajouterClips(db, ctx, p.id, await clipsDepuisEvenements(db, ids));
      return detailPlaylist(db, ctx.clubId, p.id);
    });
  });

  // Temps forts automatiques d'un match
  app.post('/api/clubs/:clubId/matchs/:id/temps-forts', async (req) => {
    const ctx = await contexte(req, 'playlist.ecrire');
    const { id } = valider(z.object({ id: uuid }), req.params);
    return avec(ctx, async (db) => {
      const match = await matchAccessible(db, ctx, id, 'playlist.ecrire');
      const m = (await chargerMatch(db, id))!;
      const forts = m.evenements.filter((e) =>
        (e.camp === 'nous' && ['essai', 'franchissement', 'turnover', 'drop'].includes(e.typeKey)) ||
        (e.camp === 'nous' && e.typeKey === 'plaquage' && e.resultat === 'dominant' && (e.attributs as any)?.contest_sol) ||
        (e.typeKey === 'essai' && e.camp === 'adversaire') ||
        (e.typeKey === 'jeu_au_pied' && (e.attributs as any)?.type === '50_22' && e.camp === 'nous'));
      const p = (await db.query(
        "INSERT INTO playlists (club_id, equipe_id, match_id, titre, type, auteur_id) VALUES ($1,$2,$3,$4,'temps_forts',$5) RETURNING id",
        [ctx.clubId, match.equipe_id, id, `Temps forts ${m.match.adversaire_nom ? `contre ${m.match.adversaire_nom}` : ''}`.trim(), ctx.utilisateurId],
      )).rows[0];
      await ajouterClips(db, ctx, p.id, await clipsDepuisEvenements(db, forts.map((e) => e.id)));
      return detailPlaylist(db, ctx.clubId, p.id);
    });
  });

  // Playlist « préparation » à partir du rapport adverse
  app.post('/api/clubs/:clubId/adversaires/:id/playlist-preparation', async (req) => {
    const ctx = await contexte(req, 'playlist.ecrire');
    exigerFonction(ctx, 'analyse_adverse');
    const { id } = valider(z.object({ id: uuid }), req.params);
    const { equipe_id, types } = valider(z.object({ equipe_id: uuid, types: z.array(z.string()).default(['essai', 'touche', 'jeu_au_pied', 'franchissement']) }), req.body);
    exigerPermission(ctx, 'playlist.ecrire', equipe_id);
    return avec(ctx, async (db) => {
      const adv = (await db.query('SELECT nom FROM adversaires WHERE id = $1', [id])).rows[0];
      if (!adv) throw nonTrouve('Adversaire');
      const evs = (await db.query(
        `SELECT e.id FROM evenements e JOIN matchs m ON m.id = e.match_id
         WHERE m.adversaire_id = $1 AND e.camp = 'adversaire' AND NOT e.supprime AND e.type_key = ANY($2) ORDER BY m.date, e.debut LIMIT 200`,
        [id, types])).rows.map((r) => r.id);
      const p = (await db.query(
        "INSERT INTO playlists (club_id, equipe_id, titre, type, auteur_id) VALUES ($1,$2,$3,'preparation',$4) RETURNING id",
        [ctx.clubId, equipe_id, `Préparation : ${adv.nom}`, ctx.utilisateurId],
      )).rows[0];
      await ajouterClips(db, ctx, p.id, await clipsDepuisEvenements(db, evs));
      return detailPlaylist(db, ctx.clubId, p.id);
    });
  });

  app.patch('/api/clubs/:clubId/playlists/:id', async (req) => {
    const ctx = await contexte(req, 'playlist.ecrire');
    const { id } = valider(z.object({ id: uuid }), req.params);
    const b = valider(z.object({
      titre: z.string().min(1).optional(), consignes: z.string().nullable().optional(),
      questions: z.array(z.object({ question: z.string(), type: z.enum(['texte', 'note', 'oui_non']) })).optional(),
      validee: z.boolean().optional(),
      ordre: z.array(uuid).optional(),
      ajouterEvenements: z.array(uuid).optional(),
      ajouterClip: z.object({ video_id: uuid, debut: z.number().min(0), fin: z.number().min(0), titre: z.string().optional() }).optional(),
    }), req.body);
    return avec(ctx, async (db) => {
      const p = (await db.query('SELECT * FROM playlists WHERE id = $1', [id])).rows[0];
      if (!p) throw nonTrouve('Playlist');
      if (p.equipe_id) exigerPermission(ctx, 'playlist.ecrire', p.equipe_id);
      // Validation des clips partagés : entraîneur principal ou admin
      if (b.validee !== undefined) exigerPermission(ctx, 'partage.valider', p.equipe_id);
      await db.query(
        `UPDATE playlists SET titre = coalesce($2, titre), consignes = CASE WHEN $3::boolean THEN $4 ELSE consignes END,
         questions = coalesce($5, questions), validee = coalesce($6, validee) WHERE id = $1`,
        [id, b.titre ?? null, b.consignes !== undefined, b.consignes ?? null, b.questions ? JSON.stringify(b.questions) : null, b.validee ?? null],
      );
      if (b.ordre) for (const [i, cid] of b.ordre.entries()) await db.query('UPDATE playlist_clips SET ordre = $3 WHERE id = $1 AND playlist_id = $2', [cid, id, i]);
      if (b.ajouterEvenements) await ajouterClips(db, ctx, id, await clipsDepuisEvenements(db, b.ajouterEvenements));
      if (b.ajouterClip) {
        if (b.ajouterClip.fin <= b.ajouterClip.debut) throw requeteInvalide('Clip vide');
        await ajouterClips(db, ctx, id, [{ evenement_id: null as any, ...b.ajouterClip, titre: b.ajouterClip.titre ?? 'Séquence' }]);
      }
      return detailPlaylist(db, ctx.clubId, id);
    });
  });

  // Clip : bornes, note, télestration
  app.patch('/api/clubs/:clubId/clips/:cid', async (req) => {
    const ctx = await contexte(req, 'playlist.ecrire');
    const { cid } = valider(z.object({ cid: uuid }), req.params);
    const b = valider(z.object({
      debut: z.number().min(0).optional(), fin: z.number().min(0).optional(), titre: z.string().optional(), note: z.string().nullable().optional(),
      dessin: z.object({ temps: z.number(), formes: z.array(z.record(z.any())), duree: z.number().default(4) }).nullable().optional(),
    }), req.body);
    return avec(ctx, async (db) => {
      const r = await db.query(
        `UPDATE playlist_clips SET debut = coalesce($2, debut), fin = coalesce($3, fin), titre = coalesce($4, titre),
         note = CASE WHEN $5::boolean THEN $6 ELSE note END, dessin = CASE WHEN $7::boolean THEN $8::jsonb ELSE dessin END WHERE id = $1 RETURNING *`,
        [cid, b.debut ?? null, b.fin ?? null, b.titre ?? null, b.note !== undefined, b.note ?? null, b.dessin !== undefined, b.dessin ? JSON.stringify(b.dessin) : null],
      );
      if (!r.rowCount) throw nonTrouve('Clip');
      return r.rows[0];
    });
  });

  // Voix off d'un clip (audio enregistré dans le navigateur)
  app.put('/api/clubs/:clubId/clips/:cid/voix-off', async (req) => {
    const ctx = await contexte(req, 'playlist.ecrire');
    const { cid } = valider(z.object({ cid: uuid }), req.params);
    const audio = req.body as Buffer;
    if (!Buffer.isBuffer(audio) || audio.length > 10 * 1024 * 1024) throw requeteInvalide('Audio invalide (10 Mo max)');
    return avec(ctx, async (db) => {
      const c = (await db.query('SELECT * FROM playlist_clips WHERE id = $1', [cid])).rows[0];
      if (!c) throw nonTrouve('Clip');
      const cle = `clubs/${ctx.clubId}/voix-off/${cid}.webm`;
      await stockage.ecrire(cle, audio);
      await db.query('UPDATE playlist_clips SET voix_off_cle = $2 WHERE id = $1', [cid, cle]);
      return { ok: true };
    });
  });

  app.delete('/api/clubs/:clubId/clips/:cid', async (req) => {
    const ctx = await contexte(req, 'playlist.ecrire');
    const { cid } = valider(z.object({ cid: uuid }), req.params);
    await avec(ctx, (db) => db.query('DELETE FROM playlist_clips WHERE id = $1', [cid]));
    return { ok: true };
  });

  app.delete('/api/clubs/:clubId/playlists/:id', async (req) => {
    const ctx = await contexte(req, 'playlist.ecrire');
    const { id } = valider(z.object({ id: uuid }), req.params);
    return avec(ctx, async (db) => {
      const p = (await db.query('SELECT * FROM playlists WHERE id = $1', [id])).rows[0];
      if (!p) throw nonTrouve('Playlist');
      if (p.equipe_id) exigerPermission(ctx, 'playlist.ecrire', p.equipe_id);
      await db.query('DELETE FROM playlists WHERE id = $1', [id]);
      await journaliser(db, ctx, 'suppression', 'playlists', id);
      return { ok: true };
    });
  });

  // Export MP4 (incrustation titre, score, logo ; 16:9 ou 9:16 pour les réseaux sociaux)
  app.post('/api/clubs/:clubId/playlists/:id/export', async (req) => {
    const ctx = await contexte(req, 'export');
    const { id } = valider(z.object({ id: uuid }), req.params);
    const b = valider(z.object({ format: z.enum(['16:9', '9:16']).default('16:9'), filigrane: z.string().max(60).optional() }), req.body ?? {});
    return avec(ctx, async (db) => {
      const p = (await db.query('SELECT * FROM playlists WHERE id = $1', [id])).rows[0];
      if (!p) throw nonTrouve('Playlist');
      const e = (await db.query('INSERT INTO exports_video (club_id, playlist_id, format, filigrane) VALUES ($1,$2,$3,$4) RETURNING *', [ctx.clubId, id, b.format, b.filigrane ?? null])).rows[0];
      await enfiler(db, ctx.clubId, 'export_video', { exportId: e.id });
      await journaliser(db, ctx, 'export_video', 'playlists', id, b);
      return e;
    });
  });

  app.get('/api/clubs/:clubId/exports/:eid', async (req) => {
    const ctx = await contexte(req, 'export');
    const { eid } = valider(z.object({ eid: uuid }), req.params);
    return avec(ctx, async (db) => {
      const e = (await db.query('SELECT * FROM exports_video WHERE id = $1', [eid])).rows[0];
      if (!e) throw nonTrouve('Export');
      return { ...e, url: e.statut === 'termine' ? `/media/${signerMedia(e.cle_stockage, 3600)}/?telecharger=1` : null };
    });
  });

  // Partage : à un joueur, un groupe, l'équipe ou par lien. Lien signé, expirable, révocable.
  app.post('/api/clubs/:clubId/playlists/:id/partages', async (req) => {
    const ctx = await contexte(req, 'playlist.ecrire');
    exigerFonction(ctx, 'partage');
    const { id } = valider(z.object({ id: uuid }), req.params);
    const b = valider(z.object({
      destinataire: z.enum(['joueur', 'groupe', 'equipe', 'lien']),
      joueurs: z.array(uuid).optional(), libelle: z.string().optional(),
      joursValidite: z.number().int().min(1).max(90).default(14), telechargement: z.boolean().default(false),
    }), req.body);
    return avec(ctx, async (db) => {
      const p = (await db.query('SELECT * FROM playlists WHERE id = $1', [id])).rows[0];
      if (!p) throw nonTrouve('Playlist');
      if (p.equipe_id) exigerPermission(ctx, 'playlist.ecrire', p.equipe_id);
      // Les analystes préparent, l'entraîneur valide avant diffusion aux joueurs
      if (!p.validee) exigerPermission(ctx, 'partage.valider', p.equipe_id);
      let cibles: { id: string | null; libelle: string }[] = [];
      if (b.destinataire === 'equipe') {
        if (!p.equipe_id) throw requeteInvalide('Playlist sans équipe');
        cibles = (await db.query('SELECT j.id, j.prenom || \' \' || j.nom AS libelle FROM joueurs j JOIN equipe_joueurs ej ON ej.joueur_id = j.id WHERE ej.equipe_id = $1 AND NOT j.archive', [p.equipe_id])).rows;
      } else if (b.destinataire === 'joueur' || b.destinataire === 'groupe') {
        if (!b.joueurs?.length) throw requeteInvalide('Choisissez au moins un joueur');
        cibles = (await db.query("SELECT id, prenom || ' ' || nom AS libelle FROM joueurs WHERE id = ANY($1::uuid[])", [b.joueurs])).rows;
      } else {
        cibles = [{ id: null, libelle: b.libelle ?? 'Lien' }];
      }
      const liens = [];
      for (const c of cibles) {
        const jeton = jetonAleatoire();
        await db.query(
          `INSERT INTO partages (club_id, playlist_id, jeton_hash, destinataire, joueur_id, libelle, expire_le, telechargement, cree_par)
           VALUES ($1,$2,$3,$4,$5,$6, now() + ($7 || ' days')::interval, $8, $9)`,
          [ctx.clubId, id, hacherJeton(jeton), b.destinataire, c.id, c.libelle, String(b.joursValidite), b.telechargement, ctx.utilisateurId],
        );
        liens.push({ joueurId: c.id, libelle: c.libelle, lien: `${config.publicWebUrl}/p/${jeton}` });
        if (c.id) await notifierJoueurs(db, ctx.clubId, [c.id], 'Nouvelle playlist', p.titre, `/p/${jeton}`);
      }
      await journaliser(db, ctx, 'partage_cree', 'playlists', id, { destinataire: b.destinataire, nb: liens.length });
      return { liens };
    });
  });

  app.get('/api/clubs/:clubId/playlists/:id/suivi', async (req) => {
    const ctx = await contexte(req, 'playlist.ecrire');
    const { id } = valider(z.object({ id: uuid }), req.params);
    return avec(ctx, async (db) => ({
      partages: (await db.query(
        `SELECT s.id, s.libelle, s.destinataire, s.expire_le, s.revoque_le, s.telechargement, s.cree_le,
                (SELECT min(l.le) FROM lectures l WHERE l.partage_id = s.id) AS premiere_lecture,
                (SELECT count(DISTINCT l.clip_id) FROM lectures l WHERE l.partage_id = s.id)::int AS clips_vus,
                (SELECT coalesce(sum(l.secondes), 0) FROM lectures l WHERE l.partage_id = s.id) AS secondes_vues
         FROM partages s WHERE s.playlist_id = $1 ORDER BY s.libelle`, [id])).rows,
      commentaires: (await db.query('SELECT * FROM commentaires WHERE playlist_id = $1 ORDER BY le', [id])).rows,
      reponses: (await db.query('SELECT r.*, s.libelle FROM reponses_questionnaire r JOIN partages s ON s.id = r.partage_id WHERE s.playlist_id = $1', [id])).rows,
    }));
  });

  app.post('/api/clubs/:clubId/partages/:sid/revoquer', async (req) => {
    const ctx = await contexte(req, 'playlist.ecrire');
    const { sid } = valider(z.object({ sid: uuid }), req.params);
    return avec(ctx, async (db) => {
      await db.query('UPDATE partages SET revoque_le = now() WHERE id = $1', [sid]);
      await journaliser(db, ctx, 'partage_revoque', 'partages', sid);
      return { ok: true };
    });
  });

  app.post('/api/clubs/:clubId/playlists/:id/commentaires', async (req) => {
    const ctx = await contexte(req);
    const { id } = valider(z.object({ id: uuid }), req.params);
    const b = valider(z.object({ texte: z.string().min(1).max(2000), clip_id: uuid.nullable().optional() }), req.body);
    return avec(ctx, async (db) => {
      const nom = (await db.query('SELECT nom FROM utilisateurs WHERE id = $1', [ctx.utilisateurId])).rows[0]?.nom ?? 'Staff';
      return (await db.query('INSERT INTO commentaires (club_id, playlist_id, clip_id, auteur, utilisateur_id, texte) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
        [ctx.clubId, id, b.clip_id ?? null, nom, ctx.utilisateurId, b.texte])).rows[0];
    });
  });

  // Ajout de l'URL de lecture d'un clip pour le saut direct depuis une stat (< 1 s : une seule requête légère)
  app.get('/api/clubs/:clubId/matchs/:id/lecture', async (req) => {
    const ctx = await contexte(req, 'match.lire');
    const { id } = valider(z.object({ id: uuid }), req.params);
    return avec(ctx, async (db) => {
      await matchAccessible(db, ctx, id, 'match.lire');
      const vids = (await db.query("SELECT * FROM videos WHERE match_id = $1 ORDER BY (angle = 'Principal') DESC, cree_le", [id])).rows;
      return vids.map((v) => urlLecture(ctx.clubId, v));
    });
  });
}
