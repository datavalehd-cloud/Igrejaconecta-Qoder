/* Service worker do IgrejaConecta (Fase 9).
 *
 * Estratégia, de propósito conservadora:
 *  - install: pré-cacheia o shell (index.html, manifest, ícones, og-image).
 *  - navegações (mode === 'navigate'): network-first; sem rede, serve o shell em
 *    cache. Rotas privadas (/app, /admin) NUNCA vão para o cache e, offline,
 *    recebem um 503 honesto em vez do shell (elas exigem sessão viva).
 *  - assets estáticos same-origin (/assets/, ícones, manifest): cache-first com
 *    preenchimento em runtime — os nomes com hash do build são cacheados no
 *    primeiro uso online e revalidados depois.
 *  - tudo que é dado (Supabase, APIs externas, tiles de mapa, fontes): só rede.
 *    O service worker JAMAIS cacheia resposta de dado, para não mostrar conteúdo
 *    velho como se fosse atual.
 *
 * O registro acontece só em produção (ver src/main.tsx); no dev ele fica desligado
 * para não atrapalhar HMR.
 */
const CACHE = 'igrejaconecta-v1'

const SHELL = [
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/maskable-512.png',
  '/apple-touch-icon.png',
  '/og-image.png',
]

const PRIVATE_PREFIXES = ['/app', '/admin']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

function isPrivatePath(url) {
  return PRIVATE_PREFIXES.some((p) => url.pathname === p || url.pathname.startsWith(`${p}/`))
}

function offlineResponse() {
  return new Response(
    '<!doctype html><html lang="pt-BR"><meta charset="utf-8">' +
      '<title>Sem conexão</title>' +
      '<body style="font-family:sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;background:#15345b;color:#fff">' +
      '<div style="text-align:center;padding:24px"><h1>Você está offline</h1>' +
      '<p>Esta área precisa de conexão e de sessão ativa. Reconecte e tente de novo.</p></div>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // Dados e terceiros: sempre rede, nunca cache (Supabase, mapa, fontes, CDN).
  if (url.origin !== self.location.origin) return

  // Navegações.
  if (request.mode === 'navigate') {
    // Rotas privadas: nunca servidas do cache.
    if (isPrivatePath(url)) {
      event.respondWith(fetch(request).catch(() => offlineResponse()))
      return
    }
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put(request, copy))
          return response
        })
        .catch(() =>
          caches.match(request).then((hit) => hit || caches.match('/index.html')),
        ),
    )
    return
  }

  // Assets estáticos same-origin: cache-first com preenchimento.
  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone()
            caches.open(CACHE).then((cache) => cache.put(request, copy))
          }
          return response
        }),
    ),
  )
})
