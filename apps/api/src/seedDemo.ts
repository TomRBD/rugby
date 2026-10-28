// Club de démonstration : effectif, 4 matchs codés dont un avec vidéo (générée), playlist partagée, compte joueur.
// Usage : npm run seed:demo  (compte : demo@rugby-analyse.fr / demo-rugby)
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { construireApp } from './app.js';
import { fermerPools, poolAdmin } from './lib/db.js';
import { migrer } from './migrate.js';
import { TACHES } from './worker/taches.js';
import { executer, FFMPEG } from './worker/ffmpeg.js';

const EMAIL = 'demo@rugby-analyse.fr';
const MDP = 'demo-rugby';

// Générateur pseudo-aléatoire déterministe : la démo est identique à chaque installation
let graine = 42;
const alea = () => ((graine = (graine * 16807) % 2147483647) - 1) / 2147483646;
const choix = <T,>(l: T[]) => l[Math.floor(alea() * l.length)];

const JOUEURS: [string, string, string][] = [
  ['Mathis', 'Garnier', 'Pilier gauche'], ['Hugo', 'Lacombe', 'Talonneur'], ['Bastien', 'Roux', 'Pilier droit'], ['Théo', 'Bessière', 'Deuxième ligne'],
  ['Lucas', 'Marty', 'Deuxième ligne'], ['Romain', 'Cazeneuve', 'Troisième ligne aile'], ['Antoine', 'Dufau', 'Troisième ligne aile'], ['Maxime', 'Etcheverry', 'Troisième ligne centre'],
  ['Louis', 'Peyrot', 'Demi de mêlée'], ['Julien', 'Lartigue', 'Demi d\'ouverture'], ['Nathan', 'Sarrazin', 'Ailier'], ['Clément', 'Bordes', 'Centre'],
  ['Victor', 'Labat', 'Centre'], ['Enzo', 'Fourcade', 'Ailier'], ['Arthur', 'Mirande', 'Arrière'], ['Kevin', 'Domec', 'Talonneur'],
  ['Florian', 'Arrieta', 'Pilier gauche'], ['Yanis', 'Barthe', 'Pilier droit'], ['Pierre', 'Lescure', 'Deuxième ligne'], ['Thomas', 'Darrigade', 'Troisième ligne aile'],
  ['Adrien', 'Pujol', 'Demi de mêlée'], ['Benjamin', 'Castagné', 'Centre'], ['Quentin', 'Lafitte', 'Arrière'],
];

