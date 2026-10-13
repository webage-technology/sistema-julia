'use strict'

// Backend Express do sistema-julia (PostgreSQL).
//   • POST /api/login · POST /api/logout · GET /api/me
//   • /api/users (CRUD, só administrador) · /api/clients (CRUD)
//   • Módulo de vistorias: /api/imoveis, /api/vistorias, /api/pavimentos, /api/ambientes, /api/fotos
//   • Camada de regularização: /api/processos (protocolos, documentos, RRT, despesas),
//     /api/arquivos (GED), /api/laudos (PDF emitido), /api/portal/* (cliente), /api/notificacoes,
//     /api/painel, /api/busca, /api/auditoria, /api/lixeira, /api/escritorio (configurações),
//     /api/dados (limpeza seletiva da base, só administrador)
//   • /api/relatorios (documentos .docx) · /api/modelos (biblioteca) · /api/hub/* (Claude Code do Hub)
// Dados no PostgreSQL (src/db.js + src/schema-regularizacao.js). Envelope: { success, data } | { success, message }.
const express = require('express')
const cors = require('cors')
const db = require('./src/db')
const {
  hashPassword,
  verifyPassword,
  signToken,
  authMiddleware,
  permitir,
  definirCookieSessao,
  loginBloqueado,
  registrarFalhaLogin,
  limparFalhasLogin,
} = require('./src/auth')
const auditoria = require('./src/auditoria')
const lixeira = require('./src/lixeira')

const app = express()
app.set('trust proxy', true)
app.use(cors({ origin: true, credentials: true }))
app.use(express.json({ limit: '2mb' })) // atribuição em massa da conferência pode listar ~1000 fotos

// Colunas públicas (created_at → createdAt para o JSON).
const USER_COLS = 'id, name, email, role, registro, titulo, telefone, assinatura <> \'\' AS "temAssinatura", ativo, created_at AS "createdAt"'
const CLIENT_COLS = 'id, name, email, phone, company, tipo, documento, endereco, portal_ativo AS "portalAtivo", created_at AS "createdAt"'
const PAPEIS = ['admin', 'arquiteto', 'estagiario', 'financeiro']

// Cliente pessoa física (CPF, 11 dígitos) ou jurídica (CNPJ, 14). Guardamos só
// os dígitos — a máscara é responsabilidade da tela.
const tipoCliente = (t) => (t === 'pf' ? 'pf' : 'pj')
const soDigitos = (v) => String(v ?? '').replace(/\D/g, '')
const docValido = (tipo, doc) => !doc || doc.length === (tipo === 'pf' ? 11 : 14)
const erroDoc = (tipo) => (tipo === 'pf' ? 'CPF deve ter 11 dígitos' : 'CNPJ deve ter 14 dígitos')

// Wrapper que captura erros de handlers async (Express 4 não faz isso sozinho).
const h = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error('[erro]', err.message)
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Erro interno' })
  })

// -------------------------------------------------------------------- público
app.get('/api/health', (_req, res) =>
  res.json({ success: true, service: 'sistema-julia', time: new Date().toISOString() })
)

app.post(
  '/api/login',
  h(async (req, res) => {
    const { email, password } = req.body || {}
    const minutos = loginBloqueado(req, email)
    if (minutos) {
      return res.status(429).json({ success: false, message: `Muitas tentativas. Tente de novo em ${minutos} minuto(s).` })
    }
    const { rows } = await db.query('SELECT * FROM users WHERE lower(email) = lower($1)', [String(email || '')])
    const user = rows[0]
    if (!user || !verifyPassword(password, user.password)) {
      registrarFalhaLogin(req, email)
      return res.status(401).json({ success: false, message: 'E-mail ou senha inválidos' })
    }
    if (user.ativo === false) return res.status(403).json({ success: false, message: 'Usuário desativado — fale com o administrador' })
    limparFalhasLogin(req, email)
    const token = signToken(user)
    // Cookie HttpOnly para as imagens e downloads (GET) — o token não vai mais na URL.
    definirCookieSessao(req, res, token)
    await auditoria.registrar({ user: { sub: user.id, name: user.name }, headers: req.headers, socket: req.socket }, { acao: 'login', entidade: 'usuario', entidadeId: user.id, descricao: `Entrou no sistema` })
    res.json({
      success: true,
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, registro: user.registro, createdAt: user.created_at },
    })
  })
)

