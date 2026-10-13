'use strict'

// Leitura da planta (PDF) para sugerir os pavimentos e ambientes do imóvel.
//
// Duas etapas:
//   1. extrairTextos — tira do PDF os textos com posição (pdfjs). Plantas de CAD
//      trazem os nomes dos ambientes como texto de verdade; se o PDF for um
//      escaneamento (sem camada de texto), avisamos em vez de inventar.
//   2. sugerirEstrutura — manda esses textos ao Claude do Hub, que separa o que é
//      AMBIENTE do que é ruído (combate a incêndio, cotas, legenda, carimbo) e
//      devolve pavimentos + ambientes já nomeados e numerados.
const fs = require('node:fs')
const hub = require('./hub')

// Limite do prompt aceito pelo Hub (ele corta em 12k) — deixamos folga.
const MAX_PROMPT = 11000

async function extrairTextos(caminhoPdf, rotulo = '') {
  // pdfjs legado é ESM; import() dinâmico funciona a partir do CommonJS.
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const data = new Uint8Array(fs.readFileSync(caminhoPdf))
  const doc = await getDocument({ data, useSystemFonts: true, verbosity: 0 }).promise
  const paginas = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const conteudo = await page.getTextContent()
    const itens = []
    for (const i of conteudo.items) {
      const t = String(i.str || '').replace(/\s+/g, ' ').trim()
      if (t) itens.push({ texto: t, x: Math.round(i.transform[4]), y: Math.round(i.transform[5]) })
    }
    paginas.push({ pagina: p, arquivo: rotulo, itens })
    page.cleanup()
  }
  await doc.destroy()
  return paginas
}

// Aceita um caminho só ou a lista de pranchas [{ caminho, nome }].
async function extrairDeVarios(entrada) {
  const lista = Array.isArray(entrada) ? entrada : [{ caminho: entrada, nome: '' }]
  const paginas = []
  for (const item of lista) {
    const doArquivo = await extrairTextos(item.caminho, item.nome || '')
    paginas.push(...doArquivo)
  }
  return paginas
}

// Ruído evidente de planta de bombeiro/cotas — tirado antes de gastar tokens.
// Só o que é seguramente descartável; a decisão fina fica com a IA.
const RUIDO = [
  /^\d+([.,]\d+)?\s*(m|m²|cm|mm|m2)?$/i, // números e medidas soltas
  /^[-–—.,;:()/\\|]+$/,
  /^\d+[A-Z]-\d+[A-Z]{1,3}$/i, // extintores: 2A-20BC
  /^(HI|HE|CX|EXT|FG|IT|UP|PMU|ESG|TUB|MANG)[\s.\-–]/i,
  /^(SAÍDA|SAIDA)$/i,
  /(corrimão|corrimao|guarda[- ]?corpo|acionador|avisador|sirene|extintor|hidrante|mangueira|alarme|sprinkler|iluminação de emerg|sinalização de emerg)/i,
  /(esc\.|escala|1\s*:\s*\d+|matrícula|matricula|logradouro|prancha|carimbo|responsável técnico)/i,
  // Siglas curtas SÓ isoladas: dentro de palavra elas casariam por engano
  // (ex.: "crea" dentro de "reCREAção" descartava "Espaço para Recreação").
  /\b(crea|cau|art|rrt)\b/i,
  /^(A|B|C|D|N|N=|S|L|O|²|º|°)$/i,
  /^\d+\s*(alunos?|pessoas?|lugares?)$/i, // lotação, não é nome de ambiente
  /^A\s*=\s*[\d.,]+\s*m/i, // A=52,15m²
  /^(rua|avenida|av\.|travessa|alameda|estrada|rodovia|praça)\b/i, // endereços do entorno
  /^vai para\b/i, // "VAI PARA PAVIMENTO SUPERIOR" é ligação, não ambiente
]

