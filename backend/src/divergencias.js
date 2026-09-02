'use strict'

// Relatório da vistoria — divergências entre a PLANTA e a REALIDADE.
//
// É o miolo do EVTL (Estudo de Viabilidade Técnica e Legal): para cada ponto que
// mudou, o laudo mostra lado a lado a foto da planta e a foto atual. Como a
// captura em campo já marca a primeira foto de cada ambiente como "claquete"
// (normalmente a planta apontada) e permite marcar fotos como "destaque", o
// sistema consegue SUGERIR as divergências prontas — a Julia só revisa.
const express = require('express')
const db = require('./db')
const { authMiddleware } = require('./auth')
const hub = require('./hub')

const router = express.Router()
router.use(authMiddleware)

const h = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error('[erro]', err.message)
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Erro interno' })
  })

const COLS = `d.id, d.vistoria_id AS "vistoriaId", d.ambiente_id AS "ambienteId", d.titulo, d.descricao,
  d.foto_planta_id AS "fotoPlantaId", d.foto_atual_id AS "fotoAtualId", d.ordem,
  a.nome AS "ambienteNome", a.origem, a.situacao, p.nome AS "pavimentoNome"`

const listar = (vistoriaId) =>
  db.query(
    `SELECT ${COLS} FROM divergencias d
     LEFT JOIN ambientes a ON a.id = d.ambiente_id
     LEFT JOIN pavimentos p ON p.id = a.pavimento_id
     WHERE d.vistoria_id = $1 ORDER BY d.ordem, d.id`,
    [vistoriaId]
  )

// ------------------------------------------------------------------ leitura
router.get(
  '/vistorias/:id/divergencias',
  h(async (req, res) => {
    const vid = Number(req.params.id)
    const v = await db.query('SELECT 1 FROM vistorias WHERE id = $1', [vid])
    if (!v.rowCount) return res.status(404).json({ success: false, message: 'Vistoria não encontrada' })

    // Ambientes que já sinalizam divergência e ainda não viraram item do laudo.
    const candidatos = await db.query(
      `SELECT a.id, a.nome, a.origem, a.situacao, a.nota, p.nome AS "pavimentoNome",
        (SELECT f.id FROM fotos f WHERE f.ambiente_id = a.id AND f.claquete ORDER BY f.capturada_em, f.id LIMIT 1) AS "fotoPlantaId",
        (SELECT f.id FROM fotos f WHERE f.ambiente_id = a.id AND NOT f.claquete
          ORDER BY f.destaque DESC, f.capturada_em, f.id LIMIT 1) AS "fotoAtualId"
       FROM ambientes a JOIN pavimentos p ON p.id = a.pavimento_id
       WHERE p.vistoria_id = $1
         AND (a.origem = 'campo' OR a.situacao = 'nao_existe')
         AND NOT EXISTS (SELECT 1 FROM divergencias d WHERE d.vistoria_id = $1 AND d.ambiente_id = a.id)
       ORDER BY p.ordem, a.ordem, a.id`,
      [vid]
    )
    res.json({ success: true, data: { divergencias: (await listar(vid)).rows, sugestoes: candidatos.rows } })
  })
)

// ------------------------------------------------------------------ escrita
router.post(
  '/vistorias/:id/divergencias',
  h(async (req, res) => {
    const vid = Number(req.params.id)
    const v = await db.query('SELECT 1 FROM vistorias WHERE id = $1', [vid])
    if (!v.rowCount) return res.status(404).json({ success: false, message: 'Vistoria não encontrada' })
    const b = req.body || {}
    const { rows } = await db.query(
      `INSERT INTO divergencias (vistoria_id, ambiente_id, titulo, descricao, foto_planta_id, foto_atual_id, ordem)
       VALUES ($1,$2,$3,$4,$5,$6,(SELECT COALESCE(MAX(ordem), -1) + 1 FROM divergencias WHERE vistoria_id = $1))
       RETURNING id`,
      [
        vid,
        b.ambienteId ? Number(b.ambienteId) : null,
        String(b.titulo || '').trim(),
        String(b.descricao || '').trim(),
        b.fotoPlantaId ? Number(b.fotoPlantaId) : null,
        b.fotoAtualId ? Number(b.fotoAtualId) : null,
      ]
    )
    res.json({ success: true, data: { id: rows[0].id, divergencias: (await listar(vid)).rows } })
  })
)

