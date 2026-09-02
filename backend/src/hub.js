'use strict'

// Integração com o WebAge Hub — dá a este sistema acesso ao **Claude Code CLI**
// que roda no Hub (o CLI vive na máquina do Hub, com a sessão logada; aqui só
// pedimos e acompanhamos).
//
// Como funciona: o Hub expõe uma API de integração autenticada por uma chave de
// sistema (header X-Integration-Key). A chave fica SÓ no servidor (env
// HUB_INTEGRATION_KEY) — o navegador nunca a vê; o frontend fala com /api/hub/*
// e este módulo repassa ao Hub.
//
// O que dá para fazer:
//   • texto   — completação texto→texto (Claude como provedor de IA)
//   • job     — alteração de código por IA na cópia local deste repositório
//               (modo "local": o Hub edita E:\Workspace\felix\sistema-julia)
//   • chat    — perguntar sobre o próprio código (só leitura)
const express = require('express')
const db = require('./db')
const { authMiddleware } = require('./auth')

const HUB_URL = (process.env.HUB_URL || 'http://host.docker.internal:4601').replace(/\/+$/, '')
const HUB_KEY = process.env.HUB_INTEGRATION_KEY || ''
const HUB_TIMEOUT = Number(process.env.HUB_TIMEOUT_MS || 120000)

const router = express.Router()
router.use(authMiddleware)

const h = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 502
    console.error('[hub]', err.message)
    res.status(status).json({ success: false, message: err.message || 'Falha ao falar com o Hub' })
  })

// Alterar código é ação de administrador — a Julia usa o sistema, não o edita.
function requireAdmin(req, res, next) {
  db.query('SELECT role FROM users WHERE id = $1', [req.user.sub])
    .then(({ rows }) => {
      if (rows[0]?.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Apenas administradores podem pedir alterações no código' })
      }
      next()
    })
    .catch((err) => {
      console.error('[hub]', err.message)
      res.status(500).json({ success: false, message: 'Erro interno' })
    })
}

// -------------------------------------------------------------- cliente HTTP
// O backend do Hub roda no HOST (fora do Docker) e às vezes reinicia. Uma queda
// de um segundo não pode derrubar um trabalho de um minuto (ex.: ler a planta),
// então falha de CONEXÃO é tentada de novo — erro de resposta (4xx) não é.
const INACESSIVEL = `Hub inacessível em ${HUB_URL}. Verifique se o backend do WebAge Hub está rodando no host (webage-hub\\backend\\start-host.cmd).`

async function hubFetch(method, path, body, { tentativas = 3 } = {}) {
  if (!HUB_KEY) {
    throw Object.assign(new Error('Integração com o Hub não configurada (defina HUB_INTEGRATION_KEY)'), { status: 503 })
  }
  let res = null
  let ultimoErro = null
  for (let n = 1; n <= tentativas && !res; n++) {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), HUB_TIMEOUT)
    try {
      res = await fetch(`${HUB_URL}${path}`, {
        method,
        headers: {
          'X-Integration-Key': HUB_KEY,
          ...(body != null ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body != null ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      })
    } catch (err) {
      ultimoErro = err
      if (err.name === 'AbortError') break // demorou demais: repetir não ajuda
      if (n < tentativas) {
        console.warn('[hub] sem resposta (tentativa %d/%d): %s', n, tentativas, err.message)
        await new Promise((r) => setTimeout(r, 1500 * n))
      }
    } finally {
      clearTimeout(t)
    }
  }
  if (!res) {
    const msg = ultimoErro?.name === 'AbortError' ? 'O Hub demorou demais para responder' : INACESSIVEL
    throw Object.assign(new Error(msg), { status: 504 })
  }
  let json = null
  try {
    json = await res.json()
  } catch {
    /* corpo vazio ou não-JSON */
  }
  if (!res.ok || json?.success === false) {
    throw Object.assign(new Error(json?.message || `Hub respondeu ${res.status}`), { status: res.status })
  }
  return json?.data !== undefined ? json.data : json
}

// Texto→texto pelo Claude do Hub. Uso interno do sistema (ex.: futuros textos de
// laudo), sem depender de chave da Anthropic aqui.
const gerarTexto = ({ prompt, system, model } = {}) =>
  hubFetch('POST', '/api/integration/ai-text', { prompt, system, model: model || 'haiku' })

// ------------------------------------------------------------------- rotas
// Status: mostra se a ponte está de pé e qual sistema o Hub enxerga.
router.get(
  '/hub/status',
  h(async (_req, res) => {
    if (!HUB_KEY) {
      return res.json({ success: true, data: { configurado: false, hubUrl: HUB_URL, motivo: 'HUB_INTEGRATION_KEY não definida' } })
    }
    try {
      // Status é só um sinal na tela: uma tentativa basta (não trava a página).
      const sys = await hubFetch('GET', '/api/integration/resolve', undefined, { tentativas: 1 })
      // Sem a `key`: o resolve do Hub devolve a própria chave de integração e ela
      // não pode chegar ao navegador.
      const { key: _key, ...publico } = sys || {}
      res.json({ success: true, data: { configurado: true, online: true, hubUrl: HUB_URL, sistema: publico } })
    } catch (err) {
      res.json({ success: true, data: { configurado: true, online: false, hubUrl: HUB_URL, motivo: err.message } })
    }
  })
)

