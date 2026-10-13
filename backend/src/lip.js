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
// A montagem do .docx (página, fontes, grade de duas colunas, empacotamento)
// mora em src/docx.js — aqui fica só o CORPO deste laudo.
const express = require('express')
const db = require('./db')
const { authMiddleware } = require('./auth')
const { VERMELHO, run, par, tabela, emPares, imagemPar, prepararMidia, nomeArquivoSeguro, enviar } = require('./docx')
const escritorio = require('./escritorio')

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
    // Nome na legenda e cor dos títulos vêm das configurações do escritório.
    const cfg = await escritorio.carregar()
    const fonte = String(req.query.fonte || cfg.fonte_fotos || cfg.nome_fantasia).trim() || 'Escritório'
    const COR = cfg.cor || VERMELHO
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
    const midia = await prepararMidia(selecionadas)

    // ---- corpo do documento
    const corpo = []

    // Identificação (só quem/onde/quando — o diagnóstico é do arquiteto).
    corpo.push(par(run('LAUDO DE INSPEÇÃO PREDIAL', { bold: true, size: 32, color: COR }), { align: 'center' }))
    corpo.push(par(run(`${v.cliente} | ${v.imovel}`, { bold: true, size: 24 }), { align: 'center' }))
    if (v.endereco) corpo.push(par(run(v.endereco, { size: 20 }), { align: 'center' }))
    corpo.push(par(run(`Data: ${v.data || '—'}`, { size: 20 }), { align: 'center', depois: 320 }))

    // Índice de ambientes, um bloco por pavimento, preenchendo coluna a coluna
    // (o modelo impresso lê de cima para baixo na coluna da esquerda).
    corpo.push(par(run('AMBIENTES', { bold: true, size: 24, color: COR }), { antes: 120 }))
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
            par(run(p.nome.toUpperCase(), { bold: true, size: 22, color: COR }), {
              quebraAntes: true,
              depois: 60,
            })
          )
          pavimentoAnterior = p.id
        }
        corpo.push(
          par(
            [
              run(`AMBIENTE ${a.numero} – `, { bold: true, size: 24, color: COR }),
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

    const nome = `LIP_${nomeArquivoSeguro(v.cliente)}_${nomeArquivoSeguro(v.imovel)}_${(v.data || '').replace(/\//g, '.')}.docx`
    await enviar(res, nome, corpo, midia)
  })
)

module.exports = router