// Siglas que a IA costuma expandir — sem isto elas reapareceriam como "não
// usadas" e a Julia poderia cadastrar o mesmo ambiente duas vezes.
const ALIAS = {
  DML: 'DEPOSITODEMATERIALDELIMPEZA',
  WC: 'BANHEIRO',
  PNE: 'BANHEIROPNE',
  SANITARIO: 'BANHEIRO',
  COZ: 'COZINHA',
  CIRC: 'CIRCULACAO',
  DEP: 'DEPOSITO',
  REC: 'RECEPCAO',
  ADM: 'ADMINISTRACAO',
  VEST: 'VESTIARIO',
}

const ehRuido = (t) => RUIDO.some((r) => r.test(t))

// Agrupa textos iguais mantendo quantas vezes aparecem e onde (a IA usa a
// contagem para numerar repetições e a posição para ordenar espacialmente).
function compactar(paginas, { filtrarRuido = true } = {}) {
  return paginas.map(({ pagina, arquivo, itens }) => {
    const mapa = new Map()
    for (const it of itens) {
      if (it.texto.length > 60 || (filtrarRuido && ehRuido(it.texto))) continue
      const chave = it.texto.toUpperCase()
      if (!mapa.has(chave)) mapa.set(chave, { texto: it.texto, pos: [] })
      const reg = mapa.get(chave)
      if (reg.pos.length < 12) reg.pos.push([it.x, it.y])
    }
    return { pagina, arquivo, textos: [...mapa.values()] }
  })
}

// Monta o texto que vai ao Claude. Com várias pranchas, o corte é feito por
// página (cota igual para cada uma) — cortar o final jogaria fora pranchas
// inteiras, que é justamente onde estão os outros pavimentos.
function montarPrompt(paginasCompactas) {
  const cota = Math.max(800, Math.floor(MAX_PROMPT / Math.max(1, paginasCompactas.length)))
  const blocos = []
  for (const { pagina, arquivo, textos } of paginasCompactas) {
    const cabecalho = `### ${arquivo ? `Prancha "${arquivo}" — página ${pagina}` : `Página ${pagina}`}`
    const linhas = []
    let tamanho = cabecalho.length
    for (const t of textos) {
      const n = t.pos.length
      const linha = `- "${t.texto}"${n > 1 ? ` (${n}x)` : ''} @ ${t.pos.map(([x, y]) => `${x},${y}`).join(' ')}`
      if (tamanho + linha.length > cota) {
        linhas.push('…(lista truncada nesta página)')
        break
      }
      linhas.push(linha)
      tamanho += linha.length + 1
    }
    blocos.push([cabecalho, ...linhas].join('\n'))
  }
  return blocos.join('\n')
}

