'use strict'

// LIP — Laudo de Inspeção Predial.
//
// O entregável é um Word separado por AMBIENTE: cada ambiente começa em uma
// página nova, numerado e com o pavimento por cima; abaixo vêm as fotos daquele
// ambiente em duas colunas, cada uma com a legenda "Imagem NN. <Ambiente>." e a
// fonte. A numeração das imagens é contínua no documento inteiro, como no modelo
// impresso da Plenno.
//
// O que este módulo NÃO faz, de propósito: nada sobre o estado do imóvel. Não
// conformidades, impacto e conclusões entram depois, escritas pelo arquiteto —
// por isso cada ambiente sai com uma linha em branco reservada para isso.
//
// Por que .docx montado à mão em vez de uma biblioteca: o pacote OOXML é um ZIP
// com quatro XMLs e as imagens, e `archiver` + `sharp` já são dependências deste
// backend (export ZIP e variantes de foto). Uma dependência a menos para manter.
const fs = require('node:fs')
const express = require('express')
const archiver = require('archiver')
const sharp = require('sharp')
const db = require('./db')
const { authMiddleware } = require('./auth')
const { absPath, variantes } = require('./uploads')

const router = express.Router()
router.use(authMiddleware)

const h = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error('[lip]', err.message)
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Erro interno' })
  })

// A ordem do caminho (mesma do resto do módulo) é a ordem das fotos no laudo.
const ORDEM_CAMINHO = 'ORDER BY f.capturada_em NULLS LAST, f.id'

// ---------------------------------------------------------------- estrutura
// Pavimentos → ambientes numerados corridos → fotos. Ambiente marcado como
// inexistente no local fica de fora: ele não é parte do prédio inspecionado.
async function estrutura(vistoriaId) {
  const pavs = await db.query('SELECT id, nome FROM pavimentos WHERE vistoria_id = $1 ORDER BY ordem, id', [
    vistoriaId,
  ])
  const ambs = await db.query(
    `SELECT a.id, a.pavimento_id AS "pavimentoId", a.nome
     FROM ambientes a JOIN pavimentos p ON p.id = a.pavimento_id
     WHERE p.vistoria_id = $1 AND a.situacao <> 'nao_existe'
     ORDER BY p.ordem, p.id, a.ordem, a.id`,
    [vistoriaId]
  )
  const fotos = await db.query(
    `SELECT f.id, f.ambiente_id AS "ambienteId", f.arquivo, f.claquete, f.destaque, f.lip
     FROM fotos f WHERE f.vistoria_id = $1 AND f.ambiente_id IS NOT NULL ${ORDEM_CAMINHO}`,
    [vistoriaId]
  )

  let numero = 0
  return pavs.rows
    .map((p) => ({
      id: p.id,
      nome: p.nome,
      ambientes: ambs.rows
        .filter((a) => a.pavimentoId === p.id)
        .map((a) => ({
          id: a.id,
          nome: a.nome,
          numero: ++numero,
          fotos: fotos.rows.filter((f) => f.ambienteId === a.id),
        })),
    }))
    .filter((p) => p.ambientes.length)
}

router.get(
  '/vistorias/:id/lip',
  h(async (req, res) => {
    const vid = Number(req.params.id)
    const v = await db.query('SELECT 1 FROM vistorias WHERE id = $1', [vid])
    if (!v.rowCount) return res.status(404).json({ success: false, message: 'Vistoria não encontrada' })
    res.json({ success: true, data: { pavimentos: await estrutura(vid) } })
  })
)

// Marca/desmarca em bloco (botões "todas do ambiente", "todas do laudo").
router.post(
  '/vistorias/:id/lip/fotos',
  h(async (req, res) => {
    const vid = Number(req.params.id)
    const { ids, lip } = req.body || {}
    if (!Array.isArray(ids)) return res.status(422).json({ success: false, message: 'Lista de fotos ausente' })
    const limpos = ids.map(Number).filter((n) => Number.isInteger(n))
    if (limpos.length) {
      await db.query('UPDATE fotos SET lip = $1 WHERE vistoria_id = $2 AND id = ANY($3::int[])', [
        lip !== false,
        vid,
        limpos,
      ])
    }
    res.json({ success: true, data: { atualizadas: limpos.length } })
  })
)

