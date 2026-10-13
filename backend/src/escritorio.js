'use strict'

// Configurações do escritório e o que se repete de trabalho em trabalho:
//   • identidade (razão social, CNPJ, logo, cor, nome na legenda das fotos);
//   • textos padrão por tipo de serviço e seção (introdução, metodologia,
//     conclusão) — carregados no laudo em PDF;
//   • numeração oficial dos documentos (LIP-2026-014), um contador por prefixo;
//   • modelos de documentos exigidos e de checklists por tipo de serviço.
// Antes o nome "Plenno Arquitetura" e o vermelho da capa estavam fixos no código.
const fsp = require('node:fs/promises')
const path = require('node:path')
const express = require('express')
const db = require('./db')
const { authMiddleware, permitir, PAPEIS_TECNICOS } = require('./auth')
const { upload, absPath, mover, ensureDirSync, nomeOriginal, textoDoForm } = require('./uploads')
const auditoria = require('./auditoria')

const router = express.Router()
router.use(authMiddleware)

const h = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error('[escritorio]', err.message)
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Erro interno' })
  })

const COLS = `id, razao_social AS "razaoSocial", nome_fantasia AS "nomeFantasia", cnpj, registro, endereco, cidade,
  telefone, email, site, logo <> '' AS "temLogo", cor, fonte_fotos AS "fonteFotos", carimbo_fotos AS "carimboFotos",
  prazo_alerta_dias AS "prazoAlertaDias", url_publica AS "urlPublica", notificacoes, updated_at AS "updatedAt"`

// Cache curto: o laudo, a legenda das fotos e o carimbo leem isto o tempo todo.
let cache = { em: 0, dados: null }
async function carregar() {
  if (cache.dados && Date.now() - cache.em < 30000) return cache.dados
  const { rows } = await db.query('SELECT * FROM escritorio WHERE id = 1')
  cache = { em: Date.now(), dados: rows[0] }
  return rows[0]
}
const invalidar = () => (cache = { em: 0, dados: null })

// Segredos das notificações (senha SMTP, chave da Evolution) não voltam ao navegador.
function semSegredos(notif) {
  const n = { ...(notif || {}) }
  if (n.smtp) n.smtp = { ...n.smtp, senha: n.smtp.senha ? '••••••' : '' }
  if (n.whatsapp) n.whatsapp = { ...n.whatsapp, apikey: n.whatsapp.apikey ? '••••••' : '' }
  return n
}

router.get(
  '/escritorio',
  h(async (req, res) => {
    const { rows } = await db.query(`SELECT ${COLS} FROM escritorio WHERE id = 1`)
    const e = rows[0]
    if (req.user.role !== 'admin') e.notificacoes = {}
    else e.notificacoes = semSegredos(e.notificacoes)
    res.json({ success: true, data: e })
  })
)

router.put(
  '/escritorio',
  permitir('admin'),
  h(async (req, res) => {
    const atual = await carregar()
    const b = req.body || {}
    // Notificações: quem manda o campo mascarado quer manter o segredo antigo.
    let notif = atual.notificacoes || {}
    if (b.notificacoes && typeof b.notificacoes === 'object') {
      notif = { ...notif, ...b.notificacoes }
      if (notif.smtp?.senha === '••••••') notif.smtp.senha = atual.notificacoes?.smtp?.senha || ''
      if (notif.whatsapp?.apikey === '••••••') notif.whatsapp.apikey = atual.notificacoes?.whatsapp?.apikey || ''
    }
    await db.query(
      `UPDATE escritorio SET razao_social=$1, nome_fantasia=$2, cnpj=$3, registro=$4, endereco=$5, cidade=$6,
        telefone=$7, email=$8, site=$9, cor=$10, fonte_fotos=$11, carimbo_fotos=$12, prazo_alerta_dias=$13,
        url_publica=$14, notificacoes=$15, updated_at=now() WHERE id = 1`,
      [
        b.razaoSocial ?? atual.razao_social,
        b.nomeFantasia ?? atual.nome_fantasia,
        b.cnpj ?? atual.cnpj,
        b.registro ?? atual.registro,
        b.endereco ?? atual.endereco,
        b.cidade ?? atual.cidade,
        b.telefone ?? atual.telefone,
        b.email ?? atual.email,
        b.site ?? atual.site,
        String(b.cor ?? atual.cor).replace(/[^0-9a-fA-F]/g, '').slice(0, 6) || atual.cor,
        b.fonteFotos ?? atual.fonte_fotos,
        'carimboFotos' in b ? !!b.carimboFotos : atual.carimbo_fotos,
        'prazoAlertaDias' in b ? Math.max(1, Number(b.prazoAlertaDias) || 7) : atual.prazo_alerta_dias,
        b.urlPublica ?? atual.url_publica,
        JSON.stringify(notif),
      ]
    )
    invalidar()
    await auditoria.registrar(req, { acao: 'editar', entidade: 'escritorio', entidadeId: 1, descricao: 'Configurações do escritório' })
    const { rows } = await db.query(`SELECT ${COLS} FROM escritorio WHERE id = 1`)
    res.json({ success: true, data: { ...rows[0], notificacoes: semSegredos(rows[0].notificacoes) } })
  })
)

