'use strict'

// Biblioteca de modelos de documento — o "armário" do escritório.
//
// A ideia é a de um GED: em vez de o sistema saber montar só os laudos que
// alguém programou, a Julia guarda aqui os .docx que ela já usa (laudos,
// declarações, pareceres) e o sistema PREENCHE os dados dos cadastros na hora
// de gerar. O modelo continua sendo dela — muda no Word, sobe de novo.
//
// Como o modelo marca onde entra cada dado: chaves entre chaves duplas no
// texto do Word, por exemplo:
//
//     RELATÓRIO — {{imovel}}
//     Cliente: {{cliente}} ({{cliente.documento}})
//     Endereço: {{endereco}}
//     Vistoria {{vistoria}} realizada em {{vistoria.data}}.
//
// Campo que o modelo cita e o sistema não conhece fica intacto no documento
// (some silenciosamente seria pior: ninguém perceberia o buraco no laudo).
const fsp = require('node:fs/promises')
const express = require('express')
const archiver = require('archiver')
const db = require('./db')
const { authMiddleware } = require('./auth')
const { upload, absPath, salvarModelo, removerArquivo, nomeOriginal, textoDoForm } = require('./uploads')
const { lerEntradas } = require('./zip')

const router = express.Router()
router.use(authMiddleware)

const h = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error('[modelos]', err.message)
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Erro interno' })
  })

const COLS = `id, nome, descricao, tipo, chave, arquivo <> '' AS "temArquivo",
  nome_original AS "nomeOriginal", created_at AS "createdAt"`

// ------------------------------------------------------------------ catálogo
// O que o modelo pode pedir. É esta lista que a tela mostra para quem está
// montando o .docx — e é ela que o preenchimento conhece.
const CAMPOS = [
  { chave: 'cliente', descricao: 'Cliente (razão social, ou o nome se for pessoa física)' },
  { chave: 'cliente.documento', descricao: 'CNPJ ou CPF do cliente, com máscara' },
  { chave: 'cliente.email', descricao: 'E-mail do cliente' },
  { chave: 'cliente.telefone', descricao: 'Telefone do cliente' },
  { chave: 'imovel', descricao: 'Nome do imóvel' },
  { chave: 'endereco', descricao: 'Endereço do imóvel' },
  { chave: 'vistoria', descricao: 'Número da vistoria (ex.: #12)' },
  { chave: 'vistoria.data', descricao: 'Data da vistoria (dd/mm/aaaa)' },
  { chave: 'vistoria.tipo', descricao: 'Tipo de serviço da vistoria' },
  { chave: 'vistoria.participantes', descricao: 'Quem participou da vistoria' },
  { chave: 'responsavel', descricao: 'Profissional responsável pela vistoria' },
  { chave: 'titulo', descricao: 'Título do relatório' },
  { chave: 'data', descricao: 'Data da capa do relatório (ex.: 09/2026)' },
  { chave: 'texto', descricao: 'O texto livre escrito na tela do relatório' },
  { chave: 'fonte', descricao: 'Fonte das fotos (ex.: Plenno Arquitetura)' },
  { chave: 'ambientes', descricao: 'Lista dos ambientes da vistoria, separados por vírgula' },
  { chave: 'fotos', descricao: 'Quantidade de fotos incluídas no relatório' },
  { chave: 'hoje', descricao: 'Data de hoje (dd/mm/aaaa)' },
]

router.get('/modelos/campos', (_req, res) => res.json({ success: true, data: CAMPOS }))

// ------------------------------------------------------------------- listagem
router.get(
  '/modelos',
  h(async (_req, res) => {
    const { rows } = await db.query(
      `SELECT ${COLS}, (SELECT COUNT(*)::int FROM relatorios r WHERE r.modelo_id = modelos.id) AS "usos"
       FROM modelos ORDER BY tipo <> 'nativo', nome`
    )
    res.json({ success: true, data: rows })
  })
)

