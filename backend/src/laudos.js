'use strict'

// Laudos EMITIDOS — o PDF congelado, numerado e versionado.
//
// "Emitir" gera o PDF com o estado atual da vistoria, guarda o arquivo com o
// hash SHA-256 e cria a linha em `laudos`: número oficial (LIP-2026-014, um
// contador por prefixo e ano), versão (v1; v2 na retificação — mesmo número) e
// quem emitiu. O que foi emitido não muda mais; corrigiu, emite a próxima
// versão. A prévia gera o mesmo PDF sem guardar nada.
//
// Assinatura digital (gov.br / ICP-Brasil) acontece fora do sistema: o PDF
// assinado volta por upload e fica ao lado do original.
const crypto = require('node:crypto')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const express = require('express')
const db = require('./db')
const { authMiddleware, permitir, PAPEIS_TECNICOS } = require('./auth')
const { upload, absPath, ensureDirSync, mover, removerArquivo, nomeOriginal } = require('./uploads')
const { gerarLaudo, MODELOS } = require('./pdf')
const { proximoNumero } = require('./escritorio')
const auditoria = require('./auditoria')

const router = express.Router()
router.use(authMiddleware)

const h = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error('[laudos]', err.message)
    if (!res.headersSent) res.status(err.status || 500).json({ success: false, message: err.status ? err.message : 'Erro interno' })
  })

const COLS = `l.id, l.vistoria_id AS "vistoriaId", l.processo_id AS "processoId", l.modelo, l.numero, l.versao, l.titulo, l.hash,
  l.paginas, l.tamanho::int AS tamanho, l.emitido_por AS "emitidoPor", u.name AS "emitidoPorNome", l.emitido_em AS "emitidoEm",
  l.observacoes, l.assinado_arquivo <> '' AS "temAssinado", l.assinado_em AS "assinadoEm", l.visivel_cliente AS "visivelCliente",
  l.aprovado_em AS "aprovadoEm", l.aprovacao_comentario AS "aprovacaoComentario", l.opcoes,
  i.nome AS "imovelNome", ${db.CLIENTE_NOME} AS "clienteNome", i.client_id AS "clientId", v.imovel_id AS "imovelId",
  to_char(v.data_vistoria, 'YYYY-MM-DD') AS "dataVistoria", pr.numero AS "processoNumero"`

const DE = `FROM laudos l JOIN vistorias v ON v.id = l.vistoria_id JOIN imoveis i ON i.id = v.imovel_id JOIN clients c ON c.id = i.client_id
  LEFT JOIN users u ON u.id = l.emitido_por LEFT JOIN processos pr ON pr.id = l.processo_id`

const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v))

const opcoesDe = (b) => {
  const o = b?.opcoes && typeof b.opcoes === 'object' ? b.opcoes : {}
  return {
    titulo: String(o.titulo || '').slice(0, 200),
    introducao: String(o.introducao || ''),
    metodologia: String(o.metodologia || ''),
    conclusao: String(o.conclusao || ''),
    observacoes: String(o.observacoes || ''),
    fonte: String(o.fonte || ''),
    fotosPorAmbiente: Math.max(0, Number(o.fotosPorAmbiente) || 0),
    incluirClaquetes: !!o.incluirClaquetes,
    relatorioId: num(o.relatorioId),
  }
}

router.get('/laudos/modelos', (_req, res) =>
  res.json({ success: true, data: Object.entries(MODELOS).map(([id, m]) => ({ id, label: m.label, prefixo: m.prefixo, titulo: m.titulo })) })
)

router.get(
  '/laudos',
  h(async (req, res) => {
    const { rows } = await db.query(
      `SELECT ${COLS} ${DE}
       WHERE ($1::int IS NULL OR l.vistoria_id = $1) AND ($2::int IS NULL OR l.processo_id = $2 OR v.processo_id = $2)
         AND ($3::int IS NULL OR v.imovel_id = $3) AND ($4::int IS NULL OR i.client_id = $4)
       ORDER BY l.id DESC LIMIT 500`,
      [num(req.query.vistoriaId), num(req.query.processoId), num(req.query.imovelId), num(req.query.clienteId)]
    )
    res.json({ success: true, data: rows })
  })
)

router.get(
  '/vistorias/:id/laudos',
  h(async (req, res) => {
    const { rows } = await db.query(`SELECT ${COLS} ${DE} WHERE l.vistoria_id = $1 ORDER BY l.id DESC`, [Number(req.params.id)])
    res.json({ success: true, data: rows })
  })
)

