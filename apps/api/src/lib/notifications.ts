// Notifications in-app, doublées d'un Web Push quand les clés VAPID sont configurées.
import webpush from 'web-push';
import { config } from './config.js';
import type { Db } from './db.js';

const pushActif = !!(config.vapid.publicKey && config.vapid.privateKey);
if (pushActif) webpush.setVapidDetails(config.vapid.subject, config.vapid.publicKey!, config.vapid.privateKey!);

export async function notifierJoueurs(db: Db, clubId: string, joueurIds: string[], titre: string, corps: string, lien: string) {
  if (!joueurIds.length) return;
  for (const j of joueurIds) {
    await db.query('INSERT INTO notifications (club_id, joueur_id, titre, corps, lien) VALUES ($1,$2,$3,$4,$5)', [clubId, j, titre, corps, lien]);
  }
  if (!pushActif) return;
  const abonnements = (await db.query(
    `SELECT p.abonnement FROM abonnements_push p JOIN adhesions a ON a.utilisateur_id = p.utilisateur_id
     WHERE a.joueur_id = ANY($1::uuid[])`, [joueurIds])).rows;
  await Promise.allSettled(abonnements.map((a) => webpush.sendNotification(a.abonnement, JSON.stringify({ titre, corps, lien }))));
}
