'use strict'

// Planta interativa: a prancha vira IMAGEM e cada ambiente ganha um PINO.
//
//   • Rasterização: PDF → PNG com o pdftoppm (poppler), guardado em
//     uploads/plantas/<imovel>/render/NN.png. Planta que já é imagem só é
//     redimensionada. É a mesma imagem que o celular usa na captura e que o
//     laudo em PDF embute.
//   • Pinos: um por ambiente do MODELO do imóvel, em coordenadas relativas
//     (0..1) — independem do tamanho em que a imagem é mostrada. A vistoria
//     encontra o pino pelo nome do ambiente (ela herdou o modelo).
//   • Leitura visual: planta escaneada (sem camada de texto) vai como imagem ao
//     Claude do Hub (ai-vision), que devolve pavimentos e ambientes no mesmo
//     formato da leitura por texto — a tela de conferência é a mesma.
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const express = require('express')
const sharp = require('sharp')
const db = require('./db')
const hub = require('./hub')
const { authMiddleware } = require('./auth')
const { absPath, listarPlantas, ensureDirSync } = require('./uploads')

const execFileP = promisify(execFile)

const router = express.Router()
router.use(authMiddleware)

const h = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error('[planta-pinos]', err.message)
    if (!res.headersSent) res.status(err.status || 500).json({ success: false, message: err.status ? err.message : 'Erro interno' })
  })

const LARGURA_MAX = 2400

// Devolve o caminho relativo do PNG da prancha, gerando se ainda não existe.
async function imagemDaPrancha(imovelId, plantaPath, indice = 0, pagina = 1) {
  const arquivos = listarPlantas(imovelId, plantaPath)
  if (!arquivos.length) throw Object.assign(new Error('Imóvel sem planta'), { status: 404 })
  const i = Math.min(Math.max(Number(indice) || 0, 0), arquivos.length - 1)
  const origem = arquivos[i]
  const dirRel = `plantas/${imovelId}/render`
  ensureDirSync(absPath(dirRel))
  const rel = `${dirRel}/${String(i).padStart(2, '0')}-p${pagina}.png`
  const abs = absPath(rel)
  const origemAbs = absPath(origem.rel)
  // Regenera se a planta foi trocada depois do render.
  if (fs.existsSync(abs) && fs.statSync(abs).mtimeMs >= fs.statSync(origemAbs).mtimeMs) return { rel, indice: i, total: arquivos.length }

  if (/\.pdf$/i.test(origem.rel)) {
    const base = path.join(path.dirname(abs), `tmp-${process.pid}-${Date.now()}`)
    try {
      await execFileP('pdftoppm', ['-png', '-r', '110', '-f', String(pagina), '-l', String(pagina), '-singlefile', origemAbs, base], {
        timeout: 120000,
      })
    } catch (err) {
      throw Object.assign(new Error(`Não consegui rasterizar a prancha (pdftoppm): ${err.message}`), { status: 500 })
    }
    await sharp(`${base}.png`).resize({ width: LARGURA_MAX, height: LARGURA_MAX, fit: 'inside', withoutEnlargement: true }).png({ compressionLevel: 8 }).toFile(abs)
    await fsp.unlink(`${base}.png`).catch(() => {})
  } else {
    await sharp(origemAbs, { failOn: 'none' }).rotate().resize({ width: LARGURA_MAX, height: LARGURA_MAX, fit: 'inside', withoutEnlargement: true }).png().toFile(abs)
  }
  return { rel, indice: i, total: arquivos.length }
}

// Quantas páginas tem a prancha (PDF) — pdfinfo vem no mesmo pacote.
async function paginasDoPdf(abs) {
  try {
    const { stdout } = await execFileP('pdfinfo', [abs], { timeout: 30000 })
    const m = /Pages:\s+(\d+)/.exec(stdout)
    return m ? Number(m[1]) : 1
  } catch {
    return 1
  }
}

router.get(
  '/imoveis/:id/planta/imagem',
  h(async (req, res) => {
    const id = Number(req.params.id)
    const { rows } = await db.query('SELECT planta_path FROM imoveis WHERE id = $1', [id])
    if (!rows.length) return res.status(404).json({ success: false, message: 'Imóvel não encontrado' })
    const { rel } = await imagemDaPrancha(id, rows[0].planta_path, req.query.arquivo || 0, Number(req.query.pagina) || 1)
    res.sendFile(absPath(rel), { headers: { 'Cache-Control': 'private, max-age=3600' } })
  })
)

