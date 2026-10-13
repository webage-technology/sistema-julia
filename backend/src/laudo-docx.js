'use strict'

// O MESMO laudo do PDF, em Word (.docx) — para quando o texto ainda precisa de
// ajuste antes de virar documento oficial.
//
// A regra é: não inventar um segundo laudo. Os dados vêm do mesmo `coletar()`
// de src/pdf.js e as seções seguem a mesma ordem de cada modelo (EVTL, LIP,
// fotográfico, bombeiro, as-built, regularização). O que muda é só a mídia: o
// PDF desenha as fotos, aqui elas entram como imagens do OOXML.
//
// O PDF continua sendo o que se emite e numera (src/laudos.js); o Word é uma
// saída de trabalho — por isso não recebe número oficial nem fica guardado.
const { coletar, MODELOS } = require('./pdf')
const { VERMELHO, run, par, tabela, tabelaDados, emPares, imagemPar, prepararMidia, nomeArquivoSeguro } = require('./docx')

const GRAU_LABEL = { critico: 'Crítico', regular: 'Regular', minimo: 'Mínimo' }
const PRAZO_LABEL = { imediato: 'Imediato', curto: 'Curto prazo', medio: 'Médio prazo', longo: 'Longo prazo' }
const RESULTADO_LABEL = { conforme: 'Conforme', nao_conforme: 'Não conforme', nao_aplicavel: 'Não se aplica', pendente: 'Não verificado' }
const ORGAO_LABEL = { prefeitura: 'Prefeitura', bombeiros: 'Corpo de Bombeiros', cartorio: 'Cartório', cetesb: 'CETESB', vigilancia: 'Vigilância Sanitária', condominio: 'Condomínio', outro: 'Outro' }

const dia = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '')
const m2 = (n) => (n == null ? '' : `${Number(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m²`)
const mascaraDoc = (d) => {
  const n = String(d || '').replace(/\D/g, '')
  if (n.length === 11) return n.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  if (n.length === 14) return n.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
  return n
}

// Fotos do registro fotográfico, pela mesma regra do PDF (claquete, recorte de
// um documento, máximo por ambiente, destaque primeiro).
function fotosDoRegistro(d, { apenasLip = false, maxPorAmbiente = 0, incluirClaquete = false } = {}) {
  const porAmbiente = new Map()
  for (const f of d.fotos) {
    if (!f.ambienteId) continue
    if (f.claquete && !incluirClaquete) continue
    if (apenasLip && !f.lip) continue
    if (d.selecionadas && !d.selecionadas.has(f.id)) continue
    if (!porAmbiente.has(f.ambienteId)) porAmbiente.set(f.ambienteId, [])
    porAmbiente.get(f.ambienteId).push(f)
  }
  if (maxPorAmbiente > 0) {
    for (const [id, lista] of porAmbiente) {
      const destaque = lista.filter((f) => f.destaque)
      const resto = lista.filter((f) => !f.destaque)
      porAmbiente.set(id, [...destaque, ...resto].slice(0, maxPorAmbiente).sort((x, y) => x.ordem - y.ordem))
    }
  }
  return porAmbiente
}

class LaudoWord {
  constructor(dados, { modelo, numero, versao, opcoes, cor }) {
    this.d = dados
    this.modelo = modelo
    this.numero = numero
    this.versao = versao
    this.opcoes = opcoes || {}
    this.cor = cor || VERMELHO
    this.corpo = []
    this.midia = new Map()
    this.secao = 0
    this.imagem = 0
  }

