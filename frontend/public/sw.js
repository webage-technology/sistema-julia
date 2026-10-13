/* Service worker do Sistema Julia — o app abre sem sinal.
 *
 * O que fica em cache:
 *   • páginas visitadas (HTML) e os chunks estáticos do Next: rede primeiro,
 *     cache quando a rede falha — é o que faz /captura/12 abrir num galpão
 *     sem sinal depois de ter sido aberta uma vez com sinal;
 *   • GET /api/vistorias/:id e /api/vistorias/:id/pinos e a imagem da planta:
 *     rede primeiro, cache como reserva — a captura precisa da lista de
 *     ambientes para funcionar.
 * O que NUNCA fica em cache: POST/PUT/DELETE (as fotos vão pela fila do
 * IndexedDB) e as fotos em si (são grandes e não são necessárias em campo).
 */
const VERSAO = 'sj-v2'
const CACHE_PAGINAS = `${VERSAO}-paginas`
const CACHE_ESTATICO = `${VERSAO}-estatico`
const CACHE_API = `${VERSAO}-api`

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((chaves) => Promise.all(chaves.filter((c) => !c.startsWith(VERSAO)).map((c) => caches.delete(c))))
      .then(() => self.clients.claim())
  )
})

const redePrimeiro = async (req, nomeCache) => {
  const cache = await caches.open(nomeCache)
  try {
    const res = await fetch(req)
    if (res && res.ok) cache.put(req, res.clone())
    return res
  } catch (err) {
    const guardado = await cache.match(req, { ignoreSearch: false })
    if (guardado) return guardado
    throw err
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  // Chunks do Next: rede primeiro, cache como reserva. Em produção o nome tem
  // hash e a rede responde do cache HTTP (immutable), então não custa nada; em
  // desenvolvimento o nome NÃO tem hash (webpack.js, app/.../page.js) — guardar
  // "para sempre" serviria JS velho depois de cada alteração e quebraria a tela
  // com erros que não existem no código. Offline continua valendo: se a rede
  // falhar, vem do cache.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(redePrimeiro(req, CACHE_ESTATICO))
    return
  }
  // Dados que a captura precisa para funcionar sem sinal.
  if (/^\/api\/vistorias\/\d+(\/pinos)?$/.test(url.pathname) || /^\/api\/imoveis\/\d+\/planta\/imagem/.test(url.pathname)) {
    event.respondWith(redePrimeiro(req, CACHE_API))
    return
  }
  if (url.pathname.startsWith('/api/')) return // o resto da API não é cacheado
  // Navegação (HTML) e ícones: rede primeiro, cache de reserva.
  if (req.mode === 'navigate' || url.pathname.startsWith('/icons/') || url.pathname === '/manifest.webmanifest') {
    event.respondWith(
      redePrimeiro(req, CACHE_PAGINAS).catch(async () => {
        // Sem a página exata em cache, tenta a casca da captura/iniciar.
        const cache = await caches.open(CACHE_PAGINAS)
        return (await cache.match('/iniciar')) || Response.error()
      })
    )
  }
})