const INSTRUCOES = `Você lê plantas arquitetônicas e monta a lista de PAVIMENTOS e AMBIENTES para uma vistoria fotográfica.

Recebe os textos extraídos do PDF com a posição de cada um (x,y em pontos; y MAIOR = mais ACIMA na folha).

O QUE INTERESSA: só os nomes dos ambientes/cômodos e a que pavimento pertencem.

IGNORE COMPLETAMENTE (não vire ambiente):
- combate a incêndio e emergência: extintores, hidrantes, mangueiras, acionador, sirene, alarme, saída/rota de emergência, iluminação e sinalização de emergência, corrimão, guarda-corpo, placas;
- cotas, áreas (m²), escalas, níveis, lotação ("40 Alunos"), cálculos e memoriais;
- endereços, ruas, matrículas, dados do terreno, carimbo, legendas, títulos de prancha e nomes de projeto.

PRINCÍPIO: nesta planta TODO ambiente é nomeado. Se um texto nomeia um espaço, ele É um ambiente — inclusive quando já vem numerado ("SALA 01", "SALA 2", "QUARTO 03"). Prefira incluir a deixar de fora: esquecer um ambiente faz a vistoria perder o cômodo.

REGRAS:
1. Pavimento: use os títulos da planta ("PLANTA BAIXA - TÉRREO", "PAVIMENTO SUPERIOR", "COBERTURA", "SUBSOLO", "MEZANINO"). Cada prancha/página costuma trazer UM pavimento — se vierem várias, devolva um item por pavimento encontrado, sem misturar os ambientes de um com os do outro. Se não houver indicação, use "Pavimento único". Não invente pavimento a partir de setas como "VAI PARA PAVIMENTO SUPERIOR" — isso só indica ligação, não é a planta dele.
2. Ambientes repetidos: crie um por ocorrência e acrescente 1, 2, 3… ao fim do nome — "Sala de Aula 1" … "Sala de Aula 8" (a marca "(8x)" indica 8 ocorrências). Nomes que já vêm numerados na planta ("SALA 01" e "SALA 02") são ambientes diferentes: mantenha o número original e não renumere.
3. Ordene os ambientes de cada pavimento de forma espacialmente coerente: de cima para baixo (y decrescente) e da esquerda para a direita (x crescente).
4. Nomes em Português, Title Case, sem siglas cruas. Expanda o que for claro: "W.C." → "Banheiro", "P.N.E." → "Banheiro PNE", "D.M.L." → "Depósito de Material de Limpeza", "COZ." → "Cozinha", "CIRC." → "Circulação". Mantenha nomes próprios ("Sala Google", "Anfiteatro 01").
5. TODA etiqueta que dá nome a um espaço é ambiente — inclusive pátios, áreas de recreação, quadras, varandas, circulações, halls e áreas externas cobertas. Não descarte uma etiqueta só porque ao lado dela há área ("A=52,15m²"), lotação ("36 Alunos") ou uma observação entre parênteses: use apenas o nome do espaço.
6. Não invente ambiente que não esteja escrito na planta.
7. Antes de responder, confira item a item: todo texto que nomeia um espaço precisa ter virado ambiente (na quantidade certa de ocorrências), e nada de incêndio/cota/legenda pode ter entrado.

EXEMPLO de como tratar as ocorrências:
  - "SALA DE AULA" (3x) → "Sala de Aula 1", "Sala de Aula 2", "Sala de Aula 3"
  - "ESPAÇO PARA RECREAÇÃO" (2x) → "Espaço para Recreação 1", "Espaço para Recreação 2"
  - "SALA 01" (1x) e "SALA 02" (1x) → "Sala 01" e "Sala 02" (já vêm numeradas)
  - "W.C." (2x) → "Banheiro 1", "Banheiro 2"
  - "2A-20BC", "HI-05", "SAÍDA", "40 Alunos", "A=52,15m²" → nada (ruído)

RESPONDA SÓ COM O JSON, sem comentários e sem cercas de código:
{"pavimentos":[{"nome":"Térreo","ambientes":["Sala de Aula 01","Cozinha"]}],"observacoes":"o que ficou em dúvida, em uma frase"}`

