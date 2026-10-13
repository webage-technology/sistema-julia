'use strict'

// Segurança de conta: sair, trocar a própria senha, esquecer/redefinir senha.
//
// Redefinição por link: o usuário pede pelo e-mail (se o SMTP estiver
// configurado, recebe o link) ou o administrador gera o link na tela de
// usuários e manda por onde quiser. O token vale 1 hora e uma única vez.
const crypto = require('node:crypto')
const express = require('express')
const db = require('./db')
const {
  authMiddleware,
  permitir,
  hashPassword,
  verifyPassword,
  limparCookieSessao,
} = require('./auth')
const auditoria = require('./auditoria')
const escritorio = require('./escritorio')

const h = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error('[seguranca]', err.message)
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Erro interno' })
  })

const VALIDADE_MS = 60 * 60 * 1000

async function criarToken(userId) {
  const token = crypto.randomBytes(24).toString('hex')
  await db.query('INSERT INTO senha_tokens (user_id, token, expira_em) VALUES ($1, $2, $3)', [userId, token, new Date(Date.now() + VALIDADE_MS)])
  return token
}

async function urlBase(req) {
  const cfg = await escritorio.carregar()
  if (cfg.url_publica) return String(cfg.url_publica).replace(/\/+$/, '')
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http'
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3503'
  return `${proto}://${host}`
}

// ---- sem login ---------------------------------------------------------------
const publico = express.Router()

publico.post(
  '/senha/esquecer',
  h(async (req, res) => {
    const email = String((req.body || {}).email || '').trim()
    const generico = { success: true, message: 'Se o e-mail estiver cadastrado, o link de redefinição foi enviado.' }
    if (!email) return res.json(generico)
    const { rows } = await db.query('SELECT id, name, email FROM users WHERE lower(email) = lower($1) AND ativo', [email])
    if (!rows[0]) return res.json(generico)
    const cfg = await escritorio.carregar()
    if (!cfg.notificacoes?.smtp?.host) {
      return res.json({ success: true, enviado: false, message: 'O envio de e-mail não está configurado. Peça ao administrador um link de redefinição.' })
    }
    const token = await criarToken(rows[0].id)
    const link = `${await urlBase(req)}/redefinir-senha?token=${token}`
    try {
      const notificacoes = require('./notificacoes')
      await notificacoes.enviarEmail(cfg.notificacoes, {
        para: rows[0].email,
        assunto: `Redefinição de senha — ${cfg.nome_fantasia || 'Sistema Julia'}`,
        texto: `Olá, ${rows[0].name}.\n\nPara definir uma nova senha, abra o link abaixo (vale por 1 hora):\n${link}\n\nSe não foi você quem pediu, ignore esta mensagem.`,
      })
    } catch (err) {
      console.error('[seguranca] e-mail de redefinição: %s', err.message)
      return res.json({ success: true, enviado: false, message: 'Não consegui enviar o e-mail. Peça ao administrador um link de redefinição.' })
    }
    res.json({ ...generico, enviado: true })
  })
)

publico.get(
  '/senha/token/:token',
  h(async (req, res) => {
    const { rows } = await db.query(
      `SELECT t.id, u.name FROM senha_tokens t JOIN users u ON u.id = t.user_id
       WHERE t.token = $1 AND t.usado_em IS NULL AND t.expira_em > now() AND u.ativo`,
      [String(req.params.token)]
    )
    if (!rows[0]) return res.status(404).json({ success: false, message: 'Link inválido ou vencido — peça outro' })
    res.json({ success: true, data: { nome: rows[0].name } })
  })
)

publico.post(
  '/senha/redefinir',
  h(async (req, res) => {
    const { token, senha } = req.body || {}
    if (String(senha || '').length < 6) return res.status(422).json({ success: false, message: 'A senha precisa ter ao menos 6 caracteres' })
    const { rows } = await db.query(
      'SELECT id, user_id FROM senha_tokens WHERE token = $1 AND usado_em IS NULL AND expira_em > now()',
      [String(token || '')]
    )
    if (!rows[0]) return res.status(404).json({ success: false, message: 'Link inválido ou vencido — peça outro' })
    await db.query('UPDATE users SET password = $1 WHERE id = $2', [hashPassword(senha), rows[0].user_id])
    await db.query('UPDATE senha_tokens SET usado_em = now() WHERE id = $1', [rows[0].id])
    await auditoria.registrar({ user: { sub: rows[0].user_id, name: '' }, headers: req.headers, socket: req.socket }, { acao: 'senha', entidade: 'usuario', entidadeId: rows[0].user_id, descricao: 'Senha redefinida por link' })
    res.json({ success: true, message: 'Senha alterada — entre com a nova senha' })
  })
)

// ---- com login -----------------------------------------------------------------
const router = express.Router()
router.use(authMiddleware)

router.post(
  '/logout',
  h(async (req, res) => {
    limparCookieSessao(req, res)
    res.json({ success: true })
  })
)

router.put(
  '/minha-senha',
  h(async (req, res) => {
    const { atual, nova } = req.body || {}
    if (String(nova || '').length < 6) return res.status(422).json({ success: false, message: 'A nova senha precisa ter ao menos 6 caracteres' })
    const { rows } = await db.query('SELECT password FROM users WHERE id = $1', [req.user.sub])
    if (!rows[0] || !verifyPassword(atual, rows[0].password)) return res.status(422).json({ success: false, message: 'Senha atual incorreta' })
    await db.query('UPDATE users SET password = $1 WHERE id = $2', [hashPassword(nova), req.user.sub])
    await auditoria.registrar(req, { acao: 'senha', entidade: 'usuario', entidadeId: req.user.sub, descricao: 'Trocou a própria senha' })
    res.json({ success: true, message: 'Senha alterada' })
  })
)

// Administrador gera o link e entrega por WhatsApp/pessoalmente.
router.post(
  '/users/:id/link-redefinicao',
  permitir('admin'),
  h(async (req, res) => {
    const id = Number(req.params.id)
    const u = await db.query('SELECT id, name FROM users WHERE id = $1', [id])
    if (!u.rowCount) return res.status(404).json({ success: false, message: 'Usuário não encontrado' })
    const token = await criarToken(id)
    await auditoria.registrar(req, { acao: 'link-senha', entidade: 'usuario', entidadeId: id, descricao: `Link de redefinição gerado para ${u.rows[0].name}` })
    res.json({ success: true, data: { url: `${await urlBase(req)}/redefinir-senha?token=${token}`, validadeMinutos: 60 } })
  })
)

module.exports = { publico, router }
