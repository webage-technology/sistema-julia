'use strict'

// Módulo de vistorias — fotos: upload (lote e captura guiada), variantes para
// exibição, atribuição em massa (conferência) e export ZIP com a estrutura de
// pastas do entregável (pavimento/ambiente, numeradas na ordem do caminho).
// A ordem do caminho deriva sempre de (capturada_em, id) — nunca é armazenada.
const fs = require('node:fs')
const path = require('node:path')
const express = require('express')
const archiver = require('archiver')
const db = require('./db')
const { authMiddleware } = require('./auth')
const { upload, absPath, variantes, processarFoto, removerArquivosFoto, nomeOriginal } = require('./uploads')

const router = express.Router()
router.use(authMiddleware)

const h = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error('[erro]', err.message)
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Erro interno' })
  })

const ORDEM_CAMINHO = 'ORDER BY f.capturada_em NULLS LAST, f.id'
const bool = (v) => v === true || v === 'true' || v === '1'
const pad = (n, casas) => String(n).padStart(casas, '0')
const limparNome = (s) => (String(s || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '-').trim() || 'Sem nome')

// Ambiente pertence à vistoria?
async function ambienteDaVistoria(ambienteId, vistoriaId) {
  const r = await db.query(
    `SELECT 1 FROM ambientes a JOIN pavimentos p ON p.id = a.pavimento_id
     WHERE a.id = $1 AND p.vistoria_id = $2`,
    [ambienteId, vistoriaId]
  )
  return r.rowCount > 0
}

// ------------------------------------------------------------------ upload
// Uma foto por requisição (lote = várias requisições em sequência; o cliente
// controla progresso e retentativa). capturadaEm do corpo é só o fallback
// quando o arquivo não tem EXIF (ex.: captura pela câmera do navegador).
router.post(
  '/vistorias/:id/fotos',
  upload.single('foto'),
  h(async (req, res) => {
    const vid = Number(req.params.id)
    const limparTmp = () => req.file && fs.promises.unlink(req.file.path).catch(() => {})
    const v = await db.query('SELECT 1 FROM vistorias WHERE id = $1', [vid])
    if (!v.rowCount) {
      await limparTmp()
      return res.status(404).json({ success: false, message: 'Vistoria não encontrada' })
    }
    if (!req.file) return res.status(422).json({ success: false, message: 'Arquivo não enviado' })

    const { ambienteId, capturadaEm, claquete, destaque } = req.body || {}
    let amb = null
    if (ambienteId) {
      if (!(await ambienteDaVistoria(Number(ambienteId), vid))) {
        await limparTmp()
        return res.status(422).json({ success: false, message: 'Ambiente não pertence à vistoria' })
      }
      amb = Number(ambienteId)
    }

    let proc
    try {
      proc = await processarFoto(req.file.path, nomeOriginal(req.file), req.file.mimetype, vid)
    } catch (err) {
      await limparTmp()
      return res
        .status(422)
        .json({ success: false, message: `${nomeOriginal(req.file) || 'arquivo'}: ${err.message}` })
    }

    let data = proc.capturadaEm || (capturadaEm ? new Date(capturadaEm) : null)
    if (data && isNaN(data.getTime())) data = null
    const { rows } = await db.query(
      `INSERT INTO fotos (vistoria_id, ambiente_id, capturada_em, arquivo, nome_original, claquete, destaque, lip)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, ambiente_id AS "ambienteId", capturada_em AS "capturadaEm", claquete, destaque, lip`,
      // Claquete é a planta apontada: entra na conferência, não no laudo.
      [vid, amb, data, proc.arquivo, nomeOriginal(req.file), bool(claquete), bool(destaque), !bool(claquete)]
    )
    res.json({ success: true, data: rows[0] })
  })
)

