-- Le worker signale si FFmpeg est utilisable sur sa machine (sinon il ne prend aucun traitement vidéo)
ALTER TABLE workers ADD COLUMN ffmpeg boolean NOT NULL DEFAULT true;
ALTER TABLE workers ADD COLUMN ffmpeg_erreur text;
