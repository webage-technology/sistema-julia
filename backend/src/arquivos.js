'use strict'

// Arquivos — o GED do escritório. Qualquer documento (matrícula, alvará, guia
// paga, DWG, contrato, RRT, laudo assinado) anexado a um processo, a um imóvel,
// a um cliente ou a uma vistoria, com categoria, versão e validade.
//
// Versão: enviar um arquivo "no lugar de" outro (substituiId) cria a versão
// seguinte e mantém a anterior — nada some, e dá para saber qual é a atual.
// `visivel_cliente` é o que o portal do cliente enxerga.
const fsp = require('node:fs/promises')
const path = require('node:path')
const express = require('express')
const db = require('./db')
const { authMiddleware, permitir, PAPEIS_TECNICOS } = require('./auth')
const { upload, absPath, salvarArquivoGenerico, removerArquivo, nomeOriginal, textoDoForm } = require('./uploads')
const auditoria = require('./auditoria')

const router = express.Router()
router.use(authMiddleware)

const h = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error('[arquivos]', err.message)
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Erro interno' })
  })

const CATEGORIAS = [
  'planta', 'matricula', 'iptu', 'alvara', 'habite-se', 'avcb', 'projeto', 'rrt', 'guia', 'contrato', 'procuracao',
  'documento-pessoal', 'laudo', 'oficio', 'foto', 'outro',
]

const COLS = `a.id, a.processo_id AS "processoId", a.imovel_id AS "imovelId", a.client_id AS "clientId",
  a.vistoria_id AS "vistoriaId", a.categoria, a.nome, a.descricao, a.nome_original AS "nomeOriginal", a.mime,
  a.tamanho::int AS tamanho, a.versao, a.substitui_id AS "substituiId", to_char(a.validade, 'YYYY-MM-DD') AS validade,
  a.visivel_cliente AS "visivelCliente", a.enviado_por AS "enviadoPor", u.name AS "enviadoPorNome",
  a.enviado_pelo_cliente AS "enviadoPeloCliente", a.created_at AS "createdAt",
  (a.validade IS NOT NULL AND a.validade < CURRENT_DATE) AS vencido`

const DE = 'FROM arquivos a LEFT JOIN users u ON u.id = a.enviado_por'

const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v))

// Só a versão mais recente de cada arquivo aparece na lista (as antigas ficam
// acessíveis pelo histórico do próprio arquivo).
router.get(
  '/arquivos',
  h(async (req, res) => {
    const { rows } = await db.query(
      `SELECT ${COLS} ${DE}
       WHERE ($1::int IS NULL OR a.processo_id = $1)
         AND ($2::int IS NULL OR a.imovel_id = $2)
         AND ($3::int IS NULL OR a.client_id = $3)
         AND ($4::int IS NULL OR a.vistoria_id = $4)
         AND ($5::text IS NULL OR a.categoria = $5)
         AND NOT EXISTS (SELECT 1 FROM arquivos n WHERE n.substitui_id = a.id)
       ORDER BY a.categoria, a.nome, a.id DESC`,
      [num(req.query.processoId), num(req.query.imovelId), num(req.query.clientId), num(req.query.vistoriaId), req.query.categoria || null]
    )
    res.json({ success: true, data: rows, categorias: CATEGORIAS })
  })
)

router.get(
  '/arquivos/:id',
  h(async (req, res) => {
    const id = Number(req.params.id)
    const { rows } = await db.query(`SELECT ${COLS} ${DE} WHERE a.id = $1`, [id])
    if (!rows[0]) return res.status(404).json({ success: false, message: 'Arquivo não encontrado' })
    // Cadeia de versões (da mais nova para a mais antiga).
    const versoes = await db.query(
      `WITH RECURSIVE cadeia AS (
         SELECT * FROM arquivos WHERE id = $1
         UNION ALL
         SELECT a.* FROM arquivos a JOIN cadeia c ON a.id = c.substitui_id
       ) SELECT id, versao, nome_original AS "nomeOriginal", created_at AS "createdAt" FROM cadeia ORDER BY versao DESC`,
      [id]
    )
    res.json({ success: true, data: { ...rows[0], versoes: versoes.rows } })
  })
)