// Prévia: o PDF de agora, sem guardar.
router.post(
  '/vistorias/:id/laudos/previa',
  h(async (req, res) => {
    const vid = Number(req.params.id)
    const modelo = String((req.body || {}).modelo || 'fotografico')
    if (!MODELOS[modelo]) return res.status(422).json({ success: false, message: 'Modelo desconhecido' })
    const ultimo = await db.query('SELECT numero, versao FROM laudos WHERE vistoria_id = $1 AND modelo = $2 ORDER BY versao DESC LIMIT 1', [vid, modelo])
    const numero = ultimo.rows[0]?.numero || `${MODELOS[modelo].prefixo}-${new Date().getFullYear()}-PRÉVIA`
    const versao = ultimo.rows[0] ? ultimo.rows[0].versao + 1 : 1
    const { buffer } = await gerarLaudo({ modelo, vistoriaId: vid, numero, versao, opcoes: opcoesDe(req.body), emissor: req.user.name })
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="previa-${modelo}-vistoria-${vid}.pdf"`)
    res.send(buffer)
  })
)

// Mesmo laudo em Word (.docx), para ajustar o texto antes de emitir. Não
// numera nem guarda nada — o documento oficial continua sendo o PDF emitido.
router.post(
  '/vistorias/:id/laudos/docx',
  h(async (req, res) => {
    const vid = Number(req.params.id)
    const modelo = String((req.body || {}).modelo || 'fotografico')
    if (!MODELOS[modelo]) return res.status(422).json({ success: false, message: 'Modelo desconhecido' })
    const ultimo = await db.query('SELECT numero, versao FROM laudos WHERE vistoria_id = $1 AND modelo = $2 ORDER BY versao DESC LIMIT 1', [vid, modelo])
    const numero = ultimo.rows[0]?.numero || `${MODELOS[modelo].prefixo}-${new Date().getFullYear()}-RASCUNHO`
    const versao = ultimo.rows[0] ? ultimo.rows[0].versao + 1 : 1
    const { gerarLaudoWord } = require('./laudo-docx')
    const { enviar } = require('./docx')
    const { corpo, midia, nome } = await gerarLaudoWord({ modelo, vistoriaId: vid, numero, versao, opcoes: opcoesDe(req.body) })
    await enviar(res, nome, corpo, midia)
  })
)

// Emissão: gera, guarda, numera e registra.
router.post(
  '/vistorias/:id/laudos',
  permitir(...PAPEIS_TECNICOS),
  h(async (req, res) => {
    const vid = Number(req.params.id)
    const b = req.body || {}
    const modelo = String(b.modelo || 'fotografico')
    if (!MODELOS[modelo]) return res.status(422).json({ success: false, message: 'Modelo desconhecido' })
    const v = await db.query('SELECT processo_id FROM vistorias WHERE id = $1 AND excluido_em IS NULL', [vid])
    if (!v.rowCount) return res.status(404).json({ success: false, message: 'Vistoria não encontrada' })

    const ultimo = await db.query('SELECT numero, versao FROM laudos WHERE vistoria_id = $1 AND modelo = $2 ORDER BY versao DESC LIMIT 1', [vid, modelo])
    const numero = ultimo.rows[0]?.numero || (await proximoNumero(MODELOS[modelo].prefixo))
    const versao = ultimo.rows[0] ? ultimo.rows[0].versao + 1 : 1
    const opcoes = opcoesDe(b)
    const { buffer, paginas } = await gerarLaudo({ modelo, vistoriaId: vid, numero, versao, opcoes, emissor: req.user.name })

    const dirRel = `laudos/${vid}`
    ensureDirSync(absPath(dirRel))
    const rel = `${dirRel}/${numero.replace(/[^A-Za-z0-9-]/g, '_')}-v${versao}.pdf`
    await fsp.writeFile(absPath(rel), buffer)
    const hash = crypto.createHash('sha256').update(buffer).digest('hex')
    const { rows } = await db.query(
      `INSERT INTO laudos (vistoria_id, processo_id, modelo, numero, versao, titulo, arquivo, hash, paginas, tamanho, emitido_por, observacoes, opcoes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [vid, v.rows[0].processo_id, modelo, numero, versao, String(b.titulo || opcoes.titulo || MODELOS[modelo].label), rel, hash, paginas, buffer.length, req.user.sub, String(b.observacoes || ''), JSON.stringify(opcoes)]
    )
    const id = rows[0].id
    await auditoria.registrar(req, { acao: 'emitir', entidade: 'laudo', entidadeId: id, processoId: v.rows[0].processo_id, descricao: `${MODELOS[modelo].label} emitido: ${numero} v${versao} (${paginas} páginas)` })
    // Avisa o escritório (e o cliente, se o portal estiver ativo e com e-mail).
    try {
      const notificacoes = require('./notificacoes')
      const cli = await db.query(
        `SELECT c.email, c.portal_ativo, ${db.CLIENTE_NOME} AS nome, v.responsavel_id AS "responsavelId"
         FROM vistorias v JOIN imoveis i ON i.id = v.imovel_id JOIN clients c ON c.id = i.client_id WHERE v.id = $1`,
        [vid]
      )
      const c = cli.rows[0]
      await notificacoes.notificar({
        chave: `laudo-${id}`,
        tipo: 'laudo',
        titulo: `Laudo emitido: ${numero} v${versao}`,
        mensagem: `${MODELOS[modelo].label} da vistoria #${vid} (${c?.nome || ''}).`,
        usuarios: c?.responsavelId ? [c.responsavelId] : [],
        vistoriaId: vid,
        processoId: v.rows[0].processo_id,
        link: `/vistorias/${vid}/relatorio?modelo=${modelo}`,
        emailsExtras: c?.portal_ativo && c?.email ? [c.email] : [],
      })
    } catch (err) {
      console.error('[laudos] notificação: %s', err.message)
    }
    const { rows: out } = await db.query(`SELECT ${COLS} ${DE} WHERE l.id = $1`, [id])
    res.json({ success: true, data: out[0] })
  })
)