// Logo: PNG/JPG, vai para o timbre do PDF e para a tela de login.
router.post(
  '/escritorio/logo',
  permitir('admin'),
  upload.single('logo'),
  h(async (req, res) => {
    if (!req.file) return res.status(422).json({ success: false, message: 'Arquivo não enviado' })
    const ext = path.extname(nomeOriginal(req.file)).toLowerCase()
    if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
      await fsp.unlink(req.file.path).catch(() => {})
      return res.status(422).json({ success: false, message: 'Envie o logo em PNG, JPG ou WebP' })
    }
    ensureDirSync(absPath('escritorio'))
    const rel = `escritorio/logo${ext}`
    for (const e of ['.png', '.jpg', '.jpeg', '.webp']) await fsp.unlink(absPath(`escritorio/logo${e}`)).catch(() => {})
    await mover(req.file.path, absPath(rel))
    await db.query('UPDATE escritorio SET logo = $1, updated_at = now() WHERE id = 1', [rel])
    invalidar()
    res.json({ success: true, data: { logo: rel } })
  })
)

// Sem login: a tela de entrada e o portal do cliente mostram o logo.
async function enviarLogo(_req, res) {
  const e = await carregar()
  if (!e.logo) return res.status(404).end()
  res.sendFile(absPath(e.logo), { headers: { 'Cache-Control': 'public, max-age=3600' } })
}

// ---- numeração oficial -------------------------------------------------------
// `proximoNumero('LIP')` → LIP-2026-001, LIP-2026-002… Atômico no banco.
async function proximoNumero(prefixo, casas = 3) {
  const ano = new Date().getFullYear()
  const chave = `${prefixo}-${ano}`
  const { rows } = await db.query(
    `INSERT INTO sequencias (chave, valor) VALUES ($1, 1)
     ON CONFLICT (chave) DO UPDATE SET valor = sequencias.valor + 1 RETURNING valor`,
    [chave]
  )
  return `${chave}-${String(rows[0].valor).padStart(casas, '0')}`
}

// ---- textos padrão -----------------------------------------------------------
const TXT_COLS = `id, tipo_servico AS "tipoServico", secao, titulo, texto, ordem`
const SECOES = ['introducao', 'metodologia', 'conclusao', 'observacoes']

router.get(
  '/textos-padrao',
  h(async (req, res) => {
    const tipo = req.query.tipo
    const { rows } = await db.query(
      `SELECT ${TXT_COLS} FROM textos_padrao
       WHERE ($1::text IS NULL OR tipo_servico = $1 OR tipo_servico = '')
       ORDER BY tipo_servico <> '', ordem, id`,
      [tipo || null]
    )
    res.json({ success: true, data: rows })
  })
)

