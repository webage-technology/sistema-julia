'use strict'

// Importação de fatura do cartão / extrato / relatório da Uber.
//
// Por que é assim: não existe (e não deveria existir) acesso automático à conta
// do banco ou da Uber com a senha da Julia. O caminho honesto é o arquivo que
// eles próprios fornecem — fatura em PDF/CSV/OFX do banco, relatório de viagens
// da Uber Empresas em CSV. O sistema lê, a IA separa os lançamentos, a Julia
// confere e vira despesa com a fatura anexada como comprovante.
const fs = require('node:fs')
const db = require('./db')
const hub = require('./hub')
const { absPath } = require('./uploads')

const MAX_TEXTO = 11000

// --------------------------------------------------------------- extração
async function textoDoArquivo(caminho) {
  if (/\.pdf$/i.test(caminho)) {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const doc = await getDocument({ data: new Uint8Array(fs.readFileSync(caminho)), useSystemFonts: true, verbosity: 0 })
      .promise
    const linhas = []
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p)
      const itens = (await page.getTextContent()).items
      // Reagrupa por linha (mesmo Y) — na fatura, data, descrição e valor ficam
      // na mesma linha, e sem isso viram pedaços soltos.
      const porLinha = new Map()
      for (const i of itens) {
        const t = String(i.str || '').trim()
        if (!t) continue
        const y = Math.round(i.transform[5])
        const lista = porLinha.get(y) || []
        lista.push({ x: i.transform[4], t })
        porLinha.set(y, lista)
      }
      for (const y of [...porLinha.keys()].sort((a, b) => b - a)) {
        linhas.push(
          porLinha
            .get(y)
            .sort((a, b) => a.x - b.x)
            .map((i) => i.t)
            .join(' ')
        )
      }
      page.cleanup()
    }
    await doc.destroy()
    return linhas.join('\n')
  }
  // CSV, OFX e TXT são texto puro.
  return fs.readFileSync(caminho, 'utf8')
}

// Fica só com as linhas que parecem lançamento (têm valor em dinheiro).
function linhasComValor(texto) {
  const linhas = String(texto || '')
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  const comValor = linhas.filter((l) => /\d+[.,]\d{2}\b/.test(l) && l.length < 200)
  const escolhidas = comValor.length >= 3 ? comValor : linhas
  let saida = escolhidas.join('\n')
  if (saida.length > MAX_TEXTO) saida = saida.slice(0, MAX_TEXTO) + '\n…(cortado)'
  return saida
}

const INSTRUCOES = `Você lê faturas de cartão, extratos bancários e relatórios de corridas (Uber) e devolve os lançamentos em formato estruturado.

Para cada lançamento encontrado, extraia:
- "data": no formato AAAA-MM-DD (use o ano informado no contexto quando a linha trouxer só dia/mês);
- "descricao": o estabelecimento/serviço, limpo (sem códigos, sem "*", sem número de parcela solto);
- "valor": número com ponto decimal, sempre positivo;
- "categoria": uma de "passagem" (aéreo/rodoviário), "hospedagem" (hotel/pousada/airbnb), "transporte" (uber, 99, táxi, metrô, ônibus urbano, estacionamento, pedágio, combustível), "alimentacao" (restaurante, lanchonete, mercado, padaria), "outro".

IGNORE: saldo anterior, total da fatura, limites, encargos, juros, IOF, anuidade, pagamentos recebidos, estornos e qualquer linha que não seja uma compra.
Se a linha for parcelada, use o valor da parcela cobrada.

Responda SÓ com JSON:
{"lancamentos":[{"data":"2026-09-10","descricao":"Uber trip","valor":68.9,"categoria":"transporte"}]}`

