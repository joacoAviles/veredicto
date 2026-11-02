// Sin caché de datos a propósito: la verdad vive en el servidor. Solo existe para que la app sea instalable.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", () => {});
