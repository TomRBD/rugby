# CLAUDE.md : logiciel d'analyse de match de rugby pour clubs amateurs

## Projet

Outil d'analyse vidéo et statistique de niveau pro pour clubs de Régionale 1 à Fédérale 1, utilisable par des bénévoles avec une seule caméra, budget < 50 €/mois par club.

Objectifs produit, dans l'ordre de priorité :
1. Coder un match complet en < 90 min (Express < 60 min), en post-match ou en live.
2. Générer automatiquement stats collectives, individuelles et playlists vidéo par thème.
3. Partager à chaque joueur ses clips et ses chiffres sur mobile le lendemain du match.
4. Préparer le match suivant (analyse adverse).
5. Suivre la progression sur la saison.

Périmètre : rugby à XV, rugby à 7, féminin, jeunes (M16, M18, M21). Hors périmètre V1 : XIII, captation matérielle, billetterie, gestion admin du club (licences, cotisations).

Plateformes : web (bureau), mobile iOS/Android, tablette pour le codage live au bord du terrain.

## Stack

- Front web : SPA (React ou Svelte), lecteur vidéo HLS, PWA hors ligne pour le codage.
- Mobile : React Native ou Flutter.
- Back : API REST + WebSocket (codage collaboratif), workers de transcodage FFmpeg parallélisés.
- Données : PostgreSQL, stockage objet S3 compatible pour la vidéo, CDN.
- IA : service séparé sur GPU à la demande, file de traitement, résultats renvoyés comme propositions.
- Hébergement : France ou UE (OVHcloud, Scaleway), sauvegardes quotidiennes, rétention 30 jours.

Machine de dev costaude : paralléliser les workers (transcodage, tests, builds), ne pas sous-dimensionner.

## Règles de travail

- Livrer par milestone (voir Roadmap), MVP d'abord, rien de V1.5 ou V2 tant que le MVP n'est pas validé.
- Sur du code existant : fournir uniquement les modifications, pas le fichier complet regénéré.
- Interface et vocabulaire en français, termes rugby FFR (mêlée, touche, ruck, maul, grattage, 50:22...).
- Pas de tirets cadratins dans les textes de l'UI.
- Toute stat affichée doit être cliquable vers les clips qui la composent : garder le lien événement ↔ timecode partout.
- Les détections IA ne créent jamais d'événement directement : propositions avec score de confiance, validées par un humain.
- Multi-tenant strict : chaque requête filtrée par club. Aucun accès inter-clubs.

## Modèle de domaine

- **Club** : nom, logo, couleurs, stades, comité régional, poule.
- **Saison** et **Équipe** (Séniors A/B, Crabos, Reichel, féminines, 7), archivage et comparaison entre saisons.
- **Joueur** : identité, photo, date de naissance, postes (principal + secondaires), pied fort, taille, poids, licence, catégorie, statut (disponible, blessé, suspendu, absent, prêté), responsable légal si mineur.
- **Adversaire** : réutilisable entre saisons, joueurs identifiés par numéro, nommés si connus.
- **Match** : date, domicile/extérieur, arbitre, météo, terrain, score par mi-temps.
- **Feuille de match** : 1 à 15, remplaçants 16 à 23 (paramétrable 7 et jeunes), remplacements temporaires (commotion, saignement) et définitifs avec minute, cartons jaune/rouge/bleu avec minute. Temps de jeu calculé automatiquement.
- **Vidéo** : un ou plusieurs fichiers assemblés par match, angles multiples (V1.5), repères de synchro.
- **Événement** : timecode début et fin, équipe, joueur(s), type, résultat, zone (grille 5 bandes largeur × 6 zones longueur, ou coordonnées clic), attributs spécifiques, commentaire, auteur, source (manuel ou IA validée).
- **Playlist** : liste de clips (événement + pré-roll/post-roll), destinataires, accusés de lecture, commentaires.

## Rôles et droits (RBAC par équipe)

| Rôle | Droits | Support |
| --- | --- | --- |
| Administrateur club | Tout, facturation | Web |
| Entraîneur principal | Lecture/écriture sur ses équipes, validation des clips partagés | Web, tablette |
| Entraîneur adjoint | Lecture/écriture sur son secteur | Web, tablette |
| Analyste / codeur | Codage, montage, pas de données médicales | Web, tablette |
| Joueur | Ses données, playlists reçues, commentaires | Mobile |
| Staff médical | Données santé de l'équipe uniquement | Web, mobile |
| Dirigeant | Lecture tableaux de bord, export temps forts | Web, mobile |

Rôles cumulables. Mineurs rattachés à un responsable légal, pas de messagerie privée adulte vers mineur. Invitation par lien ou QR code, téléphone accepté sans email. Journal des actions sensibles (suppression, export, accès médical).

## Vidéo