// ------------------------------------------------------------------ listagem
router.get(
  '/vistorias/:id/fotos',
  h(async (req, res) => {
    const vid = Number(req.params.id)
    const { rows } = await db.query(
      `SELECT f.id, f.ambiente_id AS "ambienteId", f.capturada_em AS "capturadaEm",
        f.nome_original AS "nomeOriginal", f.claquete, f.destaque, f.lip,
        row_number() OVER (${ORDEM_CAMINHO})::int AS ordem
       FROM fotos f WHERE f.vistoria_id = $1 ${ORDEM_CAMINHO}`,
      [vid]
    )
    res.json({ success: true, data: rows })
  })
)

// Arquivo da foto. web/thumb caem para o original se a variante faltar.
router.get(
  '/fotos/:id/:variant(orig|web|thumb)',
  h(async (req, res) => {
    const { rows } = await db.query('SELECT arquivo FROM fotos WHERE id = $1', [Number(req.params.id)])
    if (!rows[0]) return res.status(404).json({ success: false, message: 'Foto não encontrada' })
    const v = variantes(rows[0].arquivo)
    let abs = absPath(v[req.params.variant])
    if (!fs.existsSync(abs)) abs = absPath(v.orig)
    if (!fs.existsSync(abs)) return res.status(404).json({ success: false, message: 'Arquivo não encontrado' })
    res.sendFile(abs, { headers: { 'Cache-Control': 'private, max-age=86400' } })
  })
)

router.put(
  '/fotos/:id',
  h(async (req, res) => {
    const id = Number(req.params.id)
    const cur = await db.query('SELECT * FROM fotos WHERE id = $1', [id])
    if (!cur.rowCount) return res.status(404).json({ success: false, message: 'Foto não encontrada' })
    const f = cur.rows[0]
    const body = req.body || {}
    let amb = f.ambiente_id
    if ('ambienteId' in body) {
      if (body.ambienteId == null) amb = null
      else {
        if (!(await ambienteDaVistoria(Number(body.ambienteId), f.vistoria_id))) {
          return res.status(422).json({ success: false, message: 'Ambiente não pertence à vistoria' })
        }
        amb = Number(body.ambienteId)
      }
    }
    const { rows } = await db.query(
      `UPDATE fotos SET ambiente_id = $1, claquete = $2, destaque = $3, lip = $4 WHERE id = $5
       RETURNING id, ambiente_id AS "ambienteId", claquete, destaque, lip`,
      [amb, body.claquete ?? f.claquete, body.destaque ?? f.destaque, body.lip ?? f.lip, id]
    )
    res.json({ success: true, data: rows[0] })
  })
)

router.delete(
  '/fotos/:id',
  h(async (req, res) => {
    const id = Number(req.params.id)
    const cur = await db.query('SELECT arquivo FROM fotos WHERE id = $1', [id])
    if (!cur.rowCount) return res.status(404).json({ success: false, message: 'Foto não encontrada' })
    await db.query('DELETE FROM fotos WHERE id = $1', [id])
    await removerArquivosFoto(cur.rows[0].arquivo)
    res.json({ success: true, message: 'Foto excluída' })
  })
)