// Teste da integração ponta a ponta (botão "Testar integração" na tela de IA).
// Percorre a ponte inteira: configuração → Hub no ar → Claude CLI respondendo de
// verdade → permissão de alterar código. Devolve uma etapa por passo, com tempo.
router.post(
  '/hub/teste',
  h(async (req, res) => {
    const etapas = []
    const passo = async (chave, titulo, fn) => {
      const t0 = Date.now()
      try {
        const detalhe = await fn()
        etapas.push({ chave, titulo, ok: true, detalhe, ms: Date.now() - t0 })
        return true
      } catch (err) {
        etapas.push({ chave, titulo, ok: false, detalhe: err.message, ms: Date.now() - t0 })
        return false
      }
    }

    const configurado = await passo('config', 'Chave de integração configurada', () => {
      if (!HUB_KEY) throw new Error('HUB_INTEGRATION_KEY não definida no .env do projeto')
      return `Hub em ${HUB_URL}`
    })

    let sistema = null
    if (configurado) {
      await passo('hub', 'WebAge Hub respondendo', async () => {
        sistema = await hubFetch('GET', '/api/integration/resolve')
        return `Reconhecido como "${sistema.name}" · ${sistema.hasRepo ? 'com repositório' : 'edição na cópia local'}`
      })
    }

    if (sistema) {
      await passo('claude', 'Claude Code executando pelo Hub', async () => {
        const r = await gerarTexto({ prompt: 'Responda apenas: PONTE OK', model: 'haiku' })
        const texto = String(r.text || '').trim()
        if (!/PONTE OK/i.test(texto)) throw new Error(`Resposta inesperada: "${texto.slice(0, 60)}"`)
        const custo = r.cost ? ` · custo US$ ${Number(r.cost).toFixed(4)}` : ''
        return `Respondeu "${texto}"${custo}`
      })
    }

    await passo('permissao', 'Permissão para pedir alterações no código', async () => {
      const { rows } = await db.query('SELECT role FROM users WHERE id = $1', [req.user.sub])
      if (rows[0]?.role !== 'admin') throw new Error('Seu usuário não é administrador — só administradores alteram o código')
      return 'Você é administrador'
    })

    res.json({ success: true, data: { ok: etapas.every((e) => e.ok), etapas } })
  })
)

// Completação de texto (qualquer usuário logado).
router.post(
  '/hub/texto',
  h(async (req, res) => {
    const { prompt, system, model } = req.body || {}
    if (!String(prompt || '').trim()) {
      return res.status(422).json({ success: false, message: 'Escreva o que a IA deve responder' })
    }
    res.json({ success: true, data: await gerarTexto({ prompt, system, model }) })
  })
)

// --- alteração de código por IA (Claude Code) — só admin ---
// mode 'local': o Hub roda o CLI sobre a cópia local deste repositório e deixa as
// mudanças no working tree (sem GitHub — este repo não tem remoto).
router.post(
  '/hub/jobs',
  requireAdmin,
  h(async (req, res) => {
    const { prompt, title, model } = req.body || {}
    if (!String(prompt || '').trim()) {
      return res.status(422).json({ success: false, message: 'Descreva a alteração desejada' })
    }
    const out = await hubFetch('POST', '/api/integration/ai-jobs', {
      prompt,
      title: title || 'Alteração pedida no Sistema Julia',
      model: model || undefined,
      mode: 'local',
      source: 'Sistema Julia (integração)',
      originTask: title || undefined,
    })
    res.json({ success: true, data: out })
  })
)

// Log ao vivo + status (o frontend faz polling).
router.get(
  '/hub/jobs/:id',
  requireAdmin,
  h(async (req, res) => {
    res.json({ success: true, data: await hubFetch('GET', `/api/integration/ai-jobs/${Number(req.params.id)}`) })
  })
)

// Controles do job em andamento: pausar (retomável), cancelar, retomar e desfazer.
for (const acao of ['pause', 'cancel', 'resume', 'revert']) {
  router.post(
    `/hub/jobs/:id/${acao}`,
    requireAdmin,
    h(async (req, res) => {
      res.json({ success: true, data: await hubFetch('POST', `/api/integration/ai-jobs/${Number(req.params.id)}/${acao}`, {}) })
    })
  )
}

// --- perguntar sobre o código (chat só-leitura) ---
router.post(
  '/hub/chats',
  h(async (req, res) => {
    res.json({ success: true, data: await hubFetch('POST', '/api/integration/ai-chats', { model: (req.body || {}).model }) })
  })
)

router.post(
  '/hub/chats/:id/mensagens',
  h(async (req, res) => {
    const { content, mode } = req.body || {}
    if (!String(content || '').trim()) {
      return res.status(422).json({ success: false, message: 'Escreva a pergunta' })
    }
    res.json({
      success: true,
      data: await hubFetch('POST', `/api/integration/ai-chats/${Number(req.params.id)}/messages`, { content, mode }),
    })
  })
)

router.get(
  '/hub/chats/:id',
  h(async (req, res) => {
    res.json({ success: true, data: await hubFetch('GET', `/api/integration/ai-chats/${Number(req.params.id)}`) })
  })
)

module.exports = router
module.exports.gerarTexto = gerarTexto
module.exports.hubFetch = hubFetch
