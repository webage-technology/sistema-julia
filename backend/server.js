'use strict'

// Backend Express do sistema-julia (PostgreSQL).
//   • POST /api/login            — autentica e devolve JWT
//   • GET  /api/me               — usuário atual
//   • /api/users   (CRUD)        — protegido por JWT
//   • /api/clients (CRUD)        — protegido por JWT
// Dados no PostgreSQL (src/db.js). Envelope: { success, data } | { success, message }.
const express = require('express')
const cors = require('cors')
const db = require('./src/db')
const { hashPassword, verifyPassword, signToken, authMiddleware } = require('./src/auth')

const app = express()
app.use(cors())
app.use(express.json())

// Colunas públicas (created_at → createdAt para o JSON).
const USER_COLS = 'id, name, email, role, created_at AS "createdAt"'
const CLIENT_COLS = 'id, name, email, phone, company, created_at AS "createdAt"'

// Wrapper que captura erros de handlers async (Express 4 não faz isso sozinho).
const h = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error('[erro]', err.message)
    res.status(500).json({ success: false, message: 'Erro interno' })
  })

// -------------------------------------------------------------------- público
app.get('/api/health', (_req, res) =>
  res.json({ success: true, service: 'sistema-julia', time: new Date().toISOString() })
)

app.post(
  '/api/login',
  h(async (req, res) => {
    const { email, password } = req.body || {}
    const { rows } = await db.query('SELECT * FROM users WHERE lower(email) = lower($1)', [String(email || '')])
    const user = rows[0]
    if (!user || !verifyPassword(password, user.password)) {
      return res.status(401).json({ success: false, message: 'E-mail ou senha inválidos' })
    }
    res.json({
      success: true,
      token: signToken(user),
      user: { id: user.id, name: user.name, email: user.email, role: user.role, createdAt: user.created_at },
    })
  })
)

app.get(
  '/api/me',
  authMiddleware,
  h(async (req, res) => {
    const { rows } = await db.query(`SELECT ${USER_COLS} FROM users WHERE id = $1`, [req.user.sub])
    if (!rows[0]) return res.status(404).json({ success: false, message: 'Usuário não encontrado' })
    res.json({ success: true, user: rows[0] })
  })
)

// ---------------------------------------------------------------- usuários (CRUD)
app.get(
  '/api/users',
  authMiddleware,
  h(async (_req, res) => {
    const { rows } = await db.query(`SELECT ${USER_COLS} FROM users ORDER BY id`)
    res.json({ success: true, data: rows })
  })
)

app.post(
  '/api/users',
  authMiddleware,
  h(async (req, res) => {
    const { name, email, password, role } = req.body || {}
    if (!name || !email || !password) {
      return res.status(422).json({ success: false, message: 'Nome, e-mail e senha são obrigatórios' })
    }
    const dup = await db.query('SELECT 1 FROM users WHERE lower(email) = lower($1)', [email])
    if (dup.rowCount) return res.status(422).json({ success: false, message: 'E-mail já cadastrado' })
    const { rows } = await db.query(
      `INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, $4) RETURNING ${USER_COLS}`,
      [name, email, hashPassword(password), role || 'user']
    )
    res.json({ success: true, data: rows[0] })
  })
)

app.put(
  '/api/users/:id',
  authMiddleware,
  h(async (req, res) => {
    const id = Number(req.params.id)
    const cur = await db.query('SELECT * FROM users WHERE id = $1', [id])
    if (!cur.rowCount) return res.status(404).json({ success: false, message: 'Usuário não encontrado' })
    const { name, email, password, role } = req.body || {}
    if (email) {
      const dup = await db.query('SELECT 1 FROM users WHERE lower(email) = lower($1) AND id <> $2', [email, id])
      if (dup.rowCount) return res.status(422).json({ success: false, message: 'E-mail já cadastrado' })
    }
    const u = cur.rows[0]
    const { rows } = await db.query(
      `UPDATE users SET name = $1, email = $2, role = $3, password = $4 WHERE id = $5 RETURNING ${USER_COLS}`,
      [name ?? u.name, email ?? u.email, role ?? u.role, password ? hashPassword(password) : u.password, id]
    )
    res.json({ success: true, data: rows[0] })
  })
)

app.delete(
  '/api/users/:id',
  authMiddleware,
  h(async (req, res) => {
    const id = Number(req.params.id)
    if (req.user.sub === id) {
      return res.status(422).json({ success: false, message: 'Você não pode excluir a si mesmo' })
    }
    const r = await db.query('DELETE FROM users WHERE id = $1', [id])
    if (!r.rowCount) return res.status(404).json({ success: false, message: 'Usuário não encontrado' })
    res.json({ success: true, message: 'Usuário excluído' })
  })
)

// ---------------------------------------------------------------- clientes (CRUD)
app.get(
  '/api/clients',
  authMiddleware,
  h(async (_req, res) => {
    const { rows } = await db.query(`SELECT ${CLIENT_COLS} FROM clients ORDER BY id`)
    res.json({ success: true, data: rows })
  })
)

app.post(
  '/api/clients',
  authMiddleware,
  h(async (req, res) => {
    const { name, email, phone, company } = req.body || {}
    if (!name) return res.status(422).json({ success: false, message: 'Nome é obrigatório' })
    const { rows } = await db.query(
      `INSERT INTO clients (name, email, phone, company) VALUES ($1, $2, $3, $4) RETURNING ${CLIENT_COLS}`,
      [name, email || '', phone || '', company || '']
    )
    res.json({ success: true, data: rows[0] })
  })
)

app.put(
  '/api/clients/:id',
  authMiddleware,
  h(async (req, res) => {
    const id = Number(req.params.id)
    const cur = await db.query('SELECT * FROM clients WHERE id = $1', [id])
    if (!cur.rowCount) return res.status(404).json({ success: false, message: 'Cliente não encontrado' })
    const c = cur.rows[0]
    const { name, email, phone, company } = req.body || {}
    const { rows } = await db.query(
      `UPDATE clients SET name = $1, email = $2, phone = $3, company = $4 WHERE id = $5 RETURNING ${CLIENT_COLS}`,
      [name ?? c.name, email ?? c.email, phone ?? c.phone, company ?? c.company, id]
    )
    res.json({ success: true, data: rows[0] })
  })
)

app.delete(
  '/api/clients/:id',
  authMiddleware,
  h(async (req, res) => {
    const id = Number(req.params.id)
    const r = await db.query('DELETE FROM clients WHERE id = $1', [id])
    if (!r.rowCount) return res.status(404).json({ success: false, message: 'Cliente não encontrado' })
    res.json({ success: true, message: 'Cliente excluído' })
  })
)

const PORT = Number(process.env.PORT || 4700)
db.init()
  .then(() =>
    app.listen(PORT, '0.0.0.0', () => console.log(`[sistema-julia] backend ouvindo em :${PORT} (PostgreSQL)`))
  )
  .catch((err) => {
    console.error('[db] falha ao inicializar:', err.message)
    process.exit(1)
  })