// ------------------------------------------------------------- conferência
// Atribuição em massa: o cliente calcula as fronteiras (primeira foto de cada
// ambiente na fita cronológica) e envia o mapeamento completo foto → ambiente.
router.post(
  '/vistorias/:id/fotos/atribuir',
  h(async (req, res) => {
    const vid = Number(req.params.id)
    const { atribuicoes } = req.body || {}
    if (!Array.isArray(atribuicoes)) {
      return res.status(422).json({ success: false, message: 'Lista de atribuições ausente' })
    }
    const ambs = await db.query(
      `SELECT a.id FROM ambientes a JOIN pavimentos p ON p.id = a.pavimento_id WHERE p.vistoria_id = $1`,
      [vid]
    )
    const validos = new Set(ambs.rows.map((r) => r.id))
    const client = await db.pool.connect()
    let n = 0
    try {
      await client.query('BEGIN')
      for (const a of atribuicoes) {
        const ambId = a.ambienteId == null ? null : Number(a.ambienteId)
        if (ambId !== null && !validos.has(ambId)) continue
        const r = await client.query('UPDATE fotos SET ambiente_id = $1 WHERE id = $2 AND vistoria_id = $3', [
          ambId,
          Number(a.fotoId),
          vid,
        ])
        n += r.rowCount
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
    res.json({ success: true, data: { atualizadas: n } })
  })
)

// ------------------------------------------------------------------ export
// ZIP no formato do entregável atual da Julia:
//   01 - Térreo/02 - Cozinha/0042 - 03 - claquete.jpg
//   (número global na ordem do caminho, número dentro do ambiente, marcações)
// Ambientes são numerados pela ordem REAL (primeira foto tirada); pastas sem
// foto não aparecem. Fotos sem ambiente vão para "00 - Sem ambiente".
router.get(
  '/vistorias/:id/export',
  h(async (req, res) => {
    const vid = Number(req.params.id)
    const v = await db.query(
      'SELECT v.id, i.nome AS imovel FROM vistorias v JOIN imoveis i ON i.id = v.imovel_id WHERE v.id = $1',
      [vid]
    )
    if (!v.rowCount) return res.status(404).json({ success: false, message: 'Vistoria não encontrada' })

    const fotos = await db.query(
      `SELECT f.id, f.arquivo, f.claquete, f.destaque, f.ambiente_id AS "ambienteId",
        row_number() OVER (${ORDEM_CAMINHO})::int AS ordem
       FROM fotos f WHERE f.vistoria_id = $1 ${ORDEM_CAMINHO}`,
      [vid]
    )
    const pavs = await db.query('SELECT id, nome, ordem FROM pavimentos WHERE vistoria_id = $1 ORDER BY ordem, id', [vid])
    const ambs = await db.query(
      `SELECT a.id, a.pavimento_id AS pid, a.nome, a.ordem
       FROM ambientes a JOIN pavimentos p ON p.id = a.pavimento_id
       WHERE p.vistoria_id = $1 ORDER BY a.ordem, a.id`,
      [vid]
    )

    // Ordem real de cada ambiente = número global da sua primeira foto.
    const infoAmb = new Map(ambs.rows.map((a) => [a.id, { ...a, primeira: Infinity, seq: 0, pasta: '' }]))
    for (const f of fotos.rows) {
      const a = infoAmb.get(f.ambienteId)
      if (a) a.primeira = Math.min(a.primeira, f.ordem)
    }
    const pastaPav = new Map()
    pavs.rows.forEach((p, i) => pastaPav.set(p.id, `${pad(i + 1, 2)} - ${limparNome(p.nome)}`))
    for (const p of pavs.rows) {
      const doPav = ambs.rows
        .filter((a) => a.pid === p.id)
        .map((a) => infoAmb.get(a.id))
        .sort((x, y) => x.primeira - y.primeira || x.ordem - y.ordem || x.id - y.id)
      doPav.forEach((a, i) => (a.pasta = `${pastaPav.get(p.id)}/${pad(i + 1, 2)} - ${limparNome(a.nome)}`))
    }

    res.attachment(`vistoria-${vid} - ${limparNome(v.rows[0].imovel)}.zip`)
    const archive = archiver('zip', { zlib: { level: 0 } }) // JPEG não recomprime — só empacota
    archive.on('warning', (err) => console.warn('[export]', err.message))
    archive.on('error', (err) => {
      console.error('[export]', err.message)
      res.destroy(err)
    })
    archive.pipe(res)

    let seqSem = 0
    for (const f of fotos.rows) {
      const abs = absPath(f.arquivo)
      if (!fs.existsSync(abs)) continue
      const a = f.ambienteId ? infoAmb.get(f.ambienteId) : null
      const pasta = a ? a.pasta : '00 - Sem ambiente'
      const seq = a ? ++a.seq : ++seqSem
      const sufixo = f.claquete ? ' - claquete' : f.destaque ? ' - destaque' : ''
      const nome = `${pad(f.ordem, 4)} - ${pad(seq, 2)}${sufixo}${path.extname(f.arquivo)}`
      archive.file(abs, { name: `${pasta}/${nome}` })
    }
    await archive.finalize()
  })
)

module.exports = router