// Logo do escritório e redefinição de senha não exigem login.
app.get('/api/escritorio/logo', h(require('./src/escritorio').enviarLogo))
app.use('/api', require('./src/seguranca').publico)
app.use('/api', require('./src/portal').publico)

app.get(
  '/api/me',
  authMiddleware,
  h(async (req, res) => {
    const { rows } = await db.query(`SELECT ${USER_COLS} FROM users WHERE id = $1`, [req.user.sub])
    if (!rows[0]) return res.status(404).json({ success: false, message: 'Usuário não encontrado' })
    if (rows[0].ativo === false) return res.status(403).json({ success: false, message: 'Usuário desativado' })
    res.json({ success: true, user: rows[0] })
  })
)

// ---------------------------------------------------------------- usuários (CRUD)
// Qualquer pessoa logada vê a lista (é preciso escolher responsável pela
// vistoria); criar, alterar e excluir é só do administrador.
app.get(
  '/api/users',
  authMiddleware,
  h(async (_req, res) => {
    const { rows } = await db.query(`SELECT ${USER_COLS} FROM users ORDER BY ativo DESC, id`)
    res.json({ success: true, data: rows })
  })
)

app.post(
  '/api/users',
  authMiddleware,
  permitir('admin'),
  h(async (req, res) => {
    const { name, email, password, role, registro, titulo, telefone } = req.body || {}
    if (!name || !email || !password) {
      return res.status(422).json({ success: false, message: 'Nome, e-mail e senha são obrigatórios' })
    }
    const dup = await db.query('SELECT 1 FROM users WHERE lower(email) = lower($1)', [email])
    if (dup.rowCount) return res.status(422).json({ success: false, message: 'E-mail já cadastrado' })
    const { rows } = await db.query(
      `INSERT INTO users (name, email, password, role, registro, titulo, telefone) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${USER_COLS}`,
      [name, email, hashPassword(password), PAPEIS.includes(role) ? role : 'arquiteto', registro || '', titulo || '', telefone || '']
    )
    await auditoria.registrar(req, { acao: 'criar', entidade: 'usuario', entidadeId: rows[0].id, descricao: `Usuário ${name} (${rows[0].role})` })
    res.json({ success: true, data: rows[0] })
  })
)

app.put(
  '/api/users/:id',
  authMiddleware,
  permitir('admin'),
  h(async (req, res) => {
    const id = Number(req.params.id)
    const cur = await db.query('SELECT * FROM users WHERE id = $1', [id])
    if (!cur.rowCount) return res.status(404).json({ success: false, message: 'Usuário não encontrado' })
    const { name, email, password, role, registro, titulo, telefone, ativo } = req.body || {}
    if (email) {
      const dup = await db.query('SELECT 1 FROM users WHERE lower(email) = lower($1) AND id <> $2', [email, id])
      if (dup.rowCount) return res.status(422).json({ success: false, message: 'E-mail já cadastrado' })
    }
    const u = cur.rows[0]
    // O administrador não se rebaixa nem se desativa: senão ninguém mais entra.
    if (id === req.user.sub && ((role && role !== 'admin') || ativo === false)) {
      return res.status(422).json({ success: false, message: 'Você não pode tirar o seu próprio acesso de administrador' })
    }
    const { rows } = await db.query(
      `UPDATE users SET name = $1, email = $2, role = $3, password = $4, registro = $5, titulo = $6, telefone = $7, ativo = $8
       WHERE id = $9 RETURNING ${USER_COLS}`,
      [
        name ?? u.name,
        email ?? u.email,
        PAPEIS.includes(role) ? role : u.role,
        password ? hashPassword(password) : u.password,
        registro ?? u.registro,
        titulo ?? u.titulo,
        telefone ?? u.telefone,
        ativo === undefined ? u.ativo : !!ativo,
        id,
      ]
    )
    await auditoria.registrar(req, { acao: 'editar', entidade: 'usuario', entidadeId: id, descricao: `Usuário ${rows[0].name}${password ? ' (senha trocada)' : ''}` })
    res.json({ success: true, data: rows[0] })
  })
)

