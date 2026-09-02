'use strict'

// Relatório de despesas em Excel — preenche a planilha-modelo da Julia
// (backend/templates/relatorio-despesas.xlsx) com os gastos da viagem.
//
// O trabalho difícil é decidir em QUAL coluna cada gasto entra: a planilha
// separa METRO, ÔNIBUS, UBER|TÁXI, ALIMENTAÇÃO, CORREIO, TAXAS e TERCEIROS,
// enquanto o sistema guarda categorias mais largas + a descrição livre. Quem
// resolve isso é a IA do Hub, lendo descrição e categoria. Se a IA falhar (ou
// não estiver configurada), cai numa regra fixa — o relatório sempre sai.
const path = require('node:path')
const ExcelJS = require('exceljs')
const hub = require('./hub')

const MODELO = path.resolve(__dirname, '..', 'templates', 'relatorio-despesas.xlsx')

// Colunas da tabela de despesas na planilha (linha 5 é o cabeçalho).
const COL = {
  data: 'B',
  cliente: 'C',
  processo: 'D',
  metro: 'F',
  uber: 'G',
  onibus: 'H',
  aliment: 'I',
  correio: 'J',
  terceiros: 'K',
  taxas: 'L',
  obs: 'M',
}
const PRIMEIRA_LINHA = 6
const ULTIMA_LINHA = 30 // a planilha tem 25 linhas de lançamento

const COLUNAS_VALIDAS = ['metro', 'uber', 'onibus', 'aliment', 'correio', 'terceiros', 'taxas']

// Regra fixa (usada como partida e como plano B da IA).
function colunaPorRegra(despesa) {
  const texto = `${despesa.categoria} ${despesa.descricao}`.toLowerCase()
  if (/metr[oô]/.test(texto)) return 'metro'
  if (/(uber|99|t[áa]xi|taxi)/.test(texto)) return 'uber'
  if (/([ôo]nibus|rodovi|busão)/.test(texto)) return 'onibus'
  if (/(correio|sedex|postagem)/.test(texto)) return 'correio'
  if (/(taxa|tarifa|ped[áa]gio|estacionamento|cart[óo]rio|emolumento)/.test(texto)) return 'taxas'
  if (despesa.categoria === 'alimentacao') return 'aliment'
  if (despesa.categoria === 'transporte') return 'uber'
  return 'terceiros' // passagem aérea, hospedagem e outros
}

const INSTRUCOES = `Você organiza uma prestação de contas de viagem numa planilha padrão.

Para CADA despesa, escolha a coluna certa da planilha:
- "metro": metrô, trem urbano, VLT.
- "onibus": ônibus urbano ou rodoviário, van, translado rodoviário.
- "uber": Uber, 99, táxi, aplicativo de transporte, corrida particular.
- "aliment": refeições, lanche, café, água, marmita.
- "correio": correios, sedex, postagem, envio de documento.
- "taxas": taxas, tarifas, pedágio, estacionamento, cartório, emolumentos, bancárias.
- "terceiros": tudo o mais — passagem aérea, hospedagem/hotel, materiais, serviços contratados.

Escreva também uma observação curta (até 40 caracteres) para a linha, útil para quem confere: o essencial do gasto (ex.: "aeroporto → hotel", "almoço equipe", "diária 2 noites"). Não repita o valor.

Responda SÓ com JSON, uma entrada por despesa, na mesma ordem recebida:
{"linhas":[{"id":123,"coluna":"uber","observacao":"aeroporto → hotel"}]}`

