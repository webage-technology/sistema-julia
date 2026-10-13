'use strict'

// Relatórios como DOCUMENTOS — a área de Relatórios do menu.
//
// Diferença para o que já existia: EVTL e LIP são laudos gerados na hora a
// partir da vistoria aberta. Aqui o relatório é uma linha no banco, com capa,
// texto próprio e o recorte de fotos que ele leva. É isso que permite ver todos
// os relatórios num contexto amplo (/api/relatorios) e, quando se entra pela
// vistoria ou pelo imóvel, ver só os daquele local (?vistoriaId= / ?imovelId=).
//
// Modelo de hoje: 'fotografico' — o Relatório Fotográfico da Plenno. Estrutura
// do documento entregue como padrão:
//   capa → 1. LOCALIZAÇÃO DO IMÓVEL (endereço + texto livre) → 2. VISTORIA,
//   com uma subseção por ambiente (2.1, 2.2…) e as fotos em duas colunas,
//   legendadas "Imagem NN. <legenda>." e "Fonte: <fonte> (<ano>).".
const express = require('express')
const db = require('./db')
const { authMiddleware } = require('./auth')
const { VERMELHO, run, par, tabela, emPares, imagemPar, prepararMidia, nomeArquivoSeguro, enviar } = require('./docx')
const escritorio = require('./escritorio')
const { gerarDeModelo } = require('./modelos')

const router = express.Router()
router.use(authMiddleware)

const h = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error('[relatorios]', err.message)
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Erro interno' })
  })

const MODELOS = ['fotografico']

// A ordem do caminho (mesma do resto do módulo) é a ordem das fotos no relatório.
const ORDEM_CAMINHO = 'ORDER BY f.capturada_em NULLS LAST, f.id'

const COLS = `r.id, r.vistoria_id AS "vistoriaId", r.modelo, r.titulo, r.subtitulo,
  r.data_texto AS "dataTexto", r.fonte, r.texto, r.created_at AS "createdAt", r.updated_at AS "updatedAt",
  r.modelo_id AS "modeloId", m.nome AS "modeloNome", COALESCE(m.tipo, 'nativo') AS "modeloTipo",
  v.imovel_id AS "imovelId", v.tipo_servico AS "tipoServico", v.participantes,
  to_char(v.data_vistoria, 'YYYY-MM-DD') AS "dataVistoria", u.name AS "responsavelNome",
  i.nome AS "imovelNome", i.endereco, i.client_id AS "clientId", ${db.CLIENTE_NOME} AS "clienteNome",
  c.documento AS "clienteDocumento", c.email AS "clienteEmail", c.phone AS "clienteTelefone",
  (SELECT COUNT(*)::int FROM relatorio_fotos rf WHERE rf.relatorio_id = r.id) AS "fotosIncluidas"`

const DE = `FROM relatorios r
  JOIN vistorias v ON v.id = r.vistoria_id
  JOIN imoveis i ON i.id = v.imovel_id
  JOIN clients c ON c.id = i.client_id
  LEFT JOIN users u ON u.id = v.responsavel_id
  LEFT JOIN modelos m ON m.id = r.modelo_id`

// -------------------------------------------------------------------- listagem
// Sem filtro = todos os relatórios do escritório. Com filtro = só os daquele
// local (é a mesma tela, com endereço diferente).
router.get(
  '/relatorios',
  h(async (req, res) => {
    const num = (v) => (v === undefined || v === '' ? null : Number(v))
    const { rows } = await db.query(
      `SELECT ${COLS} ${DE}
       WHERE ($1::int IS NULL OR r.vistoria_id = $1)
         AND ($2::int IS NULL OR v.imovel_id = $2)
         AND ($3::int IS NULL OR i.client_id = $3)
       ORDER BY r.id DESC`,
      [num(req.query.vistoriaId), num(req.query.imovelId), num(req.query.clienteId)]
    )
    res.json({ success: true, data: rows })
  })
)