app.delete(
  '/api/users/:id',
  authMiddleware,
  permitir('admin'),
  h(async (req, res) => {
    const id = Number(req.params.id)
    if (req.user.sub === id) {
      return res.status(422).json({ success: false, message: 'Você não pode excluir a si mesmo' })
    }
    const r = await db.query('DELETE FROM users WHERE id = $1 RETURNING name', [id])
    if (!r.rowCount) return res.status(404).json({ success: false, message: 'Usuário não encontrado' })
    await auditoria.registrar(req, { acao: 'excluir', entidade: 'usuario', entidadeId: id, descricao: `Usuário ${r.rows[0].name} excluído` })
    res.json({ success: true, message: 'Usuário excluído' })
  })
)

// Assinatura do profissional (PNG com fundo transparente) — entra no PDF emitido.
const { upload, absPath, mover, ensureDirSync, nomeOriginal } = require('./src/uploads')
app.post(
  '/api/users/:id/assinatura',
  authMiddleware,
  upload.single('assinatura'),
  h(async (req, res) => {
    const id = Number(req.params.id)
    if (req.user.role !== 'admin' && req.user.sub !== id) {
      if (req.file) await require('node:fs/promises').unlink(req.file.path).catch(() => {})
      return res.status(403).json({ success: false, message: 'Só o próprio profissional ou o administrador' })
    }
    if (!req.file) return res.status(422).json({ success: false, message: 'Arquivo não enviado' })
    const ext = require('node:path').extname(nomeOriginal(req.file)).toLowerCase()
    if (!['.png', '.jpg', '.jpeg'].includes(ext)) {
      await require('node:fs/promises').unlink(req.file.path).catch(() => {})
      return res.status(422).json({ success: false, message: 'Envie a assinatura em PNG ou JPG' })
    }
    ensureDirSync(absPath('assinaturas'))
    const rel = `assinaturas/${id}${ext}`
    await mover(req.file.path, absPath(rel))
    await db.query('UPDATE users SET assinatura = $1 WHERE id = $2', [rel, id])
    res.json({ success: true, data: { assinatura: rel } })
  })
)
app.get(
  '/api/users/:id/assinatura',
  authMiddleware,
  h(async (req, res) => {
    const { rows } = await db.query('SELECT assinatura FROM users WHERE id = $1', [Number(req.params.id)])
    if (!rows[0]?.assinatura) return res.status(404).end()
    res.sendFile(absPath(rows[0].assinatura))
  })
)

// ---------------------------------------------------------------- clientes (CRUD)
app.get(
  '/api/clients',
  authMiddleware,
  h(async (_req, res) => {
    const { rows } = await db.query(`SELECT ${CLIENT_COLS} FROM clients WHERE excluido_em IS NULL ORDER BY id`)
    res.json({ success: true, data: rows })
  })
)

app.get(
  '/api/clients/:id',
  authMiddleware,
  h(async (req, res) => {
    const id = Number(req.params.id)
    const { rows } = await db.query(`SELECT ${CLIENT_COLS} FROM clients WHERE id = $1 AND excluido_em IS NULL`, [id])
    if (!rows[0]) return res.status(404).json({ success: false, message: 'Cliente não encontrado' })
    const [imoveis, processos] = await Promise.all([
      db.query('SELECT id, nome, endereco FROM imoveis WHERE client_id = $1 AND excluido_em IS NULL ORDER BY nome', [id]),
      db.query('SELECT id, numero, titulo, etapa FROM processos WHERE client_id = $1 AND excluido_em IS NULL ORDER BY id DESC', [id]),
    ])
    res.json({ success: true, data: { ...rows[0], imoveis: imoveis.rows, processos: processos.rows } })
  })
)

app.post(
  '/api/clients',
  authMiddleware,
  h(async (req, res) => {
    const { name, email, phone, company, endereco } = req.body || {}
    if (!name) return res.status(422).json({ success: false, message: 'Nome é obrigatório' })
    const tipo = tipoCliente(req.body?.tipo)
    const documento = soDigitos(req.body?.documento)
    if (!docValido(tipo, documento)) return res.status(422).json({ success: false, message: erroDoc(tipo) })
    const { rows } = await db.query(
      `INSERT INTO clients (name, email, phone, company, tipo, documento, endereco)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${CLIENT_COLS}`,
      [name, email || '', phone || '', company || '', tipo, documento, endereco || '']
    )
    await auditoria.registrar(req, { acao: 'criar', entidade: 'cliente', entidadeId: rows[0].id, descricao: `Cliente ${company || name}` })
    res.json({ success: true, data: rows[0] })
  })
)

