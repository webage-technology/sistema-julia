'use strict'

// Inspeção — o que a vistoria registra além da foto:
//   • NÃO CONFORMIDADES (LIP, NBR 16747): anomalia, grau de risco, recomendação
//     e prazo, com a foto que evidencia. É o que faz o laudo sair quase pronto;
//     antes só existia a marca "destaque" na foto.
//   • CHECKLISTS por tipo de serviço (bombeiro, acessibilidade, as-built…):
//     itens marcáveis por ambiente ou gerais, com foto e observação.
const express = require('express')
const db = require('./db')
const hub = require('./hub')
const { authMiddleware } = require('./auth')

const router = express.Router()
router.use(authMiddleware)

const h = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error('[inspecao]', err.message)
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Erro interno' })
  })

const ANOMALIAS = [
  'fissura', 'trinca', 'infiltracao', 'umidade', 'corrosao', 'desplacamento', 'eletrica', 'hidraulica', 'estrutural',
  'acessibilidade', 'incendio', 'esquadria', 'cobertura', 'pintura', 'piso', 'outro',
]
const GRAUS = ['critico', 'regular', 'minimo']
const PRAZOS = ['imediato', 'curto', 'medio', 'longo']
const RESULTADOS = ['pendente', 'conforme', 'nao_conforme', 'nao_aplicavel']

const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v))

// ---------------------------------------------------------- não conformidades
const NC_COLS = `n.id, n.vistoria_id AS "vistoriaId", n.ambiente_id AS "ambienteId", n.foto_id AS "fotoId", n.titulo,
  n.anomalia, n.grau, n.descricao, n.recomendacao, n.prazo, n.ordem, n.created_at AS "createdAt",
  a.nome AS "ambienteNome", p.nome AS "pavimentoNome"`

const listar = (vid) =>
  db.query(
    `SELECT ${NC_COLS} FROM nao_conformidades n
     LEFT JOIN ambientes a ON a.id = n.ambiente_id LEFT JOIN pavimentos p ON p.id = a.pavimento_id
     WHERE n.vistoria_id = $1 ORDER BY array_position($2::text[], n.grau), n.ordem, n.id`,
    [vid, GRAUS]
  )

router.get(
  '/vistorias/:id/nao-conformidades',
  h(async (req, res) => {
    res.json({ success: true, data: (await listar(Number(req.params.id))).rows, anomalias: ANOMALIAS, graus: GRAUS, prazos: PRAZOS })
  })
)

router.post(
  '/vistorias/:id/nao-conformidades',
  h(async (req, res) => {
    const vid = Number(req.params.id)
    const v = await db.query('SELECT 1 FROM vistorias WHERE id = $1', [vid])
    if (!v.rowCount) return res.status(404).json({ success: false, message: 'Vistoria não encontrada' })
    const b = req.body || {}
    if (num(b.fotoId)) {
      const f = await db.query('SELECT 1 FROM fotos WHERE id = $1 AND vistoria_id = $2', [num(b.fotoId), vid])
      if (!f.rowCount) return res.status(422).json({ success: false, message: 'Foto não pertence à vistoria' })
    }
    // Sem título, o nome da anomalia serve; sem ambiente, herda o da foto.
    let ambienteId = num(b.ambienteId)
    if (!ambienteId && num(b.fotoId)) {
      const f = await db.query('SELECT ambiente_id FROM fotos WHERE id = $1', [num(b.fotoId)])
      ambienteId = f.rows[0]?.ambiente_id || null
    }
    const { rows } = await db.query(
      `INSERT INTO nao_conformidades (vistoria_id, ambiente_id, foto_id, titulo, anomalia, grau, descricao, recomendacao, prazo, ordem)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,(SELECT COALESCE(MAX(ordem), -1) + 1 FROM nao_conformidades WHERE vistoria_id = $1)) RETURNING id`,
      [
        vid,
        ambienteId,
        num(b.fotoId),
        String(b.titulo || '').trim(),
        ANOMALIAS.includes(b.anomalia) ? b.anomalia : 'outro',
        GRAUS.includes(b.grau) ? b.grau : 'regular',
        String(b.descricao || ''),
        String(b.recomendacao || ''),
        PRAZOS.includes(b.prazo) ? b.prazo : 'curto',
      ]
    )
    res.json({ success: true, data: { id: rows[0].id, lista: (await listar(vid)).rows } })
  })
)