// Lista das pranchas com quantas páginas cada uma tem (para o seletor da tela).
router.get(
  '/imoveis/:id/planta/pranchas',
  h(async (req, res) => {
    const id = Number(req.params.id)
    const { rows } = await db.query('SELECT planta_path FROM imoveis WHERE id = $1', [id])
    if (!rows.length) return res.status(404).json({ success: false, message: 'Imóvel não encontrado' })
    const arquivos = listarPlantas(id, rows[0].planta_path)
    const lista = []
    for (const [i, a] of arquivos.entries()) {
      lista.push({ indice: i, nome: a.nome, paginas: /\.pdf$/i.test(a.rel) ? await paginasDoPdf(absPath(a.rel)) : 1 })
    }
    res.json({ success: true, data: lista })
  })
)

// ------------------------------------------------------------------- pinos
const PINO_COLS = `pp.id, pp.imovel_id AS "imovelId", pp.ambiente_id AS "ambienteId", pp.prancha, pp.x, pp.y, a.nome, p.nome AS "pavimentoNome"`

const listarPinos = (imovelId) =>
  db.query(
    `SELECT ${PINO_COLS} FROM planta_pinos pp JOIN ambientes a ON a.id = pp.ambiente_id JOIN pavimentos p ON p.id = a.pavimento_id
     WHERE pp.imovel_id = $1 ORDER BY p.ordem, a.ordem, a.id`,
    [imovelId]
  )

router.get(
  '/imoveis/:id/pinos',
  h(async (req, res) => res.json({ success: true, data: (await listarPinos(Number(req.params.id))).rows }))
)

// Cria ou move o pino de um ambiente do modelo.
router.put(
  '/imoveis/:id/pinos',
  h(async (req, res) => {
    const imovelId = Number(req.params.id)
    const b = req.body || {}
    const ambienteId = Number(b.ambienteId)
    const x = Number(b.x)
    const y = Number(b.y)
    if (!ambienteId || !(x >= 0 && x <= 1) || !(y >= 0 && y <= 1)) {
      return res.status(422).json({ success: false, message: 'Ambiente e posição (0..1) são obrigatórios' })
    }
    const ok = await db.query(
      'SELECT 1 FROM ambientes a JOIN pavimentos p ON p.id = a.pavimento_id WHERE a.id = $1 AND p.imovel_id = $2',
      [ambienteId, imovelId]
    )
    if (!ok.rowCount) return res.status(422).json({ success: false, message: 'O ambiente não é do modelo deste imóvel' })
    await db.query(
      `INSERT INTO planta_pinos (imovel_id, ambiente_id, prancha, x, y) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (ambiente_id) DO UPDATE SET prancha = EXCLUDED.prancha, x = EXCLUDED.x, y = EXCLUDED.y`,
      [imovelId, ambienteId, Math.max(0, Number(b.prancha) || 0), x, y]
    )
    res.json({ success: true, data: (await listarPinos(imovelId)).rows })
  })
)

router.delete(
  '/pinos/:id',
  h(async (req, res) => {
    const cur = await db.query('DELETE FROM planta_pinos WHERE id = $1 RETURNING imovel_id', [Number(req.params.id)])
    if (!cur.rowCount) return res.status(404).json({ success: false, message: 'Pino não encontrado' })
    res.json({ success: true, data: (await listarPinos(cur.rows[0].imovel_id)).rows })
  })
)

// Pinos vistos pela VISTORIA: casa o ambiente da vistoria com o do modelo pelo
// nome (dentro do mesmo pavimento). Ambientes criados em campo não têm pino.
const chave = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')

router.get(
  '/vistorias/:id/pinos',
  h(async (req, res) => {
    const vid = Number(req.params.id)
    const v = await db.query('SELECT imovel_id FROM vistorias WHERE id = $1', [vid])
    if (!v.rowCount) return res.status(404).json({ success: false, message: 'Vistoria não encontrada' })
    const imovelId = v.rows[0].imovel_id
    const pinos = (await listarPinos(imovelId)).rows
    const ambs = await db.query(
      `SELECT a.id, a.nome, p.nome AS "pavimentoNome" FROM ambientes a JOIN pavimentos p ON p.id = a.pavimento_id WHERE p.vistoria_id = $1`,
      [vid]
    )
    const porChave = new Map(pinos.map((pp) => [chave(`${pp.pavimentoNome}|${pp.nome}`), pp]))
    const porNome = new Map(pinos.map((pp) => [chave(pp.nome), pp]))
    const lista = []
    for (const a of ambs.rows) {
      const pp = porChave.get(chave(`${a.pavimentoNome}|${a.nome}`)) || porNome.get(chave(a.nome))
      if (pp) lista.push({ ambienteId: a.id, nome: a.nome, pavimentoNome: a.pavimentoNome, prancha: pp.prancha, x: pp.x, y: pp.y })
    }
    res.json({ success: true, data: { imovelId, pinos: lista } })
  })
)