  // ------------------------------------------------------------- blocos
  titulo(texto) {
    this.secao += 1
    this.corpo.push(par(run(`${this.secao}. ${texto}`, { bold: true, size: 24, color: this.cor }), { antes: 240, depois: 100 }))
  }
  subtitulo(texto) {
    this.corpo.push(par(run(texto, { bold: true, size: 21 }), { antes: 140, depois: 60 }))
  }
  paragrafo(texto, opcoes = {}) {
    for (const trecho of String(texto || '').split(/\n{2,}/)) {
      if (trecho.trim()) this.corpo.push(par(run(trecho.trim(), { size: 20, ...opcoes }), { depois: 100 }))
    }
  }
  tabela(colunas, linhas) {
    this.corpo.push(tabelaDados(colunas, linhas))
    this.corpo.push(par(''))
  }
  textoPadrao(secao) {
    const v = this.d.vistoria
    const tipo = String(v.tipoServico || '').toLowerCase()
    const alvo = MODELOS[this.modelo]?.tipo?.toLowerCase() || ''
    const t = this.d.textos
    return (
      t.find((x) => x.secao === secao && x.tipoServico && (x.tipoServico.toLowerCase() === tipo || x.tipoServico.toLowerCase() === alvo)) ||
      t.find((x) => x.secao === secao && !x.tipoServico)
    )
  }
  // Grade de duas fotos por linha, numeradas e legendadas como no LIP.
  gradeFotos(fotos, legenda) {
    const celulas = []
    for (const f of fotos) {
      const m = this.midia.get(f.id)
      if (!m) continue
      this.imagem += 1
      celulas.push(
        imagemPar(m.rid, m.cx, m.cy, this.imagem) +
          par(run(`Imagem ${String(this.imagem).padStart(2, '0')}. ${legenda(f)}`, { size: 16 }), { align: 'center', depois: 0 }) +
          par(run(`Fonte: ${this.opcoes.fonte || this.d.escritorio.fonte_fotos || this.d.escritorio.nome_fantasia || 'Escritório'}.`, { size: 16 }), { align: 'center', depois: 160 })
      )
    }
    if (celulas.length) {
      this.corpo.push(tabela(emPares(celulas)))
      this.corpo.push(par(''))
    }
  }

  // ------------------------------------------------------------- seções
  capa() {
    const v = this.d.vistoria
    const e = this.d.escritorio
    const m = MODELOS[this.modelo]
    if (e.nome_fantasia) this.corpo.push(par(run(e.nome_fantasia, { bold: true, size: 22, color: this.cor }), { align: 'center' }))
    this.corpo.push(par(run(m.titulo, { bold: true, size: 36, color: this.cor }), { align: 'center', antes: 240 }))
    if (this.opcoes.titulo) this.corpo.push(par(run(this.opcoes.titulo, { size: 24 }), { align: 'center' }))
    this.corpo.push(par(run(`${v.clienteNome} | ${v.imovelNome}`, { bold: true, size: 24 }), { align: 'center', antes: 160 }))
    if (v.endereco) this.corpo.push(par(run(v.endereco, { size: 20 }), { align: 'center' }))
    this.corpo.push(
      par(run(`${this.numero} — versão ${this.versao}${v.dataVistoria ? ` · vistoria em ${dia(v.dataVistoria)}` : ''}`, { size: 20 }), { align: 'center', depois: 240 })
    )
  }