router.get(
  '/laudos/:id/pdf',
  h(async (req, res) => {
    const { rows } = await db.query('SELECT numero, versao, arquivo, assinado_arquivo FROM laudos WHERE id = $1', [Number(req.params.id)])
    if (!rows[0]) return res.status(404).json({ success: false, message: 'Laudo não encontrado' })
    const assinado = req.query.assinado === '1' && rows[0].assinado_arquivo
    const rel = assinado ? rows[0].assinado_arquivo : rows[0].arquivo
    if (!fs.existsSync(absPath(rel))) return res.status(404).json({ success: false, message: 'Arquivo do laudo não está mais no disco' })
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${rows[0].numero}-v${rows[0].versao}${assinado ? '-assinado' : ''}.pdf"`)
    res.sendFile(absPath(rel))
  })
)

router.put(
  '/laudos/:id',
  permitir(...PAPEIS_TECNICOS),
  h(async (req, res) => {
    const id = Number(req.params.id)
    const cur = await db.query('SELECT * FROM laudos WHERE id = $1', [id])
    if (!cur.rowCount) return res.status(404).json({ success: false, message: 'Laudo não encontrado' })
    const a = cur.rows[0]
    const b = req.body || {}
    await db.query('UPDATE laudos SET observacoes = $1, visivel_cliente = $2, titulo = $3 WHERE id = $4', [
      b.observacoes ?? a.observacoes,
      'visivelCliente' in b ? !!b.visivelCliente : a.visivel_cliente,
      String(b.titulo ?? a.titulo).trim() || a.titulo,
      id,
    ])
    const { rows } = await db.query(`SELECT ${COLS} ${DE} WHERE l.id = $1`, [id])
    res.json({ success: true, data: rows[0] })
  })
)

// PDF assinado digitalmente (gov.br / ICP-Brasil) — volta por upload.
router.post(
  '/laudos/:id/assinado',
  permitir(...PAPEIS_TECNICOS),
  upload.single('pdf'),
  h(async (req, res) => {
    const id = Number(req.params.id)
    const cur = await db.query('SELECT * FROM laudos WHERE id = $1', [id])
    if (!cur.rowCount) {
      if (req.file) await fsp.unlink(req.file.path).catch(() => {})
      return res.status(404).json({ success: false, message: 'Laudo não encontrado' })
    }
    if (!req.file) return res.status(422).json({ success: false, message: 'Envie o PDF assinado' })
    if (path.extname(nomeOriginal(req.file)).toLowerCase() !== '.pdf') {
      await fsp.unlink(req.file.path).catch(() => {})
      return res.status(422).json({ success: false, message: 'O arquivo precisa ser um PDF' })
    }
    const rel = cur.rows[0].arquivo.replace(/\.pdf$/i, '-assinado.pdf')
    await mover(req.file.path, absPath(rel))
    await db.query('UPDATE laudos SET assinado_arquivo = $1, assinado_em = now() WHERE id = $2', [rel, id])
    await auditoria.registrar(req, { acao: 'assinar', entidade: 'laudo', entidadeId: id, processoId: cur.rows[0].processo_id, descricao: `PDF assinado anexado ao laudo ${cur.rows[0].numero} v${cur.rows[0].versao}` })
    const { rows } = await db.query(`SELECT ${COLS} ${DE} WHERE l.id = $1`, [id])
    res.json({ success: true, data: rows[0] })
  })
)

router.delete(
  '/laudos/:id',
  permitir('admin'),
  h(async (req, res) => {
    const id = Number(req.params.id)
    const cur = await db.query('DELETE FROM laudos WHERE id = $1 RETURNING numero, versao, arquivo, assinado_arquivo, processo_id', [id])
    if (!cur.rowCount) return res.status(404).json({ success: false, message: 'Laudo não encontrado' })
    await removerArquivo(cur.rows[0].arquivo)
    if (cur.rows[0].assinado_arquivo) await removerArquivo(cur.rows[0].assinado_arquivo)
    await auditoria.registrar(req, { acao: 'excluir', entidade: 'laudo', entidadeId: id, processoId: cur.rows[0].processo_id, descricao: `Laudo ${cur.rows[0].numero} v${cur.rows[0].versao} excluído` })
    res.json({ success: true, message: 'Laudo excluído' })
  })
)

module.exports = { router }