// ------------------------------------------------------------------ OOXML
const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const VERMELHO = 'C00000'

// Um trecho de texto formatado. `size` em meio-pontos (22 = 11pt).
const run = (texto, { bold, italic, color, size = 22 } = {}) =>
  '<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>' +
  (bold ? '<w:b/>' : '') +
  (italic ? '<w:i/>' : '') +
  (color ? `<w:color w:val="${color}"/>` : '') +
  `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>` +
  `<w:t xml:space="preserve">${esc(texto)}</w:t></w:r>`

const par = (runs, { align, antes = 0, depois = 80, quebraAntes } = {}) =>
  '<w:p><w:pPr>' +
  (quebraAntes ? '<w:pageBreakBefore/>' : '') +
  `<w:spacing w:before="${antes}" w:after="${depois}" w:line="240" w:lineRule="auto"/>` +
  (align ? `<w:jc w:val="${align}"/>` : '') +
  '</w:pPr>' +
  (Array.isArray(runs) ? runs.join('') : runs || '') +
  '</w:p>'

// Página A4 retrato com 2 cm de margem → 9638 twips úteis, 2 colunas de 4819.
const LARGURA_UTIL = 9638
const COLUNA = LARGURA_UTIL / 2
// 1 twip = 635 EMU. A foto ocupa quase a coluna inteira; a altura é limitada
// para que duas linhas de fotos "em pé" ainda caibam na mesma página.
const FOTO_LARGURA_EMU = 2900000
const FOTO_ALTURA_MAX_EMU = 2450000

const imagemPar = (rid, cx, cy, indice) =>
  '<w:p><w:pPr><w:spacing w:after="40"/><w:jc w:val="center"/></w:pPr><w:r><w:drawing>' +
  '<wp:inline distT="0" distB="0" distL="0" distR="0">' +
  `<wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${indice}" name="Imagem ${indice}"/><wp:cNvGraphicFramePr/>` +
  '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic>' +
  `<pic:nvPicPr><pic:cNvPr id="${indice}" name="Imagem ${indice}"/><pic:cNvPicPr/></pic:nvPicPr>` +
  `<pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
  `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
  '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>' +
  '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>'

// Tabela invisível de 2 colunas — é ela que põe as fotos lado a lado. Cada
// célula PRECISA terminar em parágrafo, senão o Word recusa o arquivo.
const tabela = (linhas) =>
  `<w:tbl><w:tblPr><w:tblW w:w="${LARGURA_UTIL}" w:type="dxa"/><w:tblLayout w:type="fixed"/>` +
  '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/>' +
  '<w:bottom w:w="0" w:type="dxa"/><w:right w:w="113" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
  `<w:tblGrid><w:gridCol w:w="${COLUNA}"/><w:gridCol w:w="${COLUNA}"/></w:tblGrid>` +
  linhas
    .map(
      (celulas) =>
        '<w:tr>' +
        celulas
          .map((c) => `<w:tc><w:tcPr><w:tcW w:w="${COLUNA}" w:type="dxa"/></w:tcPr>${c || par('')}</w:tc>`)
          .join('') +
        '</w:tr>'
    )
    .join('') +
  '</w:tbl>'

const emPares = (itens) => {
  const linhas = []
  for (let i = 0; i < itens.length; i += 2) linhas.push([itens[i], itens[i + 1] || ''])
  return linhas
}

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Default Extension="jpeg" ContentType="image/jpeg"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
  '</Types>'

const RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  '</Relationships>'

const STYLES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/>' +
  '<w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>' +
  '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>' +
  '</w:styles>'

