// Offline after first load: cache the app shell. The model files are cached by transformers.js itself.
const CACHE = "pos-daybook-v13";   // bump on every app change: the shell is served cache-first
const SHELL = ["./", "./index.html", "./app.js", "./manifest.json", "./src/parse.js", "./src/guard.js",
  "./src/prompt.js", "./src/classify.js", "./src/daybook.js", "./src/rules.js", "./src/resumable.js", "./vendor/transformers.min.js"];

self.addEventListener("install", (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", (e) => e.waitUntil(
  // Only old app-shell caches. Never touch the model ("transformers-cache") or saved download pieces.
  caches.keys().then((ks) => Promise.all(ks.filter((k) => /^pos-daybook-v\d+$/.test(k) && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;               // model + runtime: let the browser/library handle them
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request)));
});
