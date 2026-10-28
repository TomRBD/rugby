-- Schéma initial. Toutes les tables métier portent club_id et sont protégées par RLS :
-- le rôle applicatif (rugby_app) ne voit que les lignes du club fixé par app.club_id.

CREATE OR REPLACE FUNCTION app_club() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.club_id', true), '')::uuid $$;

CREATE TABLE clubs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nom text NOT NULL,
  slug text UNIQUE NOT NULL,
  logo_url text,
  couleurs jsonb NOT NULL DEFAULT '{"primaire":"#0b5d3b","secondaire":"#ffffff"}',
  stades jsonb NOT NULL DEFAULT '[]',
  comite text,
  poule text,
  offre text NOT NULL DEFAULT 'decouverte' CHECK (offre IN ('decouverte','club','club_plus','pro')),
  cycle_facturation text NOT NULL DEFAULT 'mensuel' CHECK (cycle_facturation IN ('mensuel','annuel')),
  suspendu_ete boolean NOT NULL DEFAULT false,
  page_publique boolean NOT NULL DEFAULT false,
  config jsonb NOT NULL DEFAULT '{}', -- objectifs, pondérations, modèles de rapport, pré/post-roll
  fin_abonnement date,
  suppression_prevue date,
  cree_le timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE utilisateurs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE,
  telephone text UNIQUE,
  mot_de_passe text NOT NULL,
  nom text NOT NULL,
  mfa_secret text,
  mfa_actif boolean NOT NULL DEFAULT false,
  langue text NOT NULL DEFAULT 'fr',
  cree_le timestamptz NOT NULL DEFAULT now(),
  CHECK (email IS NOT NULL OR telephone IS NOT NULL)
);

CREATE TABLE saisons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  libelle text NOT NULL,
  debut date NOT NULL,
  fin date NOT NULL,
  archivee boolean NOT NULL DEFAULT false
);

CREATE TABLE equipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  saison_id uuid NOT NULL REFERENCES saisons(id) ON DELETE CASCADE,
  nom text NOT NULL,
  categorie text NOT NULL DEFAULT 'seniors',
  format text NOT NULL DEFAULT 'XV' CHECK (format IN ('XV','7')),
  feminine boolean NOT NULL DEFAULT false,
  duree_mi_temps integer NOT NULL DEFAULT 40,
  nb_titulaires integer NOT NULL DEFAULT 15,
  nb_remplacants integer NOT NULL DEFAULT 8,
  archivee boolean NOT NULL DEFAULT false
);

CREATE TABLE joueurs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  prenom text NOT NULL,
  nom text NOT NULL,
  photo_url text,
  date_naissance date,
  poste_principal text,
  postes_secondaires text[] NOT NULL DEFAULT '{}',
  pied_fort text CHECK (pied_fort IN ('droit','gauche','les_deux')),
  taille_cm integer,
  poids_kg integer,
  licence text,
  categorie text,
  statut text NOT NULL DEFAULT 'disponible' CHECK (statut IN ('disponible','blesse','suspendu','absent','prete')),
  numero_habituel integer,
  responsable_legal_nom text,
  responsable_legal_contact text,
  consentement_image boolean NOT NULL DEFAULT false,
  consentement_parental boolean NOT NULL DEFAULT false,
  archive boolean NOT NULL DEFAULT false,
  cree_le timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE equipe_joueurs (
  club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  equipe_id uuid NOT NULL REFERENCES equipes(id) ON DELETE CASCADE,
  joueur_id uuid NOT NULL REFERENCES joueurs(id) ON DELETE CASCADE,
  PRIMARY KEY (equipe_id, joueur_id)
);

CREATE TABLE adhesions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  utilisateur_id uuid NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('admin','entraineur','entraineur_adjoint','analyste','joueur','medical','dirigeant')),
  equipe_id uuid REFERENCES equipes(id) ON DELETE CASCADE,
  joueur_id uuid REFERENCES joueurs(id) ON DELETE CASCADE,
  secteur text, -- avants, arrières... pour l'entraîneur adjoint
  cree_le timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX adhesions_unique ON adhesions (club_id, utilisateur_id, role, coalesce(equipe_id, '00000000-0000-0000-0000-000000000000'));

