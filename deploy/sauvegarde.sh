#!/bin/sh
# Sauvegarde quotidienne de la base, rétention 30 jours. Les vidéos sont protégées par la réplication
# du stockage objet (versioning du bucket recommandé chez l'hébergeur).
set -e
DOSSIER=${DOSSIER_SAUVEGARDE:-/sauvegardes}
HOTE=${PGHOST:-postgres}
mkdir -p "$DOSSIER"
FICHIER="$DOSSIER/rugby-$(date +%Y%m%d-%H%M).dump"
pg_dump -h "$HOTE" -U rugby_admin -d rugby -Fc -f "$FICHIER"
find "$DOSSIER" -name 'rugby-*.dump' -mtime +30 -delete
echo "Sauvegarde : $FICHIER"
