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

function nomeOriginal(file) {
  const bruto = String(file?.originalname || '')
  if (!temAcento(bruto)) return bruto
  const relido = Buffer.from(bruto, 'latin1').toString('utf8')
  // Se a releitura gerou caractere invalido, o nome ja estava certo.
  return relido.includes('�') ? bruto : relido
}

// Caminhos das variantes a partir do caminho relativo do original
// (vistorias/<id>/orig/<base>.<ext>).
function variantes(arquivo) {
  const dir = path.posix.dirname(path.posix.dirname(arquivo))
  const base = path.posix.basename(arquivo).replace(/\.[^.]+$/, '')
  return { orig: arquivo, web: `${dir}/web/${base}.jpg`, thumb: `${dir}/thumb/${base}.jpg` }
}

// Data em que a foto foi tirada, gravada dentro do arquivo (EXIF). É ela que
// define a ordem do caminho no upload em lote.
async function dataExif(input) {
  try {
    const exif = await exifr.parse(input, { pick: ['DateTimeOriginal', 'CreateDate', 'ModifyDate'] })
    return exif?.DateTimeOriginal || exif?.CreateDate || exif?.ModifyDate || null
  } catch {
    return null
  }
}

const pareceHeic = (nome, mime) => /\.hei[cf]$/i.test(nome || '') || /hei[cf]/i.test(mime || '')

// Processa uma foto enviada: lê a data EXIF, converte HEIC se preciso e grava
// original + web + thumb. Devolve { arquivo, capturadaEm }.
async function processarFoto(tmpPath, nomeOriginal, mime, vistoriaId) {
  const capturadaEm = await dataExif(tmpPath)
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

  // .rotate() aplica a orientação EXIF para as variantes exibidas no navegador.
  const img = sharp(buffer, { failOn: 'none' }).rotate()
  await img
    .clone()
    .resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toFile(absPath(`${rel}/web/${base}.jpg`))
  await img
    .clone()
    .resize({ width: 400, height: 400, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 72 })
    .toFile(absPath(`${rel}/thumb/${base}.jpg`))

  await fsp.unlink(tmpPath).catch(() => {})
  return { arquivo, capturadaEm }
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
  for (const rel of [v.orig, v.web, v.thumb]) await fsp.unlink(absPath(rel)).catch(() => {})
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
  salvarPlantas,
  listarPlantas,
  removerPlantas,
  salvarComprovante,
  salvarFatura,
  removerArquivosFoto,
  removerPastaVistoria,
  removerArquivo,
  nomeOriginal,
}
