'use strict'

// Armazenamento de arquivos das vistorias (fotos e plantas) em disco local
// (volume docker `uploads_data` → /app/uploads). Cada foto tem três variantes:
//   orig/  — arquivo original (HEIC do iPhone é convertido para JPEG q95 na entrada)
//   web/   — até 1800px, JPEG q80 (conferência, captura, visualização)
//   thumb/ — até 400px, JPEG q72 (grades e fitas de miniaturas)
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const path = require('node:path')
const crypto = require('node:crypto')
const multer = require('multer')
const sharp = require('sharp')
const exifr = require('exifr')

const UPLOADS_DIR = path.resolve(__dirname, '..', 'uploads')
const TMP_DIR = path.join(UPLOADS_DIR, 'tmp')

function ensureDirSync(dir) {
  fs.mkdirSync(dir, { recursive: true })
  return dir
}
ensureDirSync(TMP_DIR)

// Nome de arquivo aleatório: nunca usamos o nome original no disco.
const nomeAleatorio = () => `${Date.now().toString(36)}${crypto.randomBytes(5).toString('hex')}`

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, ensureDirSync(TMP_DIR)),
    filename: (_req, _file, cb) => cb(null, nomeAleatorio()),
  }),
  limits: { fileSize: 40 * 1024 * 1024 },
})

const absPath = (rel) => path.join(UPLOADS_DIR, rel)

// O multer (busboy) lê o NOME do arquivo enviado como latin1, então "Recibo
// Alimentação.pdf" chega como "Recibo AlimentaÃ§Ã£o.pdf". Aqui desfazemos isso.
// Se a releitura não fizer sentido (nome já correto), mantemos o original.
// Tem algum caractere fora do ASCII (acento, cedilha, til)?
const temAcento = (s) => {
  for (const c of s) if (c.codePointAt(0) > 127) return true
  return false
}

// Desfaz a leitura em latin1 de um texto que veio num multipart (nome de
// arquivo ou campo de formulário). Vale para os DOIS: o busboy trata ambos do
// mesmo jeito, então "Laudo técnico" chega como "Laudo tÃ©cnico".
function textoDoForm(valor) {
  const bruto = String(valor ?? '')
  if (!temAcento(bruto)) return bruto
  const relido = Buffer.from(bruto, 'latin1').toString('utf8')
  // Se a releitura gerou caractere invalido, o texto ja estava certo.
  return relido.includes('�') ? bruto : relido
}

const nomeOriginal = (file) => textoDoForm(file?.originalname)

// Caminhos das variantes a partir do caminho relativo do original
// (vistorias/<id>/orig/<base>.<ext>).
function variantes(arquivo) {
  const dir = path.posix.dirname(path.posix.dirname(arquivo))
  const base = path.posix.basename(arquivo).replace(/\.[^.]+$/, '')
  return { orig: arquivo, web: `${dir}/web/${base}.jpg`, thumb: `${dir}/thumb/${base}.jpg` }
}

// Data e posição gravadas dentro do arquivo (EXIF). A data define a ordem do
// caminho no upload em lote; o GPS vai para o carimbo e para o laudo.
async function metaExif(input) {
  const meta = { capturadaEm: null, latitude: null, longitude: null }
  try {
    const exif = await exifr.parse(input, { pick: ['DateTimeOriginal', 'CreateDate', 'ModifyDate'] })
    meta.capturadaEm = exif?.DateTimeOriginal || exif?.CreateDate || exif?.ModifyDate || null
  } catch {
    /* sem EXIF */
  }
  try {
    const gps = await exifr.gps(input)
    if (gps && Number.isFinite(gps.latitude) && Number.isFinite(gps.longitude)) {
      meta.latitude = gps.latitude
      meta.longitude = gps.longitude
    }
  } catch {
    /* sem GPS */
  }
  return meta
}

const pareceHeic = (nome, mime) => /\.hei[cf]$/i.test(nome || '') || /hei[cf]/i.test(mime || '')

const escXml = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