function extrairJson(texto) {
  const limpo = String(texto || '').replace(/```(?:json)?/gi, '').trim()
  const ini = limpo.indexOf('{')
  const fim = limpo.lastIndexOf('}')
  if (ini < 0 || fim <= ini) throw Object.assign(new Error('A IA não devolveu um JSON'), { status: 502 })
  try {
    return JSON.parse(limpo.slice(ini, fim + 1))
  } catch {
    return JSON.parse(limpo.slice(ini, fim + 1).replace(/,\s*([}\]])/g, '$1'))
  }
}

// Lê o arquivo e devolve os lançamentos, já marcando os que parecem repetidos
// de despesas que a viagem já tem (mesma data e mesmo valor).
async function analisar(caminho, { viagemId, periodo } = {}) {
  const texto = await textoDoArquivo(caminho)
  const corpo = linhasComValor(texto)
  if (corpo.length < 20) {
    throw Object.assign(
      new Error('Não consegui ler lançamentos neste arquivo. Se for um PDF escaneado, exporte a fatura em CSV/OFX.'),
      { status: 422 }
    )
  }

  const contexto = periodo ? `Período da viagem: ${periodo}. Use este ano nas datas sem ano.\n\n` : ''
  const { text } = await hub.gerarTexto({
    system: INSTRUCOES,
    prompt: `${contexto}Conteúdo do arquivo:\n${corpo}`,
    model: 'sonnet',
  })
  const dados = extrairJson(text)

  const jaExistem = viagemId
    ? (await db.query("SELECT to_char(data,'YYYY-MM-DD') AS data, valor::float8 AS valor FROM despesas WHERE viagem_id = $1", [viagemId])).rows
    : []
  const chave = (d, v) => `${d}|${Number(v).toFixed(2)}`
  const existentes = new Set(jaExistem.map((d) => chave(d.data, d.valor)))

  const lancamentos = (Array.isArray(dados.lancamentos) ? dados.lancamentos : [])
    .map((l, i) => ({
      indice: i,
      data: /^\d{4}-\d{2}-\d{2}$/.test(String(l?.data || '')) ? l.data : null,
      descricao: String(l?.descricao || '').trim().slice(0, 120),
      valor: Math.abs(Number(String(l?.valor).replace(',', '.'))) || 0,
      categoria: ['passagem', 'hospedagem', 'transporte', 'alimentacao', 'outro'].includes(l?.categoria)
        ? l.categoria
        : 'outro',
    }))
    .filter((l) => l.valor > 0 && l.descricao)
    .map((l) => ({ ...l, repetido: existentes.has(chave(l.data, l.valor)) }))

  return {
    lancamentos,
    total: lancamentos.reduce((s, l) => s + l.valor, 0),
    repetidos: lancamentos.filter((l) => l.repetido).length,
  }
}

// ------------------------------------- leitura em segundo plano (como a planta)
const leituras = new Map()
let proxima = 1
const VALIDADE_MS = 30 * 60 * 1000

function iniciar(viagemId, caminho, opcoes = {}) {
  const agora = Date.now()
  for (const [id, l] of leituras) if (l.status !== 'processando' && agora - l.fim > VALIDADE_MS) leituras.delete(id)
  const id = proxima++
  const reg = { viagemId, arquivo: caminho, status: 'processando', inicio: agora, fim: 0, dados: null, mensagem: '' }
  leituras.set(id, reg)
  analisar(caminho, { viagemId, ...opcoes })
    .then((dados) => Object.assign(reg, { status: 'ok', dados, fim: Date.now() }))
    .catch((err) => {
      console.error('[fatura] leitura %d falhou: %s', id, err.message)
      Object.assign(reg, { status: 'erro', mensagem: err.message, fim: Date.now() })
    })
  return id
}

function consultar(id) {
  const l = leituras.get(Number(id))
  if (!l) return null
  return {
    status: l.status,
    segundos: Math.round(((l.fim || Date.now()) - l.inicio) / 1000),
    dados: l.dados,
    mensagem: l.mensagem,
    arquivo: l.arquivo,
  }
}

module.exports = { analisar, iniciar, consultar, textoDoArquivo }