router.put(
  '/nao-conformidades/:id',
  h(async (req, res) => {
    const id = Number(req.params.id)
    const cur = await db.query('SELECT * FROM nao_conformidades WHERE id = $1', [id])
    if (!cur.rowCount) return res.status(404).json({ success: false, message: 'Não conformidade não encontrada' })
    const a = cur.rows[0]
    const b = req.body || {}
    await db.query(
      `UPDATE nao_conformidades SET ambiente_id=$1, foto_id=$2, titulo=$3, anomalia=$4, grau=$5, descricao=$6, recomendacao=$7, prazo=$8, ordem=$9 WHERE id=$10`,
      [
        'ambienteId' in b ? num(b.ambienteId) : a.ambiente_id,
        'fotoId' in b ? num(b.fotoId) : a.foto_id,
        b.titulo ?? a.titulo,
        ANOMALIAS.includes(b.anomalia) ? b.anomalia : a.anomalia,
        GRAUS.includes(b.grau) ? b.grau : a.grau,
        b.descricao ?? a.descricao,
        b.recomendacao ?? a.recomendacao,
        PRAZOS.includes(b.prazo) ? b.prazo : a.prazo,
        'ordem' in b ? Number(b.ordem) : a.ordem,
        id,
      ]
    )
    res.json({ success: true, data: (await listar(a.vistoria_id)).rows })
  })
)

router.delete(
  '/nao-conformidades/:id',
  h(async (req, res) => {
    const cur = await db.query('DELETE FROM nao_conformidades WHERE id = $1 RETURNING vistoria_id', [Number(req.params.id)])
    if (!cur.rowCount) return res.status(404).json({ success: false, message: 'Não conformidade não encontrada' })
    res.json({ success: true, data: (await listar(cur.rows[0].vistoria_id)).rows })
  })
)

