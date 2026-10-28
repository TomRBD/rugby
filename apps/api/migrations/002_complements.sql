-- Objectifs individuels (app joueur) et score affiché sur la page publique
ALTER TABLE joueurs ADD COLUMN objectifs_perso jsonb NOT NULL DEFAULT '[]';
ALTER TABLE matchs ADD COLUMN publie boolean NOT NULL DEFAULT true;