async function inserir(req, { processoId, imovelId, clientId, vistoriaId, categoria, nome, descricao, validade, visivelCliente, substituiId, peloCliente }) {
  const original = nomeOriginal(req.file)
  let versao = 1
  let anterior = null
  if (substituiId) {
    const a = await db.query('SELECT * FROM arquivos WHERE id = $1', [Number(substituiId)])
    if (a.rowCount) {
      anterior = a.rows[0]
      versao = anterior.versao + 1
    }
  }
  const rel = await salvarArquivoGenerico(req.file.path, original, 'arquivos')
  const { rows } = await db.query(
    `INSERT INTO arquivos (processo_id, imovel_id, client_id, vistoria_id, categoria, nome, descricao, arquivo,
       nome_original, mime, tamanho, versao, substitui_id, validade, visivel_cliente, enviado_por, enviado_pelo_cliente)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
    [
      anterior ? anterior.processo_id : num(processoId),
      anterior ? anterior.imovel_id : num(imovelId),
      anterior ? anterior.client_id : num(clientId),
      anterior ? anterior.vistoria_id : num(vistoriaId),
      CATEGORIAS.includes(categoria) ? categoria : anterior ? anterior.categoria : 'outro',
      String(nome || '').trim() || (anterior ? anterior.nome : original.replace(/\.[^.]+$/, '')),
      String(descricao || ''),
      rel,
      original,
      req.file.mimetype || '',
      req.file.size || 0,
      versao,
      anterior ? anterior.id : null,
      validade || null,
      visivelCliente === true || visivelCliente === 'true' || visivelCliente === '1',
      peloCliente ? null : req.user?.sub || null,
      !!peloCliente,
    ]
  )
  return rows[0].id
}

router.post(
  '/arquivos',
  upload.single('arquivo'),
  h(async (req, res) => {
    if (!req.file) return res.status(422).json({ success: false, message: 'Arquivo não enviado' })
    const b = req.body || {}
    if (!b.processoId && !b.imovelId && !b.clientId && !b.vistoriaId && !b.substituiId) {
      await fsp.unlink(req.file.path).catch(() => {})
      return res.status(422).json({ success: false, message: 'Diga a que processo, imóvel, cliente ou vistoria o arquivo pertence' })
    }
    const id = await inserir(req, {
      ...b,
      nome: textoDoForm(b.nome),
      descricao: textoDoForm(b.descricao),
    })
    const { rows } = await db.query(`SELECT ${COLS} ${DE} WHERE a.id = $1`, [id])
    await auditoria.registrar(req, {
      acao: 'anexar',
      entidade: 'arquivo',
      entidadeId: id,
      processoId: rows[0].processoId,
      descricao: `Arquivo "${rows[0].nome}" (${rows[0].categoria}, v${rows[0].versao})`,
    })
    res.json({ success: true, data: rows[0] })
  })
)

router.put(
  '/arquivos/:id',
  h(async (req, res) => {
    const id = Number(req.params.id)
    const cur = await db.query('SELECT * FROM arquivos WHERE id = $1', [id])
    if (!cur.rowCount) return res.status(404).json({ success: false, message: 'Arquivo não encontrado' })
    const a = cur.rows[0]
    const b = req.body || {}
    await db.query(
      `UPDATE arquivos SET nome=$1, categoria=$2, descricao=$3, validade=$4, visivel_cliente=$5 WHERE id=$6`,
      [
        String(b.nome ?? a.nome).trim() || a.nome,
        CATEGORIAS.includes(b.categoria) ? b.categoria : a.categoria,
        b.descricao ?? a.descricao,
        'validade' in b ? b.validade || null : a.validade,
        'visivelCliente' in b ? !!b.visivelCliente : a.visivel_cliente,
        id,
      ]
    )
    const { rows } = await db.query(`SELECT ${COLS} ${DE} WHERE a.id = $1`, [id])
    res.json({ success: true, data: rows[0] })
  })
)

router.delete(
  '/arquivos/:id',
  permitir(...PAPEIS_TECNICOS),
  h(async (req, res) => {
    const id = Number(req.params.id)
    const cur = await db.query('SELECT * FROM arquivos WHERE id = $1', [id])
    if (!cur.rowCount) return res.status(404).json({ success: false, message: 'Arquivo não encontrado' })
    await db.query('DELETE FROM arquivos WHERE id = $1', [id])
    await removerArquivo(cur.rows[0].arquivo)
    await auditoria.registrar(req, {
      acao: 'excluir',
      entidade: 'arquivo',
      entidadeId: id,
      processoId: cur.rows[0].processo_id,
      descricao: `Arquivo "${cur.rows[0].nome}" excluído`,
    })
    res.json({ success: true, message: 'Arquivo excluído' })
  })
)

// Abre no navegador (inline) ou baixa (?download=1).
async function enviarArquivo(res, rel, nome, download) {
  const abs = absPath(rel)
  try {
    await fsp.access(abs)
  } catch {
    return res.status(404).json({ success: false, message: 'Arquivo não está mais no disco' })
  }
  res.sendFile(abs, {
    headers: {
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(nome || path.basename(rel))}`,
    },
  })
}

router.get(
  '/arquivos/:id/download',
  h(async (req, res) => {
    const { rows } = await db.query('SELECT arquivo, nome_original FROM arquivos WHERE id = $1', [Number(req.params.id)])
    if (!rows[0]) return res.status(404).json({ success: false, message: 'Arquivo não encontrado' })
    await enviarArquivo(res, rows[0].arquivo, rows[0].nome_original, req.query.download === '1')
  })
)

module.exports = { router, inserir, enviarArquivo, CATEGORIAS }