// Envio de um modelo novo: o .docx é guardado como veio e a resposta já diz
// quais campos ele usa — é assim que se confere se as chaves foram escritas
// certo, sem precisar gerar um documento para descobrir.
router.post(
  '/modelos',
  upload.single('modelo'),
  h(async (req, res) => {
    if (!req.file) return res.status(422).json({ success: false, message: 'Arquivo não enviado' })
    const original = nomeOriginal(req.file)
    let arquivo
    try {
      arquivo = await salvarModelo(req.file.path, original)
    } catch (err) {
      return res.status(422).json({ success: false, message: err.message })
    }

    // Abre o pacote agora: se não for um Word de verdade, melhor recusar aqui.
    let campos
    try {
      campos = camposDoModelo(await fsp.readFile(absPath(arquivo)))
    } catch (err) {
      await removerArquivo(arquivo)
      return res.status(422).json({ success: false, message: err.message })
    }

    const nome = textoDoForm(req.body?.nome).trim() || original.replace(/\.docx$/i, '')
    const { rows } = await db.query(
      `INSERT INTO modelos (nome, descricao, tipo, arquivo, nome_original)
       VALUES ($1, $2, 'docx', $3, $4) RETURNING ${COLS}`,
      [nome, textoDoForm(req.body?.descricao).trim(), arquivo, original]
    )
    res.json({ success: true, data: { ...rows[0], campos, usos: 0 } })
  })
)

router.put(
  '/modelos/:id',
  h(async (req, res) => {
    const id = Number(req.params.id)
    const cur = await db.query('SELECT * FROM modelos WHERE id = $1', [id])
    if (!cur.rowCount) return res.status(404).json({ success: false, message: 'Modelo não encontrado' })
    const m = cur.rows[0]
    const b = req.body || {}
    const { rows } = await db.query(
      `UPDATE modelos SET nome = $1, descricao = $2 WHERE id = $3 RETURNING ${COLS}`,
      [String(b.nome ?? m.nome).trim() || m.nome, String(b.descricao ?? m.descricao).trim(), id]
    )
    res.json({ success: true, data: rows[0] })
  })
)

router.delete(
  '/modelos/:id',
  h(async (req, res) => {
    const id = Number(req.params.id)
    const cur = await db.query('SELECT tipo, arquivo FROM modelos WHERE id = $1', [id])
    if (!cur.rowCount) return res.status(404).json({ success: false, message: 'Modelo não encontrado' })
    if (cur.rows[0].tipo === 'nativo') {
      return res.status(422).json({ success: false, message: 'O Relatório fotográfico vem com o sistema e não pode ser excluído' })
    }
    await db.query('DELETE FROM modelos WHERE id = $1', [id])
    if (cur.rows[0].arquivo) await removerArquivo(cur.rows[0].arquivo)
    res.json({ success: true, message: 'Modelo excluído' })
  })
)

// Baixa o modelo em branco (conferir no Word, ajustar e subir de novo).
router.get(
  '/modelos/:id/arquivo',
  h(async (req, res) => {
    const { rows } = await db.query('SELECT arquivo, nome_original FROM modelos WHERE id = $1', [Number(req.params.id)])
    if (!rows[0]?.arquivo) return res.status(404).json({ success: false, message: 'Modelo sem arquivo' })
    res.download(absPath(rows[0].arquivo), rows[0].nome_original || 'modelo.docx')
  })
)

// Quais campos este modelo usa (e quais o sistema não conhece).
router.get(
  '/modelos/:id/campos',
  h(async (req, res) => {
    const { rows } = await db.query('SELECT arquivo FROM modelos WHERE id = $1', [Number(req.params.id)])
    if (!rows[0]) return res.status(404).json({ success: false, message: 'Modelo não encontrado' })
    if (!rows[0].arquivo) return res.json({ success: true, data: { campos: [], desconhecidos: [] } })
    const campos = camposDoModelo(await fsp.readFile(absPath(rows[0].arquivo)))
    const conhecidos = new Set(CAMPOS.map((c) => c.chave))
    res.json({
      success: true,
      data: { campos, desconhecidos: campos.filter((c) => !conhecidos.has(c)) },
    })
  })
)

// ------------------------------------------------------------- preenchimento
const CHAVE = /\{\{\s*([\w.]+)\s*\}\}/g

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