// Redige descrição e recomendação no tom do laudo, a partir do que já se sabe.
router.post(
  '/nao-conformidades/:id/texto',
  h(async (req, res) => {
    const id = Number(req.params.id)
    const { rows } = await db.query(
      `SELECT n.*, a.nome AS ambiente, a.nota, a.medidas, p.nome AS pavimento, v.tipo_servico AS tipo, i.nome AS imovel
       FROM nao_conformidades n LEFT JOIN ambientes a ON a.id = n.ambiente_id LEFT JOIN pavimentos p ON p.id = a.pavimento_id
       JOIN vistorias v ON v.id = n.vistoria_id JOIN imoveis i ON i.id = v.imovel_id WHERE n.id = $1`,
      [id]
    )
    if (!rows[0]) return res.status(404).json({ success: false, message: 'Não conformidade não encontrada' })
    const d = rows[0]
    const contexto = [
      `Imóvel: ${d.imovel}`,
      `Serviço: ${d.tipo || 'inspeção predial'}`,
      d.pavimento ? `Pavimento: ${d.pavimento}` : '',
      d.ambiente ? `Ambiente: ${d.ambiente}` : '',
      `Anomalia: ${d.anomalia}`,
      `Grau de risco: ${d.grau}`,
      `Prazo sugerido: ${d.prazo}`,
      d.titulo ? `Título: ${d.titulo}` : '',
      d.descricao ? `Descrição atual: ${d.descricao}` : '',
      d.nota ? `Anotação de campo: ${d.nota}` : '',
      d.medidas ? `Medidas: ${d.medidas}` : '',
    ]
      .filter(Boolean)
      .join('\n')
    const { text } = await hub.gerarTexto({
      system: `Você redige itens de Laudo de Inspeção Predial (NBR 16747) em português do Brasil.
Devolva SÓ um JSON: {"descricao":"…","recomendacao":"…"}.
- descricao: um parágrafo de 2 a 3 frases descrevendo a anomalia observada, no tom impessoal do laudo ("Constatou-se…"), sem inventar medidas, materiais ou causas não citadas.
- recomendacao: uma ou duas frases objetivas com a providência recomendada e a urgência compatível com o grau de risco.`,
      prompt: contexto,
      model: 'sonnet',
    })
    let dados = {}
    try {
      const limpo = String(text || '').replace(/```(?:json)?/gi, '').trim()
      dados = JSON.parse(limpo.slice(limpo.indexOf('{'), limpo.lastIndexOf('}') + 1))
    } catch {
      dados = { descricao: String(text || '').trim() }
    }
    res.json({ success: true, data: { descricao: String(dados.descricao || '').trim(), recomendacao: String(dados.recomendacao || '').trim() } })
  })
)

// ------------------------------------------------------------------ checklist
const CHK_COLS = `ci.id, ci.vistoria_id AS "vistoriaId", ci.ambiente_id AS "ambienteId", ci.nome, ci.resultado, ci.foto_id AS "fotoId",
  ci.observacao, ci.ordem, a.nome AS "ambienteNome", p.nome AS "pavimentoNome"`

const listarChecklist = (vid) =>
  db.query(
    `SELECT ${CHK_COLS} FROM checklist_itens ci LEFT JOIN ambientes a ON a.id = ci.ambiente_id LEFT JOIN pavimentos p ON p.id = a.pavimento_id
     WHERE ci.vistoria_id = $1 ORDER BY ci.ambiente_id NULLS FIRST, p.ordem, a.ordem, ci.ordem, ci.id`,
    [vid]
  )

function resumoChecklist(itens) {
  const r = { total: itens.length, conforme: 0, naoConforme: 0, naoAplicavel: 0, pendente: 0 }
  for (const i of itens) {
    if (i.resultado === 'conforme') r.conforme++
    else if (i.resultado === 'nao_conforme') r.naoConforme++
    else if (i.resultado === 'nao_aplicavel') r.naoAplicavel++
    else r.pendente++
  }
  return r
}

router.get(
  '/vistorias/:id/checklist',
  h(async (req, res) => {
    const vid = Number(req.params.id)
    const itens = (await listarChecklist(vid)).rows
    const v = await db.query('SELECT tipo_servico FROM vistorias WHERE id = $1', [vid])
    const tipos = await db.query('SELECT DISTINCT tipo_servico AS tipo FROM checklist_modelos ORDER BY tipo_servico')
    res.json({
      success: true,
      data: { itens, resumo: resumoChecklist(itens), tipoServico: v.rows[0]?.tipo_servico || '', tiposDisponiveis: tipos.rows.map((t) => t.tipo) },
    })
  })
)

// Aplica o modelo do tipo: item "por ambiente" vira um por ambiente previsto;
// item geral vira um só. O que já existe com o mesmo nome não repete.
router.post(
  '/vistorias/:id/checklist/aplicar',
  h(async (req, res) => {
    const vid = Number(req.params.id)
    const v = await db.query('SELECT tipo_servico FROM vistorias WHERE id = $1', [vid])
    if (!v.rowCount) return res.status(404).json({ success: false, message: 'Vistoria não encontrada' })
    const tipo = String((req.body || {}).tipo || v.rows[0].tipo_servico || '')
    if (!tipo) return res.status(422).json({ success: false, message: 'Defina o tipo de serviço da vistoria antes' })
    const modelo = await db.query('SELECT nome, por_ambiente FROM checklist_modelos WHERE lower(tipo_servico) = lower($1) ORDER BY ordem, id', [tipo])
    if (!modelo.rowCount) return res.status(422).json({ success: false, message: `Não há checklist cadastrado para "${tipo}" — crie em Configurações` })
    const ambs = await db.query(
      `SELECT a.id FROM ambientes a JOIN pavimentos p ON p.id = a.pavimento_id WHERE p.vistoria_id = $1 AND a.situacao <> 'nao_existe' ORDER BY p.ordem, a.ordem, a.id`,
      [vid]
    )
    const existentes = await db.query('SELECT ambiente_id, lower(nome) AS nome FROM checklist_itens WHERE vistoria_id = $1', [vid])
    const chave = (amb, nome) => `${amb || 0}|${String(nome).toLowerCase()}`
    const jaTem = new Set(existentes.rows.map((e) => chave(e.ambiente_id, e.nome)))
    let n = 0
    let ordem = 0
    for (const m of modelo.rows) {
      const alvos = m.por_ambiente ? ambs.rows.map((a) => a.id) : [null]
      for (const amb of alvos) {
        if (jaTem.has(chave(amb, m.nome))) continue
        await db.query('INSERT INTO checklist_itens (vistoria_id, ambiente_id, nome, ordem) VALUES ($1,$2,$3,$4)', [vid, amb, m.nome, ordem++])
        jaTem.add(chave(amb, m.nome))
        n++
      }
    }
    const itens = (await listarChecklist(vid)).rows
    res.json({ success: true, data: { adicionados: n, itens, resumo: resumoChecklist(itens) } })
  })
)

router.post(
  '/vistorias/:id/checklist',
  h(async (req, res) => {
    const vid = Number(req.params.id)
    const b = req.body || {}
    if (!String(b.nome || '').trim()) return res.status(422).json({ success: false, message: 'Descreva o item' })
    await db.query(
      `INSERT INTO checklist_itens (vistoria_id, ambiente_id, nome, resultado, ordem)
       VALUES ($1,$2,$3,$4,(SELECT COALESCE(MAX(ordem), -1) + 1 FROM checklist_itens WHERE vistoria_id = $1))`,
      [vid, num(b.ambienteId), String(b.nome).trim(), RESULTADOS.includes(b.resultado) ? b.resultado : 'pendente']
    )
    const itens = (await listarChecklist(vid)).rows
    res.json({ success: true, data: { itens, resumo: resumoChecklist(itens) } })
  })
)

router.put(
  '/checklist-itens/:id',
  h(async (req, res) => {
    const id = Number(req.params.id)
    const cur = await db.query('SELECT * FROM checklist_itens WHERE id = $1', [id])
    if (!cur.rowCount) return res.status(404).json({ success: false, message: 'Item não encontrado' })
    const a = cur.rows[0]
    const b = req.body || {}
    await db.query(`UPDATE checklist_itens SET nome=$1, resultado=$2, foto_id=$3, observacao=$4, ambiente_id=$5 WHERE id=$6`, [
      b.nome ?? a.nome,
      RESULTADOS.includes(b.resultado) ? b.resultado : a.resultado,
      'fotoId' in b ? num(b.fotoId) : a.foto_id,
      b.observacao ?? a.observacao,
      'ambienteId' in b ? num(b.ambienteId) : a.ambiente_id,
      id,
    ])
    const itens = (await listarChecklist(a.vistoria_id)).rows
    res.json({ success: true, data: { itens, resumo: resumoChecklist(itens) } })
  })
)

router.delete(
  '/checklist-itens/:id',
  h(async (req, res) => {
    const cur = await db.query('DELETE FROM checklist_itens WHERE id = $1 RETURNING vistoria_id', [Number(req.params.id)])
    if (!cur.rowCount) return res.status(404).json({ success: false, message: 'Item não encontrado' })
    const itens = (await listarChecklist(cur.rows[0].vistoria_id)).rows
    res.json({ success: true, data: { itens, resumo: resumoChecklist(itens) } })
  })
)

module.exports = { router, listar, listarChecklist, resumoChecklist, ANOMALIAS, GRAUS, PRAZOS }