app.put(
  '/api/clients/:id',
  authMiddleware,
  h(async (req, res) => {
    const id = Number(req.params.id)
    const cur = await db.query('SELECT * FROM clients WHERE id = $1 AND excluido_em IS NULL', [id])
    if (!cur.rowCount) return res.status(404).json({ success: false, message: 'Cliente não encontrado' })
    const c = cur.rows[0]
    const { name, email, phone, company, endereco } = req.body || {}
    const tipo = req.body?.tipo === undefined ? c.tipo : tipoCliente(req.body.tipo)
    const documento = req.body?.documento === undefined ? c.documento : soDigitos(req.body.documento)
    if (!docValido(tipo, documento)) return res.status(422).json({ success: false, message: erroDoc(tipo) })
    const { rows } = await db.query(
      `UPDATE clients SET name = $1, email = $2, phone = $3, company = $4, tipo = $5, documento = $6, endereco = $7
       WHERE id = $8 RETURNING ${CLIENT_COLS}`,
      [name ?? c.name, email ?? c.email, phone ?? c.phone, company ?? c.company, tipo, documento, endereco ?? c.endereco, id]
    )
    await auditoria.registrar(req, { acao: 'editar', entidade: 'cliente', entidadeId: id, descricao: `Cliente ${rows[0].company || rows[0].name}` })
    res.json({ success: true, data: rows[0] })
  })
)

// Exclusão vai para a lixeira, com os imóveis, vistorias e processos do cliente.
app.delete(
  '/api/clients/:id',
  authMiddleware,
  permitir('admin', 'arquiteto'),
  h(async (req, res) => {
    const id = Number(req.params.id)
    const cur = await db.query('SELECT name, company FROM clients WHERE id = $1 AND excluido_em IS NULL', [id])
    if (!cur.rowCount) return res.status(404).json({ success: false, message: 'Cliente não encontrado' })
    await lixeira.excluir('clients', id)
    await auditoria.registrar(req, { acao: 'excluir', entidade: 'cliente', entidadeId: id, descricao: `Cliente ${cur.rows[0].company || cur.rows[0].name} enviado à lixeira (com imóveis, vistorias e processos)` })
    res.json({ success: true, message: 'Cliente enviado para a lixeira' })
  })
)

// ---------------------------------------------------------- módulo de vistorias
app.use('/api', require('./src/vistorias'))
app.use('/api', require('./src/fotos'))
app.use('/api', require('./src/viagens'))
app.use('/api', require('./src/divergencias'))
app.use('/api', require('./src/lip'))
app.use('/api', require('./src/modelos').router)
app.use('/api', require('./src/relatorios'))

// ------------------------------------------------------ camada de regularização
app.use('/api', require('./src/escritorio').router)
app.use('/api', auditoria.router)
app.use('/api', require('./src/arquivos').router)
app.use('/api', require('./src/processos').router)
app.use('/api', lixeira.router)
app.use('/api', require('./src/inspecao').router)
app.use('/api', require('./src/areas').router)
app.use('/api', require('./src/comparar').router)
app.use('/api', require('./src/planta-pinos').router)
app.use('/api', require('./src/laudos').router)
app.use('/api', require('./src/portal').equipe)
app.use('/api', require('./src/painel').router)
app.use('/api', require('./src/seguranca').router)
app.use('/api', require('./src/dados'))
const notificacoes = require('./src/notificacoes')
app.use('/api', notificacoes.router)

// ------------------------------------------- integração com o WebAge Hub (IA)
app.use('/api', require('./src/hub'))

const PORT = Number(process.env.PORT || 4700)
db.init()
  .then(() => {
    notificacoes.iniciarVarredura()
    app.listen(PORT, '0.0.0.0', () => console.log(`[sistema-julia] backend ouvindo em :${PORT} (PostgreSQL)`))
  })
  .catch((err) => {
    console.error('[db] falha ao inicializar:', err.message)
    process.exit(1)
  })
