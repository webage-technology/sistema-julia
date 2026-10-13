'use strict'

// Laudo em PDF gerado no servidor — o documento que se protocola.
//
// Um só gerador para todos os modelos: o que muda entre EVTL, LIP, fotográfico,
// bombeiro, as-built e regularização é QUAIS seções entram. Capa com o timbre
// do escritório, identificação do imóvel e do cliente, textos padrão do tipo de
// serviço, as seções do modelo (divergências, não conformidades, checklist,
// quadro de áreas, registro fotográfico), conclusão e responsabilidade técnica
// com assinatura. Rodapé com número, versão e "página X de Y".
//
// pdfkit usa as fontes padrão (Helvetica), que cobrem o português; caracteres
// fora do WinAnsi (setas, ticks) são trocados antes de escrever.
const fs = require('node:fs')
const PDFDocument = require('pdfkit')
const sharp = require('sharp')
const db = require('./db')
const { absPath, variantes } = require('./uploads')
const { quadroDeAreas } = require('./areas')
const escritorioMod = require('./escritorio')

const MODELOS = {
  evtl: { label: 'EVTL — Estudo de Viabilidade Técnica e Legal', prefixo: 'EVTL', titulo: 'ESTUDO DE VIABILIDADE TÉCNICA E LEGAL', tipo: 'EVTL — Estudo de Viabilidade Técnica e Legal' },
  lip: { label: 'LIP — Laudo de Inspeção Predial', prefixo: 'LIP', titulo: 'LAUDO DE INSPEÇÃO PREDIAL', tipo: 'LIP — Laudo de Inspeção Predial' },
  fotografico: { label: 'Relatório fotográfico', prefixo: 'RF', titulo: 'RELATÓRIO FOTOGRÁFICO', tipo: '' },
  bombeiro: { label: 'Laudo técnico de segurança contra incêndio', prefixo: 'LTI', titulo: 'LAUDO TÉCNICO DE SEGURANÇA CONTRA INCÊNDIO', tipo: 'Laudo de bombeiro' },
  asbuilt: { label: 'Levantamento cadastral (as-built)', prefixo: 'ASB', titulo: 'LEVANTAMENTO CADASTRAL — AS-BUILT', tipo: 'As-built' },
  regularizacao: { label: 'Laudo técnico para regularização', prefixo: 'REG', titulo: 'LAUDO TÉCNICO PARA REGULARIZAÇÃO', tipo: 'Regularização' },
}

const A4 = { largura: 595.28, altura: 841.89 }
const MARGEM = 50

const limpar = (s) =>
  String(s ?? '')
    .replace(/→/g, '->')
    .replace(/←/g, '<-')
    .replace(/[✓✔]/g, 'OK')
    .replace(/[✗✘]/g, 'X')
    .replace(/≥/g, '>=')
    .replace(/≤/g, '<=')
    .replace(/−/g, '-')
    .replace(/ | | /g, ' ')

const dia = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '')
const dataHora = (d) => (d ? new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '')
const m2 = (n) => (n == null ? '' : `${Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m²`)
const reais = (n) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const mascaraDoc = (d) => {
  const n = String(d || '').replace(/\D/g, '')
  if (n.length === 11) return n.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  if (n.length === 14) return n.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
  return n
}

const GRAU_LABEL = { critico: 'Crítico', regular: 'Regular', minimo: 'Mínimo' }
const PRAZO_LABEL = { imediato: 'Imediato', curto: 'Curto prazo', medio: 'Médio prazo', longo: 'Longo prazo' }
const RESULTADO_LABEL = { conforme: 'Conforme', nao_conforme: 'Não conforme', nao_aplicavel: 'Não se aplica', pendente: 'Não verificado' }
const ORGAO_LABEL = { prefeitura: 'Prefeitura', bombeiros: 'Corpo de Bombeiros', cartorio: 'Cartório', cetesb: 'CETESB', vigilancia: 'Vigilância Sanitária', condominio: 'Condomínio', outro: 'Outro' }

