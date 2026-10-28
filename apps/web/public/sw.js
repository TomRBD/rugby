// Service worker : application disponible hors ligne (codage live, app joueur) et vidéos téléchargées pour lecture sans réseau.
const VERSION = 'rugby-v1';
const COQUILLE = ['/', '/index.html', '/manifest.webmanifest', '/icone.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(COQUILLE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((cles) => Promise.all(cles.filter((k) => k !== VERSION && k !== 'rugby-media').map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Clé de cache média indépendante du jeton signé (qui change à chaque ouverture)
function cleMedia(url) {
  const m = url.pathname.match(/^\/media\/([^/]+)\/(.*)$/);
  if (!m) return null;
  try {
    const corps = m[1].split('.')[0].replace(/-/g, '+').replace(/_/g, '/');
    const p = JSON.parse(atob(corps)).p;
    return `https://media.local/${p}${m[2]}`;
  } catch {
    return null;
  }
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/media/')) {
    const cle = cleMedia(url);
    if (!cle) return;
    e.respondWith(
      caches.open('rugby-media').then(async (c) => (await c.match(cle)) || fetch(e.request)),
    );
    return;
  }
  if (url.pathname.startsWith('/api/')) return; // l'API est gérée par l'application (file d'attente hors ligne)

  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('/index.html')));
    return;
  }
  // Fichiers statiques (noms hachés) : cache d'abord, puis réseau
  e.respondWith(
    caches.match(e.request).then((r) => r || fetch(e.request).then((rep) => {
      if (rep.ok && (url.pathname.startsWith('/assets/') || COQUILLE.includes(url.pathname))) {
        const copie = rep.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copie));
      }
      return rep;
    })),
  );
});

// Mise en cache explicite d'une vidéo pour lecture hors ligne (demandée par l'application)
self.addEventListener('message', (e) => {
  if (e.data?.type !== 'cacher-media') return;
  const { urls } = e.data;
  e.waitUntil((async () => {
    const c = await caches.open('rugby-media');
    let fait = 0;
    for (const u of urls) {
      const url = new URL(u, self.location.origin);
      const cle = cleMedia(url);
      if (cle && !(await c.match(cle))) {
        const r = await fetch(url);
        if (r.ok) await c.put(cle, r);
      }
      fait++;
      if (fait % 10 === 0 || fait === urls.length) e.source?.postMessage({ type: 'progression-media', fait, total: urls.length });
    }
  })());
});

self.addEventListener('push', (e) => {
  const d = e.data ? e.data.json() : { titre: 'Rugby Analyse' };
  e.waitUntil(self.registration.showNotification(d.titre, { body: d.corps, icon: '/icone.svg', data: { lien: d.lien } }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.openWindow(e.notification.data?.lien || '/'));
});