// Cria de uma vez todas as divergências sugeridas (ambientes de campo e
// inexistentes), já com as fotos de planta e atual encontradas.
router.post(
  '/vistorias/:id/divergencias/sugerir',
  h(async (req, res) => {
    const vid = Number(req.params.id)
    const candidatos = await db.query(
      `SELECT a.id, a.nome, a.origem, a.situacao, a.nota,
        (SELECT f.id FROM fotos f WHERE f.ambiente_id = a.id AND f.claquete ORDER BY f.capturada_em, f.id LIMIT 1) AS planta,
        (SELECT f.id FROM fotos f WHERE f.ambiente_id = a.id AND NOT f.claquete
          ORDER BY f.destaque DESC, f.capturada_em, f.id LIMIT 1) AS atual
       FROM ambientes a JOIN pavimentos p ON p.id = a.pavimento_id
       WHERE p.vistoria_id = $1 AND (a.origem = 'campo' OR a.situacao = 'nao_existe')
         AND NOT EXISTS (SELECT 1 FROM divergencias d WHERE d.vistoria_id = $1 AND d.ambiente_id = a.id)
       ORDER BY p.ordem, a.ordem, a.id`,
      [vid]
    )
    for (const c of candidatos.rows) {
      const titulo =
        c.situacao === 'nao_existe'
          ? `${c.nome}: consta na planta e não existe no local`
          : `${c.nome}: existe no local e não consta na planta`
      await db.query(
        `INSERT INTO divergencias (vistoria_id, ambiente_id, titulo, descricao, foto_planta_id, foto_atual_id, ordem)
         VALUES ($1,$2,$3,$4,$5,$6,(SELECT COALESCE(MAX(ordem), -1) + 1 FROM divergencias WHERE vistoria_id = $1))`,
        [vid, c.id, titulo, c.nota || '', c.planta, c.atual]
      )
    }
    res.json({ success: true, data: { criadas: candidatos.rowCount, divergencias: (await listar(vid)).rows } })
  })
)

router.put(
  '/divergencias/:id',
  h(async (req, res) => {
    const id = Number(req.params.id)
    const cur = await db.query('SELECT * FROM divergencias WHERE id = $1', [id])
    if (!cur.rowCount) return res.status(404).json({ success: false, message: 'Divergência não encontrada' })
    const a = cur.rows[0]
    const b = req.body || {}
    await db.query(
      `UPDATE divergencias SET titulo=$1, descricao=$2, foto_planta_id=$3, foto_atual_id=$4, ordem=$5,
        ambiente_id=$6 WHERE id=$7`,
      [
        b.titulo ?? a.titulo,
        b.descricao ?? a.descricao,
        'fotoPlantaId' in b ? (b.fotoPlantaId ? Number(b.fotoPlantaId) : null) : a.foto_planta_id,
        'fotoAtualId' in b ? (b.fotoAtualId ? Number(b.fotoAtualId) : null) : a.foto_atual_id,
        'ordem' in b ? Number(b.ordem) : a.ordem,
        'ambienteId' in b ? (b.ambienteId ? Number(b.ambienteId) : null) : a.ambiente_id,
        id,
      ]
    )
    res.json({ success: true, data: (await listar(a.vistoria_id)).rows })
  })
)

router.delete(
  '/divergencias/:id',
  h(async (req, res) => {
    const id = Number(req.params.id)
    const cur = await db.query('SELECT vistoria_id FROM divergencias WHERE id = $1', [id])
    if (!cur.rowCount) return res.status(404).json({ success: false, message: 'Divergência não encontrada' })
    await db.query('DELETE FROM divergencias WHERE id = $1', [id])
    res.json({ success: true, data: (await listar(cur.rows[0].vistoria_id)).rows })
  })
)

// Redige o texto técnico da divergência a partir do que já se sabe (ambiente,
// tipo de divergência e anotação de campo). A Julia revisa antes de emitir.
router.post(
  '/divergencias/:id/texto',
  h(async (req, res) => {
    const id = Number(req.params.id)
    const { rows } = await db.query(
      `SELECT d.titulo, d.descricao, a.nome AS ambiente, a.origem, a.situacao, a.nota, a.medidas,
        p.nome AS pavimento, v.tipo_servico AS tipo, i.nome AS imovel
       FROM divergencias d
       LEFT JOIN ambientes a ON a.id = d.ambiente_id
       LEFT JOIN pavimentos p ON p.id = a.pavimento_id
       JOIN vistorias v ON v.id = d.vistoria_id
       JOIN imoveis i ON i.id = v.imovel_id
       WHERE d.id = $1`,
      [id]
    )
    if (!rows[0]) return res.status(404).json({ success: false, message: 'Divergência não encontrada' })
    const d = rows[0]
    const contexto = [
      `Imóvel: ${d.imovel}`,
      `Serviço: ${d.tipo || 'vistoria'}`,
      d.pavimento ? `Pavimento: ${d.pavimento}` : '',
      d.ambiente ? `Ambiente: ${d.ambiente}` : '',
      d.situacao === 'nao_existe'
        ? 'Situação: consta na planta aprovada e NÃO existe no local'
        : d.origem === 'campo'
          ? 'Situação: existe no local e NÃO consta na planta aprovada'
          : 'Situação: divergência entre planta e local',
      d.nota ? `Anotação de campo: ${d.nota}` : '',
      d.medidas ? `Medidas: ${d.medidas}` : '',
      d.titulo ? `Título atual: ${d.titulo}` : '',
      d.descricao ? `Texto atual: ${d.descricao}` : '',
    ]
      .filter(Boolean)
      .join('\n')

    const { text } = await hub.gerarTexto({
      system: `Você redige trechos de laudo técnico de arquitetura em português do Brasil, para um EVTL (Estudo de Viabilidade Técnica e Legal).
Escreva UM parágrafo de 2 a 3 frases descrevendo objetivamente a divergência entre o projeto aprovado e o levantamento em campo, no tom impessoal do laudo ("Verificou-se que…", "Constatou-se…").
Não invente medidas, materiais nem datas que não estejam no contexto. Não use adjetivos de opinião. Não escreva título, apenas o parágrafo.`,
      prompt: contexto,
      model: 'sonnet',
    })
    res.json({ success: true, data: { texto: String(text || '').trim() } })
  })
)

module.exports = router