CREATE TABLE invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  jeton_hash text UNIQUE NOT NULL,
  role text NOT NULL,
  equipe_id uuid REFERENCES equipes(id) ON DELETE CASCADE,
  joueur_id uuid REFERENCES joueurs(id) ON DELETE CASCADE,
  expire_le timestamptz NOT NULL,
  utilisee_le timestamptz,
  cree_par uuid REFERENCES utilisateurs(id)
);

CREATE TABLE adversaires (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  nom text NOT NULL,
  ville text,
  couleurs text,
  notes text
);

CREATE TABLE joueurs_adverses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  adversaire_id uuid NOT NULL REFERENCES adversaires(id) ON DELETE CASCADE,
  numero integer NOT NULL,
  nom text,
  poste text,
  notes text
);

CREATE TABLE matchs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  equipe_id uuid NOT NULL REFERENCES equipes(id) ON DELETE CASCADE,
  adversaire_id uuid REFERENCES adversaires(id) ON DELETE SET NULL,
  type text NOT NULL DEFAULT 'officiel' CHECK (type IN ('officiel','amical','observation')),
  competition text,
  date timestamptz NOT NULL,
  domicile boolean NOT NULL DEFAULT true,
  arbitre text,
  meteo text,
  terrain text,
  duree_mi_temps integer NOT NULL DEFAULT 40,
  niveau_codage text NOT NULL DEFAULT 'express' CHECK (niveau_codage IN ('express','complet')),
  coup_envoi_1 double precision,
  coup_envoi_2 double precision,
  score_nous_mt integer, score_adv_mt integer,
  score_nous integer, score_adv integer,
  compo_annoncee boolean NOT NULL DEFAULT false,
  consignes text,
  points_positifs text[] NOT NULL DEFAULT '{}',
  axes_travail text[] NOT NULL DEFAULT '{}',
  objectifs jsonb,
  statut text NOT NULL DEFAULT 'a_coder' CHECK (statut IN ('a_coder','en_cours','code','valide')),
  cree_le timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX matchs_equipe ON matchs (club_id, equipe_id, date);

CREATE TABLE feuille_match (
  club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  match_id uuid NOT NULL REFERENCES matchs(id) ON DELETE CASCADE,
  joueur_id uuid NOT NULL REFERENCES joueurs(id) ON DELETE CASCADE,
  numero integer NOT NULL,
  titulaire boolean NOT NULL,
  poste text,
  capitaine boolean NOT NULL DEFAULT false,
  PRIMARY KEY (match_id, joueur_id),
  UNIQUE (match_id, numero)
);

CREATE TABLE changements_feuille (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  match_id uuid NOT NULL REFERENCES matchs(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('remplacement','temporaire_commotion','temporaire_saignement','retour','carton_jaune','carton_rouge','carton_bleu')),
  minute double precision NOT NULL,
  joueur_sortant uuid REFERENCES joueurs(id) ON DELETE CASCADE,
  joueur_entrant uuid REFERENCES joueurs(id) ON DELETE CASCADE,
  evenement_id uuid
);

CREATE TABLE videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  match_id uuid NOT NULL REFERENCES matchs(id) ON DELETE CASCADE,
  angle text NOT NULL DEFAULT 'Principal',
  decalage double precision NOT NULL DEFAULT 0, -- secondes à ajouter au temps de l'angle principal
  statut text NOT NULL DEFAULT 'televersement' CHECK (statut IN ('televersement','en_attente','transcodage','pret','erreur','archive')),
  source text NOT NULL DEFAULT 'fichier',
  source_url text,
  duree double precision,
  largeur integer, hauteur integer,
  renditions jsonb NOT NULL DEFAULT '[]',
  progression real NOT NULL DEFAULT 0,
  erreur text,
  conserver_original boolean NOT NULL DEFAULT true,
  cree_le timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE video_parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  video_id uuid NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  ordre integer NOT NULL,
  nom_fichier text NOT NULL,
  taille bigint NOT NULL,
  recu bigint NOT NULL DEFAULT 0,
  cle_stockage text NOT NULL,
  duree double precision,
  UNIQUE (video_id, ordre)
);

