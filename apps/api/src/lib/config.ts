import path from 'node:path';

const env = (k: string, d?: string) => {
  const v = process.env[k] ?? d;
  if (v === undefined) throw new Error(`Variable d'environnement manquante : ${k}`);
  return v;
};

export const config = {
  databaseUrl: env('DATABASE_URL', 'postgres://rugby_admin:rugby_admin@localhost:5433/rugby'),
  appDatabaseUrl: env('APP_DATABASE_URL', 'postgres://rugby_app:rugby_app@localhost:5433/rugby'),
  secret: env('APP_SECRET', 'dev-secret-a-changer-en-production-0123456789'),
  // Clé dédiée aux données de santé (32 octets en hexadécimal), distincte du secret applicatif
  healthKey: env('HEALTH_KEY', 'a3f1c2d4e5b6978812ab34cd56ef7890a3f1c2d4e5b6978812ab34cd56ef7890'),
  port: Number(env('API_PORT', '3000')),
  publicWebUrl: env('PUBLIC_WEB_URL', 'http://localhost:5173'),
  storage: {
    driver: env('STORAGE_DRIVER', 'local') as 'local' | 's3',
    dir: path.resolve(env('STORAGE_DIR', './.data/storage')),
    s3: {
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION ?? 'fr-par',
      bucket: process.env.S3_BUCKET ?? 'rugby-videos',
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '',
    },
  },
  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY,
    privateKey: process.env.VAPID_PRIVATE_KEY,
    subject: process.env.VAPID_SUBJECT ?? 'mailto:contact@example.fr',
  },
};