// ------------------------------------------------------------------- estrutura
// Seções do relatório = ambientes da vistoria (2.1, 2.2…), na ordem do caminho.
// Ambiente marcado como inexistente no local fica de fora: não é parte do imóvel.
async function secoes(vistoriaId, relatorioId) {
  const ambs = await db.query(
    `SELECT a.id, a.nome, p.nome AS "pavimentoNome"
     FROM ambientes a JOIN pavimentos p ON p.id = a.pavimento_id
     WHERE p.vistoria_id = $1 AND a.situacao <> 'nao_existe'
     ORDER BY p.ordem, p.id, a.ordem, a.id`,
    [vistoriaId]
  )
  const fotos = await db.query(
    `SELECT f.id, f.ambiente_id AS "ambienteId", f.arquivo, f.legenda, f.claquete, f.destaque,
      (rf.foto_id IS NOT NULL) AS incluida
     FROM fotos f
     LEFT JOIN relatorio_fotos rf ON rf.foto_id = f.id AND rf.relatorio_id = $2
     WHERE f.vistoria_id = $1 AND f.ambiente_id IS NOT NULL ${ORDEM_CAMINHO}`,
    [vistoriaId, relatorioId]
  )
  return ambs.rows
    .map((a, i) => ({
      id: a.id,
      nome: a.nome,
      pavimentoNome: a.pavimentoNome,
      numero: `2.${i + 1}`,
      fotos: fotos.rows.filter((f) => f.ambienteId === a.id),
    }))
    .filter((s) => s.fotos.length)
}

const carregar = (id) => db.query(`SELECT ${COLS} ${DE} WHERE r.id = $1`, [id])

router.get(
  '/relatorios/:id',
  h(async (req, res) => {
    const { rows } = await carregar(Number(req.params.id))
    if (!rows[0]) return res.status(404).json({ success: false, message: 'Relatório não encontrado' })
    const r = rows[0]
    res.json({ success: true, data: { ...r, secoes: await secoes(r.vistoriaId, r.id) } })
  })
)