CREATE TABLE types_evenements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  key text NOT NULL,
  definition jsonb NOT NULL,
  actif boolean NOT NULL DEFAULT true,
  UNIQUE (club_id, key)
);

CREATE TABLE evenements (
  id uuid PRIMARY KEY, -- généré par le client : rend la synchro hors ligne idempotente
  club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  match_id uuid NOT NULL REFERENCES matchs(id) ON DELETE CASCADE,
  type_key text NOT NULL,
  camp text NOT NULL CHECK (camp IN ('nous','adversaire')),
  joueurs uuid[] NOT NULL DEFAULT '{}',
  numero_adverse integer,
  resultat text,
  attributs jsonb NOT NULL DEFAULT '{}',
  debut double precision NOT NULL,
  fin double precision NOT NULL,
  x double precision, y double precision,
  commentaire text,
  auteur_id uuid REFERENCES utilisateurs(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'manuel' CHECK (source IN ('manuel','live','ia_validee','vocal')),
  a_completer boolean NOT NULL DEFAULT false, -- codé en live (horodatage seul), détail à compléter
  version integer NOT NULL DEFAULT 1,
  supprime boolean NOT NULL DEFAULT false,
  maj_le timestamptz NOT NULL DEFAULT now(),
  cree_le timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX evenements_match ON evenements (club_id, match_id, debut);

ALTER TABLE changements_feuille ADD CONSTRAINT changements_evenement FOREIGN KEY (evenement_id) REFERENCES evenements(id) ON DELETE CASCADE;

CREATE TABLE propositions_ia (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  match_id uuid NOT NULL REFERENCES matchs(id) ON DELETE CASCADE,
  video_id uuid REFERENCES videos(id) ON DELETE CASCADE,
  type text NOT NULL, -- type d'événement proposé ou 'temps_mort', 'coup_envoi', 'mi_temps'
  debut double precision NOT NULL,
  fin double precision NOT NULL,
  confiance real NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  statut text NOT NULL DEFAULT 'en_attente' CHECK (statut IN ('en_attente','validee','rejetee')),
  evenement_id uuid REFERENCES evenements(id) ON DELETE SET NULL,
  cree_le timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE playlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  equipe_id uuid REFERENCES equipes(id) ON DELETE CASCADE,
  match_id uuid REFERENCES matchs(id) ON DELETE SET NULL,
  titre text NOT NULL,
  type text NOT NULL DEFAULT 'theme' CHECK (type IN ('theme','preparation','temps_forts','individuelle')),
  filtre jsonb,
  consignes text,
  questions jsonb NOT NULL DEFAULT '[]',
  validee boolean NOT NULL DEFAULT false,
  auteur_id uuid REFERENCES utilisateurs(id) ON DELETE SET NULL,
  cree_le timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE playlist_clips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  playlist_id uuid NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  evenement_id uuid REFERENCES evenements(id) ON DELETE CASCADE,
  video_id uuid NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  debut double precision NOT NULL,
  fin double precision NOT NULL,
  ordre integer NOT NULL,
  titre text,
  note text,
  dessin jsonb, -- télestration
  voix_off_cle text
);

CREATE TABLE partages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  playlist_id uuid NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  jeton_hash text UNIQUE NOT NULL,
  destinataire text NOT NULL DEFAULT 'lien' CHECK (destinataire IN ('joueur','groupe','equipe','lien')),
  joueur_id uuid REFERENCES joueurs(id) ON DELETE CASCADE,
  libelle text NOT NULL,
  expire_le timestamptz NOT NULL,
  telechargement boolean NOT NULL DEFAULT false,
  revoque_le timestamptz,
  cree_par uuid REFERENCES utilisateurs(id) ON DELETE SET NULL,
  cree_le timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE lectures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  partage_id uuid NOT NULL REFERENCES partages(id) ON DELETE CASCADE,
  clip_id uuid REFERENCES playlist_clips(id) ON DELETE CASCADE,
  spectateur text,
  secondes double precision NOT NULL DEFAULT 0,
  le timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE commentaires (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  playlist_id uuid NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  clip_id uuid REFERENCES playlist_clips(id) ON DELETE CASCADE,
  partage_id uuid REFERENCES partages(id) ON DELETE CASCADE,
  auteur text NOT NULL,
  utilisateur_id uuid REFERENCES utilisateurs(id) ON DELETE SET NULL,
  texte text NOT NULL,
  le timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reponses_questionnaire (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  partage_id uuid NOT NULL REFERENCES partages(id) ON DELETE CASCADE,
  repondant text NOT NULL,
  reponses jsonb NOT NULL,
  le timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE suivi_joueur (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  joueur_id uuid NOT NULL REFERENCES joueurs(id) ON DELETE CASCADE,
  date date NOT NULL,
  type text NOT NULL DEFAULT 'entrainement' CHECK (type IN ('match','entrainement','autre')),
  rpe integer CHECK (rpe BETWEEN 1 AND 10),
  duree_minutes integer,
  fatigue integer CHECK (fatigue BETWEEN 1 AND 5),
  douleurs text,
  disponible boolean NOT NULL DEFAULT true,
  le timestamptz NOT NULL DEFAULT now()
);

-- Données de santé : contenu chiffré à part (AES-256-GCM, clé distincte HEALTH_KEY)
CREATE TABLE dossiers_sante (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  joueur_id uuid NOT NULL REFERENCES joueurs(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('blessure','commotion')),
  date date NOT NULL,
  etape_protocole integer NOT NULL DEFAULT 0,
  clos boolean NOT NULL DEFAULT false,
  contenu_chiffre text NOT NULL,
  maj_le timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE entrainements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  equipe_id uuid NOT NULL REFERENCES equipes(id) ON DELETE CASCADE,
  date timestamptz NOT NULL,
  duree_minutes integer NOT NULL DEFAULT 90,
  theme text,
  exercices jsonb NOT NULL DEFAULT '[]',
  presences uuid[] NOT NULL DEFAULT '{}'
);

CREATE TABLE donnees_gps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  joueur_id uuid NOT NULL REFERENCES joueurs(id) ON DELETE CASCADE,
  match_id uuid REFERENCES matchs(id) ON DELETE CASCADE,
  entrainement_id uuid REFERENCES entrainements(id) ON DELETE CASCADE,
  decalage_video double precision NOT NULL DEFAULT 0,
  resume jsonb NOT NULL,
  points jsonb NOT NULL DEFAULT '[]'
);

-- Tracking (V2) : positions estimées par la vidéo, joueurs identifiés par numéro (OCR corrigé à la main)
CREATE TABLE tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  match_id uuid NOT NULL REFERENCES matchs(id) ON DELETE CASCADE,
  piste integer NOT NULL,
  camp text,
  numero integer,
  joueur_id uuid REFERENCES joueurs(id) ON DELETE SET NULL,
  confiance_numero real,
  positions jsonb NOT NULL -- [[t, x, y], ...] en mètres terrain
);

CREATE TABLE consentements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  joueur_id uuid NOT NULL REFERENCES joueurs(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('image','parental')),
  accorde boolean NOT NULL,
  par text NOT NULL,
  le timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  utilisateur_id uuid REFERENCES utilisateurs(id) ON DELETE CASCADE,
  joueur_id uuid REFERENCES joueurs(id) ON DELETE CASCADE,
  titre text NOT NULL,
  corps text,
  lien text,
  lue boolean NOT NULL DEFAULT false,
  le timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE abonnements_push (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  utilisateur_id uuid NOT NULL REFERENCES utilisateurs(id) ON DELETE CASCADE,
  abonnement jsonb NOT NULL
);

CREATE TABLE exports_video (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  playlist_id uuid NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  format text NOT NULL DEFAULT '16:9' CHECK (format IN ('16:9','9:16')),
  filigrane text,
  statut text NOT NULL DEFAULT 'en_attente',
  cle_stockage text,
  erreur text,
  cree_le timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE journal (
  id bigserial PRIMARY KEY,
  club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  utilisateur_id uuid REFERENCES utilisateurs(id) ON DELETE SET NULL,
  action text NOT NULL,
  cible text,
  cible_id text,
  details jsonb,
  le timestamptz NOT NULL DEFAULT now()
);

-- Échange de vidéos entre clubs d'une poule, sur consentement mutuel (hors RLS : deux clubs concernés)
CREATE TABLE echanges_video (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_demandeur uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  club_cible uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  match_cible_id uuid REFERENCES matchs(id) ON DELETE CASCADE,
  match_offert_id uuid REFERENCES matchs(id) ON DELETE CASCADE,
  message text,
  statut text NOT NULL DEFAULT 'demande' CHECK (statut IN ('demande','accepte','refuse','revoque')),
  le timestamptz NOT NULL DEFAULT now()
);

-- File de traitement (transcodage, IA, exports, purge) lue par les workers via SKIP LOCKED
CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid REFERENCES clubs(id) ON DELETE CASCADE,
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  statut text NOT NULL DEFAULT 'en_attente' CHECK (statut IN ('en_attente','en_cours','termine','echec')),
  tentatives integer NOT NULL DEFAULT 0,
  executer_apres timestamptz NOT NULL DEFAULT now(),
  verrouille_le timestamptz,
  erreur text,
  cree_le timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_file ON jobs (statut, executer_apres);

-- RLS sur toutes les tables portant club_id
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'saisons','equipes','joueurs','equipe_joueurs','adhesions','invitations','adversaires','joueurs_adverses','matchs',
    'feuille_match','changements_feuille','videos','video_parties','types_evenements','evenements','propositions_ia',
    'playlists','playlist_clips','partages','lectures','commentaires','reponses_questionnaire','suivi_joueur',
    'dossiers_sante','entrainements','donnees_gps','tracking','consentements','notifications','abonnements_push',
    'exports_video','journal'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY cloisonnement_club ON %I USING (club_id = app_club()) WITH CHECK (club_id = app_club())', t);
  END LOOP;
END $$;
ALTER TABLE clubs ENABLE ROW LEVEL SECURITY;
CREATE POLICY cloisonnement_club ON clubs USING (id = app_club()) WITH CHECK (id = app_club());

-- Recherches hors contexte club (connexion, jetons) : fonctions SECURITY DEFINER au périmètre minimal
CREATE FUNCTION f_mes_adhesions(p_utilisateur uuid)
RETURNS TABLE (club_id uuid, club_nom text, club_slug text, role text, equipe_id uuid, joueur_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.club_id, c.nom, c.slug, a.role, a.equipe_id, a.joueur_id
  FROM adhesions a JOIN clubs c ON c.id = a.club_id WHERE a.utilisateur_id = p_utilisateur
$$;

CREATE FUNCTION f_club_du_partage(p_jeton_hash text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT club_id FROM partages WHERE jeton_hash = p_jeton_hash
$$;

CREATE FUNCTION f_club_de_invitation(p_jeton_hash text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT club_id FROM invitations WHERE jeton_hash = p_jeton_hash
$$;

CREATE FUNCTION f_club_public(p_slug text) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM clubs WHERE slug = p_slug AND page_publique
$$;

CREATE FUNCTION f_clubs_poule(p_club uuid)
RETURNS TABLE (id uuid, nom text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, c.nom FROM clubs c, clubs moi
  WHERE moi.id = p_club AND c.id <> moi.id AND c.poule IS NOT NULL AND c.poule = moi.poule
$$;