// A IA quase sempre devolve JSON limpo, mas às vezes escapa uma vírgula ou uma
// cerca de código. Como isto é ferramenta de trabalho, tentamos consertar o que
// é claramente reparável antes de desistir (e há uma segunda tentativa acima).
function extrairJson(texto) {
  const limpo = String(texto || '')
    .replace(/```(?:json)?/gi, '')
    .trim()
  const ini = limpo.indexOf('{')
  const fim = limpo.lastIndexOf('}')
  if (ini < 0 || fim <= ini) throw Object.assign(new Error('A IA não devolveu um JSON'), { status: 502 })
  const bruto = limpo.slice(ini, fim + 1)
  try {
    return JSON.parse(bruto)
  } catch {
    const reparado = bruto
      .replace(/,\s*([}\]])/g, '$1') // vírgula sobrando antes de fechar
      .replace(/"\s*\n\s*"/g, '", "') // itens de lista sem a vírgula
      .replace(/([}\]"])\s*\n\s*"/g, '$1, "')
    return JSON.parse(reparado) // se ainda falhar, quem chamou tenta de novo
  }
}

// Lê a planta e devolve { pavimentos: [{ nome, ambientes: [] }], observacoes }.
async function sugerirEstrutura(entrada, { model } = {}) {
  const paginas = await extrairDeVarios(entrada)
  const totalTextos = paginas.reduce((s, p) => s + p.itens.length, 0)
  if (totalTextos < 5) {
    throw Object.assign(
      new Error(
        'Esta planta não tem texto para ler: ou é um escaneamento/imagem, ou o CAD exportou o PDF com as fontes convertidas em curvas. Peça ao projetista o PDF com texto pesquisável, ou cadastre os ambientes manualmente.'
      ),
      { status: 422 }
    )
  }

  const compactas = compactar(paginas)
  const prompt = montarPrompt(compactas)

  // Duas tentativas: se a resposta vier fora do formato, pede de novo reforçando
  // o JSON (falha de formatação não pode custar a leitura da planta inteira).
  let dados = null
  let ultimoErro = null
  for (let tentativa = 1; tentativa <= 2 && !dados; tentativa++) {
    const { text } = await hub.gerarTexto({
      system: tentativa === 1 ? INSTRUCOES : `${INSTRUCOES}\n\nATENÇÃO: a resposta anterior veio fora do formato. Devolva APENAS o objeto JSON, em uma única linha, com todas as vírgulas corretas.`,
      prompt: `Textos extraídos da planta:\n\n${prompt}`,
      model: model || 'sonnet',
    })
    try {
      dados = extrairJson(text)
    } catch (err) {
      ultimoErro = err
      console.error('[planta] resposta fora do formato (tentativa %d): %s', tentativa, String(text || '').slice(0, 300))
    }
  }
  if (!dados) {
    throw Object.assign(new Error(`A IA não devolveu a lista em formato válido (${ultimoErro?.message || 'erro'}). Tente de novo.`), { status: 502 })
  }
  const pavimentos = (Array.isArray(dados.pavimentos) ? dados.pavimentos : [])
    .map((p) => ({
      nome: String(p?.nome || '').trim() || 'Pavimento único',
      ambientes: (Array.isArray(p?.ambientes) ? p.ambientes : [])
        .map((a) => String(a || '').trim())
        .filter(Boolean),
    }))
    .filter((p) => p.ambientes.length)

  // A rede de segurança olha TODOS os textos (sem o filtro de ruído aplicado ao
  // prompt): assim um engano no filtro não esconde um ambiente duas vezes.
  let sobraram = naoAproveitados(compactar(paginas, { filtrarRuido: false }), pavimentos)

  // Segunda passada: a primeira leitura às vezes esquece ambientes. Aqui a IA
  // olha SÓ o que sobrou e diz o que ainda é ambiente — barato e é o que mais
  // melhora a completude ("faltaram ambientes" era a queixa principal).
  if (sobraram.length && pavimentos.length) {
    const resgatados = await resgatar(sobraram, pavimentos, model)
    if (resgatados.length) {
      const alvo = pavimentos.reduce((a, b) => (b.ambientes.length > a.ambientes.length ? b : a))
      const jaTem = new Set(pavimentos.flatMap((p) => p.ambientes.map(chaveComparacao)))
      for (const nome of resgatados) {
        if (jaTem.has(chaveComparacao(nome))) continue
        alvo.ambientes.push(nome)
        jaTem.add(chaveComparacao(nome))
      }
      const usadosAgora = new Set(resgatados.map(chaveComparacao))
      sobraram = sobraram.filter((t) => !usadosAgora.has(chaveComparacao(t.texto)))
    }
  }

  return {
    pavimentos,
    ignorados: sobraram,
    observacoes: String(dados.observacoes || '').trim(),
    paginas: paginas.length,
    textosLidos: totalTextos,
    // "01/05" no carimbo = este PDF é uma prancha de um conjunto; os outros
    // pavimentos estão nas demais. Sem este aviso, parece que a leitura falhou.
    prancha: detectarPrancha(paginas),
  }
}

// Junta as marcas "01/05" de todas as pranchas lidas → quantas do conjunto já
// temos e quantas faltam.
function detectarPrancha(paginas) {
  let total = 0
  const presentes = new Set()
  for (const { itens } of paginas) {
    for (const it of itens) {
      const m = /^(\d{1,2})\s*\/\s*(\d{1,2})$/.exec(it.texto)
      if (m && Number(m[2]) > 1 && Number(m[1]) <= Number(m[2])) {
        total = Math.max(total, Number(m[2]))
        presentes.add(Number(m[1]))
      }
    }
  }
  return total ? { total, presentes: [...presentes].sort((a, b) => a - b) } : null
}

// Pergunta à IA quais dos textos restantes são ambientes de verdade. Conservador
// por construção: só entra o que for claramente nome de espaço.
async function resgatar(sobraram, pavimentos, model) {
  const lista = sobraram
    .slice(0, 40)
    .map((t) => `- "${t.texto}"${t.ocorrencias > 1 ? ` (${t.ocorrencias}x)` : ''}`)
    .join('\n')
  const jaListados = pavimentos
    .flatMap((p) => p.ambientes)
    .slice(0, 60)
    .join(', ')
  const system = `Você revisa a leitura de uma planta arquitetônica. Já foram identificados estes ambientes: ${jaListados}.
Abaixo vêm os textos que SOBRARAM. Diga quais deles são, também, nomes de ambiente/cômodo que ficaram de fora.

NÃO são ambientes: itens de incêndio (extintor, hidrante, mangueira, acionador, sirene, alarme, abrigo, saída/rota de emergência), corrimão e guarda-corpo, cotas e áreas, escalas, níveis, lotação, textos de cálculo e memorial, ruas e endereços, legendas, carimbo, nomes de projeto e observações soltas ("caminhamento da", "manual", "PORTANTO OK!").
SÃO ambientes: qualquer etiqueta que nomeia um espaço — sala, quarto, cozinha, depósito, copa, hall, circulação, pátio, área de recreação, quadra, vestiário, refeitório, secretaria, biblioteca, laboratório, almoxarifado, guarita, garagem, varanda, escada nomeada.

Se o mesmo nome aparecer N vezes, gere N nomes acrescentando 1, 2, 3 ao final.
Na dúvida sobre um texto ambíguo, NÃO inclua.

Responda só com JSON: {"ambientes":["Nome 1","Nome 2"]} — use Title Case em Português. Se nenhum for ambiente, responda {"ambientes":[]}.`
  try {
    const { text } = await hub.gerarTexto({ system, prompt: `Textos que sobraram:\n${lista}`, model: model || 'sonnet' })
    const dados = extrairJson(text)
    return (Array.isArray(dados.ambientes) ? dados.ambientes : [])
      .map((a) => String(a || '').trim())
      .filter(Boolean)
      .slice(0, 40)
  } catch (err) {
    // Passada opcional: se falhar, a leitura principal continua valendo.
    console.error('[planta] resgate falhou: %s', err.message)
    return []
  }
}

// Rede de segurança: textos que PARECEM nome de ambiente e que a IA não usou.
// A IA erra por omissão às vezes; em vez de perder o ambiente calada, a tela
// mostra esses textos para a Julia promover com um clique.
const chaveComparacao = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .replace(/\d+$/, '') // "SALADEAULA01" → "SALADEAULA"

// Cara de etiqueta de ambiente: tem letras, não é frase longa nem nota técnica.
// ATENÇÃO: nomes numerados ("SALA 01", "QUARTO 2") são o padrão das plantas da
// Julia — não podem ser descartados por conterem dígitos.
function pareceAmbiente(t) {
  if (t.length < 3 || t.length > 40) return false
  const letras = (t.match(/[A-Za-zÀ-ÿ]/g) || []).length
  const digitos = (t.match(/\d/g) || []).length
  if (letras < 3) return false
  if (digitos > letras) return false // código/medida, não nome
  if (/\d{4,}/.test(t)) return false // 1.750,91 · matrícula · população
  if (t.split(/\s+/).length > 5) return false // frase, não etiqueta
  if (/^\(|\)$/.test(t.trim())) return false // "(área coberta)"
  return !ehRuido(t)
}

function naoAproveitados(paginasCompactas, pavimentos) {
  const usados = new Set()
  for (const p of pavimentos) {
    usados.add(chaveComparacao(p.nome))
    for (const a of p.ambientes) usados.add(chaveComparacao(a))
  }
  const fora = []
  for (const { textos } of paginasCompactas) {
    for (const t of textos) {
      if (!pareceAmbiente(t.texto)) continue
      const chave = chaveComparacao(t.texto)
      if (!chave) continue
      const variantes = [chave, ALIAS[chave]].filter(Boolean)
      // Considera usado por igualdade, por sigla conhecida ou por conter/estar contido.
      if (variantes.some((v) => usados.has(v) || [...usados].some((u) => u.includes(v) || v.includes(u)))) continue
      fora.push({ texto: t.texto, ocorrencias: t.pos.length })
    }
  }
  return fora.slice(0, 40)
}

// ─────────────────────────────────────────────────────────────────────────────
// Leitura em segundo plano.
//
// A leitura leva de 30 s a 1,5 min (extração + IA) e NENHUM proxy aguenta isso:
// o do Next corta em 30 s e devolve 500; o túnel público, em ~100 s. Por isso a
// tela dispara a leitura, recebe um número na hora e depois pergunta o resultado.
// Como bônus, dá para recarregar a página no meio sem perder a leitura.
const leituras = new Map()
let proximaLeitura = 1
const VALIDADE_MS = 15 * 60 * 1000

function limparAntigas() {
  const agora = Date.now()
  for (const [id, l] of leituras) {
    if (l.status !== 'processando' && agora - l.fim > VALIDADE_MS) leituras.delete(id)
  }
}

// Começa (ou reaproveita) a leitura de um imóvel e devolve o id para consulta.
function iniciarLeitura(imovelId, entrada, opcoes = {}) {
  limparAntigas()
  for (const [id, l] of leituras) {
    if (l.imovelId === imovelId && l.status === 'processando' && !!l.visual === !!opcoes.visual) return id
  }
  const id = proximaLeitura++
  const registro = { imovelId, visual: !!opcoes.visual, status: 'processando', inicio: Date.now(), fim: 0, dados: null, mensagem: '' }
  leituras.set(id, registro)
  // Leitura VISUAL (planta escaneada / fontes em curvas): as pranchas viram
  // imagem e vão ao Claude com visão — mesmo formato de resposta.
  const trabalho = opcoes.visual
    ? require('./planta-pinos').sugerirPorVisao(imovelId, entrada, opcoes)
    : sugerirEstrutura(entrada, opcoes)
  trabalho
    .then((dados) => Object.assign(registro, { status: 'ok', dados, fim: Date.now() }))
    .catch((err) => {
      console.error('[planta] leitura %d falhou: %s', id, err.message)
      Object.assign(registro, { status: 'erro', mensagem: err.message, fim: Date.now() })
    })
  return id
}

function consultarLeitura(id) {
  const l = leituras.get(Number(id))
  if (!l) return null
  return {
    status: l.status,
    segundos: Math.round(((l.fim || Date.now()) - l.inicio) / 1000),
    dados: l.dados,
    mensagem: l.mensagem,
  }
}

module.exports = { extrairTextos, sugerirEstrutura, iniciarLeitura, consultarLeitura }
