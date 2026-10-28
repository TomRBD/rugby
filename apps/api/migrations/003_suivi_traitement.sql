-- Suivi détaillé du traitement vidéo (étape en cours, début du traitement pour estimer le temps restant)
ALTER TABLE videos ADD COLUMN etape text;
ALTER TABLE videos ADD COLUMN traitement_debut timestamptz;

-- Signal de vie des workers (aucune donnée de club) : permet d'avertir si aucun worker ne tourne
CREATE TABLE workers (
  nom text PRIMARY KEY,
  vu_le timestamptz NOT NULL DEFAULT now(),
  actifs integer NOT NULL DEFAULT 0,
  concurrence integer NOT NULL DEFAULT 1
);