// Partes do pacote onde o texto do documento mora (o corpo e os cabeçalhos e
// rodapés — é comum o timbre da Plenno levar o nome do cliente no rodapé).
const PARTES_DE_TEXTO = /^word\/(document|header\d*|footer\d*)\.xml$/

/** Todas as chaves {{...}} citadas pelo modelo, sem repetição. */
function camposDoModelo(buffer) {
  const entradas = lerEntradas(buffer)
  if (!entradas.has('word/document.xml')) {
    throw new Error('Arquivo .docx inválido (não tem o corpo do documento)')
  }
  const achadas = new Set()
  for (const [nome, buf] of entradas) {
    if (!PARTES_DE_TEXTO.test(nome)) continue
    // O Word pode partir "{{cliente}}" em vários trechos: junta o texto do
    // parágrafo antes de procurar, senão as chaves quebradas passam batido.
    for (const [, chave] of textoDosParagrafos(buf.toString('utf8')).matchAll(CHAVE)) achadas.add(chave)
  }
  return [...achadas]
}

// Texto corrido de cada parágrafo, um por linha — só para PROCURAR chaves.
const textoDosParagrafos = (xml) =>
  (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || [])
    .map((p) => [...p.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((m) => m[1]).join(''))
    .join('\n')

const trocar = (texto, dados, faltando) =>
  texto.replace(CHAVE, (inteiro, chave) => {
    if (!(chave in dados)) {
      faltando.add(chave)
      return inteiro // deixa visível no documento: dá para ver o que faltou
    }
    return esc(dados[chave])
  })

// Preenche uma parte do documento. Em dois passos, para estragar o mínimo de
// formatação: primeiro a troca dentro de cada trecho de texto (o caso comum,
// em que a chave está inteira num pedaço só); depois, só nos parágrafos que
// AINDA têm "{{", a junção dos trechos — é quando o Word partiu a chave no
// meio (costuma acontecer se a chave foi digitada aos pedaços ou corrigida).
// Nesse segundo caso o parágrafo passa a ter a formatação do primeiro trecho.
function preencher(xml, dados, faltando) {
  const passo1 = xml.replace(
    /(<w:t[^>]*>)([\s\S]*?)(<\/w:t>)/g,
    (_m, abre, texto, fecha) => abre + trocar(texto, dados, faltando) + fecha
  )
  return passo1.replace(/<w:p[ >][\s\S]*?<\/w:p>/g, (par) => {
    if (!par.includes('{{')) return par
    const trechos = [...par.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)]
    if (trechos.length < 2) return par
    const juntado = trechos.map((m) => m[1]).join('')
    const novo = trocar(juntado, dados, faltando)
    if (novo === juntado) return par
    let primeiro = true
    return par.replace(/(<w:t[^>]*>)([\s\S]*?)(<\/w:t>)/g, (_m, _abre, _t, fecha) => {
      if (!primeiro) return `<w:t xml:space="preserve">${fecha}`
      primeiro = false
      return `<w:t xml:space="preserve">${novo}${fecha}`
    })
  })
}

/** Gera o documento a partir do modelo .docx e envia como download. */
async function gerarDeModelo(res, arquivoModelo, dados, nomeSaida) {
  const entradas = lerEntradas(await fsp.readFile(absPath(arquivoModelo)))
  const faltando = new Set()

  res.attachment(nomeSaida)
  res.type('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  const zip = archiver('zip', { zlib: { level: 6 } })
  zip.on('error', (err) => {
    console.error('[modelos]', err.message)
    res.destroy(err)
  })
  zip.pipe(res)
  for (const [nome, buf] of entradas) {
    if (PARTES_DE_TEXTO.test(nome)) zip.append(preencher(buf.toString('utf8'), dados, faltando), { name: nome })
    else zip.append(buf, { name: nome })
  }
  await zip.finalize()
  if (faltando.size) console.warn('[modelos] campos não reconhecidos: %s', [...faltando].join(', '))
}

module.exports = { router, CAMPOS, camposDoModelo, gerarDeModelo }