// Faixa escura no rodapé com data/hora, posição e ambiente — o carimbo que
// laudo pericial e comunique-se pedem. Vai só nas variantes exibidas/impressas;
// o original fica intocado.
function svgCarimbo(largura, altura, linhas) {
  const fonte = Math.max(14, Math.round(largura / 60))
  const alturaFaixa = Math.round(fonte * 1.6 * linhas.length + fonte * 0.8)
  const textos = linhas
    .map(
      (l, i) =>
        `<text x="${Math.round(fonte * 0.8)}" y="${altura - alturaFaixa + fonte * 1.3 * (i + 1)}" font-family="Arial, Helvetica, sans-serif" font-size="${fonte}" fill="#ffffff">${escXml(l)}</text>`
    )
    .join('')
  return Buffer.from(
    `<svg width="${largura}" height="${altura}" xmlns="http://www.w3.org/2000/svg">
       <rect x="0" y="${altura - alturaFaixa}" width="${largura}" height="${alturaFaixa}" fill="#000000" fill-opacity="0.55"/>
       ${textos}
     </svg>`
  )
}

// Gera (ou regera) web + thumb a partir do original, aplicando a orientação
// EXIF, a anotação (PNG transparente desenhado na tela) e o carimbo.
async function gerarVariantes(arquivo, { carimbo = null, anotacao = null } = {}) {
  const v = variantes(arquivo)
  const origem = absPath(v.orig)
  const img = sharp(await fsp.readFile(origem), { failOn: 'none' }).rotate()
  let web = img.clone().resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true })
  const camadas = []
  const meta = await web.clone().toBuffer({ resolveWithObject: true })
  const { width, height } = meta.info
  if (anotacao) {
    const anotAbs = absPath(anotacao)
    if (fs.existsSync(anotAbs)) {
      // A anotação foi desenhada sobre a imagem exibida; redimensiona para o
      // tamanho exato da variante web.
      const png = await sharp(anotAbs).resize({ width, height, fit: 'fill' }).png().toBuffer()
      camadas.push({ input: png, top: 0, left: 0 })
    }
  }
  if (carimbo && carimbo.length) camadas.push({ input: svgCarimbo(width, height, carimbo), top: 0, left: 0 })
  let webBuffer = meta.data
  if (camadas.length) webBuffer = await sharp(meta.data).composite(camadas).toBuffer()
  await sharp(webBuffer).jpeg({ quality: 80 }).toFile(absPath(v.web))
  await sharp(webBuffer)
    .resize({ width: 400, height: 400, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 72 })
    .toFile(absPath(v.thumb))
}

// Processa uma foto enviada: lê data e GPS do EXIF, converte HEIC se preciso e
// grava original + web + thumb. `carimbo` são as linhas de texto da faixa.
// Devolve { arquivo, capturadaEm, latitude, longitude }.
async function processarFoto(tmpPath, nomeOriginal, mime, vistoriaId, { carimbo = null } = {}) {
  const meta = await metaExif(tmpPath)
  let buffer = await fsp.readFile(tmpPath)
  let ext = (path.extname(nomeOriginal || '').toLowerCase() || '.jpg').replace(/[^.a-z0-9]/g, '')

  let decodavel = true
  try {
    await sharp(buffer).metadata()
  } catch {
    decodavel = false
  }
  if (!decodavel) {
    if (!pareceHeic(nomeOriginal, mime)) throw new Error('Formato de imagem não suportado')
    const heicConvert = require('heic-convert')
    buffer = Buffer.from(await heicConvert({ buffer, format: 'JPEG', quality: 0.95 }))
    ext = '.jpg'
  }

  const base = nomeAleatorio()
  const rel = `vistorias/${vistoriaId}`
  for (const sub of ['orig', 'web', 'thumb']) ensureDirSync(absPath(`${rel}/${sub}`))
  const arquivo = `${rel}/orig/${base}${ext}`
  await fsp.writeFile(absPath(arquivo), buffer)
  await gerarVariantes(arquivo, { carimbo })

  await fsp.unlink(tmpPath).catch(() => {})
  return { arquivo, ...meta }
}