// --------------------------------------------------------------------- escrita
// Nasce preenchido com o que o sistema já sabe (imóvel, endereço, mês) e com
// TODAS as fotos dos ambientes dentro — a curadoria é por exclusão, como no LIP.
// A claquete fica de fora: é a planta apontada, não foto do ambiente.
router.post(
  '/vistorias/:id/relatorios',
  h(async (req, res) => {
    const vid = Number(req.params.id)
    const v = await db.query(
      `SELECT v.id, to_char(COALESCE(v.data_vistoria, CURRENT_DATE), 'MM/YYYY') AS mes, i.endereco
       FROM vistorias v JOIN imoveis i ON i.id = v.imovel_id WHERE v.id = $1`,
      [vid]
    )
    if (!v.rowCount) return res.status(404).json({ success: false, message: 'Vistoria não encontrada' })
    const b = req.body || {}

    // O modelo vem da biblioteca. Sem escolha, cai no Relatório fotográfico —
    // que é o que vem com o sistema.
    const escolhido = await db.query(
      b.modeloId
        ? 'SELECT id, nome, tipo, chave FROM modelos WHERE id = $1'
        : "SELECT id, nome, tipo, chave FROM modelos WHERE chave = 'fotografico'",
      b.modeloId ? [Number(b.modeloId)] : []
    )
    if (!escolhido.rowCount) return res.status(422).json({ success: false, message: 'Modelo não encontrado' })
    const m = escolhido.rows[0]
    const nativo = m.tipo === 'nativo'

    const { rows } = await db.query(
      `INSERT INTO relatorios (vistoria_id, modelo, modelo_id, titulo, subtitulo, data_texto, fonte)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        vid,
        nativo && MODELOS.includes(m.chave) ? m.chave : 'docx',
        m.id,
        String(b.titulo || m.nome).trim(),
        String(b.subtitulo ?? v.rows[0].endereco).trim(),
        String(b.dataTexto || v.rows[0].mes).trim(),
        String(b.fonte || (await escritorio.carregar()).fonte_fotos || 'Escritório').trim(),
      ]
    )
    const id = rows[0].id
    // Só o modelo nativo monta as páginas de fotos; num .docx da biblioteca as
    // fotos não entram, então marcá-las daria um número sem sentido na lista.
    if (nativo) {
      await db.query(
        `INSERT INTO relatorio_fotos (relatorio_id, foto_id)
         SELECT $1, f.id FROM fotos f
         WHERE f.vistoria_id = $2 AND f.ambiente_id IS NOT NULL AND NOT f.claquete
         ON CONFLICT DO NOTHING`,
        [id, vid]
      )
    }
    res.json({ success: true, data: { id } })
  })
)

router.put(
  '/relatorios/:id',
  h(async (req, res) => {
    const id = Number(req.params.id)
    const cur = await db.query('SELECT * FROM relatorios WHERE id = $1', [id])
    if (!cur.rowCount) return res.status(404).json({ success: false, message: 'Relatório não encontrado' })
    const a = cur.rows[0]
    const b = req.body || {}
    await db.query(
      `UPDATE relatorios SET titulo = $1, subtitulo = $2, data_texto = $3, fonte = $4, texto = $5,
        updated_at = now() WHERE id = $6`,
      [
        b.titulo ?? a.titulo,
        b.subtitulo ?? a.subtitulo,
        b.dataTexto ?? a.data_texto,
        b.fonte ?? a.fonte,
        b.texto ?? a.texto,
        id,
      ]
    )
    const { rows } = await carregar(id)
    res.json({ success: true, data: rows[0] })
  })
)

router.delete(
  '/relatorios/:id',
  h(async (req, res) => {
    const r = await db.query('DELETE FROM relatorios WHERE id = $1', [Number(req.params.id)])
    if (!r.rowCount) return res.status(404).json({ success: false, message: 'Relatório não encontrado' })
    res.json({ success: true, message: 'Relatório excluído' })
  })
)

// Inclui/tira fotos em bloco (botões "todas do ambiente", "nenhuma").
router.post(
  '/relatorios/:id/fotos',
  h(async (req, res) => {
    const id = Number(req.params.id)
    const cur = await db.query('SELECT vistoria_id FROM relatorios WHERE id = $1', [id])
    if (!cur.rowCount) return res.status(404).json({ success: false, message: 'Relatório não encontrado' })
    const { ids, incluir } = req.body || {}
    if (!Array.isArray(ids)) return res.status(422).json({ success: false, message: 'Lista de fotos ausente' })
    const limpos = ids.map(Number).filter((n) => Number.isInteger(n))
    if (limpos.length) {
      if (incluir === false) {
        await db.query('DELETE FROM relatorio_fotos WHERE relatorio_id = $1 AND foto_id = ANY($2::int[])', [id, limpos])
      } else {
        // O SELECT sobre `fotos` garante que só entram fotos da vistoria do relatório.
        await db.query(
          `INSERT INTO relatorio_fotos (relatorio_id, foto_id)
           SELECT $1, f.id FROM fotos f WHERE f.vistoria_id = $2 AND f.id = ANY($3::int[])
           ON CONFLICT DO NOTHING`,
          [id, cur.rows[0].vistoria_id, limpos]
        )
      }
    }
    res.json({ success: true, data: { atualizadas: limpos.length } })
  })
)

// -------------------------------------------------------------------- documento
const semPontoFinal = (s) => String(s || '').trim().replace(/\.+$/, '')
// O ano da legenda sai da data da capa ("09/2026"); sem ela, da data da vistoria.
const anoDe = (dataTexto, dataVistoria) =>
  (String(dataTexto || '').match(/(\d{4})/) || [])[1] ||
  (String(dataVistoria || '').match(/(\d{4})/) || [])[1] ||
  String(new Date().getFullYear())

const dia = (iso) => (iso ? String(iso).split('-').reverse().join('/') : '')
const mascaraDoc = (d) => {
  const n = String(d || '').replace(/\D/g, '')
  if (n.length === 11) return n.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  if (n.length === 14) return n.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
  return n
}

// O que um modelo .docx da biblioteca consegue puxar dos cadastros.
// A lista de chaves aceitas está em src/modelos.js (CAMPOS) — as duas precisam
// contar a mesma história, senão a tela promete um campo que não é preenchido.
const dadosDoCadastro = (r, ambientes) => ({
  cliente: r.clienteNome || '',
  'cliente.documento': mascaraDoc(r.clienteDocumento),
  'cliente.email': r.clienteEmail || '',
  'cliente.telefone': r.clienteTelefone || '',
  imovel: r.imovelNome || '',
  endereco: r.subtitulo || r.endereco || '',
  vistoria: `#${r.vistoriaId}`,
  'vistoria.data': dia(r.dataVistoria),
  'vistoria.tipo': r.tipoServico || '',
  'vistoria.participantes': r.participantes || '',
  responsavel: r.responsavelNome || '',
  titulo: r.titulo || '',
  data: r.dataTexto || '',
  texto: r.texto || '',
  fonte: r.fonte || '',
  ambientes: ambientes.join(', '),
  fotos: String(r.fotosIncluidas ?? 0),
  hoje: new Date().toLocaleDateString('pt-BR'),
})

router.get(
  '/relatorios/:id/docx',
  h(async (req, res) => {
    const { rows } = await carregar(Number(req.params.id))
    if (!rows[0]) return res.status(404).json({ success: false, message: 'Relatório não encontrado' })
    const r = rows[0]

    // Modelo da biblioteca: o .docx do escritório, preenchido com os cadastros.
    if (r.modeloTipo === 'docx') {
      const mod = await db.query('SELECT arquivo FROM modelos WHERE id = $1', [r.modeloId])
      if (!mod.rows[0]?.arquivo) {
        return res.status(422).json({ success: false, message: 'O modelo deste relatório não está mais na biblioteca' })
      }
      const ambs = await db.query(
        `SELECT a.nome FROM ambientes a JOIN pavimentos p ON p.id = a.pavimento_id
         WHERE p.vistoria_id = $1 AND a.situacao <> 'nao_existe' ORDER BY p.ordem, p.id, a.ordem, a.id`,
        [r.vistoriaId]
      )
      const nome = `${nomeArquivoSeguro(r.titulo)}_${nomeArquivoSeguro(r.imovelNome)}.docx`
      return gerarDeModelo(res, mod.rows[0].arquivo, dadosDoCadastro(r, ambs.rows.map((a) => a.nome)), nome)
    }

    const COR = (await escritorio.carregar()).cor || VERMELHO
    const lista = await secoes(r.vistoriaId, r.id)
    const escolhidas = lista.flatMap((s) => s.fotos.filter((f) => f.incluida))
    if (!escolhidas.length) {
      return res
        .status(422)
        .json({ success: false, message: 'Nenhuma foto no relatório — inclua as fotos dos ambientes antes' })
    }
    const midia = await prepararMidia(escolhidas)
    const ano = anoDe(r.dataTexto, r.dataVistoria)
    const corpo = []

    // ---- capa (o modelo impresso alinha o bloco à direita)
    corpo.push(
      par(run(r.titulo.toUpperCase(), { bold: true, size: 44, color: COR }), {
        align: 'right',
        antes: 3200,
        depois: 400,
      })
    )
    corpo.push(par(run(r.imovelNome.toUpperCase(), { bold: true, size: 24 }), { align: 'right' }))
    if (r.subtitulo) corpo.push(par(run(r.subtitulo, { size: 22 }), { align: 'right' }))
    if (r.dataTexto) corpo.push(par(run(`Data: ${r.dataTexto}`, { size: 22 }), { align: 'right' }))

    // ---- 1. localização e o que a Julia escreveu
    corpo.push(
      par(run('1. LOCALIZAÇÃO DO IMÓVEL', { bold: true, size: 24, color: COR }), {
        quebraAntes: true,
        depois: 160,
      })
    )
    corpo.push(
      par([run('Endereço: ', { bold: true }), run(`${r.subtitulo || r.endereco || '—'}.`)], { depois: 160 })
    )
    for (const linha of String(r.texto || '').split('\n')) {
      if (linha.trim()) corpo.push(par(run(linha.trim()), { depois: 120 }))
    }

    // ---- 2. vistoria: uma subseção por ambiente, fotos em duas colunas
    corpo.push(par(run('2. VISTORIA', { bold: true, size: 24, color: COR }), { antes: 240, depois: 120 }))
    let numeroImagem = 0
    for (const s of lista) {
      const daSecao = s.fotos.filter((f) => f.incluida && midia.has(f.id))
      if (!daSecao.length) continue
      corpo.push(
        par(run(`${s.numero} ${s.nome.toUpperCase()}`, { size: 22, color: COR }), { antes: 160, depois: 120 })
      )
      const celulas = daSecao.map((f) => {
        const m = midia.get(f.id)
        numeroImagem += 1
        const legenda = `Imagem ${String(numeroImagem).padStart(2, '0')}. ${semPontoFinal(f.legenda) || s.nome}.`
        return (
          imagemPar(m.rid, m.cx, m.cy, numeroImagem) +
          par(run(legenda, { size: 16 }), { align: 'center', depois: 0 }) +
          par(run(`Fonte: ${r.fonte} (${ano}).`, { size: 16 }), { align: 'center', depois: 200 })
        )
      })
      corpo.push(tabela(emPares(celulas)))
      corpo.push(par(''))
    }

    const nome = `${nomeArquivoSeguro(r.titulo)}_${nomeArquivoSeguro(r.imovelNome)}.docx`
    await enviar(res, nome, corpo, midia)
  })
)

module.exports = router