  identificacao() {
    const v = this.d.vistoria
    const linhas = [
      ['Cliente', `${v.clienteNome}${v.clienteDocumento ? ` — ${mascaraDoc(v.clienteDocumento)}` : ''}`],
      ['Imóvel', v.imovelNome],
      ['Endereço', [v.endereco, [v.municipio, v.uf].filter(Boolean).join('/'), v.cep ? `CEP ${v.cep}` : ''].filter(Boolean).join(' — ')],
      v.matricula ? ['Matrícula', `${v.matricula}${v.cartorio ? ` — ${v.cartorio}` : ''}`] : null,
      v.inscricao ? ['Inscrição imobiliária (SQL)', v.inscricao] : null,
      v.zoneamento ? ['Zoneamento', v.zoneamento] : null,
      v.areaAprovada ? ['Área construída aprovada', m2(v.areaAprovada)] : null,
      v.areaIptu ? ['Área construída no IPTU', m2(v.areaIptu)] : null,
      this.d.areas?.total ? ['Área construída levantada', m2(this.d.areas.total)] : null,
      ['Vistoria', `nº ${v.id}${v.dataVistoria ? ` em ${dia(v.dataVistoria)}` : ''}${v.tipoServico ? ` — ${v.tipoServico}` : ''}`],
      v.participantes ? ['Participantes', v.participantes] : null,
      v.processoNumero ? ['Processo', `${v.processoNumero} — ${v.processoTitulo}`] : null,
      v.responsavelNome ? ['Responsável técnico', `${v.responsavelNome}${v.responsavelRegistro ? ` — ${v.responsavelRegistro}` : ''}`] : null,
    ].filter(Boolean)
    this.titulo('IDENTIFICAÇÃO')
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
        linhas.push([p.nome, a.nome, dim, a.peDireito ? a.peDireito.toFixed(2) : '', a.areaCalculada ? a.areaCalculada.toFixed(2) : '—'])
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

  divergencias() {
    const lista = this.d.divergencias
    const camp = this.d.pavimentos.flatMap((p) =>
      p.ambientes.filter((a) => a.origem === 'campo' || a.situacao === 'nao_existe').map((a) => ({ ...a, pavimentoNome: p.nome }))
    )
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
    for (const [i, dv] of lista.entries()) {
      this.subtitulo(`${this.secao}.${i + 1} ${dv.titulo || 'Divergência'}${dv.ambienteNome ? ` — ${dv.pavimentoNome} / ${dv.ambienteNome}` : ''}`)
      const planta = porId.get(dv.fotoPlantaId)
      const atual = porId.get(dv.fotoAtualId)
      const celula = (f, rotulo) => {
        const m = f && this.midia.get(f.id)
        if (!m) return par(run(`${rotulo}: sem foto`, { size: 16, italic: true }), { align: 'center' })
        this.imagem += 1
        return imagemPar(m.rid, m.cx, m.cy, this.imagem) + par(run(rotulo, { size: 16 }), { align: 'center', depois: 120 })
      }
      if (planta || atual) {
        this.corpo.push(tabela([[celula(planta, 'Projeto aprovado'), celula(atual, 'Situação encontrada')]]))
        this.corpo.push(par(''))
      }
      if (dv.descricao) this.paragrafo(dv.descricao)
    }
  }

  naoConformidades() {
    const ncs = this.d.ncs
    if (!ncs.length) return
    this.titulo('NÃO CONFORMIDADES')
    this.tabela(
      [{ titulo: 'Grau de risco', largura: 0.6 }, { titulo: 'Quantidade', largura: 0.4, alinhar: 'right' }],
      ['critico', 'regular', 'minimo'].map((g) => [GRAU_LABEL[g], String(ncs.filter((n) => n.grau === g).length)])
    )
    const porId = new Map(this.d.fotos.map((f) => [f.id, f]))
    for (const [i, n] of ncs.entries()) {
      this.subtitulo(`${this.secao}.${i + 1} ${n.titulo || n.anomalia}${n.ambienteNome ? ` — ${n.pavimentoNome} / ${n.ambienteNome}` : ''}`)
      this.paragrafo(`Anomalia: ${n.anomalia} · Grau de risco: ${GRAU_LABEL[n.grau] || n.grau} · Prazo recomendado: ${PRAZO_LABEL[n.prazo] || n.prazo}`, { size: 16 })
      const f = porId.get(n.fotoId)
      if (f) this.gradeFotos([f], () => n.titulo || n.anomalia)
      if (n.descricao) this.paragrafo(n.descricao)
      if (n.recomendacao) this.paragrafo(`Recomendação: ${n.recomendacao}`, { italic: true })
    }
  }

  checklist() {
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
      this.gradeFotos(
        comFoto.map((i) => ({ ...porId.get(i.fotoId), _item: i })),
        (f) => `${f._item.nome}${f._item.ambienteNome ? ` — ${f._item.ambienteNome}` : ''}`
      )
    }
  }