// Anotação (setas, círculos) desenhada na conferência: PNG transparente
// guardado ao lado do original, aplicado nas variantes por gerarVariantes.
async function salvarAnotacao(arquivo, pngBuffer) {
  const dir = path.posix.dirname(path.posix.dirname(arquivo))
  const base = path.posix.basename(arquivo).replace(/\.[^.]+$/, '')
  ensureDirSync(absPath(`${dir}/anot`))
  const rel = `${dir}/anot/${base}.png`
  await fsp.writeFile(absPath(rel), pngBuffer)
  return rel
}

// Arquivo qualquer do GED (matrícula, alvará, DWG…): guardado como veio, em
// uploads/<pasta>/<ano>/<nome aleatório>.<ext>.
async function salvarArquivoGenerico(tmpPath, nomeOriginal, pasta = 'arquivos') {
  const ext = (path.extname(nomeOriginal || '').toLowerCase() || '').replace(/[^.a-z0-9]/g, '').slice(0, 10)
  const dirRel = `${pasta}/${new Date().getFullYear()}`
  ensureDirSync(absPath(dirRel))
  const rel = `${dirRel}/${nomeAleatorio()}${ext}`
  await mover(tmpPath, absPath(rel))
  return rel
}

const EXT_PLANTA = ['.pdf', '.jpg', '.jpeg', '.png', '.webp']

