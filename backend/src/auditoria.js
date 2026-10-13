'use strict'

// Auditoria — quem fez o quê, quando. Cada ação relevante (criar, editar,
// excluir, mudar etapa, emitir laudo, entrar) vira uma linha; a tela de
// auditoria lista tudo e cada processo mostra a sua própria linha do tempo.
//
// `registrar` nunca derruba a rota que a chamou: falhar em gravar o log é
// pior do que não gravar, mas não pode custar o trabalho do usuário.
const express = require('express')
const db = require('./db')
const { authMiddleware, permitir, ipDe } = require('./auth')

async function registrar(req, { acao, entidade, entidadeId = null, processoId = null, descricao = '', dados = null }) {
  try {
    await db.query(
      `INSERT INTO auditoria (user_id, user_nome, acao, entidade, entidade_id, processo_id, descricao, dados, ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        req?.user?.sub || null,
        req?.user?.name || req?.portalCliente?.nome || '',
        acao,
        entidade,
        entidadeId == null ? null : Number(entidadeId),
        processoId == null ? null : Number(processoId),
        String(descricao || '').slice(0, 500),
        dados ? JSON.stringify(dados) : null,
        req ? ipDe(req) : '',
      ]
    )
  } catch (err) {
    console.error('[auditoria] falha ao registrar: %s', err.message)
  }
}

const router = express.Router()
router.use(authMiddleware)

const h = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error('[auditoria]', err.message)
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Erro interno' })
  })

const COLS = `a.id, a.user_id AS "userId", a.user_nome AS "userNome", a.acao, a.entidade, a.entidade_id AS "entidadeId",
  a.processo_id AS "processoId", a.descricao, a.dados, a.ip, a.created_at AS "createdAt"`

// Lista geral (só administrador): filtros por entidade, usuário e texto.
router.get(
  '/auditoria',
  permitir('admin'),
  h(async (req, res) => {
    const num = (v) => (v === undefined || v === '' ? null : Number(v))
    const limite = Math.min(Math.max(Number(req.query.limite || 200), 1), 1000)
    const { rows } = await db.query(
      `SELECT ${COLS} FROM auditoria a
       WHERE ($1::text IS NULL OR a.entidade = $1)
         AND ($2::int IS NULL OR a.entidade_id = $2)
         AND ($3::int IS NULL OR a.user_id = $3)
         AND ($4::text IS NULL OR a.descricao ILIKE '%' || $4 || '%' OR a.acao ILIKE '%' || $4 || '%')
       ORDER BY a.id DESC LIMIT $5`,
      [req.query.entidade || null, num(req.query.entidadeId), num(req.query.userId), req.query.busca || null, limite]
    )
    res.json({ success: true, data: rows })
  })
)

// Linha do tempo de um processo — qualquer pessoa da equipe vê.
router.get(
  '/processos/:id/historico',
  h(async (req, res) => {
    const { rows } = await db.query(`SELECT ${COLS} FROM auditoria a WHERE a.processo_id = $1 ORDER BY a.id DESC LIMIT 300`, [
      Number(req.params.id),
    ])
    res.json({ success: true, data: rows })
  })
)

module.exports = { router, registrar }