// ------------------------------------------------------------------ dados
async function coletar(vistoriaId, opcoes = {}) {
  const v = await db.query(
    `SELECT v.id, v.tipo_servico AS "tipoServico", to_char(v.data_vistoria, 'YYYY-MM-DD') AS "dataVistoria", v.participantes,
      v.status, v.processo_id AS "processoId", pr.numero AS "processoNumero", pr.titulo AS "processoTitulo", pr.tipo AS "processoTipo",
      i.id AS "imovelId", i.nome AS "imovelNome", i.endereco, i.matricula, i.cartorio, i.inscricao, i.lote, i.quadra, i.zoneamento, i.uso,
      i.area_terreno::float8 AS "areaTerreno", i.area_aprovada::float8 AS "areaAprovada", i.area_iptu::float8 AS "areaIptu",
      i.municipio, i.uf, i.cep, i.latitude, i.longitude,
      ${db.CLIENTE_NOME} AS "clienteNome", c.documento AS "clienteDocumento", c.email AS "clienteEmail", c.phone AS "clienteTelefone",
      c.endereco AS "clienteEndereco",
      u.id AS "responsavelId", u.name AS "responsavelNome", u.titulo AS "responsavelTitulo", u.registro AS "responsavelRegistro",
      u.assinatura AS "responsavelAssinatura", u.email AS "responsavelEmail"
     FROM vistorias v JOIN imoveis i ON i.id = v.imovel_id JOIN clients c ON c.id = i.client_id
     LEFT JOIN users u ON u.id = v.responsavel_id LEFT JOIN processos pr ON pr.id = v.processo_id
     WHERE v.id = $1`,
    [vistoriaId]
  )
  if (!v.rowCount) return null
  const vistoria = v.rows[0]
  const [pavs, ambs, fotos, divergencias, ncs, checklist, rrts, textos, escritorio, protocolos] = await Promise.all([
    db.query('SELECT id, nome, ordem FROM pavimentos WHERE vistoria_id = $1 ORDER BY ordem, id', [vistoriaId]),
    db.query(
      `SELECT a.id, a.pavimento_id AS "pavimentoId", a.nome, a.ordem, a.origem, a.situacao, a.nota, a.medidas,
        a.comprimento::float8 AS comprimento, a.largura::float8 AS largura, a.pe_direito::float8 AS "peDireito", a.area::float8 AS area
       FROM ambientes a JOIN pavimentos p ON p.id = a.pavimento_id WHERE p.vistoria_id = $1 ORDER BY p.ordem, p.id, a.ordem, a.id`,
      [vistoriaId]
    ),
    db.query(
      `SELECT f.id, f.arquivo, f.ambiente_id AS "ambienteId", f.claquete, f.destaque, f.lip, f.legenda, f.capturada_em AS "capturadaEm",
        f.latitude, f.longitude, row_number() OVER (ORDER BY f.capturada_em NULLS LAST, f.id)::int AS ordem
       FROM fotos f WHERE f.vistoria_id = $1 ORDER BY f.capturada_em NULLS LAST, f.id`,
      [vistoriaId]
    ),
    db.query(
      `SELECT d.id, d.titulo, d.descricao, d.foto_planta_id AS "fotoPlantaId", d.foto_atual_id AS "fotoAtualId", a.nome AS "ambienteNome", p.nome AS "pavimentoNome"
       FROM divergencias d LEFT JOIN ambientes a ON a.id = d.ambiente_id LEFT JOIN pavimentos p ON p.id = a.pavimento_id
       WHERE d.vistoria_id = $1 ORDER BY d.ordem, d.id`,
      [vistoriaId]
    ),
    db.query(
      `SELECT n.id, n.titulo, n.anomalia, n.grau, n.descricao, n.recomendacao, n.prazo, n.foto_id AS "fotoId", a.nome AS "ambienteNome", p.nome AS "pavimentoNome"
       FROM nao_conformidades n LEFT JOIN ambientes a ON a.id = n.ambiente_id LEFT JOIN pavimentos p ON p.id = a.pavimento_id
       WHERE n.vistoria_id = $1 ORDER BY array_position(ARRAY['critico','regular','minimo'], n.grau), n.ordem, n.id`,
      [vistoriaId]
    ),
    db.query(
      `SELECT ci.id, ci.nome, ci.resultado, ci.observacao, ci.foto_id AS "fotoId", a.nome AS "ambienteNome", p.nome AS "pavimentoNome"
       FROM checklist_itens ci LEFT JOIN ambientes a ON a.id = ci.ambiente_id LEFT JOIN pavimentos p ON p.id = a.pavimento_id
       WHERE ci.vistoria_id = $1 ORDER BY ci.ambiente_id NULLS FIRST, p.ordem, a.ordem, ci.ordem, ci.id`,
      [vistoriaId]
    ),
    vistoria.processoId
      ? db.query(
          `SELECT r.tipo, r.numero, r.atividade, to_char(r.data, 'YYYY-MM-DD') AS data, r.status, u.name AS profissional, u.registro
           FROM rrts r LEFT JOIN users u ON u.id = r.user_id WHERE r.processo_id = $1 ORDER BY r.data, r.id`,
          [vistoria.processoId]
        )
      : { rows: [] },
    db.query('SELECT tipo_servico AS "tipoServico", secao, titulo, texto FROM textos_padrao ORDER BY ordem, id'),
    escritorioMod.carregar(),
    vistoria.processoId
      ? db.query(
          `SELECT orgao, tipo, numero, assunto, to_char(data, 'YYYY-MM-DD') AS data, status FROM protocolos WHERE processo_id = $1 ORDER BY data, id`,
          [vistoria.processoId]
        )
      : { rows: [] },
  ])
  const areas = await quadroDeAreas(vistoriaId)
  let selecionadas = null
  if (opcoes.relatorioId) {
    const sel = await db.query('SELECT foto_id FROM relatorio_fotos WHERE relatorio_id = $1', [Number(opcoes.relatorioId)])
    selecionadas = new Set(sel.rows.map((r) => r.foto_id))
  }
  return {
    vistoria,
    pavimentos: pavs.rows.map((p) => ({ ...p, ambientes: ambs.rows.filter((a) => a.pavimentoId === p.id) })),
    fotos: fotos.rows,
    divergencias: divergencias.rows,
    ncs: ncs.rows,
    checklist: checklist.rows,
    rrts: rrts.rows,
    protocolos: protocolos.rows,
    textos: textos.rows,
    escritorio,
    areas,
    selecionadas,
  }
}

