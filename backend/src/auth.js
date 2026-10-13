'use strict'

// Autenticação: senha com scrypt (stdlib, sem dependência nativa) e sessão via JWT.
//
// O token vai de dois jeitos:
//   • header `Authorization: Bearer …` — o cliente HTTP do frontend (qualquer método);
//   • cookie HttpOnly `sj_sessao` — só para GET: é o que deixa <img src> e os
//     downloads funcionarem SEM o token na URL (antes ia em `?token=`, e URL
//     vai parar em log do túnel, histórico do navegador e print de tela).
// Cookie em requisição que altera dados não vale — evita CSRF por link.
//
// Papéis: admin · arquiteto · estagiario · financeiro. O papel viaja no token;
// trocar o papel de alguém vale no próximo login.
const crypto = require('node:crypto')
const jwt = require('jsonwebtoken')

const SECRET_DEV = 'sistema-julia-dev-sem-segredo'
const SECRET = process.env.JWT_SECRET || SECRET_DEV
if (!process.env.JWT_SECRET || process.env.JWT_SECRET === SECRET_DEV) {
  console.warn('[auth] AVISO: JWT_SECRET não definido — usando o segredo de desenvolvimento. Defina no .env antes de expor o sistema.')
}

const COOKIE = 'sj_sessao'
const SESSAO_DIAS = 7

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex')
  return `${salt}:${hash}`
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false
  const [salt, hash] = stored.split(':')
  const test = crypto.scryptSync(String(password), salt, 64).toString('hex')
  const a = Buffer.from(hash, 'hex')
  const b = Buffer.from(test, 'hex')
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email, role: user.role || 'arquiteto', name: user.name || '' }, SECRET, {
    expiresIn: `${SESSAO_DIAS}d`,
  })
}

// Sessão do PORTAL DO CLIENTE: token curto, separado do da equipe — nunca dá
// acesso às rotas internas (o payload é outro e o middleware interno o recusa).
function signPortal(clientId) {
  return jwt.sign({ portal: Number(clientId) }, SECRET, { expiresIn: '7d' })
}
function verifyPortal(token) {
  try {
    const p = jwt.verify(String(token || ''), SECRET)
    return p && p.portal ? Number(p.portal) : null
  } catch {
    return null
  }
}

function lerCookies(req) {
  const out = {}
  for (const parte of String(req.headers.cookie || '').split(';')) {
    const i = parte.indexOf('=')
    if (i < 0) continue
    out[parte.slice(0, i).trim()] = decodeURIComponent(parte.slice(i + 1).trim())
  }
  return out
}

// Atrás do túnel a conexão chega em http; o Cloudflare avisa o protocolo real.
const ehHttps = (req) => (req.headers['x-forwarded-proto'] || req.protocol) === 'https'

function definirCookieSessao(req, res, token) {
  const partes = [
    `${COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSAO_DIAS * 24 * 3600}`,
  ]
  if (ehHttps(req)) partes.push('Secure')
  res.setHeader('Set-Cookie', partes.join('; '))
}

function limparCookieSessao(req, res) {
  const partes = [`${COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0']
  if (ehHttps(req)) partes.push('Secure')
  res.setHeader('Set-Cookie', partes.join('; '))
}

function tokenDaRequisicao(req) {
  const header = req.headers.authorization || ''
  if (header.startsWith('Bearer ')) return header.slice(7)
  if (req.method === 'GET' || req.method === 'HEAD') return lerCookies(req)[COOKIE] || ''
  return ''
}

function authMiddleware(req, res, next) {
  try {
    req.user = jwt.verify(tokenDaRequisicao(req), SECRET)
    if (req.user.portal || !req.user.sub) throw new Error('token do portal não vale aqui')
    if (!req.user.role) req.user.role = 'arquiteto'
    next()
  } catch {
    res.status(401).json({ success: false, message: 'Não autenticado' })
  }
}

// Permissão por papel: `permitir('admin', 'arquiteto')`. Admin passa sempre.
const permitir =
  (...papeis) =>
  (req, res, next) => {
    const papel = req.user?.role || ''
    if (papel === 'admin' || papeis.includes(papel)) return next()
    res.status(403).json({ success: false, message: 'Seu papel não permite esta ação' })
  }

// Quem pode excluir cadastros, emitir laudos e mexer no que é irreversível.
const PAPEIS_TECNICOS = ['admin', 'arquiteto']
// Quem mexe com dinheiro (verba das viagens e despesas do processo).
const PAPEIS_FINANCEIRO = ['admin', 'financeiro']

// ---- limite de tentativas no login ------------------------------------------
// Por IP + e-mail, em memória: 5 falhas seguidas bloqueiam por 15 minutos.
// Basta para um sistema de um escritório atrás do túnel; um dia, se houver
// mais de um backend, isto vai para o banco.
const tentativas = new Map()
const MAX_FALHAS = 5
const BLOQUEIO_MS = 15 * 60 * 1000

const ipDe = (req) =>
  String(req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '')
    .split(',')[0]
    .trim()

function chaveLogin(req, email) {
  return `${ipDe(req)}|${String(email || '').toLowerCase()}`
}

function loginBloqueado(req, email) {
  const reg = tentativas.get(chaveLogin(req, email))
  if (!reg) return 0
  if (reg.falhas < MAX_FALHAS) return 0
  const resta = reg.ultima + BLOQUEIO_MS - Date.now()
  if (resta <= 0) {
    tentativas.delete(chaveLogin(req, email))
    return 0
  }
  return Math.ceil(resta / 60000)
}

function registrarFalhaLogin(req, email) {
  const k = chaveLogin(req, email)
  const reg = tentativas.get(k) || { falhas: 0, ultima: 0 }
  reg.falhas += 1
  reg.ultima = Date.now()
  tentativas.set(k, reg)
  // Limpeza preguiçosa: sem isto o mapa só cresce.
  if (tentativas.size > 5000) {
    const limite = Date.now() - BLOQUEIO_MS
    for (const [kk, v] of tentativas) if (v.ultima < limite) tentativas.delete(kk)
  }
}

function limparFalhasLogin(req, email) {
  tentativas.delete(chaveLogin(req, email))
}

module.exports = {
  hashPassword,
  verifyPassword,
  signToken,
  authMiddleware,
  permitir,
  PAPEIS_TECNICOS,
  PAPEIS_FINANCEIRO,
  definirCookieSessao,
  limparCookieSessao,
  loginBloqueado,
  registrarFalhaLogin,
  limparFalhasLogin,
  ipDe,
  signPortal,
  verifyPortal,
}