router.post(
  '/textos-padrao',
  permitir(...PAPEIS_TECNICOS),
  h(async (req, res) => {
    const b = req.body || {}
    if (!String(b.texto || '').trim()) return res.status(422).json({ success: false, message: 'Escreva o texto' })
    const { rows } = await db.query(
      `INSERT INTO textos_padrao (tipo_servico, secao, titulo, texto, ordem)
       VALUES ($1,$2,$3,$4,(SELECT COALESCE(MAX(ordem), -1) + 1 FROM textos_padrao)) RETURNING ${TXT_COLS}`,
      [String(b.tipoServico || ''), SECOES.includes(b.secao) ? b.secao : 'conclusao', String(b.titulo || ''), String(b.texto)]
    )
    res.json({ success: true, data: rows[0] })
  })
)

router.put(
  '/textos-padrao/:id',
  permitir(...PAPEIS_TECNICOS),
  h(async (req, res) => {
    const id = Number(req.params.id)
    const cur = await db.query('SELECT * FROM textos_padrao WHERE id = $1', [id])
    if (!cur.rowCount) return res.status(404).json({ success: false, message: 'Texto não encontrado' })
    const a = cur.rows[0]
    const b = req.body || {}
    const { rows } = await db.query(
      `UPDATE textos_padrao SET tipo_servico=$1, secao=$2, titulo=$3, texto=$4, ordem=$5 WHERE id=$6 RETURNING ${TXT_COLS}`,
      [
        b.tipoServico ?? a.tipo_servico,
        SECOES.includes(b.secao) ? b.secao : a.secao,
        b.titulo ?? a.titulo,
        b.texto ?? a.texto,
        'ordem' in b ? Number(b.ordem) : a.ordem,
        id,
      ]
    )
    res.json({ success: true, data: rows[0] })
  })
)

router.delete(
  '/textos-padrao/:id',
  permitir(...PAPEIS_TECNICOS),
  h(async (req, res) => {
    await db.query('DELETE FROM textos_padrao WHERE id = $1', [Number(req.params.id)])
    res.json({ success: true, message: 'Texto excluído' })
  })
)

// ---- modelos de documentos exigidos ------------------------------------------
const DOC_COLS = `id, tipo_servico AS "tipoServico", nome, descricao, obrigatorio, ordem`

router.get(
  '/documentos-modelo',
  h(async (_req, res) => {
    const { rows } = await db.query(`SELECT ${DOC_COLS} FROM documentos_modelo ORDER BY tipo_servico, ordem, id`)
    res.json({ success: true, data: rows })
  })
)

router.post(
  '/documentos-modelo',
  permitir('admin'),
  h(async (req, res) => {
    const b = req.body || {}
    if (!String(b.tipoServico || '').trim() || !String(b.nome || '').trim()) {
      return res.status(422).json({ success: false, message: 'Tipo de serviço e nome são obrigatórios' })
    }
    const { rows } = await db.query(
      `INSERT INTO documentos_modelo (tipo_servico, nome, descricao, obrigatorio, ordem)
       VALUES ($1,$2,$3,$4,(SELECT COALESCE(MAX(ordem), -1) + 1 FROM documentos_modelo)) RETURNING ${DOC_COLS}`,
      [String(b.tipoServico).trim(), String(b.nome).trim(), String(b.descricao || ''), b.obrigatorio !== false]
    )
    res.json({ success: true, data: rows[0] })
  })
)

router.put(
  '/documentos-modelo/:id',
  permitir('admin'),
  h(async (req, res) => {
    const id = Number(req.params.id)
    const cur = await db.query('SELECT * FROM documentos_modelo WHERE id = $1', [id])
    if (!cur.rowCount) return res.status(404).json({ success: false, message: 'Modelo não encontrado' })
    const a = cur.rows[0]
    const b = req.body || {}
    const { rows } = await db.query(
      `UPDATE documentos_modelo SET tipo_servico=$1, nome=$2, descricao=$3, obrigatorio=$4, ordem=$5 WHERE id=$6 RETURNING ${DOC_COLS}`,
      [b.tipoServico ?? a.tipo_servico, b.nome ?? a.nome, b.descricao ?? a.descricao, 'obrigatorio' in b ? !!b.obrigatorio : a.obrigatorio, 'ordem' in b ? Number(b.ordem) : a.ordem, id]
    )
    res.json({ success: true, data: rows[0] })
  })
)

router.delete(
  '/documentos-modelo/:id',
  permitir('admin'),
  h(async (req, res) => {
    await db.query('DELETE FROM documentos_modelo WHERE id = $1', [Number(req.params.id)])
    res.json({ success: true, message: 'Modelo excluído' })
  })
)