const SECT =
  '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
  '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/>' +
  '</w:sectPr>'

// Prepara a imagem para dentro do .docx: 1200px de largura a JPEG 78 dá ~380dpi
// no tamanho impresso e mantém o arquivo abrindo rápido no Word.
async function prepararImagem(arquivo) {
  const v = variantes(arquivo)
  let origem = absPath(v.web)
  if (!fs.existsSync(origem)) origem = absPath(v.orig)
  if (!fs.existsSync(origem)) return null
  const img = sharp(origem, { failOn: 'none' }).rotate()
  const buffer = await img
    .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 78 })
    .toBuffer()
  const meta = await sharp(buffer).metadata()
  const largura = meta.width || 4
  const altura = meta.height || 3
  let cx = FOTO_LARGURA_EMU
  let cy = Math.round((cx * altura) / largura)
  if (cy > FOTO_ALTURA_MAX_EMU) {
    cy = FOTO_ALTURA_MAX_EMU
    cx = Math.round((cy * largura) / altura)
  }
  return { buffer, cx, cy }
}

// -------------------------------------------------------------------- geração
router.get(
  '/vistorias/:id/lip/docx',
  h(async (req, res) => {
    const vid = Number(req.params.id)
    const dados = await db.query(
      `SELECT v.id, to_char(v.data_vistoria, 'DD/MM/YYYY') AS data,
        EXTRACT(YEAR FROM COALESCE(v.data_vistoria, CURRENT_DATE))::int AS ano,
        i.nome AS imovel, i.endereco, ${db.CLIENTE_NOME} AS cliente
       FROM vistorias v JOIN imoveis i ON i.id = v.imovel_id JOIN clients c ON c.id = i.client_id
       WHERE v.id = $1`,
      [vid]
    )
    if (!dados.rowCount) return res.status(404).json({ success: false, message: 'Vistoria não encontrada' })
    const v = dados.rows[0]
    const fonte = String(req.query.fonte || 'Plenno Arquitetura').trim() || 'Plenno Arquitetura'
    const ano = String(req.query.ano || v.ano)

    const pavimentos = await estrutura(vid)
    const selecionadas = pavimentos.flatMap((p) => p.ambientes.flatMap((a) => a.fotos.filter((f) => f.lip)))
    if (!selecionadas.length) {
      return res
        .status(422)
        .json({ success: false, message: 'Nenhuma foto marcada para o laudo — marque as fotos dos ambientes antes' })
    }

    // As imagens são preparadas ANTES do XML: o documento precisa do id da
    // relação e do tamanho de cada uma para montar o desenho.
    const midia = new Map() // fotoId → { nome, rid, cx, cy }
    let seq = 0
    for (const f of selecionadas) {
      const img = await prepararImagem(f.arquivo)
      if (!img) continue // arquivo sumiu do volume: o laudo segue sem ela
      seq += 1
      const nome = `imagem${seq}.jpeg`
      midia.set(f.id, { nome, rid: `rIdImg${seq}`, cx: img.cx, cy: img.cy, buffer: img.buffer })
    }

    // ---- corpo do documento
    const corpo = []

    // Identificação (só quem/onde/quando — o diagnóstico é do arquiteto).
    corpo.push(par(run('LAUDO DE INSPEÇÃO PREDIAL', { bold: true, size: 32, color: VERMELHO }), { align: 'center' }))
    corpo.push(par(run(`${v.cliente} | ${v.imovel}`, { bold: true, size: 24 }), { align: 'center' }))
    if (v.endereco) corpo.push(par(run(v.endereco, { size: 20 }), { align: 'center' }))
    corpo.push(par(run(`Data: ${v.data || '—'}`, { size: 20 }), { align: 'center', depois: 320 }))

    // Índice de ambientes, um bloco por pavimento, preenchendo coluna a coluna
    // (o modelo impresso lê de cima para baixo na coluna da esquerda).
    corpo.push(par(run('AMBIENTES', { bold: true, size: 24, color: VERMELHO }), { antes: 120 }))
    for (const p of pavimentos) {
      corpo.push(par(run(p.nome.toUpperCase(), { bold: true, size: 22 }), { antes: 120, depois: 40 }))
      const itens = p.ambientes.map((a) =>
        par([run(`${a.numero}  `, { bold: true, size: 20 }), run(a.nome, { size: 20 })], { depois: 20 })
      )
      const meio = Math.ceil(itens.length / 2)
      const linhas = []
      for (let i = 0; i < meio; i++) linhas.push([itens[i], itens[meio + i] || ''])
      corpo.push(tabela(linhas))
      corpo.push(par(''))
    }

    // ---- uma página por ambiente
    let numeroImagem = 0
    let pavimentoAnterior = null
    for (const p of pavimentos) {
      for (const a of p.ambientes) {
        const trocouPavimento = pavimentoAnterior !== p.id
        if (trocouPavimento) {
          corpo.push(
            par(run(p.nome.toUpperCase(), { bold: true, size: 22, color: VERMELHO }), {
              quebraAntes: true,
              depois: 60,
            })
          )
          pavimentoAnterior = p.id
        }
        corpo.push(
          par(
            [
              run(`AMBIENTE ${a.numero} – `, { bold: true, size: 24, color: VERMELHO }),
              run(a.nome.toUpperCase(), { size: 24 }),
            ],
            { quebraAntes: !trocouPavimento, depois: 60 }
          )
        )
        // Linha reservada: as não conformidades do ambiente são escritas aqui
        // pelo arquiteto, depois da análise. O sistema não as inventa.
        corpo.push(par('', { depois: 160 }))

        const daFoto = a.fotos.filter((f) => f.lip && midia.has(f.id))
        if (!daFoto.length) {
          corpo.push(
            par(run('Não foi possível realizar registro fotográfico deste ambiente.', { italic: true, size: 20 }))
          )
          continue
        }
        const celulas = daFoto.map((f) => {
          const m = midia.get(f.id)
          numeroImagem += 1
          const legenda = `Imagem ${String(numeroImagem).padStart(2, '0')}. ${a.nome}.`
          return (
            imagemPar(m.rid, m.cx, m.cy, numeroImagem) +
            par(run(legenda, { size: 16 }), { align: 'center', depois: 0 }) +
            par(run(`Fonte: ${fonte} (${ano}).`, { size: 16 }), { align: 'center', depois: 200 })
          )
        })
        corpo.push(tabela(emPares(celulas)))
        corpo.push(par(''))
      }
    }

    const documento =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
      'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
      'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
      'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      `<w:body>${corpo.join('')}${SECT}</w:body></w:document>`

    const docRels =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      [...midia.values()]
        .map(
          (m) =>
            `<Relationship Id="${m.rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${m.nome}"/>`
        )
        .join('') +
      '</Relationships>'

    const limpo = (s) => String(s || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '-').trim()
    res.attachment(`LIP_${limpo(v.cliente)}_${limpo(v.imovel)}_${(v.data || '').replace(/\//g, '.')}.docx`)
    res.type('application/vnd.openxmlformats-officedocument.wordprocessingml.document')

    const zip = archiver('zip', { zlib: { level: 6 } })
    zip.on('error', (err) => {
      console.error('[lip]', err.message)
      res.destroy(err)
    })
    zip.pipe(res)
    zip.append(CONTENT_TYPES, { name: '[Content_Types].xml' })
    zip.append(RELS, { name: '_rels/.rels' })
    zip.append(STYLES, { name: 'word/styles.xml' })
    zip.append(docRels, { name: 'word/_rels/document.xml.rels' })
    zip.append(documento, { name: 'word/document.xml' })
    for (const m of midia.values()) zip.append(m.buffer, { name: `word/media/${m.nome}` })
    await zip.finalize()
  })
)

module.exports = router