  registroFotografico(opcoes) {
    const porAmbiente = fotosDoRegistro(this.d, opcoes)
    if (!porAmbiente.size) return
    this.titulo('REGISTRO FOTOGRÁFICO')
    let n = 0
    for (const p of this.d.pavimentos) {
      for (const a of p.ambientes) {
        const lista = porAmbiente.get(a.id) || []
        if (!lista.length) continue
        n += 1
        this.subtitulo(`${this.secao}.${n} ${p.nome} — ${a.nome}${a.situacao === 'nao_existe' ? ' (não existe no local)' : ''}${a.origem === 'campo' ? ' (não constava na planta)' : ''}`)
        const detalhes = [a.nota ? `Observação: ${a.nota}` : '', a.medidas ? `Medidas: ${a.medidas}` : ''].filter(Boolean).join(' · ')
        if (detalhes) this.paragrafo(detalhes, { size: 16 })
        this.gradeFotos(lista, (f) => f.legenda || a.nome)
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
    this.corpo.push(par(run('_________________________________________', { size: 20 }), { align: 'center', antes: 400 }))
    this.corpo.push(par(run(v.responsavelNome || e.nome_fantasia || '', { bold: true, size: 20 }), { align: 'center', depois: 0 }))
    const credencial = [v.responsavelTitulo, v.responsavelRegistro].filter(Boolean).join(' — ')
    if (credencial) this.corpo.push(par(run(credencial, { size: 18 }), { align: 'center', depois: 0 }))
    if (e.nome_fantasia) this.corpo.push(par(run(`${e.nome_fantasia}${e.registro ? ` — ${e.registro}` : ''}`, { size: 18 }), { align: 'center' }))
  }

  // Todas as fotos que este modelo vai usar — preparadas de uma vez só.
  fotosUsadas() {
    const o = this.opcoes
    const ids = new Set()
    const porId = new Map(this.d.fotos.map((f) => [f.id, f]))
    const incluir = (id) => id && porId.has(id) && ids.add(id)
    for (const dv of this.d.divergencias) {
      incluir(dv.fotoPlantaId)
      incluir(dv.fotoAtualId)
    }
    for (const n of this.d.ncs) incluir(n.fotoId)
    for (const i of this.d.checklist) if (i.resultado === 'nao_conforme') incluir(i.fotoId)
    const registro = {
      lip: { apenasLip: true, maxPorAmbiente: Number(o.fotosPorAmbiente) || 0 },
      fotografico: { maxPorAmbiente: Number(o.fotosPorAmbiente) || 0, incluirClaquete: !!o.incluirClaquetes },
      bombeiro: { maxPorAmbiente: Number(o.fotosPorAmbiente) || 4 },
      asbuilt: { maxPorAmbiente: Number(o.fotosPorAmbiente) || 4, incluirClaquete: true },
      regularizacao: { maxPorAmbiente: Number(o.fotosPorAmbiente) || 4, incluirClaquete: true },
    }[this.modelo]
    if (registro) for (const lista of fotosDoRegistro(this.d, registro).values()) for (const f of lista) incluir(f.id)
    return this.d.fotos.filter((f) => ids.has(f.id))
  }

  async montar() {
    this.midia = await prepararMidia(this.fotosUsadas())
    const o = this.opcoes
    this.capa()
    this.identificacao()
    this.objetivoEMetodologia()
    switch (this.modelo) {
      case 'evtl':
        this.quadroDeAreas()
        this.divergencias()
        this.protocolos()
        break
      case 'lip':
        this.naoConformidades()
        this.checklist()
        this.registroFotografico({ apenasLip: true, maxPorAmbiente: Number(o.fotosPorAmbiente) || 0 })
        break
      case 'fotografico':
        this.registroFotografico({ maxPorAmbiente: Number(o.fotosPorAmbiente) || 0, incluirClaquete: !!o.incluirClaquetes })
        break
      case 'bombeiro':
        this.checklist()
        this.naoConformidades()
        this.registroFotografico({ maxPorAmbiente: Number(o.fotosPorAmbiente) || 4 })
        break
      case 'asbuilt':
        this.quadroDeAreas()
        this.divergencias()
        this.registroFotografico({ maxPorAmbiente: Number(o.fotosPorAmbiente) || 4, incluirClaquete: true })
        break
      case 'regularizacao':
        this.quadroDeAreas()
        this.divergencias()
        this.checklist()
        this.protocolos()
        this.registroFotografico({ maxPorAmbiente: Number(o.fotosPorAmbiente) || 4, incluirClaquete: true })
        break
      default:
        this.registroFotografico({})
    }
    this.conclusao()
    this.responsabilidade()
    return { corpo: this.corpo, midia: this.midia }
  }
}

/** Monta o .docx do laudo. Devolve { corpo, midia, nome } para src/docx.js enviar. */
async function gerarLaudoWord({ modelo, vistoriaId, numero, versao = 1, opcoes = {} }) {
  if (!MODELOS[modelo]) throw Object.assign(new Error('Modelo de laudo desconhecido'), { status: 422 })
  const dados = await coletar(vistoriaId, opcoes)
  if (!dados) throw Object.assign(new Error('Vistoria não encontrada'), { status: 404 })
  // A cor do escritório é guardada sem "#" (é o que o OOXML espera).
  const cor = String(dados.escritorio.cor || VERMELHO).replace('#', '') || VERMELHO
  const laudo = new LaudoWord(dados, { modelo, numero, versao, opcoes, cor })
  const { corpo, midia } = await laudo.montar()
  const v = dados.vistoria
  const nome = `${nomeArquivoSeguro(numero)}_${nomeArquivoSeguro(v.clienteNome)}_${nomeArquivoSeguro(v.imovelNome)}.docx`
  return { corpo, midia, nome }
}

module.exports = { gerarLaudoWord }
