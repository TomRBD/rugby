import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { construireApp } from '../src/app.js';
import { fermerPools, poolApp } from '../src/lib/db.js';
import { codeTotp } from '../src/lib/securite.js';

let app: FastifyInstance;

async function req(method: string, url: string, jeton?: string, body?: unknown, headers: Record<string, string> = {}) {
  const r = await app.inject({
    method: method as any, url,
    headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...headers },
    ...(body instanceof Buffer ? { payload: body } : body !== undefined ? { payload: body as any } : {}),
  });
  let json: any = null;
  try { json = r.json(); } catch { /* binaire */ }
  return { statut: r.statusCode, json, brut: r };
}

const uid = () => crypto.randomUUID();

describe('API', () => {
  let jetonA: string, clubA: string, jetonB: string, clubB: string;
  let saisonA: string, equipeA: string, matchA: string;
  const joueursA: string[] = [];

  beforeAll(async () => {
    app = await construireApp();
    const a = await req('POST', '/api/auth/inscription', undefined, { nom: 'Coach A', email: 'a@club.fr', motDePasse: 'motdepasse', club: { nom: 'RC Alpha', poule: 'Poule 1' } });
    expect(a.statut).toBe(200);
    jetonA = a.json.jeton;
    clubA = a.json.utilisateur.clubs[0].id;
    // Club B inscrit par téléphone, sans email
    const b = await req('POST', '/api/auth/inscription', undefined, { nom: 'Coach B', telephone: '06 12 34 56 78', motDePasse: 'motdepasse', club: { nom: 'US Bêta', poule: 'Poule 1' } });
    expect(b.statut).toBe(200);
    jetonB = b.json.jeton;
    clubB = b.json.utilisateur.clubs[0].id;
    await req('POST', `/api/clubs/${clubA}/abonnement`, jetonA, { offre: 'club_plus' });
  });

  afterAll(async () => {
    await app.close();
    await fermerPools();
  });

  it('se connecte par téléphone', async () => {
    const r = await req('POST', '/api/auth/connexion', undefined, { identifiant: '0612345678', motDePasse: 'motdepasse' });
    expect(r.statut).toBe(200);
    expect((await req('POST', '/api/auth/connexion', undefined, { identifiant: 'a@club.fr', motDePasse: 'mauvais' })).statut).toBe(401);
  });

  it('crée saison, équipe, joueurs et adversaire', async () => {
    const saisons = await req('GET', `/api/clubs/${clubA}/saisons`, jetonA);
    saisonA = saisons.json[0].id;
    const eq = await req('POST', `/api/clubs/${clubA}/equipes`, jetonA, { saison_id: saisonA, nom: 'Séniors A' });
    expect(eq.statut).toBe(200);
    equipeA = eq.json.id;
    for (let i = 1; i <= 17; i++) {
      const j = await req('POST', `/api/clubs/${clubA}/joueurs`, jetonA, { prenom: `Prénom${i}`, nom: `Nom${i}`, numero_habituel: i, poste_principal: i <= 8 ? 'Avant' : 'Arrière' });
      expect(j.statut).toBe(200);
      joueursA.push(j.json.id);
    }
    expect((await req('PUT', `/api/clubs/${clubA}/equipes/${equipeA}/joueurs`, jetonA, { joueurs: joueursA })).statut).toBe(200);
    const adv = await req('POST', `/api/clubs/${clubA}/adversaires`, jetonA, { nom: 'Stade Gamma' });
    const m = await req('POST', `/api/clubs/${clubA}/matchs`, jetonA, { equipe_id: equipeA, adversaire_id: adv.json.id, date: '2026-10-25T15:00:00Z', domicile: true });
    expect(m.statut).toBe(200);
    expect(m.json.duree_mi_temps).toBe(40);
    matchA = m.json.id;
  });

  it('enregistre la feuille de match et refuse les doublons', async () => {
    const lignes = joueursA.map((j, i) => ({ joueur_id: j, numero: i + 1, titulaire: i < 15 }));
    expect((await req('PUT', `/api/clubs/${clubA}/matchs/${matchA}/feuille`, jetonA, { lignes })).statut).toBe(200);
    const doublon = await req('PUT', `/api/clubs/${clubA}/matchs/${matchA}/feuille`, jetonA, { lignes: [lignes[0], { ...lignes[1], numero: 1 }] });
    expect(doublon.statut).toBe(400);
    const r = await req('POST', `/api/clubs/${clubA}/matchs/${matchA}/changements`, jetonA, { type: 'remplacement', minute: 60, joueur_sortant: joueursA[0], joueur_entrant: joueursA[15] });
    expect(r.statut).toBe(200);
  });

  it('code des événements, idempotent, et calcule les stats', async () => {
    await req('PATCH', `/api/clubs/${clubA}/matchs/${matchA}/reperes`, jetonA, { coup_envoi_1: 10, coup_envoi_2: 2500 });
    const essai = uid();
    const evs = [
      { id: essai, type_key: 'essai', camp: 'nous', joueurs: [joueursA[10]], debut: 300, fin: 303, x: 98, y: 30, attributs: { origine: 'touche' } },
      { id: uid(), type_key: 'transformation', camp: 'nous', joueurs: [joueursA[9]], resultat: 'reussie', debut: 360, fin: 362 },
      { id: uid(), type_key: 'plaquage', camp: 'nous', joueurs: [joueursA[6]], resultat: 'dominant', debut: 400, fin: 401 },
      { id: uid(), type_key: 'plaquage', camp: 'nous', joueurs: [joueursA[6]], resultat: 'manque', debut: 420, fin: 421 },
      { id: uid(), type_key: 'penalite_tentee', camp: 'adversaire', resultat: 'reussie', debut: 2600, fin: 2603 },
      { id: uid(), type_key: 'carton', camp: 'nous', joueurs: [joueursA[3]], resultat: 'jaune', debut: 1210, fin: 1212 },
    ];
    const r = await req('POST', `/api/clubs/${clubA}/matchs/${matchA}/evenements/sync`, jetonA, { evenements: evs });
    expect(r.statut).toBe(200);
    expect(r.json.evenements).toHaveLength(6);
    // Rejouer le même lot (reprise de synchro hors ligne) ne crée pas de doublon
    const r2 = await req('POST', `/api/clubs/${clubA}/matchs/${matchA}/evenements/sync`, jetonA, { evenements: evs });
    expect(r2.json.conflits).toHaveLength(6);
    const liste = await req('GET', `/api/clubs/${clubA}/matchs/${matchA}/evenements`, jetonA);
    expect(liste.json.evenements).toHaveLength(6);

    const s = await req('GET', `/api/clubs/${clubA}/matchs/${matchA}/stats`, jetonA);
    expect(s.statut).toBe(200);
    expect(s.json.stats.score).toEqual({ nous: 7, adversaire: 3 });
    const plaq = s.json.stats.indicateurs.find((i: any) => i.key === 'plaquages_reussis');
    expect(plaq.nous.valeur).toBe(50);
    expect(plaq.nous.ids).toHaveLength(2);
    // Le carton jaune codé alimente la feuille : 10 minutes en moins pour le joueur 4
    const j4 = s.json.stats.joueurs.find((j: any) => j.joueurId === joueursA[3]);
    expect(j4.tempsDeJeu).toBe(70);
    const j1 = s.json.stats.joueurs.find((j: any) => j.joueurId === joueursA[0]);
    expect(j1.tempsDeJeu).toBe(60);
  });

  it('gère les conflits de version (codage collaboratif)', async () => {
    const id = uid();
    const base = { id, type_key: 'ruck', camp: 'nous', debut: 500, fin: 503, resultat: 'rapide' };
    await req('POST', `/api/clubs/${clubA}/matchs/${matchA}/evenements/sync`, jetonA, { evenements: [base] });
    const c1 = await req('POST', `/api/clubs/${clubA}/matchs/${matchA}/evenements/sync`, jetonA, { evenements: [{ ...base, version: 1, resultat: 'lent' }] });
    expect(c1.json.evenements[0].version).toBe(2);
    const c2 = await req('POST', `/api/clubs/${clubA}/matchs/${matchA}/evenements/sync`, jetonA, { evenements: [{ ...base, version: 1, resultat: 'perdu' }] });
    expect(c2.json.conflits[0].resultat).toBe('lent');
  });

  it('exporte CSV, Excel et PDF', async () => {
    const csv = await req('GET', `/api/clubs/${clubA}/matchs/${matchA}/export?format=csv`, jetonA);
    expect(csv.statut).toBe(200);
    expect(csv.brut.body).toContain('Plaquages réussis');
    const xlsx = await req('GET', `/api/clubs/${clubA}/matchs/${matchA}/export?format=xlsx&quoi=joueurs`, jetonA);
    expect(xlsx.statut).toBe(200);
    const debut = Date.now();
    const pdf = await req('GET', `/api/clubs/${clubA}/matchs/${matchA}/rapport.pdf`, jetonA);
    expect(pdf.statut).toBe(200);
    expect(pdf.brut.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
    expect(Date.now() - debut).toBeLessThan(10000);
    const saison = await req('GET', `/api/clubs/${clubA}/equipes/${equipeA}/rapport-saison.pdf`, jetonA);
    expect(saison.statut).toBe(200);
  });

  it('cloisonne strictement les clubs', async () => {
    // Le club B ne voit rien du club A, même avec les identifiants exacts
    expect((await req('GET', `/api/clubs/${clubA}/joueurs`, jetonB)).statut).toBe(404);
    expect((await req('GET', `/api/clubs/${clubA}/matchs/${matchA}/stats`, jetonB)).statut).toBe(404);
    expect((await req('GET', `/api/clubs/${clubB}/matchs/${matchA}/stats`, jetonB)).statut).toBe(404);
    expect((await req('GET', `/api/clubs/${clubB}/joueurs/${joueursA[0]}`, jetonB)).statut).toBe(404);
    const vol = await req('POST', `/api/clubs/${clubB}/matchs/${matchA}/evenements/sync`, jetonB, { evenements: [{ id: uid(), type_key: 'essai', camp: 'nous', debut: 1, fin: 2 }] });
    expect(vol.statut).toBe(404);
    // Même un identifiant d'événement existant d'un autre club ne peut pas être écrasé
    const evA = (await req('GET', `/api/clubs/${clubA}/matchs/${matchA}/evenements`, jetonA)).json.evenements[0];
    const matchB = (await req('POST', `/api/clubs/${clubB}/matchs`, jetonB, {
      equipe_id: (await req('POST', `/api/clubs/${clubB}/equipes`, jetonB, { saison_id: (await req('GET', `/api/clubs/${clubB}/saisons`, jetonB)).json[0].id, nom: 'B1' })).json.id,
      date: '2026-10-26T15:00:00Z',
    })).json.id;
    const ecrase = await req('POST', `/api/clubs/${clubB}/matchs/${matchB}/evenements/sync`, jetonB, { evenements: [{ id: evA.id, type_key: 'essai', camp: 'nous', debut: 1, fin: 2, version: 99 }] });
    expect(ecrase.statut).toBeGreaterThanOrEqual(400);
    // Au niveau SQL : le rôle applicatif sans contexte club ne voit aucune ligne
    const c = await poolApp.connect();
    try {
      expect((await c.query('SELECT count(*) FROM evenements')).rows[0].count).toBe(0);
      expect((await c.query('SELECT count(*) FROM joueurs')).rows[0].count).toBe(0);
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.club_id', $1, true)", [clubB]);
      expect((await c.query('SELECT count(*) FROM joueurs')).rows[0].count).toBe(0);
      await expect(c.query('INSERT INTO joueurs (club_id, prenom, nom) VALUES ($1, $2, $3)', [clubA, 'X', 'Y'])).rejects.toThrow();
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
  });

  it('applique les rôles par équipe (analyste sans santé, joueur sans stats des autres)', async () => {
    const inv = await req('POST', `/api/clubs/${clubA}/invitations`, jetonA, { role: 'analyste', equipeId: equipeA });
    const jeton = inv.json.jeton;
    expect((await req('GET', `/api/invitations/${jeton}`)).statut).toBe(200);
    const acc = await req('POST', `/api/invitations/${jeton}/accepter`, undefined, { nom: 'Analyste', telephone: '0700000001', motDePasse: 'motdepasse' });
    expect(acc.statut).toBe(200);
    const jAn = acc.json.jeton;
    expect((await req('GET', `/api/clubs/${clubA}/matchs/${matchA}/stats`, jAn)).statut).toBe(200);
    expect((await req('GET', `/api/clubs/${clubA}/sante/dossiers`, jAn)).statut).toBe(403);
    expect((await req('GET', `/api/clubs/${clubA}/membres`, jAn)).statut).toBe(403);
    // Invitation déjà utilisée
    expect((await req('POST', `/api/invitations/${jeton}/accepter`, undefined, { nom: 'Xavier', telephone: '0700000002', motDePasse: 'motdepasse' })).statut).toBe(404);

    const invJ = await req('POST', `/api/clubs/${clubA}/invitations`, jetonA, { role: 'joueur', joueurId: joueursA[6] });
    const jJ = (await req('POST', `/api/invitations/${invJ.json.jeton}/accepter`, undefined, { nom: 'Joueur 7', email: 'j7@club.fr', motDePasse: 'motdepasse' })).json.jeton;
    expect((await req('GET', `/api/clubs/${clubA}/joueurs/${joueursA[6]}/stats`, jJ)).statut).toBe(200);
    expect((await req('GET', `/api/clubs/${clubA}/joueurs/${joueursA[5]}/stats`, jJ)).statut).toBe(403);
    expect((await req('GET', `/api/clubs/${clubA}/matchs/${matchA}/stats`, jJ)).statut).toBe(403);
    const moi = await req('GET', `/api/clubs/${clubA}/moi/joueur`, jJ);
    expect(moi.statut).toBe(200);
    expect((await req('POST', `/api/clubs/${clubA}/moi/suivi`, jJ, { date: '2026-10-27', rpe: 7, duree_minutes: 80, fatigue: 3 })).statut).toBe(200);
  });

  it('crée une playlist depuis une stat, la partage et la lit sans compte', async () => {
    // Vidéo prête simulée (le transcodage réel est couvert par le worker)
    const v = await req('POST', `/api/clubs/${clubA}/matchs/${matchA}/videos`, jetonA, { parties: [{ nom_fichier: 'match.mp4', taille: 10 }] });
    expect(v.statut).toBe(200);
    const c = await poolApp.connect();
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.club_id', $1, true)", [clubA]);
    await c.query("UPDATE videos SET statut = 'pret', duree = 4800 WHERE id = $1", [v.json.video.id]);
    await c.query('COMMIT');
    c.release();

    const s = await req('GET', `/api/clubs/${clubA}/matchs/${matchA}/stats`, jetonA);
    const ids = s.json.stats.indicateurs.find((i: any) => i.key === 'plaquages_reussis').nous.ids;
    const p = await req('POST', `/api/clubs/${clubA}/playlists`, jetonA, { titre: 'Plaquages', match_id: matchA, evenements: ids });
    expect(p.statut).toBe(200);
    expect(p.json.clips).toHaveLength(2);
    // Pré-roll du plaquage : 3 s avant
    expect(p.json.clips[0].debut).toBe(397);
    const parFiltre = await req('POST', `/api/clubs/${clubA}/playlists`, jetonA, { titre: 'Manqués', match_id: matchA, filtre: { types: ['plaquage'], succes: false } });
    expect(parFiltre.json.clips).toHaveLength(1);

    const partage = await req('POST', `/api/clubs/${clubA}/playlists/${p.json.id}/partages`, jetonA, { destinataire: 'joueur', joueurs: [joueursA[6]] });
    expect(partage.statut).toBe(200);
    const jeton = partage.json.liens[0].lien.split('/p/')[1];
    const pub = await req('GET', `/api/public/partages/${jeton}`);
    expect(pub.statut).toBe(200);
    expect(pub.json.destinataire).toBe('Prénom7 Nom7');
    expect(pub.json.playlist.sources[v.json.video.id].url).toMatch(/^\/media\//);
    expect((await req('POST', `/api/public/partages/${jeton}/lectures`, undefined, { clip_id: p.json.clips[0].id, secondes: 7 })).statut).toBe(200);
    const suivi = await req('GET', `/api/clubs/${clubA}/playlists/${p.json.id}/suivi`, jetonA);
    expect(suivi.json.partages[0].clips_vus).toBe(1);
    // Révocation
    await req('POST', `/api/clubs/${clubA}/partages/${suivi.json.partages[0].id}/revoquer`, jetonA);
    expect((await req('GET', `/api/public/partages/${jeton}`)).statut).toBe(410);
  });

  it('téléverse une vidéo par morceaux avec reprise', async () => {
    const contenu = crypto.randomBytes(3000);
    const v = await req('POST', `/api/clubs/${clubA}/matchs/${matchA}/videos`, jetonA, { parties: [{ nom_fichier: 'a.mp4', taille: 3000 }] });
    const part = v.json.parties[0];
    const url = `/api/clubs/${clubA}/videos/${v.json.video.id}/parties/${part.id}`;
    const oct = { 'content-type': 'application/octet-stream' };
    expect((await req('PUT', `${url}?offset=0`, jetonA, contenu.subarray(0, 1000), oct)).json.recu).toBe(1000);
    // Offset trop loin : refusé, le client reprend à l'offset indiqué
    expect((await req('PUT', `${url}?offset=2000`, jetonA, contenu.subarray(2000), oct)).statut).toBe(400);
    expect((await req('GET', url, jetonA)).json.recu).toBe(1000);
    expect((await req('POST', `/api/clubs/${clubA}/videos/${v.json.video.id}/terminer`, jetonA)).statut).toBe(400);
    await req('PUT', `${url}?offset=1000`, jetonA, contenu.subarray(1000), oct);
    expect((await req('POST', `/api/clubs/${clubA}/videos/${v.json.video.id}/terminer`, jetonA)).statut).toBe(200);
  });

  it('bloque la sélection pendant un protocole commotion', async () => {
    const d = await req('POST', `/api/clubs/${clubA}/sante/dossiers`, jetonA, { joueur_id: joueursA[1], type: 'commotion', date: '2026-10-25', contenu: { description: 'Choc tête' } });
    // L'admin n'a pas le rôle médical
    expect(d.statut).toBe(403);
    const c = await poolApp.connect();
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.club_id', $1, true)", [clubA]);
    const u = (await c.query("SELECT utilisateur_id FROM adhesions WHERE role = 'admin'")).rows[0].utilisateur_id;
    await c.query("INSERT INTO adhesions (club_id, utilisateur_id, role) VALUES ($1, $2, 'medical')", [clubA, u]);
    await c.query('COMMIT');
    c.release();
    const d2 = await req('POST', `/api/clubs/${clubA}/sante/dossiers`, jetonA, { joueur_id: joueursA[1], type: 'commotion', date: '2026-10-25', contenu: { description: 'Choc tête' } });
    expect(d2.statut).toBe(200);
    const lignes = joueursA.slice(0, 3).map((j, i) => ({ joueur_id: j, numero: i + 1, titulaire: true }));
    const r = await req('PUT', `/api/clubs/${clubA}/matchs/${matchA}/feuille`, jetonA, { lignes, forcer: true });
    expect(r.statut).toBe(400);
    expect(r.json.erreur).toContain('protocole commotion');
    // Clôture refusée tant que les étapes ne sont pas validées
    expect((await req('PATCH', `/api/clubs/${clubA}/sante/dossiers/${d2.json.id}`, jetonA, { clos: true })).statut).toBe(400);
    expect((await req('PATCH', `/api/clubs/${clubA}/sante/dossiers/${d2.json.id}`, jetonA, { etape_protocole: 6, clos: true })).statut).toBe(200);
    const liste = await req('GET', `/api/clubs/${clubA}/sante/dossiers`, jetonA);
    expect(liste.json[0].contenu.description).toBe('Choc tête');
    // Contenu chiffré en base
    const brut = await poolApp.connect();
    await brut.query('BEGIN');
    await brut.query("SELECT set_config('app.club_id', $1, true)", [clubA]);
    const ligne = (await brut.query('SELECT contenu_chiffre FROM dossiers_sante')).rows[0];
    await brut.query('COMMIT');
    brut.release();
    expect(ligne.contenu_chiffre).not.toContain('Choc');
  });

  it('applique les quotas de l\'offre Découverte', async () => {
    const saison = (await req('GET', `/api/clubs/${clubB}/saisons`, jetonB)).json[0].id;
    const r = await req('POST', `/api/clubs/${clubB}/equipes`, jetonB, { saison_id: saison, nom: 'B2' });
    expect(r.statut).toBe(402);
    const recherche = await req('GET', `/api/clubs/${clubB}/recherche?q=essais`, jetonB);
    expect(recherche.statut).toBe(402);
  });

  it('recherche en langage naturel et rapport adverse (Club+)', async () => {
    const r = await req('GET', `/api/clubs/${clubA}/recherche?q=${encodeURIComponent('plaquages manqués')}`, jetonA);
    expect(r.statut).toBe(200);
    expect(r.json.total).toBe(1);
    const advs = await req('GET', `/api/clubs/${clubA}/adversaires`, jetonA);
    const rap = await req('GET', `/api/clubs/${clubA}/adversaires/${advs.json[0].id}/rapport`, jetonA);
    expect(rap.statut).toBe(200);
    expect(rap.json.nbMatchs).toBe(1);
  });

  it('active la double authentification', async () => {
    const p = await req('POST', '/api/moi/mfa/preparer', jetonB);
    const ok = await req('POST', '/api/moi/mfa/activer', jetonB, { code: codeTotp(p.json.secret) });
    expect(ok.statut).toBe(200);
    expect((await req('POST', '/api/auth/connexion', undefined, { identifiant: '0612345678', motDePasse: 'motdepasse' })).json.code).toBe('mfa_requise');
    const c = await req('POST', '/api/auth/connexion', undefined, { identifiant: '0612345678', motDePasse: 'motdepasse', codeMfa: codeTotp(p.json.secret) });
    expect(c.statut).toBe(200);
    // Ancienne session sans MFA : accès admin refusé
    expect((await req('GET', `/api/clubs/${clubB}/membres`, jetonB)).json.code).toBe('mfa_requise');
    expect((await req('GET', `/api/clubs/${clubB}/membres`, c.json.jeton)).statut).toBe(200);
  });
});