// ---------------------------------------------------------- leitura visual
// Planta sem texto: renderiza as páginas e pede ao Claude (visão) a lista de
// pavimentos e ambientes. Devolve o mesmo formato de planta.js.
const INSTRUCOES_VISAO = `Você lê PLANTAS ARQUITETÔNICAS a partir de imagens e monta a lista de PAVIMENTOS e AMBIENTES para uma vistoria fotográfica.

Olhe cada imagem e transcreva os nomes dos ambientes escritos nela (cômodos, salas, banheiros, circulações, áreas externas nomeadas), agrupados pelo pavimento que a prancha representa (título da planta: "TÉRREO", "PAVIMENTO SUPERIOR", "SUBSOLO"…; sem título, "Pavimento único").

IGNORE: cotas, áreas em m², escalas, itens de combate a incêndio (extintores, hidrantes, rotas), legendas, carimbo, endereços e nomes de projeto.
Ambientes repetidos ganham numeração ("Sala 1", "Sala 2"). Siglas expandidas ("W.C." → "Banheiro", "D.M.L." → "Depósito de Material de Limpeza"). Nomes em Title Case, em português. Não invente ambiente que não esteja escrito.

Responda SÓ com JSON: {"pavimentos":[{"nome":"Térreo","ambientes":["Sala","Cozinha"]}],"observacoes":"o que ficou ilegível, em uma frase"}`

function extrairJson(texto) {
  const limpo = String(texto || '').replace(/```(?:json)?/gi, '').trim()
  const ini = limpo.indexOf('{')
  const fim = limpo.lastIndexOf('}')
  if (ini < 0 || fim <= ini) throw Object.assign(new Error('A IA não devolveu um JSON'), { status: 502 })
  const bruto = limpo.slice(ini, fim + 1)
  try {
    return JSON.parse(bruto)
  } catch {
    return JSON.parse(bruto.replace(/,\s*([}\]])/g, '$1'))
  }
}

// `entrada` = [{ caminho, nome }] das pranchas (PDF ou imagem).
async function sugerirPorVisao(imovelId, entrada, { model } = {}) {
  const imagens = []
  const arquivos = listarPlantas(imovelId, `plantas/${imovelId}`)
  for (const [i, a] of arquivos.entries()) {
    const paginas = /\.pdf$/i.test(a.rel) ? Math.min(await paginasDoPdf(absPath(a.rel)), 12) : 1
    for (let p = 1; p <= paginas && imagens.length < 16; p++) {
      const { rel } = await imagemDaPrancha(imovelId, `plantas/${imovelId}`, i, p)
      // Reduz para a visão: 1800px de largura em JPEG cabe no limite da API.
      const buf = await sharp(absPath(rel)).resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer()
      imagens.push({ name: `${a.nome} p${p}`, type: 'image/jpeg', dataUrl: `data:image/jpeg;base64,${buf.toString('base64')}` })
    }
  }
  void entrada
  if (!imagens.length) throw Object.assign(new Error('Nenhuma prancha para ler'), { status: 422 })

  // Até 4 imagens por chamada: mais que isso o Claude começa a resumir.
  const pavimentos = []
  const observacoes = []
  for (let i = 0; i < imagens.length; i += 4) {
    const lote = imagens.slice(i, i + 4)
    const out = await hub.hubFetch('POST', '/api/integration/ai-vision', {
      system: INSTRUCOES_VISAO,
      prompt: `Pranchas: ${lote.map((l) => l.name).join(', ')}. Liste os pavimentos e ambientes de cada uma.`,
      model: model || 'sonnet',
      images: lote,
    })
    const dados = extrairJson(out?.text || out)
    for (const p of Array.isArray(dados.pavimentos) ? dados.pavimentos : []) {
      const nome = String(p?.nome || '').trim() || 'Pavimento único'
      const ambientes = (Array.isArray(p?.ambientes) ? p.ambientes : []).map((x) => String(x || '').trim()).filter(Boolean)
      if (!ambientes.length) continue
      const existente = pavimentos.find((q) => chave(q.nome) === chave(nome))
      if (existente) {
        for (const a of ambientes) if (!existente.ambientes.some((e) => chave(e) === chave(a))) existente.ambientes.push(a)
      } else pavimentos.push({ nome, ambientes })
    }
    if (dados.observacoes) observacoes.push(String(dados.observacoes))
  }
  return { pavimentos, ignorados: [], observacoes: observacoes.join(' '), paginas: imagens.length, textosLidos: 0, prancha: null, visual: true }
}

module.exports = { router, imagemDaPrancha, sugerirPorVisao, listarPinos }
