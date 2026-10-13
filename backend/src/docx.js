'use strict'

// Montagem de arquivos .docx (OOXML) — a base dos laudos que saem em Word.
//
// Por que .docx montado à mão em vez de uma biblioteca: o pacote OOXML é um ZIP
// com quatro XMLs e as imagens, e `archiver` + `sharp` já são dependências deste
// backend (export ZIP e variantes de foto). Uma dependência a menos para manter.
//
// Quem usa: src/lip.js (Laudo de Inspeção Predial), src/relatorios.js
// (Relatório fotográfico) e src/laudo-docx.js (a versão Word de qualquer
// modelo de laudo). O que muda entre eles é o CORPO do documento — a página,
// as fontes, a grade de duas colunas e o empacotamento são os mesmos.
const fs = require('node:fs')
const archiver = require('archiver')
const sharp = require('sharp')
const { absPath, variantes } = require('./uploads')

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

// Tabela com grade e cabeçalho — a que o corpo dos laudos usa (identificação,
// quadro de áreas, checklist, protocolos). `colunas` levam a largura em fração
// da página (a soma dá 1) e, opcionalmente, o alinhamento.
const tabelaDados = (colunas, linhas, { cabecalho = true } = {}) => {
  const larguras = colunas.map((c) => Math.round(LARGURA_UTIL * c.largura))
  const bordas =
    '<w:tblBorders>' +
    ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
      .map((l) => `<w:${l} w:val="single" w:sz="4" w:space="0" w:color="BFBFBF"/>`)
      .join('') +
    '</w:tblBorders>'
  const celula = (texto, largura, { bold, align, fundo } = {}) =>
    `<w:tc><w:tcPr><w:tcW w:w="${largura}" w:type="dxa"/>` +
    (fundo ? `<w:shd w:val="clear" w:color="auto" w:fill="${fundo}"/>` : '') +
    '</w:tcPr>' +
    par(run(texto, { bold, size: 18 }), { align, antes: 20, depois: 20 }) +
    '</w:tc>'
  const linha = (celulas) => `<w:tr>${celulas.join('')}</w:tr>`
  return (
    `<w:tbl><w:tblPr><w:tblW w:w="${LARGURA_UTIL}" w:type="dxa"/><w:tblLayout w:type="fixed"/>${bordas}` +
    '<w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="80" w:type="dxa"/>' +
    '<w:bottom w:w="40" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr>' +
    `<w:tblGrid>${larguras.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>` +
    (cabecalho
      ? linha(colunas.map((c, i) => celula(c.titulo, larguras[i], { bold: true, align: c.alinhar, fundo: 'EFEFEF' })))
      : '') +
    linhas
      .map((l) => linha(colunas.map((c, i) => celula(String(l[i] ?? ''), larguras[i], { align: c.alinhar }))))
      .join('') +
    '</w:tbl>'
  )
}

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

/** Prepara TODAS as fotos escolhidas e devolve Map(fotoId → { nome, rid, cx, cy, buffer }).
 *  Foto cujo arquivo sumiu do volume fica de fora — o laudo sai sem ela. */
async function prepararMidia(fotos) {
  const midia = new Map()
  let seq = 0
  for (const f of fotos) {
    const img = await prepararImagem(f.arquivo)
    if (!img) continue
    seq += 1
    midia.set(f.id, { nome: `imagem${seq}.jpeg`, rid: `rIdImg${seq}`, cx: img.cx, cy: img.cy, buffer: img.buffer })
  }
  return midia
}

const nomeArquivoSeguro = (s) => String(s || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '-').trim()

// Empacota o .docx e envia como download. `corpo` é a lista de parágrafos/tabelas.
async function enviar(res, nomeArquivo, corpo, midia) {
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

  res.attachment(nomeArquivo)
  res.type('application/vnd.openxmlformats-officedocument.wordprocessingml.document')

  const zip = archiver('zip', { zlib: { level: 6 } })
  zip.on('error', (err) => {
    console.error('[docx]', err.message)
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
}

module.exports = {
  VERMELHO,
  run,
  par,
  tabela,
  tabelaDados,
  emPares,
  imagemPar,
  prepararImagem,
  prepararMidia,
  nomeArquivoSeguro,
  enviar,
}