const limparNomeArquivo = (s) =>
  String(s || '').replace(/[\\/:*?"<>|\x00-\x1f]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80) || 'planta'

async function mover(origem, destino) {
  await fsp.rename(origem, destino).catch(async () => {
    // rename falha entre filesystems (tmp fora do volume) — copia e apaga.
    await fsp.copyFile(origem, destino)
    await fsp.unlink(origem).catch(() => {})
  })
}

// Guarda as plantas do imóvel — um projeto vem em várias pranchas (01/05,
// 02/05…), e cada uma traz os ambientes do seu trecho. Ficam em
// uploads/plantas/<imovelId>/NN - <nome original>.pdf, substituindo o conjunto
// anterior. O nome original vira o nome do arquivo, então a listagem da pasta
// já devolve tudo que a tela precisa mostrar.
async function salvarPlantas(arquivos, imovelId) {
  const validos = []
  for (const f of arquivos) {
    const ext = path.extname(f.originalname || '').toLowerCase()
    if (EXT_PLANTA.includes(ext)) validos.push({ ...f, ext })
    else await fsp.unlink(f.path).catch(() => {})
  }
  if (!validos.length) throw new Error('Envie a planta em PDF ou imagem (JPG, PNG, WebP)')

  const dirRel = `plantas/${imovelId}`
  await fsp.rm(absPath(dirRel), { recursive: true, force: true }).catch(() => {})
  ensureDirSync(absPath(dirRel))
  const salvos = []
  for (const [i, f] of validos.entries()) {
    const base = limparNomeArquivo(path.basename(f.originalname || '', f.ext))
    const rel = `${dirRel}/${String(i + 1).padStart(2, '0')} - ${base}${f.ext}`
    await mover(f.path, absPath(rel))
    salvos.push({ rel, nome: f.originalname || base })
  }
  // Limpa o formato antigo (uma planta só: plantas/<id>.pdf).
  for (const e of EXT_PLANTA) await fsp.unlink(absPath(`plantas/${imovelId}${e}`)).catch(() => {})
  return salvos
}

// Lista as plantas do imóvel. Aceita o formato antigo (arquivo único) para não
// quebrar imóveis já cadastrados.
function listarPlantas(imovelId, plantaPath) {
  const dir = absPath(`plantas/${imovelId}`)
  if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
    return fs
      .readdirSync(dir)
      .filter((n) => EXT_PLANTA.includes(path.extname(n).toLowerCase()))
      .sort()
      .map((n) => ({ rel: `plantas/${imovelId}/${n}`, nome: n.replace(/^\d+ - /, '') }))
  }
  if (plantaPath && fs.existsSync(absPath(plantaPath))) {
    return [{ rel: plantaPath, nome: path.basename(plantaPath) }]
  }
  return []
}

const removerPlantas = (imovelId) =>
  fsp.rm(absPath(`plantas/${imovelId}`), { recursive: true, force: true }).catch(() => {})

// Comprovante de despesa: foto do recibo ou PDF, guardado como veio (o valor
// probatório está no original). Um arquivo por despesa.
const EXT_COMPROVANTE = ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']

// Fatura/extrato importado: além de PDF e imagem, aceita os formatos que os
// bancos e a Uber exportam (CSV, OFX, TXT). O arquivo fica guardado e vira o
// comprovante das despesas geradas a partir dele.
const EXT_FATURA = ['.pdf', '.csv', '.ofx', '.txt', '.jpg', '.jpeg', '.png', '.webp']

async function salvarFatura(tmpPath, nomeOriginal, viagemId) {
  const ext = path.extname(nomeOriginal || '').toLowerCase()
  if (!EXT_FATURA.includes(ext)) {
    await fsp.unlink(tmpPath).catch(() => {})
    throw new Error('Envie a fatura em PDF, CSV, OFX ou imagem')
  }
  const dirRel = `despesas/viagem-${viagemId}`
  ensureDirSync(absPath(dirRel))
  const rel = `${dirRel}/fatura-${nomeAleatorio()}${ext}`
  await mover(tmpPath, absPath(rel))
  return rel
}

// Modelo de documento da biblioteca de relatórios: o .docx que a Julia já usa
// no escritório, guardado como veio para ser preenchido a cada geração.
async function salvarModelo(tmpPath, nomeOriginal) {
  const ext = path.extname(nomeOriginal || '').toLowerCase()
  if (ext !== '.docx') {
    await fsp.unlink(tmpPath).catch(() => {})
    throw new Error('O modelo precisa ser um arquivo Word (.docx) — no Word, "Salvar como" → Documento .docx')
  }
  ensureDirSync(absPath('modelos'))
  const rel = `modelos/${nomeAleatorio()}.docx`
  await mover(tmpPath, absPath(rel))
  return rel
}

async function salvarComprovante(tmpPath, nomeOriginal, vistoriaId) {
  const ext = path.extname(nomeOriginal || '').toLowerCase()
  if (!EXT_COMPROVANTE.includes(ext)) {
    await fsp.unlink(tmpPath).catch(() => {})
    throw new Error('Comprovante deve ser imagem (foto do recibo) ou PDF')
  }
  const dirRel = `despesas/${vistoriaId}`
  ensureDirSync(absPath(dirRel))
  const rel = `${dirRel}/${nomeAleatorio()}${ext}`
  await mover(tmpPath, absPath(rel))
  return rel
}

async function removerArquivosFoto(arquivo) {
  const v = variantes(arquivo)
  const dir = path.posix.dirname(path.posix.dirname(arquivo))
  const base = path.posix.basename(arquivo).replace(/\.[^.]+$/, '')
  for (const rel of [v.orig, v.web, v.thumb, `${dir}/anot/${base}.png`]) await fsp.unlink(absPath(rel)).catch(() => {})
}

const removerPastaVistoria = (vistoriaId) =>
  fsp.rm(absPath(`vistorias/${vistoriaId}`), { recursive: true, force: true }).catch(() => {})

const removerArquivo = (rel) => fsp.unlink(absPath(rel)).catch(() => {})

module.exports = {
  UPLOADS_DIR,
  upload,
  absPath,
  variantes,
  processarFoto,
  gerarVariantes,
  salvarAnotacao,
  salvarArquivoGenerico,
  mover,
  ensureDirSync,
  nomeAleatorio,
  salvarPlantas,
  listarPlantas,
  removerPlantas,
  salvarComprovante,
  salvarFatura,
  salvarModelo,
  removerArquivosFoto,
  removerPastaVistoria,
  removerArquivo,
  nomeOriginal,
  textoDoForm,
}