// Pergunta à IA a coluna de cada despesa. Devolve Map(id → { coluna, observacao }).
async function classificar(despesas) {
  const lista = despesas
    .map((d) => `- id ${d.id} | categoria: ${d.categoria} | ${d.descricao || '(sem descrição)'} | R$ ${d.valor}`)
    .join('\n')
  const { text } = await hub.gerarTexto({
    system: INSTRUCOES,
    prompt: `Despesas da viagem:\n${lista}`,
    model: 'haiku',
  })
  const limpo = String(text || '').replace(/```(?:json)?/gi, '').trim()
  const dados = JSON.parse(limpo.slice(limpo.indexOf('{'), limpo.lastIndexOf('}') + 1))
  const mapa = new Map()
  for (const l of Array.isArray(dados.linhas) ? dados.linhas : []) {
    if (COLUNAS_VALIDAS.includes(l?.coluna)) {
      mapa.set(Number(l.id), { coluna: l.coluna, observacao: String(l.observacao || '').slice(0, 60) })
    }
  }
  return mapa
}

const dia = (iso) => (iso ? iso.split('-').reverse().join('/') : '')

// Gera o arquivo. `usarIA` liga a classificação inteligente (padrão: sim).
async function gerar({ viagem, vistorias, despesas, totais }, { usarIA = true } = {}) {
  let classificacao = new Map()
  let viaIA = false
  if (usarIA && despesas.length) {
    try {
      classificacao = await classificar(despesas)
      viaIA = classificacao.size > 0
    } catch (err) {
      console.error('[relatorio] classificação por IA falhou, usando regra fixa: %s', err.message)
    }
  }

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(MODELO)
  const ws = wb.worksheets[0]

  // Nome do cliente/unidade de cada vistoria (para a coluna CLIENTE | UNIDADE).
  const porVistoria = new Map(vistorias.map((v) => [v.id, `${v.clienteNome} | ${v.imovelNome}`]))
  const clientesDaViagem = [...new Set(vistorias.map((v) => v.clienteNome))].join(', ')

  const ordenadas = [...despesas].sort((a, b) => String(a.data || '').localeCompare(String(b.data || '')))
  const sobra = []
  let linha = PRIMEIRA_LINHA
  for (const d of ordenadas) {
    if (linha > ULTIMA_LINHA) {
      sobra.push(d)
      continue
    }
    const escolha = classificacao.get(d.id)
    const coluna = escolha?.coluna || colunaPorRegra(d)
    const obs = escolha?.observacao || d.descricao || ''

    ws.getCell(`${COL.data}${linha}`).value = dia(d.data)
    ws.getCell(`${COL.cliente}${linha}`).value = d.vistoriaId ? porVistoria.get(d.vistoriaId) || clientesDaViagem : clientesDaViagem
    ws.getCell(`${COL.processo}${linha}`).value = viagem.processo || ''
    const celula = ws.getCell(`${COL[coluna]}${linha}`)
    celula.value = Number(d.valor) || 0
    celula.numFmt = 'R$ #,##0.00'
    ws.getCell(`${COL.obs}${linha}`).value = d.temComprovante ? obs : `${obs} (sem comprovante)`.trim()
    linha++
  }

  // Rodapé: responsável, período, totais.
  const periodo =
    viagem.inicio && viagem.fim && viagem.inicio !== viagem.fim
      ? `${dia(viagem.inicio)} a ${dia(viagem.fim)}`
      : dia(viagem.inicio || viagem.fim)
  const reais = (v) => {
    const c = Number(v) || 0
    return c
  }
  ws.getCell('J35').value = viagem.responsavelNome || ''
  ws.getCell('J37').value = viagem.liderConferente || ''
  ws.getCell('J38').value = periodo || viagem.titulo || ''
  ws.getCell('J41').value = reais(totais.verba) // total antecipação = verba liberada
  ws.getCell('J42').value = reais(totais.gasto) // total despesas
  ws.getCell('J43').value = reais(viagem.retencao) // retenção p/ próxima semana
  ws.getCell('J44').value = reais(totais.verba - totais.gasto - (Number(viagem.retencao) || 0)) // saldo a restituir
  ws.getCell('J43').numFmt = ws.getCell('J41').numFmt = ws.getCell('J42').numFmt = ws.getCell('J44').numFmt = 'R$ #,##0.00'
  if (viagem.motivoRetencao) ws.getCell('M43').value = viagem.motivoRetencao

  return {
    buffer: await wb.xlsx.writeBuffer(),
    viaIA,
    lancadas: Math.min(ordenadas.length, ULTIMA_LINHA - PRIMEIRA_LINHA + 1),
    sobra: sobra.length,
  }
}

module.exports = { gerar, colunaPorRegra }
