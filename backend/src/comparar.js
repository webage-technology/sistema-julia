'use strict'

// Comparação entre duas vistorias do mesmo imóvel — levantamento × conclusão
// de obra, ou vistoria de atualização × a anterior. Os ambientes casam pelo
// NOME (é o modelo do imóvel que os dois herdaram); para cada um sai o que
// mudou: apareceu, sumiu, mudou de área, ganhou não conformidade.
const express = require('express')
const db = require('./db')
const { authMiddleware } = require('./auth')
const { areaDe } = require('./areas')

const router = express.Router()
router.use(authMiddleware)

const h = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error('[comparar]', err.message)
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Erro interno' })
  })

const chave = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

async function ambientesDaVistoria(vid) {
  const { rows } = await db.query(
    `SELECT a.id, a.nome, a.situacao, a.origem, a.nota, a.medidas,
      a.comprimento::float8 AS comprimento, a.largura::float8 AS largura, a.pe_direito::float8 AS "peDireito", a.area::float8 AS area,
      p.nome AS "pavimentoNome", p.ordem AS "pavOrdem", a.ordem,
      (SELECT COUNT(*)::int FROM fotos f WHERE f.ambiente_id = a.id) AS fotos,
      (SELECT f.id FROM fotos f WHERE f.ambiente_id = a.id AND f.claquete ORDER BY f.capturada_em, f.id LIMIT 1) AS "claqueteId",
      (SELECT f.id FROM fotos f WHERE f.ambiente_id = a.id AND NOT f.claquete ORDER BY f.destaque DESC, f.capturada_em, f.id LIMIT 1) AS "fotoId",
      (SELECT COUNT(*)::int FROM nao_conformidades n WHERE n.ambiente_id = a.id) AS "naoConformidades"
     FROM ambientes a JOIN pavimentos p ON p.id = a.pavimento_id WHERE p.vistoria_id = $1
     ORDER BY p.ordem, p.id, a.ordem, a.id`,
    [vid]
  )
  return rows.map((a) => ({ ...a, areaCalculada: areaDe(a) }))
}

router.get(
  '/imoveis/:id/comparar',
  h(async (req, res) => {
    const imovelId = Number(req.params.id)
    const vistorias = await db.query(
      `SELECT v.id, v.tipo_servico AS "tipoServico", to_char(v.data_vistoria, 'YYYY-MM-DD') AS "dataVistoria", v.status,
        (SELECT COUNT(*)::int FROM fotos f WHERE f.vistoria_id = v.id) AS fotos
       FROM vistorias v WHERE v.imovel_id = $1 AND v.excluido_em IS NULL ORDER BY v.data_vistoria NULLS LAST, v.id`,
      [imovelId]
    )
    const a = Number(req.query.a)
    const b = Number(req.query.b)
    const ids = new Set(vistorias.rows.map((v) => v.id))
    if (!a || !b || !ids.has(a) || !ids.has(b)) {
      return res.json({ success: true, data: { vistorias: vistorias.rows, comparacao: null } })
    }
    const [ambA, ambB] = await Promise.all([ambientesDaVistoria(a), ambientesDaVistoria(b)])
    const mapaA = new Map(ambA.map((x) => [chave(`${x.pavimentoNome}|${x.nome}`), x]))
    const mapaB = new Map(ambB.map((x) => [chave(`${x.pavimentoNome}|${x.nome}`), x]))
    const chaves = [...new Set([...mapaA.keys(), ...mapaB.keys()])]
    const linhas = chaves.map((k) => {
      const x = mapaA.get(k) || null
      const y = mapaB.get(k) || null
      let situacao = 'igual'
      const mudancas = []
      if (x && !y) situacao = 'removido'
      else if (!x && y) situacao = 'novo'
      else {
        if ((x.situacao === 'nao_existe') !== (y.situacao === 'nao_existe')) {
          mudancas.push(y.situacao === 'nao_existe' ? 'passou a não existir' : 'voltou a existir')
        }
        if (x.areaCalculada && y.areaCalculada && Math.abs(x.areaCalculada - y.areaCalculada) >= 0.05) {
          mudancas.push(`área ${x.areaCalculada.toFixed(2)} → ${y.areaCalculada.toFixed(2)} m²`)
        }
        if ((x.peDireito || 0) !== (y.peDireito || 0) && x.peDireito && y.peDireito) {
          mudancas.push(`pé-direito ${x.peDireito} → ${y.peDireito} m`)
        }
        if (y.naoConformidades > x.naoConformidades) mudancas.push(`${y.naoConformidades - x.naoConformidades} não conformidade(s) nova(s)`)
        if ((x.nota || '') !== (y.nota || '') && y.nota) mudancas.push('nota de campo diferente')
        if (mudancas.length) situacao = 'alterado'
      }
      const ref = y || x
      return { chave: k, pavimentoNome: ref.pavimentoNome, nome: ref.nome, pavOrdem: ref.pavOrdem, ordem: ref.ordem, situacao, mudancas, a: x, b: y }
    })
    linhas.sort((p, q) => p.pavOrdem - q.pavOrdem || p.ordem - q.ordem)
    const resumo = {
      iguais: linhas.filter((l) => l.situacao === 'igual').length,
      alterados: linhas.filter((l) => l.situacao === 'alterado').length,
      novos: linhas.filter((l) => l.situacao === 'novo').length,
      removidos: linhas.filter((l) => l.situacao === 'removido').length,
      areaA: Math.round(ambA.filter((z) => z.situacao !== 'nao_existe').reduce((s, z) => s + z.areaCalculada, 0) * 100) / 100,
      areaB: Math.round(ambB.filter((z) => z.situacao !== 'nao_existe').reduce((s, z) => s + z.areaCalculada, 0) * 100) / 100,
    }
    res.json({ success: true, data: { vistorias: vistorias.rows, comparacao: { a, b, linhas, resumo } } })
  })
)

module.exports = { router }