// ---- modelos de checklist ----------------------------------------------------
const CHK_COLS = `id, tipo_servico AS "tipoServico", nome, por_ambiente AS "porAmbiente", ordem`

router.get(
  '/checklist-modelos',
  h(async (_req, res) => {
    const { rows } = await db.query(`SELECT ${CHK_COLS} FROM checklist_modelos ORDER BY tipo_servico, ordem, id`)
    res.json({ success: true, data: rows })
  })
)

router.post(
  '/checklist-modelos',
  permitir('admin'),
  h(async (req, res) => {
    const b = req.body || {}
    if (!String(b.tipoServico || '').trim() || !String(b.nome || '').trim()) {
      return res.status(422).json({ success: false, message: 'Tipo de serviço e item são obrigatórios' })
    }
    const { rows } = await db.query(
      `INSERT INTO checklist_modelos (tipo_servico, nome, por_ambiente, ordem)
       VALUES ($1,$2,$3,(SELECT COALESCE(MAX(ordem), -1) + 1 FROM checklist_modelos)) RETURNING ${CHK_COLS}`,
      [String(b.tipoServico).trim(), String(b.nome).trim(), b.porAmbiente !== false]
    )
    res.json({ success: true, data: rows[0] })
  })
)

router.put(
  '/checklist-modelos/:id',
  permitir('admin'),
  h(async (req, res) => {
    const id = Number(req.params.id)
    const cur = await db.query('SELECT * FROM checklist_modelos WHERE id = $1', [id])
    if (!cur.rowCount) return res.status(404).json({ success: false, message: 'Item não encontrado' })
    const a = cur.rows[0]
    const b = req.body || {}
    const { rows } = await db.query(
      `UPDATE checklist_modelos SET tipo_servico=$1, nome=$2, por_ambiente=$3, ordem=$4 WHERE id=$5 RETURNING ${CHK_COLS}`,
      [b.tipoServico ?? a.tipo_servico, b.nome ?? a.nome, 'porAmbiente' in b ? !!b.porAmbiente : a.por_ambiente, 'ordem' in b ? Number(b.ordem) : a.ordem, id]
    )
    res.json({ success: true, data: rows[0] })
  })
)

router.delete(
  '/checklist-modelos/:id',
  permitir('admin'),
  h(async (req, res) => {
    await db.query('DELETE FROM checklist_modelos WHERE id = $1', [Number(req.params.id)])
    res.json({ success: true, message: 'Item excluído' })
  })
)

// ---- estado do backup (20) ---------------------------------------------------
// O scripts/backup.ps1 roda no host e deixa os arquivos em ./backups, montado
// aqui só para leitura. O painel avisa quando a última cópia está velha.
async function estadoBackup() {
  const dir = path.resolve(__dirname, '..', 'backups')
  try {
    const nomes = (await fsp.readdir(dir)).filter((n) => /\.(sql|sql\.gz|tgz|tar\.gz)$/i.test(n))
    let ultimo = null
    let total = 0
    for (const n of nomes) {
      const st = await fsp.stat(path.join(dir, n))
      total += st.size
      if (!ultimo || st.mtimeMs > ultimo.mtimeMs) ultimo = { nome: n, mtimeMs: st.mtimeMs, tamanho: st.size }
    }
    return {
      configurado: true,
      arquivos: nomes.length,
      tamanhoTotal: total,
      ultimo: ultimo ? { nome: ultimo.nome, em: new Date(ultimo.mtimeMs).toISOString(), tamanho: ultimo.tamanho } : null,
      atrasado: !ultimo || Date.now() - ultimo.mtimeMs > 2 * 24 * 3600 * 1000,
    }
  } catch {
    return { configurado: false, arquivos: 0, tamanhoTotal: 0, ultimo: null, atrasado: true }
  }
}

router.get(
  '/backup/estado',
  permitir('admin'),
  h(async (_req, res) => res.json({ success: true, data: await estadoBackup() }))
)

module.exports = { router, carregar, proximoNumero, enviarLogo, estadoBackup, textoDoForm }