- Import : MP4, MOV, MKV, AVI; H.264/H.265; jusqu'à 4K 60 i/s. Sources : fichier, carte SD, YouTube/Vimeo non listé, exports Veo, Pixellot, Spiideo, Hudl Focus, Drive, Dropbox.
- Upload reprenable en tâche de fond, transcodage 1080p / 720p / 480p.
- Assemblage de fichiers découpés (tranches de 4 Go), détection mi-temps et arrêts longs.
- Lecteur : 0,25x à 4x, image par image, raccourcis configurables, zoom numérique, double fenêtre vidéo + timeline, lecture hors ligne.
- Synchro horloge match ↔ timecode via 2 repères (coups d'envoi). Multi-angles par clap ou détection audio du sifflet (V1.5). GPS calé sur la vidéo (V2).
- Télestration : flèches, zones, cercles, lignes de défense, texte, voix off, lignes 22 m / 10 m / 5 m.
- Montage : playlists par filtre, pré-roll/post-roll par type d'événement (ex : ruck 3 s avant, 4 s après), export MP4 avec incrustation titre/score/logo, 16:9 ou 9:16, temps forts automatiques.

## Codage

Modes :
- **Live** tablette : gros boutons, horodatage seul, détail complété après. 100 % hors ligne, synchro au retour réseau.
- **Post-match** PC : une touche par événement, pause auto pour saisir les attributs.
- **Collaboratif** : 2 codeurs simultanés (avants / arrières), fusion sans conflit (WebSocket).
- **Niveaux** : Express (~15 types, 45 min) ou Complet.
- Fenêtres de codage personnalisables par le club (boutons, catégories, attributs).

Taxonomie par défaut :

| Famille | Événements | Attributs |
| --- | --- | --- |
| Possession | Début/fin, origine, phases | Origine (touche, mêlée, renvoi, turnover, jeu au pied adverse), nb phases, issue |
| Mêlée | Introduction, résultat | Gagnée propre, sous pression, perdue, pénalité pour/contre, effondrement, reprise |
| Touche | Lancer, réception, issue | Nb joueurs, cible (devant, milieu, fond), sauteur, groupé pénétrant, pas droit, volée |
| Renvois | Coup d'envoi, 22, en-but | Court/long, récupéré, réceptionneur |
| Ruck | Formation, sortie | Rapide (< 3 s), lent, perdu, joueurs engagés, nettoyeurs |
| Maul | Formation, mètres | Origine, essai, écroulé, pénalité |
| Jeu au pied | Type | Chandelle, diagonale, rasant, par-dessus, touche directe, 50:22, mètres, récupéré |
| Attaque | Passe, course, franchissement, offload, en-avant, plaqué | Ligne d'avantage, défenseurs battus, mètres |
| Défense | Plaquage | Réussi dominant, réussi passif, manqué, cassé, haut, à deux, contest au sol |
| Turnover | Grattage, interception, contre, arraché, en-avant adverse | Gagné/concédé, zone |
| Discipline | Pénalité, coup franc, carton | Motif (hors-jeu, ruck, mêlée, plaquage dangereux, obstruction), fautif, zone |
| Points | Essai, transfo, pénalité, drop, essai de pénalité | Origine, buteur, position, réussite |
| Arbitrage | Avantage, décision vidéo | Avantage joué ou non |
| Santé | Arrêt blessure, protocole commotion | Joueur, minute, sortie |

Aides : compteur de score et de phases auto, duplication du dernier événement, saisie joueur par numéro ou clic sur la compo, contrôles de cohérence (joueur sorti codé, score incohérent). Modèles de codage partageables entre clubs (V2).

La taxonomie doit être stockée en données (configurable), pas codée en dur.

## Statistiques

Collectives :
- Résultat : score, points par mi-temps et par tranche de 10 min, essais pour/contre.
- Possession : % possession, % occupation, nombre et durée des possessions, phases par possession.
- Efficacité : points par entrée dans les 22, % entrées converties, origine des essais.
- Conquête : % mêlées, % touches (par lanceur, sauteur, zone), % renvois récupérés.
- Rucks : nombre, % gagnés, % sorties rapides. Défense : % plaquages réussis, dominants, grattages, mètres concédés.
- Jeu au pied : nombre, mètres, % récupérés, 50:22. Discipline : pénalités par motif/zone/période, cartons. Buteur : % par zone, carte des tirs.

Individuelles : temps de jeu, ballons portés, mètres, franchissements, défenseurs battus, offloads, plaquages (tentés, réussis, manqués, dominants), rucks (premier arrivé, nettoyages, grattages), pénalités concédées/provoquées, stats de poste (lanceur, buteur, 9, 10), indice de contribution à pondération configurable.

Visualisations : carte du terrain par type d'événement, chronologie (score, momentum par 5 min, cartons, remplacements), arbres d'issue des possessions, comparaisons match/match, joueur/joueur, match/moyenne, courbes de saison, radar joueur vs moyenne du poste.

Tableaux de bord : après-match (10 indicateurs choisis, vert/rouge vs objectifs), saison, dirigeant. Objectifs par match suivis automatiquement. Exports PDF, Excel, CSV, API.

## Analyse adverse, rapports, partage

- Codage des matchs adverses, rapport adverse auto (lancements, touche, jeu au pied, buteur, joueurs clés, discipline), playlist « préparation ». Échange de vidéos entre clubs d'une poule sur consentement mutuel (V2).
- Rapports PDF en un clic : après-match (score, stats clés, carte, 3 points positifs + 3 axes saisis), individuel, saison, fin de cycle jeunes. Modèles personnalisables.
- Partage : playlists à un joueur, un groupe ou l'équipe, push + lien signé, téléchargement bloquable, commentaires, accusé de lecture, questionnaire, suivi de visionnage.
- App joueur : mes stats, mes clips, mes objectifs, playlists, consignes, compo annoncée, RPE (1 à 10), fatigue, douleurs, disponibilité, hors ligne.
- Communication : temps forts format réseaux sociaux, carte de résultat en image, page publique optionnelle.

## IA et avancé

- V1.5 : détection temps morts et jeu effectif (mouvement, sifflet audio), détection mêlée/touche/coup d'envoi, propositions validées en un clic, saisie vocale (« plaquage manqué 7 »), recherche en langage naturel.
- V2 : tracking joueurs (type YOLO + ByteTrack), calibration terrain par les lignes, OCR des numéros avec correction manuelle, vue 2D, métriques physiques estimées sans GPS (marge d'erreur affichée).
- Analyse assistée : résumé de match auto, détection de schémas adverses, suggestions d'exercices.
- Santé (V2) : blessures, protocole commotion FFR avec blocage de sélection tant que non validé, charge RPE × durée, ratio aigu/chronique, import GPS/cardio CSV.

## Exigences non fonctionnelles

| Exigence | Cible |
| --- | --- |
| Ouverture d'un match codé | < 3 s |
| Saut à un clip depuis une stat | < 1 s |
| Traitement serveur vidéo 80 min 1080p | < 30 min |
| Génération rapport PDF | < 10 s |
| Disponibilité | 99,5 % mensuel, pic dimanche soir et lundi |
| Codage live hors ligne | 100 % des fonctions |
| Matériel minimal | PC 8 Go RAM, navigateur récent; tablette 2020+ |

Stockage : ~1,5 Go par match 1080p compressé, ~60 Go par équipe et par saison. Quotas par offre, archivage froid après la saison, suppression des originaux en option.

## Sécurité et RGPD

- Auth email ou téléphone, MFA pour admin et médical.
- TLS en transit, AES-256 au repos, données de santé chiffrées à part.
- RBAC par rôle et par équipe, cloisonnement multi-tenant, liens signés expirables, filigrane du nom du joueur sur les vidéos partagées.
- Journalisation des accès, pentest avant mise en prod.
- Registre des traitements, AIPD (santé, mineurs), hébergeur HDS si module médical activé.
- Droit à l'image : consentement à l'inscription, parental pour mineurs, révocable. Floutage spectateurs et mineurs non consentants sur exports publics.
- Accès, rectification, effacement en libre-service, export des données joueur. Fin d'abonnement : export puis suppression sous 90 jours.

## Ergonomie

Prise en main d'un bénévole < 30 min, tutoriels intégrés, match de démo pré-codé. Mode sombre, contraste élevé plein soleil, RGAA de base. Anglais en V1.5.

## Offres (hypothèses)

| Offre | Prix | Contenu |
| --- | --- | --- |
| Découverte | Gratuit | 1 équipe, 3 matchs, Express, pas de partage |
| Club | 29 €/mois | 2 équipes, 50 h vidéo, codage complet, stats, app joueurs |
| Club+ | 59 €/mois | Équipes illimitées, 200 h, analyse adverse, rapports perso, IA |
| Pro | Sur devis | Multi-angles, GPS, tracking, API |

Prévoir dès le MVP : quotas par offre, feature flags par plan, paiement annuel et suspension estivale.

## Roadmap

| Phase | Durée | Contenu | Critère de passage |
| --- | --- | --- | --- |
| MVP | 4 à 6 mois | Effectif, feuille de match, import vidéo, codage post-match Express, stats de base, playlists, partage lien | 5 clubs pilotes codent 3 matchs chacun en < 90 min |
| V1 | + 4 mois | Codage live hors ligne, taxonomie complète, tableaux de bord, rapports PDF, app joueur, analyse adverse | 30 clubs payants, rétention > 80 % sur 3 mois |
| V1.5 | + 4 mois | IA d'assistance, multi-angles, recherche naturelle, anglais | Temps de codage divisé par 2 |
| V2 | + 6 mois | Tracking, santé et charge, GPS, échange entre clubs, entraînements | 150 clubs, offre Pro vendue |

## Critères d'acceptation

- [ ] Un bénévole sans formation code un match en Express en < 60 min après 30 min de tutoriel.
- [ ] Chaque stat ouvre ses clips en < 1 s.
- [ ] Le codage live tient 80 min sans réseau et se synchronise sans perte.
- [ ] Un joueur lit sa playlist en 4G sans téléchargement complet.
- [ ] Le rapport PDF se génère en < 10 s.
- [ ] Aucune donnée d'un club accessible depuis un autre (pentest).
- [ ] Consentements image et parentaux recueillis et révocables.