async function main() {
  await migrer();
  const app = await construireApp();
  let jeton = '';
  const api = async (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) => {
    const r = await app.inject({ method: method as any, url, headers: { ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...headers }, ...(body !== undefined ? { payload: body as any } : {}) });
    if (r.statusCode >= 400) throw new Error(`${method} ${url} : ${r.statusCode} ${r.body}`);
    try { return r.json(); } catch { return r.body; }
  };

  // Réinitialisation de la démo précédente
  const ancien = (await poolAdmin.query('SELECT id FROM utilisateurs WHERE email = ANY($1)', [[EMAIL, 'joueur@rugby-analyse.fr']])).rows.map((r) => r.id);
  if (ancien.length) {
    await poolAdmin.query("DELETE FROM clubs WHERE id IN (SELECT club_id FROM adhesions WHERE utilisateur_id = ANY($1) AND role = 'admin')", [ancien]);
    await poolAdmin.query('DELETE FROM utilisateurs WHERE id = ANY($1)', [ancien]);
  }

  const ins = await api('POST', '/api/auth/inscription', { nom: 'Coach Démo', email: EMAIL, motDePasse: MDP, club: { nom: 'RC Démonstration', comite: 'Occitanie', poule: 'Fédérale 2 Poule 6' } });
  jeton = ins.jeton;
  const club = ins.utilisateur.clubs[0].id;
  const c = (p: string) => `/api/clubs/${club}${p}`;
  await api('POST', c('/abonnement'), { offre: 'pro' });
  await api('PATCH', c(''), { couleurs: { primaire: '#8b1e2d', secondaire: '#ffffff' }, page_publique: true, stades: ['Stade municipal'] });
  const saison = (await api('GET', c('/saisons')))[0].id;
  const equipe = (await api('POST', c('/equipes'), { saison_id: saison, nom: 'Séniors A' })).id;
  const joueurs: string[] = [];
  for (const [i, [prenom, nom, poste]] of JOUEURS.entries()) {
    const j = await api('POST', c('/joueurs'), {
      prenom, nom, poste_principal: poste, numero_habituel: i + 1, date_naissance: `${1994 + (i % 9)}-0${1 + (i % 9)}-1${i % 9}`,
      taille_cm: 170 + (i * 7) % 30, poids_kg: 75 + (i * 11) % 45, pied_fort: i === 9 ? 'gauche' : 'droit', licence: `FFR-${100000 + i}`,
    });
    await api('POST', c(`/joueurs/${j.id}/consentements`), { type: 'image', accorde: true, par: `${prenom} ${nom}` });
    joueurs.push(j.id);
  }
  await api('PUT', c(`/equipes/${equipe}/joueurs`), { joueurs });
  const advs = [];
  for (const nom of ['US Exemple', 'Stade Modèle', 'AS Témoin', 'RC Voisin']) advs.push((await api('POST', c('/adversaires'), { nom })).id);
  for (const [n, nom, poste] of [[10, 'Duboscq', 'Ouvreur buteur'], [2, 'Laplace', 'Talonneur lanceur'], [8, 'Ithurbide', 'Numéro 8 perforateur']] as const) {
    await api('POST', c('/joueurs-adverses'), { adversaire_id: advs[0], numero: n, nom, poste });
  }

  /** Événements plausibles d'un match ; la vidéo de démo est condensée (une mi-temps = 3 minutes). */
  const coder = async (matchId: string, k1: number, k2: number, dureeMT: number, force: number) => {
    await api('PATCH', c(`/matchs/${matchId}/reperes`), { coup_envoi_1: k1, coup_envoi_2: k2 });
    const evs: any[] = [];
    const ev = (t: number, typeKey: string, camp: 'nous' | 'adversaire', extra: any = {}) =>
      evs.push({ id: crypto.randomUUID(), type_key: typeKey, camp, debut: Math.round(t * 10) / 10, fin: Math.round((t + 3) * 10) / 10, joueurs: [], attributs: {}, ...extra });
    const titulaire = (min: number, max: number) => joueurs[min - 1 + Math.floor(alea() * (max - min + 1))];
    for (const [debut] of [[k1], [k2]]) {
      const pas = dureeMT / 60;
      for (let i = 1; i < 58; i++) {
        const t = debut + i * pas + alea() * pas * 0.5;
        const nous = alea() < force;
        const camp = nous ? 'nous' : 'adversaire';
        const x = Math.round((nous ? 30 + alea() * 65 : 5 + alea() * 65) * 2) / 2;
        const y = Math.round(alea() * 70 * 2) / 2;
        const r = alea();
        if (r < 0.22) ev(t, 'plaquage', camp, { joueurs: nous ? [titulaire(1, 15)] : [], numero_adverse: nous ? null : 1 + Math.floor(alea() * 15), resultat: choix(['dominant', 'passif', 'passif', 'passif', 'manque']), x: nous ? 100 - x : x, y });
        else if (r < 0.40) ev(t, 'ruck', camp, { resultat: choix(['rapide', 'rapide', 'lent', 'lent', 'perdu']), attributs: nous ? { premier_arrive: titulaire(1, 8), nettoyeur: titulaire(1, 8) } : {}, x, y });
        else if (r < 0.47) ev(t, 'touche', camp, { joueurs: nous ? [joueurs[1]] : [], numero_adverse: nous ? null : 2, resultat: choix(['gagnee', 'gagnee', 'gagnee', 'volee', 'pas_droit']), attributs: { cible: choix(['devant', 'milieu', 'milieu', 'fond']), sauteur: nous ? choix([joueurs[3], joueurs[4]]) : undefined, nb_joueurs: choix([5, 7]) }, x, y: choix([0, 70]) });
        else if (r < 0.53) ev(t, 'melee', camp, { resultat: choix(['gagnee_propre', 'gagnee_propre', 'gagnee_sous_pression', 'perdue', 'penalite_pour', 'penalite_contre']), x, y: 20 + alea() * 30 });
        else if (r < 0.61) ev(t, 'jeu_au_pied', camp, { joueurs: nous ? [choix([joueurs[8], joueurs[9], joueurs[14]])] : [], resultat: choix(['recupere', 'perdu', 'touche_gagnee', 'perdu']), attributs: { type: choix(['chandelle', 'diagonale', 'degagement', 'rasant', '50_22']), metres: 15 + Math.round(alea() * 35) }, x, y });
        else if (r < 0.67) ev(t, 'penalite', camp, { joueurs: nous ? [titulaire(1, 15)] : [], numero_adverse: nous ? null : choix([4, 6, 7, 9]), attributs: { motif: choix(['hors_jeu', 'ruck', 'ruck', 'melee', 'plaquage_dangereux', 'obstruction']), provoquee_par: nous ? undefined : titulaire(1, 15) }, x, y });
        else if (r < 0.72) ev(t, 'franchissement', camp, { joueurs: nous ? [titulaire(9, 15)] : [], attributs: { defenseurs_battus: 1 + Math.floor(alea() * 3), metres: 10 + Math.round(alea() * 30) }, x, y });
        else if (r < 0.76) ev(t, 'turnover', camp, { joueurs: nous ? [titulaire(6, 8)] : [], attributs: { type: choix(['grattage', 'grattage', 'interception', 'arrache', 'en_avant_adverse']) }, x, y });
        else if (r < 0.80) ev(t, 'renvoi', camp, { resultat: choix(['recupere', 'perdu', 'perdu']), attributs: { type: 'coup_envoi', longueur: choix(['court', 'long', 'long']), receptionneur: nous ? undefined : titulaire(4, 5) } });
        else if (r < 0.86) {
          ev(t, 'entree_22', camp, { resultat: choix(['essai_transforme', 'essai', 'trois_points', 'sans_points', 'sans_points']), x: nous ? 80 : 20, y });
        } else if (r < 0.90) {
          const essaiNous = alea() < force;
          const cE = essaiNous ? 'nous' : 'adversaire';
          ev(t, 'essai', cE, { joueurs: essaiNous ? [titulaire(9, 15)] : [], numero_adverse: essaiNous ? null : choix([11, 13, 8]), attributs: { origine: choix(['touche', 'melee', 'turnover', 'jeu_au_pied_adverse', 'penalite']) }, x: essaiNous ? 100 : 0, y: 5 + alea() * 60 });
          ev(t + pas * 0.4, 'transformation', cE, { joueurs: essaiNous ? [joueurs[9]] : [], numero_adverse: essaiNous ? null : 10, resultat: alea() < 0.7 ? 'reussie' : 'manquee' });
        } else if (r < 0.94) ev(t, 'penalite_tentee', camp, { joueurs: nous ? [joueurs[9]] : [], numero_adverse: nous ? null : 10, resultat: alea() < 0.72 ? 'reussie' : 'manquee', x: nous ? 70 + alea() * 15 : 15 + alea() * 15, y: 15 + alea() * 40 });
        else if (r < 0.95) ev(t, 'carton', camp, { joueurs: nous ? [titulaire(1, 8)] : [], numero_adverse: nous ? null : 6, resultat: 'jaune', attributs: { motif: 'ruck' } });
      }
    }
    for (let i = 0; i < evs.length; i += 500) await api('POST', c(`/matchs/${matchId}/evenements/sync`), { evenements: evs.slice(i, i + 500) });
    return evs.length;
  };

  const feuille = (matchId: string) => api('PUT', c(`/matchs/${matchId}/feuille`), { lignes: joueurs.map((j, i) => ({ joueur_id: j, numero: i + 1, titulaire: i < 15, capitaine: i === 7 })) });
  const changements = async (matchId: string) => {
    for (const [m, out, inn] of [[50, 1, 17], [55, 3, 18], [60, 2, 16], [62, 9, 21], [65, 4, 19], [68, 6, 20], [70, 12, 22]]) {
      await api('POST', c(`/matchs/${matchId}/changements`), { type: 'remplacement', minute: m, joueur_sortant: joueurs[out - 1], joueur_entrant: joueurs[inn - 1] });
    }
    await api('POST', c(`/matchs/${matchId}/changements`), { type: 'temporaire_saignement', minute: 23, joueur_sortant: joueurs[11], joueur_entrant: joueurs[21] });
    await api('POST', c(`/matchs/${matchId}/changements`), { type: 'retour', minute: 31, joueur_sortant: joueurs[21], joueur_entrant: joueurs[11] });
  };

  // Matchs précédents (sans vidéo) pour les courbes de saison
  const dates = ['2026-09-13T15:00:00Z', '2026-09-27T15:00:00Z', '2026-10-11T15:00:00Z'];
  for (const [i, d] of dates.entries()) {
    const m = await api('POST', c('/matchs'), { equipe_id: equipe, adversaire_id: advs[i + 1], date: d, domicile: i % 2 === 0, competition: 'Fédérale 2', niveau_codage: 'complet' });
    await feuille(m.id);
    await changements(m.id);
    await coder(m.id, 0, 2400, 2400, 0.45 + i * 0.05);
    const s = await api('GET', c(`/matchs/${m.id}/stats`));
    await api('PATCH', c(`/matchs/${m.id}`), { score_nous: s.stats.score.nous, score_adv: s.stats.score.adversaire, statut: 'valide' });
  }

  // Match principal avec vidéo
  const m = await api('POST', c('/matchs'), {
    equipe_id: equipe, adversaire_id: advs[0], date: '2026-10-25T15:00:00Z', domicile: true, competition: 'Fédérale 2', niveau_codage: 'complet',
    arbitre: 'M. Exemple', meteo: 'Vent d\'ouest, sec', terrain: 'Stade municipal',
  });
  await feuille(m.id);
  await changements(m.id);
  console.log('Génération de la vidéo de démonstration (6 minutes condensées)…');
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rugby-demo-'));
  const fichier = path.join(tmp, 'demo.mp4');
  const sifflets = [5, 60, 120, 185, 240, 300].map((s) => `between(t,${s},${s + 0.7})`).join('+');
  await executer(FFMPEG, ['-hide_banner', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=25:duration=370',
    '-f', 'lavfi', '-i', `aevalsrc='0.45*sin(2*PI*3400*t)*(${sifflets})+0.03*(random(0)-0.5)':s=44100:d=370`,
    '-vf', "drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='RC Démonstration - US Exemple   %{pts\\:hms}':x=40:y=40:fontsize=36:fontcolor=white:box=1:boxcolor=black@0.5",
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-c:a', 'aac', '-shortest', fichier]).catch(async () => {
    // Sans police disponible : vidéo sans incrustation
    await executer(FFMPEG, ['-hide_banner', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=25:duration=370',
      '-f', 'lavfi', '-i', `aevalsrc='0.45*sin(2*PI*3400*t)*(${sifflets})':s=44100:d=370`, '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-c:a', 'aac', '-shortest', fichier]);
  });
  const contenu = await fs.readFile(fichier);
  const v = await api('POST', c(`/matchs/${m.id}/videos`), { parties: [{ nom_fichier: 'demo.mp4', taille: contenu.length }] });
  for (let o = 0; o < contenu.length; o += 8 * 1024 * 1024) {
    await api('PUT', c(`/videos/${v.video.id}/parties/${v.parties[0].id}?offset=${o}`), contenu.subarray(o, o + 8 * 1024 * 1024), { 'content-type': 'application/octet-stream' });
  }
  await api('POST', c(`/videos/${v.video.id}/terminer`));
  console.log('Transcodage HLS…');
  for (const type of ['transcodage', 'analyse_ia']) {
    const jobs = (await poolAdmin.query("SELECT * FROM jobs WHERE club_id = $1 AND type = $2 AND statut = 'en_attente'", [club, type])).rows;
    for (const j of jobs) { await TACHES[type](j); await poolAdmin.query("UPDATE jobs SET statut = 'termine' WHERE id = $1", [j.id]); }
  }
  await fs.rm(tmp, { recursive: true, force: true });
  const n = await coder(m.id, 5, 185, 180, 0.55);
  const s = await api('GET', c(`/matchs/${m.id}/stats`));
  await api('PATCH', c(`/matchs/${m.id}`), {
    score_nous: s.stats.score.nous, score_adv: s.stats.score.adversaire, score_nous_mt: s.stats.parMiTemps[0].nous.valeur, score_adv_mt: s.stats.parMiTemps[0].adversaire.valeur,
    statut: 'code', points_positifs: ['Conquête en touche solide', 'Défense agressive sur les rucks', 'Discipline en 2e mi-temps'],
    axes_travail: ['Plaquages manqués au large', 'Sorties de camp au pied', 'Efficacité dans les 22'], consignes: 'Revoir les clips de défense avant jeudi.',
  });

  // Playlists et partage
  const tf = await api('POST', c(`/matchs/${m.id}/temps-forts`), {});
  await api('PATCH', c(`/playlists/${tf.id}`), { validee: true });
  const plaq = s.stats.indicateurs.find((i: any) => i.key === 'plaquages_manques').nous.ids;
  const pm = await api('POST', c('/playlists'), { titre: 'Plaquages manqués à corriger', match_id: m.id, evenements: plaq, consignes: 'Regardez le placement des appuis avant le contact.', questions: [{ question: 'Qu\'as-tu retenu ?', type: 'texte' }, { question: 'Note ta défense', type: 'note' }] });
  await api('PATCH', c(`/playlists/${pm.id}`), { validee: true });
  const partage = await api('POST', c(`/playlists/${pm.id}/partages`), { destinataire: 'equipe', joursValidite: 60 });
  await api('POST', c('/playlists'), { titre: 'Nos touches', match_id: m.id, filtre: { types: ['touche'], camp: 'nous' } });

  // Compte joueur (n° 9) pour l'app joueur
  const inv = await api('POST', c('/invitations'), { role: 'joueur', joueurId: joueurs[8] });
  const jetonAdmin = jeton;
  jeton = '';
  await api('POST', `/api/invitations/${inv.jeton}/accepter`, { nom: 'Louis Peyrot', email: 'joueur@rugby-analyse.fr', motDePasse: MDP });
  jeton = jetonAdmin;
  // Prochain match avec composition annoncée (visible dans l'app joueur)
  const prochain = await api('POST', c('/matchs'), { equipe_id: equipe, adversaire_id: advs[3], date: '2026-11-08T14:30:00Z', domicile: false, competition: 'Fédérale 2' });
  await api('PATCH', c(`/matchs/${prochain.id}`), { consignes: 'Rendez-vous 12 h 30 au club. Défense inversée sur leurs lancements.' });
  await feuille(prochain.id);
  await api('POST', c(`/matchs/${prochain.id}/annoncer-compo`), {});

  console.log(`\nDémo prête : ${n} actions codées sur le match vidéo, 3 autres matchs codés.`);
  console.log(`  Staff  : ${EMAIL} / ${MDP}`);
  console.log(`  Joueur : joueur@rugby-analyse.fr / ${MDP}`);
  console.log(`  Lien partagé (n° 9) : ${partage.liens.find((l: any) => l.joueurId === joueurs[8])?.lien}`);
  await app.close();
  await fermerPools();
}

main().catch(async (e) => {
  console.error(e);
  await fermerPools().catch(() => undefined);
  process.exit(1);
});
