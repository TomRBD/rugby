# Rugby Analyse

Logiciel d'analyse vidéo et statistique de match de rugby pour clubs amateurs (Régionale 1 à Fédérale 1).
Cahier des charges : [CLAUDE.md](CLAUDE.md).

## Démarrage rapide (développement)

Prérequis : Node 20+, FFmpeg dans le PATH (pour le worker vidéo), et pour la base soit Docker Desktop
(Windows, macOS, Linux), soit les binaires PostgreSQL 16 sous Linux.

```bash
npm install
npm run db:start                     # PostgreSQL sur le port 5433 (Docker, ou binaires locaux sous Linux)
npm run build -w @rugby/shared
npm run migrate
npm run seed:demo                    # club de démo : 4 matchs codés dont 1 avec vidéo, playlists, compte joueur
npm run dev:api & npm run dev:worker & npm run dev:web
```

Ouvrir http://localhost:5173.

| Compte | Identifiant | Mot de passe |
| --- | --- | --- |
| Staff (admin, offre Pro) | demo@rugby-analyse.fr | demo-rugby |
| Joueur (n° 9) | joueur@rugby-analyse.fr | demo-rugby |

Tests : `npm test` (37 tests, dont la chaîne vidéo réelle : assemblage, transcodage HLS, sifflet, synchro d'angles, export MP4).

## Déploiement

```bash
cp .env.example .env                 # changer APP_SECRET, HEALTH_KEY, mots de passe
docker compose up -d                 # postgres, minio (S3), api, worker x2, web (nginx), sauvegardes quotidiennes
docker compose --profile gpu up -d ia   # service IA, sur une machine GPU
```

Hébergement prévu en France ou UE (OVHcloud, Scaleway). En production, le stockage S3 peut être celui de l'hébergeur (variables `S3_*`), avec le CDN branché sur `/media/`. TLS est terminé en frontal (répartiteur de charge ou Caddy).

## Architecture

```
packages/shared   Domaine pur, testé : taxonomie (données), stats, horloge, temps de jeu, filtres,
                  saisie vocale, recherche en langage naturel, objectifs, rapport adverse, charge.
apps/api          Fastify + PostgreSQL. Multi-tenant par RLS : le rôle applicatif ne voit que les lignes
                  du club fixé pour la transaction. REST + WebSocket (codage collaboratif).
apps/api/src/worker   File de jobs PostgreSQL (SKIP LOCKED), FFmpeg en parallèle : transcodage HLS
                  1080p/720p/480p, assemblage, vignettes, import par lien, détection sifflet et temps
                  morts, synchro d'angles, export MP4 (16:9 / 9:16), archivage froid, purge à 90 jours.
apps/ia           Service Python GPU : YOLO + ByteTrack, équipes par couleur, OCR des numéros,
                  homographie terrain, détection mêlée/touche. Renvoie des propositions.
apps/web          React + Vite, PWA hors ligne : codage post-match au clavier, codage live tablette,
                  stats cliquables vers les clips, playlists, télestration, app joueur, paramètres.
```

## Couverture du cahier des charges

| Phase | Livré |
| --- | --- |
| MVP | Effectif, saisons, équipes ; feuille de match (1 à 23, paramétrable 7 et jeunes), remplacements temporaires et définitifs, cartons, temps de jeu automatique ; import vidéo reprenable en tâche de fond, assemblage des fichiers découpés ; codage post-match Express au clavier ; stats collectives et individuelles toutes cliquables vers leurs clips ; playlists par filtre ou depuis une stat ; partage par lien signé expirable et révocable ; quotas et feature flags par offre, paiement annuel, suspension estivale |
| V1 | Codage live 100 % hors ligne avec synchro sans perte et recalage sur la vidéo ; taxonomie complète et configurable ; tableaux de bord après-match (objectifs vert/rouge), saison, dirigeant ; rapports PDF (après-match, individuel, saison, adverse, fin de cycle jeunes) ; exports CSV et Excel ; app joueur (clips, stats, objectifs, compo, consignes, RPE, fatigue, douleurs, disponibilité) ; analyse adverse et playlist « préparation » ; codage collaboratif à 2 (avants / arrières) ; télestration, voix off, export MP4, temps forts automatiques, carte de résultat en image, page publique |
| V1.5 | Détection des temps morts (mouvement), des coups d'envoi (sifflet), propositions validées en un clic ; multi-angles avec synchro automatique au sifflet ; saisie vocale (« plaquage manqué 7 ») ; recherche en langage naturel ; anglais partiel (navigation, connexion) |
| V2 | Tracking (service GPU), correction manuelle des numéros, vue 2D, métriques physiques avec marge d'erreur ; santé chiffrée à part, protocole commotion avec blocage de sélection, charge RPE x durée et ratio aigu/chronique, import GPS/cardio CSV ; échange de vidéos entre clubs de la poule sur consentement mutuel ; entraînements ; résumé de match automatique, schémas adverses, suggestions d'exercices |

Mesures sur la démo : ouverture des stats d'un match 180 ms, saut d'une stat au clip en lecture 400 ms, rapport PDF 90 ms.

## Ce qui reste à faire ou à vérifier

- **Mobile** : l'app joueur et le codage tablette sont une PWA installable (hors ligne, notifications), pas une app React Native / Flutter.
- **Vision par ordinateur** : le service `apps/ia` est écrit mais n'a pas été exécuté ici (pas de GPU ni de modèles). La détection audio (sifflet) et de mouvement, elle, est testée. Sans service GPU, les arrêts de jeu sifflés sont proposés à l'analyste pour qu'il les qualifie.
- **Paiement** : offres, quotas et feature flags sont en place, mais aucun prestataire de paiement n'est branché.
- **Floutage** des spectateurs et des mineurs sur les exports publics : non implémenté. La page publique ne montre aucune vidéo.
- **Anglais** : seules la navigation et la connexion sont traduites.
- **Pilote S3 et images Docker** : écrits, mais pas exécutés ici (pas de démon Docker dans cet environnement). Les tests utilisent le stockage local.
- **Performance** : la cible de traitement serveur (80 min de 1080p en moins de 30 min) n'a pas été mesurée sur une vraie vidéo de match.
- **Avant la mise en production** : pentest, registre des traitements, AIPD (santé, mineurs), hébergeur HDS si le module médical est activé. La double authentification est obligatoire pour admin et médical quand `NODE_ENV=production`.
