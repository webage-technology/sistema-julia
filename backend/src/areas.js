'use strict'

// Quadro de áreas — a conta que dispara a regularização.
//
// Cada ambiente tem comprimento × largura (ou a área informada direto, quando
// o cômodo não é retangular) e pé-direito. Somando por pavimento e no total,
// dá para comparar a área LEVANTADA com a APROVADA na prefeitura e a do IPTU
// que estão na ficha do imóvel. A diferença é a divergência de área.
const express = require('express')
const db = require('./db')
const { authMiddleware } = require('./auth')

const router = express.Router()
router.use(authMiddleware)

const h = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error('[areas]', err.message)
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Erro interno' })
  })

const r2 = (n) => Math.round(Number(n || 0) * 100) / 100

// Área efetiva de um ambiente: a informada, senão comprimento × largura.
function areaDe(a) {
  if (a.area != null && Number(a.area) > 0) return r2(a.area)
  if (a.comprimento && a.largura) return r2(Number(a.comprimento) * Number(a.largura))
  return 0
}

async function quadroDeAreas(vistoriaId) {
  const v = await db.query(
    `SELECT v.id, v.imovel_id AS "imovelId", i.nome AS "imovelNome",
      i.area_aprovada::float8 AS "areaAprovada", i.area_iptu::float8 AS "areaIptu", i.area_terreno::float8 AS "areaTerreno"
     FROM vistorias v JOIN imoveis i ON i.id = v.imovel_id WHERE v.id = $1`,
    [vistoriaId]
  )
  if (!v.rowCount) return null
  const pavs = await db.query('SELECT id, nome, ordem FROM pavimentos WHERE vistoria_id = $1 ORDER BY ordem, id', [vistoriaId])
  const ambs = await db.query(
    `SELECT a.id, a.pavimento_id AS "pavimentoId", a.nome, a.situacao, a.origem,
      a.comprimento::float8 AS comprimento, a.largura::float8 AS largura, a.pe_direito::float8 AS "peDireito", a.area::float8 AS area
     FROM ambientes a JOIN pavimentos p ON p.id = a.pavimento_id WHERE p.vistoria_id = $1 ORDER BY a.ordem, a.id`,
    [vistoriaId]
  )
  let total = 0
  let semMedida = 0
  const pavimentos = pavs.rows.map((p) => {
    const lista = ambs.rows
      .filter((a) => a.pavimentoId === p.id && a.situacao !== 'nao_existe')
      .map((a) => {
        const calc = areaDe(a)
        if (!calc) semMedida++
        return { ...a, areaCalculada: calc }
      })
    const soma = r2(lista.reduce((s, a) => s + a.areaCalculada, 0))
    total += soma
    return { id: p.id, nome: p.nome, area: soma, ambientes: lista }
  })
  total = r2(total)
  const im = v.rows[0]
  const dif = (ref) => (ref ? { valor: r2(total - ref), percentual: r2(((total - ref) / ref) * 100) } : null)
  return {
    vistoriaId,
    imovel: im,
    pavimentos,
    total,
    ambientes: ambs.rows.filter((a) => a.situacao !== 'nao_existe').length,
    semMedida,
    divergencia: { aprovada: dif(im.areaAprovada), iptu: dif(im.areaIptu) },
  }
}

router.get(
  '/vistorias/:id/areas',
  h(async (req, res) => {
    const q = await quadroDeAreas(Number(req.params.id))
    if (!q) return res.status(404).json({ success: false, message: 'Vistoria não encontrada' })
    res.json({ success: true, data: q })
  })
)

module.exports = { router, quadroDeAreas, areaDe }