async function imagemParaPdf(arquivo, largura = 1000) {
  const v = variantes(arquivo)
  let origem = absPath(v.web)
  if (!fs.existsSync(origem)) origem = absPath(v.orig)
  if (!fs.existsSync(origem)) return null
  try {
    return await sharp(origem, { failOn: 'none' }).rotate().resize({ width: largura, height: largura, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer()
  } catch {
    return null
  }
}

// ------------------------------------------------------------- desenho
class Laudo {
  constructor(dados, { modelo, numero, versao, opcoes, emissor }) {
    this.d = dados
    this.modelo = modelo
    this.def = MODELOS[modelo]
    this.numero = numero
    this.versao = versao
    this.opcoes = opcoes || {}
    this.emissor = emissor
    this.cor = `#${(dados.escritorio.cor || 'C00000').replace('#', '')}`
    this.doc = new PDFDocument({
      size: 'A4',
      margins: { top: MARGEM + 14, bottom: MARGEM + 10, left: MARGEM, right: MARGEM },
      bufferPages: true,
      info: { Title: `${this.def.titulo} — ${dados.vistoria.imovelNome}`, Author: dados.escritorio.nome_fantasia || 'Sistema Julia' },
    })
    this.secao = 0
    this.numeroImagem = 0
    this.cacheImg = new Map()
  }

  get largura() {
    return A4.largura - MARGEM * 2
  }
  get limite() {
    return A4.altura - MARGEM - 10
  }

  garantir(altura) {
    if (this.doc.y + altura > this.limite) this.doc.addPage()
  }

  titulo(texto) {
    this.secao += 1
    this.garantir(40)
    this.doc.moveDown(0.6)
    this.doc.font('Helvetica-Bold').fontSize(13).fillColor(this.cor).text(limpar(`${this.secao}. ${texto}`), MARGEM, this.doc.y, { width: this.largura })
    this.doc.moveTo(MARGEM, this.doc.y + 2).lineTo(MARGEM + this.largura, this.doc.y + 2).lineWidth(0.8).strokeColor(this.cor).stroke()
    this.doc.moveDown(0.5)
    this.doc.fillColor('#000000')
  }

  // `reserva` = altura que precisa caber junto com o subtítulo (a primeira
  // linha de fotos, por exemplo) — senão o título fica órfão no fim da página.
  subtitulo(texto, reserva = 24) {
    this.garantir(reserva)
    this.doc.moveDown(0.3)
    this.doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text(limpar(texto), MARGEM, this.doc.y, { width: this.largura })
    this.doc.moveDown(0.2)
  }

  paragrafo(texto, { tamanho = 10, italico = false, cor = '#000000' } = {}) {
    const t = limpar(texto).trim()
    if (!t) return
    this.doc.font(italico ? 'Helvetica-Oblique' : 'Helvetica').fontSize(tamanho).fillColor(cor)
    for (const linha of t.split(/\n+/)) {
      const altura = this.doc.heightOfString(linha, { width: this.largura, align: 'justify' })
      this.garantir(altura + 4)
      this.doc.text(linha, MARGEM, this.doc.y, { width: this.largura, align: 'justify' })
      this.doc.moveDown(0.4)
    }
    this.doc.fillColor('#000000')
  }

  // Tabela simples: colunas = [{ titulo, largura (fração), alinhar }], linhas = [[...]].
  tabela(colunas, linhas, { tamanho = 9 } = {}) {
    const doc = this.doc
    const larguras = colunas.map((c) => this.largura * c.largura)
    const cabecalho = () => {
      const y = doc.y
      doc.rect(MARGEM, y, this.largura, 16).fill(this.cor)
      doc.font('Helvetica-Bold').fontSize(tamanho).fillColor('#ffffff')
      let x = MARGEM
      colunas.forEach((c, i) => {
        doc.text(limpar(c.titulo), x + 4, y + 4, { width: larguras[i] - 8, align: c.alinhar || 'left', lineBreak: false })
        x += larguras[i]
      })
      doc.y = y + 16
      doc.fillColor('#000000')
    }
    this.garantir(40)
    cabecalho()
    doc.font('Helvetica').fontSize(tamanho)
    for (const [idx, linha] of linhas.entries()) {
      const celulas = linha.map((c) => limpar(c == null ? '' : String(c)))
      const alturas = celulas.map((c, i) => doc.heightOfString(c || ' ', { width: larguras[i] - 8 }))
      const altura = Math.max(...alturas, 10) + 6
      if (doc.y + altura > this.limite) {
        doc.addPage()
        cabecalho()
        doc.font('Helvetica').fontSize(tamanho)
      }
      const y = doc.y
      if (idx % 2 === 1) doc.rect(MARGEM, y, this.largura, altura).fill('#f3f3f3')
      doc.fillColor('#000000')
      let x = MARGEM
      celulas.forEach((c, i) => {
        doc.text(c, x + 4, y + 3, { width: larguras[i] - 8, align: colunas[i].alinhar || 'left' })
        x += larguras[i]
      })
      doc.moveTo(MARGEM, y + altura).lineTo(MARGEM + this.largura, y + altura).lineWidth(0.3).strokeColor('#cccccc').stroke()
      doc.y = y + altura
    }
    doc.moveDown(0.6)
  }

  async imagem(arquivo, largura = 1000) {
    if (!this.cacheImg.has(arquivo)) this.cacheImg.set(arquivo, await imagemParaPdf(arquivo, largura))
    return this.cacheImg.get(arquivo)
  }

  legendaFoto(f, texto) {
    this.numeroImagem += 1
    const partes = [`Imagem ${String(this.numeroImagem).padStart(2, '0')}. ${texto}`]
    const extras = []
    if (f.capturadaEm) extras.push(dataHora(f.capturadaEm))
    if (f.latitude != null && f.longitude != null) extras.push(`${Number(f.latitude).toFixed(5)}, ${Number(f.longitude).toFixed(5)}`)
    return { titulo: partes.join(''), extras: extras.join(' · '), fonte: `Fonte: ${this.opcoes.fonte || this.d.escritorio.fonte_fotos || this.d.escritorio.nome_fantasia} (${(this.d.vistoria.dataVistoria || new Date().toISOString()).slice(0, 4)}).` }
  }

  // Grade de fotos em duas colunas com legenda numerada.
  async gradeFotos(fotos, textoDe) {
    const doc = this.doc
    const gap = 12
    const w = (this.largura - gap) / 2
    const hImg = w * 0.72
    const alturaCelula = hImg + 34
    for (let i = 0; i < fotos.length; i += 2) {
      this.garantir(alturaCelula + 6)
      const y = doc.y
      for (let j = 0; j < 2 && i + j < fotos.length; j++) {
        const f = fotos[i + j]
        const x = MARGEM + j * (w + gap)
        const buf = await this.imagem(f.arquivo)
        if (buf) {
          doc.rect(x, y, w, hImg).lineWidth(0.3).strokeColor('#bbbbbb').stroke()
          doc.image(buf, x, y, { fit: [w, hImg], align: 'center', valign: 'center' })
        } else {
          doc.rect(x, y, w, hImg).fill('#eeeeee')
          doc.fillColor('#666666').font('Helvetica').fontSize(8).text('imagem indisponível', x, y + hImg / 2 - 4, { width: w, align: 'center' })
        }
        const leg = this.legendaFoto(f, textoDe(f))
        doc.fillColor('#000000').font('Helvetica-Bold').fontSize(7.5).text(limpar(leg.titulo), x, y + hImg + 3, { width: w, align: 'center', lineBreak: false })
        doc.font('Helvetica').fontSize(7).fillColor('#444444').text(limpar([leg.extras, leg.fonte].filter(Boolean).join(' · ')), x, y + hImg + 13, { width: w, align: 'center', height: 18 })
      }
      doc.y = y + alturaCelula
      doc.fillColor('#000000')
    }
    doc.moveDown(0.4)
  }

  // Par de fotos lado a lado com rótulo (planta × atual).
  async parFotos(esq, dir, rotEsq, rotDir) {
    const doc = this.doc
    const gap = 12
    const w = (this.largura - gap) / 2
    const hImg = w * 0.72
    this.garantir(hImg + 40)
    const y = doc.y
    const itens = [
      [esq, rotEsq, MARGEM],
      [dir, rotDir, MARGEM + w + gap],
    ]
    for (const [f, rotulo, x] of itens) {
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#444444').text(limpar(rotulo), x, y, { width: w, align: 'center', lineBreak: false })
      const buf = f ? await this.imagem(f.arquivo) : null
      if (buf) {
        doc.rect(x, y + 12, w, hImg).lineWidth(0.3).strokeColor('#bbbbbb').stroke()
        doc.image(buf, x, y + 12, { fit: [w, hImg], align: 'center', valign: 'center' })
      } else {
        doc.rect(x, y + 12, w, hImg).fill('#eeeeee')
        doc.fillColor('#666666').font('Helvetica').fontSize(8).text('sem foto', x, y + 12 + hImg / 2 - 4, { width: w, align: 'center' })
      }
      if (f) {
        const leg = this.legendaFoto(f, rotulo)
        doc.fillColor('#000000').font('Helvetica').fontSize(7).text(limpar(`${leg.titulo}${leg.extras ? ' · ' + leg.extras : ''}`), x, y + 14 + hImg, { width: w, align: 'center', lineBreak: false })
      }
    }
    doc.y = y + hImg + 30
    doc.fillColor('#000000')
  }

  textoPadrao(secao) {
    const tipos = [this.d.vistoria.tipoServico, this.def.tipo].filter(Boolean)
    const doTipo = this.d.textos.find((t) => t.secao === secao && tipos.some((tp) => tp.toLowerCase() === String(t.tipoServico).toLowerCase()))
    const geral = this.d.textos.find((t) => t.secao === secao && !t.tipoServico)
    return doTipo || geral || null
  }

  // ----------------------------------------------------------------- capa
  async capa() {
    const doc = this.doc
    const e = this.d.escritorio
    const v = this.d.vistoria
    doc.rect(0, 0, A4.largura, 12).fill(this.cor)
    doc.fillColor('#000000')
    let y = 70
    if (e.logo && fs.existsSync(absPath(e.logo))) {
      try {
        doc.image(absPath(e.logo), MARGEM, y, { fit: [180, 70] })
      } catch {
        /* logo inválido: segue sem */
      }
    }
    doc.font('Helvetica-Bold').fontSize(12).fillColor('#333333').text(limpar(e.nome_fantasia || 'Escritório'), MARGEM + 200, y + 4, { width: this.largura - 200, align: 'right' })
    doc.font('Helvetica').fontSize(8).fillColor('#555555')
    const linhasEsc = [e.razao_social, e.cnpj ? `CNPJ ${mascaraDoc(e.cnpj)}` : '', e.registro, e.endereco, [e.telefone, e.email, e.site].filter(Boolean).join(' · ')].filter(Boolean)
    doc.text(limpar(linhasEsc.join('\n')), MARGEM + 200, y + 22, { width: this.largura - 200, align: 'right' })

    y = 250
    doc.font('Helvetica-Bold').fontSize(22).fillColor(this.cor).text(limpar(this.def.titulo), MARGEM, y, { width: this.largura, align: 'left' })
    y = doc.y + 6
    if (this.opcoes.titulo) {
      doc.font('Helvetica').fontSize(13).fillColor('#333333').text(limpar(this.opcoes.titulo), MARGEM, y, { width: this.largura })
      y = doc.y + 6
    }
    doc.moveTo(MARGEM, y + 4).lineTo(MARGEM + 120, y + 4).lineWidth(2).strokeColor(this.cor).stroke()
    y += 26
    doc.font('Helvetica-Bold').fontSize(15).fillColor('#000000').text(limpar(v.imovelNome), MARGEM, y, { width: this.largura })
    y = doc.y + 2
    doc.font('Helvetica').fontSize(11).fillColor('#333333')
    const endereco = [v.endereco, [v.municipio, v.uf].filter(Boolean).join('/')].filter(Boolean).join(' — ')
    if (endereco) {
      doc.text(limpar(endereco), MARGEM, y, { width: this.largura })
      y = doc.y + 2
    }
    doc.text(limpar(`Cliente: ${v.clienteNome}${v.clienteDocumento ? ` (${mascaraDoc(v.clienteDocumento)})` : ''}`), MARGEM, y + 6, { width: this.largura })
    y = doc.y + 2
    doc.text(limpar(`Vistoria nº ${v.id}${v.dataVistoria ? ` realizada em ${dia(v.dataVistoria)}` : ''}${v.processoNumero ? ` · Processo ${v.processoNumero}` : ''}`), MARGEM, y, { width: this.largura })

    // Bloco inferior: número, versão, responsável e emissão.
    const yb = A4.altura - 170
    doc.rect(MARGEM, yb, this.largura, 0.8).fill('#999999')
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#000000').text(limpar(`Documento ${this.numero} · versão ${this.versao}`), MARGEM, yb + 10, { width: this.largura })
    doc.font('Helvetica').fontSize(10).fillColor('#333333')
    doc.text(limpar(`Emitido em ${new Date().toLocaleDateString('pt-BR')}${this.emissor ? ` por ${this.emissor}` : ''}`), MARGEM, doc.y + 2, { width: this.largura })
    if (v.responsavelNome) {
      doc.text(limpar(`Responsável técnico: ${v.responsavelNome}${v.responsavelTitulo ? `, ${v.responsavelTitulo}` : ''}${v.responsavelRegistro ? ` — ${v.responsavelRegistro}` : ''}`), MARGEM, doc.y + 2, { width: this.largura })
    }
    doc.addPage()
  }

  // ---------------------------------------------------------- seções comuns
  identificacao() {
    const v = this.d.vistoria
    this.titulo('IDENTIFICAÇÃO')
    const linhas = [
      ['Cliente', `${v.clienteNome}${v.clienteDocumento ? ` — ${mascaraDoc(v.clienteDocumento)}` : ''}`],
      ['Imóvel', v.imovelNome],
      ['Endereço', [v.endereco, [v.municipio, v.uf].filter(Boolean).join('/'), v.cep ? `CEP ${v.cep}` : ''].filter(Boolean).join(' — ')],
      v.matricula ? ['Matrícula', `${v.matricula}${v.cartorio ? ` — ${v.cartorio}` : ''}`] : null,
      v.inscricao ? ['Inscrição imobiliária (SQL)', v.inscricao] : null,
      v.lote || v.quadra ? ['Lote / Quadra', `${v.lote || '—'} / ${v.quadra || '—'}`] : null,
      v.zoneamento ? ['Zoneamento', v.zoneamento] : null,
      v.uso ? ['Uso', v.uso] : null,
      v.areaTerreno ? ['Área do terreno', m2(v.areaTerreno)] : null,
      v.areaAprovada ? ['Área construída aprovada', m2(v.areaAprovada)] : null,
      v.areaIptu ? ['Área construída no IPTU', m2(v.areaIptu)] : null,
      this.d.areas?.total ? ['Área construída levantada', m2(this.d.areas.total)] : null,
      ['Vistoria', `nº ${v.id}${v.dataVistoria ? ` em ${dia(v.dataVistoria)}` : ''}${v.tipoServico ? ` — ${v.tipoServico}` : ''}`],
      v.participantes ? ['Participantes', v.participantes] : null,
      v.processoNumero ? ['Processo', `${v.processoNumero} — ${v.processoTitulo}`] : null,
      v.responsavelNome ? ['Responsável técnico', `${v.responsavelNome}${v.responsavelRegistro ? ` — ${v.responsavelRegistro}` : ''}`] : null,
      ['Registro fotográfico', `${this.d.fotos.length} foto(s) em ${this.d.pavimentos.reduce((s, p) => s + p.ambientes.filter((a) => a.situacao !== 'nao_existe').length, 0)} ambiente(s)`],
    ].filter(Boolean)
    this.tabela([{ titulo: 'Campo', largura: 0.3 }, { titulo: 'Informação', largura: 0.7 }], linhas)
  }

  objetivoEMetodologia() {
    const intro = this.opcoes.introducao || this.textoPadrao('introducao')?.texto
    const met = this.opcoes.metodologia || this.textoPadrao('metodologia')?.texto
    if (intro) {
      this.titulo('OBJETIVO')
      this.paragrafo(intro)
    }
    if (met) {
      this.titulo('METODOLOGIA')
      this.paragrafo(met)
    }
  }

  quadroDeAreas() {
    const q = this.d.areas
    if (!q || !q.total) return
    this.titulo('QUADRO DE ÁREAS')
    const linhas = []
    for (const p of q.pavimentos) {
      for (const a of p.ambientes) {
        const dim = a.comprimento && a.largura ? `${a.comprimento.toFixed(2)} × ${a.largura.toFixed(2)}` : ''
        linhas.push([p.nome, a.nome, dim, a.peDireito ? `${a.peDireito.toFixed(2)}` : '', a.areaCalculada ? a.areaCalculada.toFixed(2) : '—'])
      }
      linhas.push([`${p.nome} — subtotal`, '', '', '', p.area.toFixed(2)])
    }
    linhas.push(['TOTAL LEVANTADO', '', '', '', q.total.toFixed(2)])
    this.tabela(
      [
        { titulo: 'Pavimento', largura: 0.26 },
        { titulo: 'Ambiente', largura: 0.32 },
        { titulo: 'Dimensões (m)', largura: 0.16 },
        { titulo: 'Pé-direito (m)', largura: 0.12, alinhar: 'right' },
        { titulo: 'Área (m²)', largura: 0.14, alinhar: 'right' },
      ],
      linhas
    )
    const comp = []
    if (q.imovel.areaAprovada) comp.push(`Área aprovada: ${m2(q.imovel.areaAprovada)} — diferença de ${m2(q.divergencia.aprovada.valor)} (${q.divergencia.aprovada.percentual.toFixed(1)}%).`)
    if (q.imovel.areaIptu) comp.push(`Área no IPTU: ${m2(q.imovel.areaIptu)} — diferença de ${m2(q.divergencia.iptu.valor)} (${q.divergencia.iptu.percentual.toFixed(1)}%).`)
    if (q.semMedida) comp.push(`${q.semMedida} ambiente(s) sem medida informada não entram no total.`)
    if (comp.length) this.paragrafo(comp.join(' '))
  }

  async divergencias() {
    const lista = this.d.divergencias
    const camp = this.d.pavimentos.flatMap((p) => p.ambientes.filter((a) => a.origem === 'campo' || a.situacao === 'nao_existe').map((a) => ({ ...a, pavimentoNome: p.nome })))
    if (!lista.length && !camp.length) return
    this.titulo('DIVERGÊNCIAS ENTRE O PROJETO APROVADO E O LEVANTAMENTO')
    if (camp.length) {
      this.tabela(
        [
          { titulo: 'Pavimento', largura: 0.3 },
          { titulo: 'Ambiente', largura: 0.35 },
          { titulo: 'Situação', largura: 0.35 },
        ],
        camp.map((a) => [a.pavimentoNome, a.nome, a.situacao === 'nao_existe' ? 'Consta na planta e não existe no local' : 'Existe no local e não consta na planta'])
      )
    }
    const porId = new Map(this.d.fotos.map((f) => [f.id, f]))
    for (const [i, d] of lista.entries()) {
      this.subtitulo(`${this.secao}.${i + 1} ${d.titulo || 'Divergência'}${d.ambienteNome ? ` — ${d.pavimentoNome} / ${d.ambienteNome}` : ''}`, 240)
      await this.parFotos(porId.get(d.fotoPlantaId), porId.get(d.fotoAtualId), 'Projeto aprovado', 'Situação encontrada')
      if (d.descricao) this.paragrafo(d.descricao)
    }
  }

  async naoConformidades() {
    const ncs = this.d.ncs
    if (!ncs.length) return
    this.titulo('NÃO CONFORMIDADES')
    const resumo = ['critico', 'regular', 'minimo'].map((g) => [GRAU_LABEL[g], String(ncs.filter((n) => n.grau === g).length)])
    this.tabela([{ titulo: 'Grau de risco', largura: 0.6 }, { titulo: 'Quantidade', largura: 0.4, alinhar: 'right' }], resumo)
    const porId = new Map(this.d.fotos.map((f) => [f.id, f]))
    for (const [i, n] of ncs.entries()) {
      this.subtitulo(`${this.secao}.${i + 1} ${n.titulo || n.anomalia}${n.ambienteNome ? ` — ${n.pavimentoNome} / ${n.ambienteNome}` : ''}`, 120)
      this.paragrafo(`Anomalia: ${n.anomalia} · Grau de risco: ${GRAU_LABEL[n.grau] || n.grau} · Prazo recomendado: ${PRAZO_LABEL[n.prazo] || n.prazo}`, { tamanho: 9, cor: '#444444' })
      const f = porId.get(n.fotoId)
      if (f) await this.gradeFotos([f], () => n.titulo || n.anomalia)
      if (n.descricao) this.paragrafo(n.descricao)
      if (n.recomendacao) this.paragrafo(`Recomendação: ${n.recomendacao}`, { italico: true })
    }
  }

  async checklist() {
    const itens = this.d.checklist
    if (!itens.length) return
    this.titulo('CHECKLIST DE VERIFICAÇÃO')
    const r = { conforme: 0, nao_conforme: 0, nao_aplicavel: 0, pendente: 0 }
    for (const i of itens) r[i.resultado] = (r[i.resultado] || 0) + 1
    this.paragrafo(`${itens.length} item(ns) verificado(s): ${r.conforme} conforme(s), ${r.nao_conforme} não conforme(s), ${r.nao_aplicavel} não aplicável(is), ${r.pendente} não verificado(s).`)
    this.tabela(
      [
        { titulo: 'Item', largura: 0.42 },
        { titulo: 'Ambiente', largura: 0.22 },
        { titulo: 'Resultado', largura: 0.14 },
        { titulo: 'Observação', largura: 0.22 },
      ],
      itens.map((i) => [i.nome, i.ambienteNome ? `${i.pavimentoNome} / ${i.ambienteNome}` : 'Geral', RESULTADO_LABEL[i.resultado] || i.resultado, i.observacao])
    )
    const porId = new Map(this.d.fotos.map((f) => [f.id, f]))
    const comFoto = itens.filter((i) => i.resultado === 'nao_conforme' && porId.get(i.fotoId))
    if (comFoto.length) {
      this.subtitulo('Evidências dos itens não conformes')
      await this.gradeFotos(comFoto.map((i) => ({ ...porId.get(i.fotoId), _item: i })), (f) => `${f._item.nome}${f._item.ambienteNome ? ` — ${f._item.ambienteNome}` : ''}`)
    }
  }

  async registroFotografico({ apenasLip = false, maxPorAmbiente = 0, incluirClaquete = false } = {}) {
    const fotosPorAmb = new Map()
    for (const f of this.d.fotos) {
      if (!f.ambienteId) continue
      if (f.claquete && !incluirClaquete) continue
      if (apenasLip && !f.lip) continue
      if (this.d.selecionadas && !this.d.selecionadas.has(f.id)) continue
      if (!fotosPorAmb.has(f.ambienteId)) fotosPorAmb.set(f.ambienteId, [])
      fotosPorAmb.get(f.ambienteId).push(f)
    }
    if (!fotosPorAmb.size) return
    this.titulo('REGISTRO FOTOGRÁFICO')
    let n = 0
    for (const p of this.d.pavimentos) {
      for (const a of p.ambientes) {
        let lista = fotosPorAmb.get(a.id) || []
        if (!lista.length) continue
        if (maxPorAmbiente > 0) {
          const destaque = lista.filter((f) => f.destaque)
          const resto = lista.filter((f) => !f.destaque)
          lista = [...destaque, ...resto].slice(0, maxPorAmbiente).sort((x, y) => x.ordem - y.ordem)
        }
        n += 1
        this.subtitulo(`${this.secao}.${n} ${p.nome} — ${a.nome}${a.situacao === 'nao_existe' ? ' (não existe no local)' : ''}${a.origem === 'campo' ? ' (não constava na planta)' : ''}`, 230)
        const detalhes = [a.nota ? `Observação: ${a.nota}` : '', a.medidas ? `Medidas: ${a.medidas}` : ''].filter(Boolean).join(' · ')
        if (detalhes) this.paragrafo(detalhes, { tamanho: 9, cor: '#444444' })
        await this.gradeFotos(lista, (f) => f.legenda || a.nome)
      }
    }
  }

  protocolos() {
    const lista = this.d.protocolos
    if (!lista.length) return
    this.titulo('HISTÓRICO DE PROTOCOLOS')
    this.tabela(
      [
        { titulo: 'Data', largura: 0.12 },
        { titulo: 'Órgão', largura: 0.2 },
        { titulo: 'Tipo', largura: 0.16 },
        { titulo: 'Número', largura: 0.17 },
        { titulo: 'Assunto / situação', largura: 0.35 },
      ],
      lista.map((p) => [dia(p.data), ORGAO_LABEL[p.orgao] || p.orgao, p.tipo.replace('_', '-'), p.numero, `${p.assunto} (${p.status})`])
    )
  }

  conclusao() {
    const texto = this.opcoes.conclusao || this.textoPadrao('conclusao')?.texto
    if (texto) {
      this.titulo('CONCLUSÃO')
      this.paragrafo(texto)
    }
    if (this.opcoes.observacoes) {
      this.titulo('OBSERVAÇÕES')
      this.paragrafo(this.opcoes.observacoes)
    }
  }

  responsabilidade() {
    const v = this.d.vistoria
    const e = this.d.escritorio
    this.titulo('RESPONSABILIDADE TÉCNICA')
    if (this.d.rrts.length) {
      this.tabela(
        [
          { titulo: 'Documento', largura: 0.14 },
          { titulo: 'Número', largura: 0.24 },
          { titulo: 'Atividade', largura: 0.3 },
          { titulo: 'Profissional', largura: 0.32 },
        ],
        this.d.rrts.map((r) => [r.tipo, r.numero, r.atividade, `${r.profissional || ''}${r.registro ? ` — ${r.registro}` : ''}`])
      )
    }
    this.paragrafo(
      `O presente documento foi elaborado com base em vistoria realizada no imóvel${v.dataVistoria ? ` em ${dia(v.dataVistoria)}` : ''} e reflete as condições observadas naquela data. ${e.cidade || 'São Paulo'}, ${new Date().toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' })}.`
    )
    this.garantir(120)
    const doc = this.doc
    const y = doc.y + 40
    const x = MARGEM + this.largura / 2 - 110
    if (v.responsavelAssinatura && fs.existsSync(absPath(v.responsavelAssinatura))) {
      try {
        doc.image(absPath(v.responsavelAssinatura), x + 20, y - 46, { fit: [180, 50], align: 'center' })
      } catch {
        /* assinatura inválida */
      }
    }
    doc.moveTo(x, y + 6).lineTo(x + 220, y + 6).lineWidth(0.6).strokeColor('#000000').stroke()
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#000000').text(limpar(v.responsavelNome || e.nome_fantasia || ''), x, y + 10, { width: 220, align: 'center' })
    doc.font('Helvetica').fontSize(9).fillColor('#333333').text(limpar([v.responsavelTitulo, v.responsavelRegistro].filter(Boolean).join(' — ')), x, y + 22, { width: 220, align: 'center' })
    if (e.nome_fantasia) doc.text(limpar(`${e.nome_fantasia}${e.registro ? ` — ${e.registro}` : ''}`), x, y + 34, { width: 220, align: 'center' })
    doc.y = y + 50
  }

  // ---------------------------------------------------------------- rodapé
  rodapes() {
    const doc = this.doc
    const range = doc.bufferedPageRange()
    const total = range.count
    for (let i = 0; i < total; i++) {
      doc.switchToPage(i)
      const yb = A4.altura - MARGEM + 6
      doc.font('Helvetica').fontSize(7.5).fillColor('#666666')
      doc.text(limpar(`${this.numero} · v${this.versao} · ${this.d.escritorio.nome_fantasia || ''}`), MARGEM, yb, { width: this.largura / 2, lineBreak: false })
      doc.text(`Página ${i + 1} de ${total}`, MARGEM + this.largura / 2, yb, { width: this.largura / 2, align: 'right', lineBreak: false })
      if (i > 0) {
        doc.fontSize(7.5).fillColor('#888888').text(limpar(`${this.def.titulo} — ${this.d.vistoria.imovelNome}`), MARGEM, MARGEM - 22, { width: this.largura, lineBreak: false })
        doc.moveTo(MARGEM, MARGEM - 10).lineTo(MARGEM + this.largura, MARGEM - 10).lineWidth(0.3).strokeColor('#cccccc').stroke()
      }
    }
    return total
  }

  async montar() {
    await this.capa()
    this.identificacao()
    this.objetivoEMetodologia()
    const o = this.opcoes
    switch (this.modelo) {
      case 'evtl':
        this.quadroDeAreas()
        await this.divergencias()
        this.protocolos()
        break
      case 'lip':
        await this.naoConformidades()
        await this.checklist()
        await this.registroFotografico({ apenasLip: true, maxPorAmbiente: Number(o.fotosPorAmbiente) || 0 })
        break
      case 'fotografico':
        await this.registroFotografico({ maxPorAmbiente: Number(o.fotosPorAmbiente) || 0, incluirClaquete: !!o.incluirClaquetes })
        break
      case 'bombeiro':
        await this.checklist()
        await this.naoConformidades()
        await this.registroFotografico({ maxPorAmbiente: Number(o.fotosPorAmbiente) || 4 })
        break
      case 'asbuilt':
        this.quadroDeAreas()
        await this.divergencias()
        await this.registroFotografico({ maxPorAmbiente: Number(o.fotosPorAmbiente) || 4, incluirClaquete: true })
        break
      case 'regularizacao':
        this.quadroDeAreas()
        await this.divergencias()
        await this.checklist()
        this.protocolos()
        await this.registroFotografico({ maxPorAmbiente: Number(o.fotosPorAmbiente) || 4, incluirClaquete: true })
        break
      default:
        await this.registroFotografico({})
    }
    this.conclusao()
    this.responsabilidade()
    const paginas = this.rodapes()
    return paginas
  }
}

// Gera o PDF em memória. Devolve { buffer, paginas }.
async function gerarLaudo({ modelo, vistoriaId, numero, versao, opcoes = {}, emissor = '' }) {
  if (!MODELOS[modelo]) throw Object.assign(new Error('Modelo de laudo desconhecido'), { status: 422 })
  const dados = await coletar(vistoriaId, opcoes)
  if (!dados) throw Object.assign(new Error('Vistoria não encontrada'), { status: 404 })
  const laudo = new Laudo(dados, { modelo, numero, versao, opcoes, emissor })
  const chunks = []
  const pronto = new Promise((resolve, reject) => {
    laudo.doc.on('data', (c) => chunks.push(c))
    laudo.doc.on('end', () => resolve(Buffer.concat(chunks)))
    laudo.doc.on('error', reject)
  })
  const paginas = await laudo.montar()
  laudo.doc.end()
  return { buffer: await pronto, paginas }
}

module.exports = { gerarLaudo, MODELOS, coletar }
