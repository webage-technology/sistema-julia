'use strict'

// Viagem: uma ida a campo que cobre VÁRIAS vistorias (vários imóveis, do mesmo
// cliente ou de clientes diferentes). Guarda o cronograma (voo, ônibus, hotel,
// traslados), a verba e a prestação de contas com comprovantes.
//
// A verba é o dinheiro que o escritório adianta ao analista para ele conseguir
// fazer a vistoria: tantos dias em campo, tanto de almoço, Uber e afins. A tela
// /financeiro (rota no fim deste arquivo) é a visão do escritório sobre esse
// adiantamento — quanto saiu, quanto voltou comprovado na planilha de despesas.
//
// Notificação: o cronograma é exportado como **calendário (.ics)**. Os itens
// marcados com "avisar" levam alarme — o celular notifica sozinho, offline e
// sem o sistema aberto.
const express = require('express')
const fs = require('node:fs')
const db = require('./db')
const { authMiddleware, permitir, PAPEIS_FINANCEIRO } = require('./auth')
const fatura = require('./fatura')
const { upload, absPath, salvarComprovante, salvarFatura, removerArquivo, nomeOriginal } = require('./uploads')

const router = express.Router()
router.use(authMiddleware)

const h = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error('[erro]', err.message)
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Erro interno' })
  })

// "tarefa" é o que não é trecho: levar EPI, perguntar o horário do almoço,
// fazer o checkout. Tem `concluido`, marcado na viagem e na agenda.
const TIPOS = ['voo', 'onibus', 'carro', 'hotel', 'transfer', 'vistoria', 'tarefa', 'outro']
const CATEGORIAS = ['passagem', 'hospedagem', 'transporte', 'alimentacao', 'outro']

const ITEM_COLS = `id, viagem_id AS "viagemId", tipo, titulo, inicio, fim, origem, destino, codigo,
  valor::float8 AS valor, notificar, lembrete_min AS "lembreteMin", obs, concluido`
const DESPESA_COLS = `id, viagem_id AS "viagemId", vistoria_id AS "vistoriaId", categoria, descricao,
  valor::float8 AS valor, to_char(data, 'YYYY-MM-DD') AS data, arquivo <> '' AS "temComprovante",
  nome_original AS "nomeOriginal"`
const VIAGEM_COLS = `v.id, v.titulo, v.destino, to_char(v.inicio, 'YYYY-MM-DD') AS inicio,
  to_char(v.fim, 'YYYY-MM-DD') AS fim, v.verba::float8 AS verba, v.observacoes,
  v.responsavel_id AS "responsavelId", u.name AS "responsavelNome", v.processo,
  v.lider_conferente AS "liderConferente", v.retencao::float8 AS retencao,
  v.motivo_retencao AS "motivoRetencao", v.created_at AS "createdAt"`

const num = (v) => {
  const n = Number(String(v ?? '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}
const dataOuNulo = (v) => {
  if (!v) return null
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d
}

// Vistorias cobertas pela viagem, com imóvel e cliente.
const vistoriasDaViagem = (viagemId) =>
  db.query(
    `SELECT vi.id, vi.tipo_servico AS "tipoServico", to_char(vi.data_vistoria, 'YYYY-MM-DD') AS "dataVistoria",
      vi.status, i.nome AS "imovelNome", i.endereco, ${db.CLIENTE_NOME} AS "clienteNome"
     FROM viagem_vistorias vv
     JOIN vistorias vi ON vi.id = vv.vistoria_id
     JOIN imoveis i ON i.id = vi.imovel_id
     JOIN clients c ON c.id = i.client_id
     WHERE vv.viagem_id = $1
     ORDER BY vi.data_vistoria NULLS LAST, vi.id`,
    [viagemId]
  )

// ------------------------------------------------------------------ viagens
router.get(
  '/viagens',
  h(async (_req, res) => {
    const { rows } = await db.query(
      `SELECT ${VIAGEM_COLS},
        (SELECT COUNT(*)::int FROM viagem_vistorias vv WHERE vv.viagem_id = v.id) AS vistorias,
        (SELECT COUNT(*)::int FROM viagem_itens it WHERE it.viagem_id = v.id) AS itens,
        (SELECT COALESCE(SUM(d.valor), 0)::float8 FROM despesas d WHERE d.viagem_id = v.id) AS gasto,
        (SELECT string_agg(DISTINCT ${db.CLIENTE_NOME}, ', ') FROM viagem_vistorias vv
          JOIN vistorias vi ON vi.id = vv.vistoria_id
          JOIN imoveis i ON i.id = vi.imovel_id
          JOIN clients c ON c.id = i.client_id
          WHERE vv.viagem_id = v.id) AS clientes
       FROM viagens v LEFT JOIN users u ON u.id = v.responsavel_id
       ORDER BY COALESCE(v.inicio, v.created_at::date) DESC, v.id DESC`
    )
    res.json({ success: true, data: rows })
  })
)

router.post(
  '/viagens',
  h(async (req, res) => {
    const b = req.body || {}
    if (!String(b.titulo || '').trim() && !String(b.destino || '').trim()) {
      return res.status(422).json({ success: false, message: 'Informe ao menos o título ou o destino da viagem' })
    }
    const { rows } = await db.query(
      `INSERT INTO viagens (titulo, destino, inicio, fim, verba, observacoes, responsavel_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [
        String(b.titulo || b.destino).trim(),
        b.destino || '',
        b.inicio || null,
        b.fim || null,
        num(b.verba),
        b.observacoes || '',
        b.responsavelId || null,
      ]
    )
    const id = rows[0].id
    // Já pode nascer cobrindo vistorias (ex.: criada a partir de uma delas).
    for (const vid of Array.isArray(b.vistorias) ? b.vistorias : []) {
      await db
        .query('INSERT INTO viagem_vistorias (viagem_id, vistoria_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [
          id,
          Number(vid),
        ])
        .catch(() => {})
    }
    res.json({ success: true, data: { id } })
  })
)

// Viagem completa (usada pela tela e pelo relatório em Excel).
async function dadosDaViagem(id) {
  const v = await db.query(
    `SELECT ${VIAGEM_COLS} FROM viagens v LEFT JOIN users u ON u.id = v.responsavel_id WHERE v.id = $1`,
    [id]
  )
  if (!v.rowCount) return null
  const [vistorias, itens, despesas] = await Promise.all([
    vistoriasDaViagem(id),
    db.query(`SELECT ${ITEM_COLS} FROM viagem_itens WHERE viagem_id = $1 ORDER BY inicio NULLS LAST, id`, [id]),
    db.query(`SELECT ${DESPESA_COLS} FROM despesas WHERE viagem_id = $1 ORDER BY data NULLS LAST, id`, [id]),
  ])
  const gasto = despesas.rows.reduce((s, d) => s + Number(d.valor || 0), 0)
  const previsto = itens.rows.reduce((s, i) => s + Number(i.valor || 0), 0)
  const verba = Number(v.rows[0].verba) || 0
  return {
    viagem: v.rows[0],
    vistorias: vistorias.rows,
    itens: itens.rows,
    despesas: despesas.rows,
    totais: { verba, previsto, gasto, saldo: verba - gasto },
  }
}

router.get(
  '/viagens/:id',
  h(async (req, res) => {
    const dados = await dadosDaViagem(Number(req.params.id))
    if (!dados) return res.status(404).json({ success: false, message: 'Viagem não encontrada' })
    res.json({ success: true, data: dados })
  })
)

router.put(
  '/viagens/:id',
  h(async (req, res) => {
    const id = Number(req.params.id)
    const cur = await db.query('SELECT * FROM viagens WHERE id = $1', [id])
    if (!cur.rowCount) return res.status(404).json({ success: false, message: 'Viagem não encontrada' })
    const a = cur.rows[0]
    const b = req.body || {}
    await db.query(
      `UPDATE viagens SET titulo=$1, destino=$2, inicio=$3, fim=$4, verba=$5, observacoes=$6, responsavel_id=$7,
        processo=$8, lider_conferente=$9, retencao=$10, motivo_retencao=$11 WHERE id=$12`,
      [
        b.titulo ?? a.titulo,
        b.destino ?? a.destino,
        'inicio' in b ? b.inicio || null : a.inicio,
        'fim' in b ? b.fim || null : a.fim,
        'verba' in b ? num(b.verba) : a.verba,
        b.observacoes ?? a.observacoes,
        'responsavelId' in b ? b.responsavelId || null : a.responsavel_id,
        b.processo ?? a.processo,
        b.liderConferente ?? a.lider_conferente,
        'retencao' in b ? num(b.retencao) : a.retencao,
        b.motivoRetencao ?? a.motivo_retencao,
        id,
      ]
    )
    res.json({ success: true, message: 'Viagem atualizada' })
  })
)

router.delete(
  '/viagens/:id',
  h(async (req, res) => {
    const id = Number(req.params.id)
    const arqs = await db.query("SELECT arquivo FROM despesas WHERE viagem_id = $1 AND arquivo <> ''", [id])
    const r = await db.query('DELETE FROM viagens WHERE id = $1', [id])
    if (!r.rowCount) return res.status(404).json({ success: false, message: 'Viagem não encontrada' })
    for (const a of arqs.rows) await removerArquivo(a.arquivo)
    res.json({ success: true, message: 'Viagem excluída' })
  })
)

// ------------------------------------------- vistorias cobertas pela viagem
router.post(
  '/viagens/:id/vistorias',
  h(async (req, res) => {
    const id = Number(req.params.id)
    const vistoriaId = Number((req.body || {}).vistoriaId)
    const ok = await db.query('SELECT 1 FROM viagens WHERE id = $1', [id])
    if (!ok.rowCount) return res.status(404).json({ success: false, message: 'Viagem não encontrada' })
    const vi = await db.query('SELECT 1 FROM vistorias WHERE id = $1', [vistoriaId])
    if (!vi.rowCount) return res.status(422).json({ success: false, message: 'Vistoria não encontrada' })
    // Uma vistoria acontece numa ida só: se já está em outra viagem, avisa em
    // vez de duplicar (senão a mesma despesa seria contada duas vezes).
    const outra = await db.query(
      `SELECT COALESCE(NULLIF(v.titulo, ''), v.destino, 'Viagem #' || v.id) AS nome
       FROM viagem_vistorias vv JOIN viagens v ON v.id = vv.viagem_id
       WHERE vv.vistoria_id = $1 AND vv.viagem_id <> $2 LIMIT 1`,
      [vistoriaId, id]
    )
    if (outra.rowCount) {
      return res.status(422).json({
        success: false,
        message: `Esta vistoria já faz parte da viagem “${outra.rows[0].nome}”. Tire-a de lá antes de incluir aqui.`,
      })
    }
    await db.query('INSERT INTO viagem_vistorias (viagem_id, vistoria_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [
      id,
      vistoriaId,
    ])
    res.json({ success: true, data: (await vistoriasDaViagem(id)).rows })
  })
)

router.delete(
  '/viagens/:id/vistorias/:vistoriaId',
  h(async (req, res) => {
    await db.query('DELETE FROM viagem_vistorias WHERE viagem_id = $1 AND vistoria_id = $2', [
      Number(req.params.id),
      Number(req.params.vistoriaId),
    ])
    res.json({ success: true, data: (await vistoriasDaViagem(Number(req.params.id))).rows })
  })
)

// ------------------------------------------------------------- cronograma
router.post(
  '/viagens/:id/itens',
  h(async (req, res) => {
    const id = Number(req.params.id)
    const ok = await db.query('SELECT 1 FROM viagens WHERE id = $1', [id])
    if (!ok.rowCount) return res.status(404).json({ success: false, message: 'Viagem não encontrada' })
    const b = req.body || {}
    if (!String(b.titulo || '').trim()) {
      return res.status(422).json({ success: false, message: 'Descreva o item (ex.: “Voo GRU → CGB”)' })
    }
    const { rows } = await db.query(
      `INSERT INTO viagem_itens (viagem_id, tipo, titulo, inicio, fim, origem, destino, codigo, valor, notificar, lembrete_min, obs, concluido)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING ${ITEM_COLS}`,
      [
        id,
        TIPOS.includes(b.tipo) ? b.tipo : 'outro',
        String(b.titulo).trim(),
        dataOuNulo(b.inicio),
        dataOuNulo(b.fim),
        b.origem || '',
        b.destino || '',
        b.codigo || '',
        num(b.valor),
        b.notificar !== false,
        Number(b.lembreteMin) >= 0 ? Number(b.lembreteMin) : 120,
        b.obs || '',
        !!b.concluido,
      ]
    )
    res.json({ success: true, data: rows[0] })
  })
)

router.put(
  '/viagem-itens/:id',
  h(async (req, res) => {
    const id = Number(req.params.id)
    const cur = await db.query('SELECT * FROM viagem_itens WHERE id = $1', [id])
    if (!cur.rowCount) return res.status(404).json({ success: false, message: 'Item não encontrado' })
    const a = cur.rows[0]
    const b = req.body || {}
    const { rows } = await db.query(
      `UPDATE viagem_itens SET tipo=$1, titulo=$2, inicio=$3, fim=$4, origem=$5, destino=$6, codigo=$7,
        valor=$8, notificar=$9, lembrete_min=$10, obs=$11, concluido=$12 WHERE id=$13 RETURNING ${ITEM_COLS}`,
      [
        TIPOS.includes(b.tipo) ? b.tipo : a.tipo,
        String(b.titulo ?? a.titulo).trim() || a.titulo,
        'inicio' in b ? dataOuNulo(b.inicio) : a.inicio,
        'fim' in b ? dataOuNulo(b.fim) : a.fim,
        b.origem ?? a.origem,
        b.destino ?? a.destino,
        b.codigo ?? a.codigo,
        'valor' in b ? num(b.valor) : a.valor,
        'notificar' in b ? !!b.notificar : a.notificar,
        'lembreteMin' in b ? Number(b.lembreteMin) || 0 : a.lembrete_min,
        b.obs ?? a.obs,
        'concluido' in b ? !!b.concluido : a.concluido,
        id,
      ]
    )
    res.json({ success: true, data: rows[0] })
  })
)

router.delete(
  '/viagem-itens/:id',
  h(async (req, res) => {
    const r = await db.query('DELETE FROM viagem_itens WHERE id = $1', [Number(req.params.id)])
    if (!r.rowCount) return res.status(404).json({ success: false, message: 'Item não encontrado' })
    res.json({ success: true, message: 'Item excluído' })
  })
)

// ---------------------------------------------------------------- despesas
// A despesa é da VIAGEM (a verba é da viagem inteira); `vistoriaId` é opcional,
// para quando o gasto pertence claramente a uma das vistorias.
router.post(
  '/viagens/:id/despesas',
  upload.single('comprovante'),
  h(async (req, res) => {
    const id = Number(req.params.id)
    const existe = await db.query('SELECT 1 FROM viagens WHERE id = $1', [id])
    if (!existe.rowCount) {
      if (req.file) await fs.promises.unlink(req.file.path).catch(() => {})
      return res.status(404).json({ success: false, message: 'Viagem não encontrada' })
    }
    const b = req.body || {}
    let arquivo = ''
    if (req.file) {
      try {
        arquivo = await salvarComprovante(req.file.path, nomeOriginal(req.file), `viagem-${id}`)
      } catch (err) {
        return res.status(422).json({ success: false, message: err.message })
      }
    }
    const { rows } = await db.query(
      `INSERT INTO despesas (viagem_id, vistoria_id, categoria, descricao, valor, data, arquivo, nome_original)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${DESPESA_COLS}`,
      [
        id,
        b.vistoriaId ? Number(b.vistoriaId) : null,
        CATEGORIAS.includes(b.categoria) ? b.categoria : 'outro',
        b.descricao || '',
        num(b.valor),
        b.data || null,
        arquivo,
        req.file ? nomeOriginal(req.file) : '',
      ]
    )
    res.json({ success: true, data: rows[0] })
  })
)

router.get(
  '/despesas/:id/comprovante',
  h(async (req, res) => {
    const { rows } = await db.query('SELECT arquivo, nome_original FROM despesas WHERE id = $1', [Number(req.params.id)])
    if (!rows[0]?.arquivo) return res.status(404).json({ success: false, message: 'Sem comprovante' })
    res.sendFile(absPath(rows[0].arquivo), {
      headers: {
        'Content-Disposition': `inline; filename="${encodeURIComponent(rows[0].nome_original || 'comprovante')}"`,
      },
    })
  })
)

router.delete(
  '/despesas/:id',
  h(async (req, res) => {
    const id = Number(req.params.id)
    const cur = await db.query('SELECT arquivo FROM despesas WHERE id = $1', [id])
    if (!cur.rowCount) return res.status(404).json({ success: false, message: 'Despesa não encontrada' })
    await db.query('DELETE FROM despesas WHERE id = $1', [id])
    if (cur.rows[0].arquivo) await removerArquivo(cur.rows[0].arquivo)
    res.json({ success: true, message: 'Despesa excluída' })
  })
)

// ------------------------------------------------- relatório em Excel
// Preenche a planilha-modelo com os gastos da viagem. A IA decide a coluna de
// cada despesa (metrô, ônibus, uber, alimentação…); ?ia=0 usa só a regra fixa.
router.get(
  '/viagens/:id/relatorio.xlsx',
  h(async (req, res) => {
    const id = Number(req.params.id)
    const dados = await dadosDaViagem(id)
    if (!dados) return res.status(404).json({ success: false, message: 'Viagem não encontrada' })
    const relatorio = require('./relatorio')
    const { buffer, viaIA, sobra } = await relatorio.gerar(dados, { usarIA: req.query.ia !== '0' })
    const nome = `Relatorio de Despesas - ${(dados.viagem.titulo || dados.viagem.destino || 'viagem').replace(/[\/:*?"<>|]/g, '-')}.xlsx`
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(nome)}`)
    res.setHeader('X-Classificacao', viaIA ? 'ia' : 'regra')
    if (sobra) res.setHeader('X-Despesas-Fora', String(sobra))
    res.send(Buffer.from(buffer))
  })
)

// ------------------------------------- importar fatura / extrato / Uber CSV
// A leitura demora (extração + IA), então segue o padrão: dispara e consulta.
router.post(
  '/viagens/:id/fatura',
  upload.single('fatura'),
  h(async (req, res) => {
    const id = Number(req.params.id)
    const v = await db.query('SELECT to_char(inicio,\'YYYY-MM-DD\') AS inicio, to_char(fim,\'YYYY-MM-DD\') AS fim FROM viagens WHERE id = $1', [id])
    if (!v.rowCount) {
      if (req.file) await fs.promises.unlink(req.file.path).catch(() => {})
      return res.status(404).json({ success: false, message: 'Viagem não encontrada' })
    }
    if (!req.file) return res.status(422).json({ success: false, message: 'Arquivo não enviado' })
    let rel
    try {
      rel = await salvarFatura(req.file.path, nomeOriginal(req.file), id)
    } catch (err) {
      return res.status(422).json({ success: false, message: err.message })
    }
    const p = v.rows[0]
    const periodo = p.inicio ? `${p.inicio} a ${p.fim || p.inicio}` : ''
    const leituraId = fatura.iniciar(id, absPath(rel), { periodo })
    res.json({ success: true, data: { leituraId, arquivo: rel, nome: nomeOriginal(req.file) } })
  })
)

router.get(
  '/fatura/leituras/:leituraId',
  h(async (req, res) => {
    const info = fatura.consultar(req.params.leituraId)
    if (!info) return res.status(404).json({ success: false, message: 'Leitura não encontrada — importe de novo' })
    res.json({ success: true, data: info })
  })
)

// Cria em lote as despesas escolhidas na conferência da fatura. O arquivo da
// fatura vira o comprovante de todas elas (é ele que prova o gasto).
router.post(
  '/viagens/:id/despesas/lote',
  h(async (req, res) => {
    const id = Number(req.params.id)
    const existe = await db.query('SELECT 1 FROM viagens WHERE id = $1', [id])
    if (!existe.rowCount) return res.status(404).json({ success: false, message: 'Viagem não encontrada' })
    const lista = Array.isArray((req.body || {}).despesas) ? req.body.despesas : []
    if (!lista.length) return res.status(422).json({ success: false, message: 'Nada selecionado' })
    const arquivo = String((req.body || {}).arquivo || '')
    const nome = String((req.body || {}).nomeArquivo || 'fatura')

    const client = await db.pool.connect()
    let criadas = 0
    try {
      await client.query('BEGIN')
      for (const d of lista) {
        const valor = num(d.valor)
        if (!valor) continue
        await client.query(
          `INSERT INTO despesas (viagem_id, vistoria_id, categoria, descricao, valor, data, arquivo, nome_original)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            id,
            d.vistoriaId ? Number(d.vistoriaId) : null,
            CATEGORIAS.includes(d.categoria) ? d.categoria : 'outro',
            String(d.descricao || '').slice(0, 200),
            valor,
            d.data || null,
            arquivo,
            nome,
          ]
        )
        criadas++
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
    res.json({ success: true, data: { criadas } })
  })
)

// ----------------------------------------------------- calendário (.ics)
const escICS = (s) =>
  String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')

const dataICS = (d) => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

// Quebra em linhas de 75 octetos, como manda o formato.
const dobrar = (linha) => {
  const partes = []
  let atual = linha
  while (atual.length > 74) {
    partes.push(atual.slice(0, 74))
    atual = ' ' + atual.slice(74)
  }
  partes.push(atual)
  return partes.join('\r\n')
}

router.get(
  '/viagens/:id/calendario.ics',
  h(async (req, res) => {
    const id = Number(req.params.id)
    const v = await db.query('SELECT * FROM viagens WHERE id = $1', [id])
    if (!v.rowCount) return res.status(404).json({ success: false, message: 'Viagem não encontrada' })
    const viagem = v.rows[0]
    const [vistorias, itens] = await Promise.all([
      vistoriasDaViagem(id),
      db.query('SELECT * FROM viagem_itens WHERE viagem_id = $1 ORDER BY inicio NULLS LAST, id', [id]),
    ])

    const linhas = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Sistema Julia//Viagens//PT', 'CALSCALE:GREGORIAN']
    const agora = dataICS(new Date())

    // Cada vistoria da viagem vira um evento do dia.
    for (const vi of vistorias.rows) {
      if (!vi.dataVistoria) continue
      linhas.push(
        'BEGIN:VEVENT',
        `UID:vistoria-${vi.id}@sistema-julia`,
        `DTSTAMP:${agora}`,
        `DTSTART;VALUE=DATE:${vi.dataVistoria.replace(/-/g, '')}`,
        `SUMMARY:${escICS(`Vistoria: ${vi.imovelNome} (${vi.tipoServico || 'vistoria'})`)}`,
        `LOCATION:${escICS(vi.endereco || '')}`,
        `DESCRIPTION:${escICS(`Cliente: ${vi.clienteNome}`)}`,
        'END:VEVENT'
      )
    }

    for (const it of itens.rows) {
      if (!it.inicio) continue // sem hora não vira evento
      const fim = it.fim || new Date(new Date(it.inicio).getTime() + 60 * 60 * 1000)
      const detalhes = [
        it.origem || it.destino ? `${it.origem || '?'} → ${it.destino || '?'}` : '',
        it.codigo ? `Código/localizador: ${it.codigo}` : '',
        Number(it.valor) ? `Valor: R$ ${Number(it.valor).toFixed(2)}` : '',
        it.obs || '',
      ]
        .filter(Boolean)
        .join('\n')
      linhas.push(
        'BEGIN:VEVENT',
        `UID:viagem-item-${it.id}@sistema-julia`,
        `DTSTAMP:${agora}`,
        `DTSTART:${dataICS(it.inicio)}`,
        `DTEND:${dataICS(fim)}`,
        `SUMMARY:${escICS(`${it.tipo === 'outro' ? '' : it.tipo.toUpperCase() + ' · '}${it.titulo}`)}`,
        `LOCATION:${escICS(it.destino || viagem.destino || '')}`,
        `DESCRIPTION:${escICS(detalhes)}`
      )
      if (it.notificar) {
        linhas.push(
          'BEGIN:VALARM',
          'ACTION:DISPLAY',
          `TRIGGER:-PT${Math.max(0, Number(it.lembrete_min) || 0)}M`,
          `DESCRIPTION:${escICS(it.titulo)}`,
          'END:VALARM'
        )
      }
      linhas.push('END:VEVENT')
    }
    linhas.push('END:VCALENDAR')

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="viagem-${id}-cronograma.ics"`)
    res.send(linhas.map(dobrar).join('\r\n'))
  })
)

// -------------------------------------------- cronograma geral (agenda)
router.get(
  '/cronograma',
  h(async (req, res) => {
    const dias = Math.min(Math.max(Number(req.query.dias || 60), 1), 365)
    const { rows } = await db.query(
      `SELECT it.id, it.tipo, it.titulo, it.inicio, it.fim, it.origem, it.destino, it.codigo,
        it.valor::float8 AS valor, it.notificar, it.obs, it.concluido, v.id AS "viagemId",
        COALESCE(NULLIF(v.titulo, ''), v.destino, 'Viagem') AS "viagemTitulo",
        v.responsavel_id AS "responsavelId", u.name AS "responsavelNome",
        (SELECT string_agg(DISTINCT ${db.CLIENTE_NOME}, ', ') FROM viagem_vistorias vv
          JOIN vistorias vi ON vi.id = vv.vistoria_id
          JOIN imoveis i ON i.id = vi.imovel_id
          JOIN clients c ON c.id = i.client_id
          WHERE vv.viagem_id = v.id) AS "clientes",
        (SELECT string_agg(i.nome, ', ') FROM viagem_vistorias vv
          JOIN vistorias vi ON vi.id = vv.vistoria_id
          JOIN imoveis i ON i.id = vi.imovel_id
          WHERE vv.viagem_id = v.id) AS "imoveis"
       FROM viagem_itens it
       JOIN viagens v ON v.id = it.viagem_id
       LEFT JOIN users u ON u.id = v.responsavel_id
       WHERE it.inicio IS NOT NULL AND it.inicio >= now() - interval '1 day'
         AND it.inicio <= now() + ($1 || ' days')::interval
       ORDER BY it.inicio`,
      [String(dias)]
    )
    res.json({ success: true, data: rows })
  })
)

// ------------------------------------------------------------- financeiro
// A verba da viagem pela ótica do escritório: quanto foi disponibilizado a cada
// analista para ir a campo, quantos dias ele ficou fora, quanto já voltou
// comprovado (alimentação, transporte/Uber, hospedagem, passagem) e quanto
// ainda falta prestar contas. É a mesma base da planilha de despesas de viagem
// (/viagens/:id/relatorio.xlsx), só que somada por viagem e por analista.
const CATEGORIA_LABEL = {
  passagem: 'Passagem',
  hospedagem: 'Hospedagem',
  transporte: 'Transporte (Uber, táxi, ônibus)',
  alimentacao: 'Alimentação',
  outro: 'Outros',
}

// As colunas da planilha de despesas da Julia (templates/relatorio-despesas.xlsx).
// O Financeiro mostra o gasto já separado por elas, para bater com o arquivo.
const PLANILHA_LABEL = {
  metro: 'Metrô',
  uber: 'Uber / táxi',
  onibus: 'Ônibus',
  aliment: 'Alimentação',
  correio: 'Correio',
  taxas: 'Taxas',
  terceiros: 'Terceiros (passagem, hotel…)',
}

router.get(
  '/financeiro',
  permitir(...PAPEIS_FINANCEIRO, 'arquiteto'),
  h(async (req, res) => {
    const inicio = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.inicio || '')) ? req.query.inicio : null
    const fim = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.fim || '')) ? req.query.fim : null
    const responsavelId = Number(req.query.responsavelId) || null

    const { rows } = await db.query(
      `SELECT ${VIAGEM_COLS},
        CASE WHEN v.inicio IS NULL THEN NULL
             ELSE (COALESCE(v.fim, v.inicio) - v.inicio + 1) END AS dias,
        (SELECT COUNT(*)::int FROM viagem_vistorias vv WHERE vv.viagem_id = v.id) AS vistorias,
        (SELECT string_agg(DISTINCT ${db.CLIENTE_NOME}, ', ') FROM viagem_vistorias vv
          JOIN vistorias vi ON vi.id = vv.vistoria_id
          JOIN imoveis i ON i.id = vi.imovel_id
          JOIN clients c ON c.id = i.client_id
          WHERE vv.viagem_id = v.id) AS clientes,
        g.gasto, g.passagem, g.hospedagem, g.transporte, g.alimentacao, g.outro,
        g.despesas, g."semComprovante"
       FROM viagens v
       LEFT JOIN users u ON u.id = v.responsavel_id
       LEFT JOIN LATERAL (
         SELECT COALESCE(SUM(d.valor), 0)::float8 AS gasto,
           COALESCE(SUM(d.valor) FILTER (WHERE d.categoria = 'passagem'), 0)::float8 AS passagem,
           COALESCE(SUM(d.valor) FILTER (WHERE d.categoria = 'hospedagem'), 0)::float8 AS hospedagem,
           COALESCE(SUM(d.valor) FILTER (WHERE d.categoria = 'transporte'), 0)::float8 AS transporte,
           COALESCE(SUM(d.valor) FILTER (WHERE d.categoria = 'alimentacao'), 0)::float8 AS alimentacao,
           COALESCE(SUM(d.valor) FILTER (WHERE d.categoria = 'outro'), 0)::float8 AS outro,
           COUNT(*)::int AS despesas,
           (COUNT(*) FILTER (WHERE d.arquivo = ''))::int AS "semComprovante"
         FROM despesas d WHERE d.viagem_id = v.id
       ) g ON TRUE
       WHERE ($1::date IS NULL OR COALESCE(v.fim, v.inicio, v.created_at::date) >= $1)
         AND ($2::date IS NULL OR COALESCE(v.inicio, v.created_at::date) <= $2)
         AND ($3::int IS NULL OR v.responsavel_id = $3)
       ORDER BY COALESCE(v.inicio, v.created_at::date) DESC, v.id DESC
       LIMIT 500`,
      [inicio, fim, responsavelId]
    )

    const hoje = new Date().toISOString().slice(0, 10)
    const viagens = rows.map((v) => {
      const verba = Number(v.verba) || 0
      const gasto = Number(v.gasto) || 0
      const dias = v.dias == null ? null : Math.max(1, Number(v.dias))
      // Encerrada é a viagem que já voltou: é dela que se cobra a prestação de contas.
      const encerrada = !!(v.fim || v.inicio) && String(v.fim || v.inicio) < hoje
      return {
        ...v,
        verba,
        gasto,
        dias,
        saldo: verba - gasto,
        // O "valor do dia" do analista: verba dividida pelos dias em campo.
        porDia: dias ? verba / dias : null,
        // Viagem encerrada com saldo é viagem que ainda não prestou contas.
        encerrada,
      }
    })

    // Gasto separado pelas colunas da planilha (regra fixa; a IA só entra na
    // hora de gerar o arquivo, onde ela lê a descrição de cada lançamento).
    const { colunaPorRegra } = require('./relatorio')
    const planilha = { metro: 0, uber: 0, onibus: 0, aliment: 0, correio: 0, taxas: 0, terceiros: 0 }
    const ids = rows.map((v) => v.id)
    if (ids.length) {
      const desp = await db.query(
        'SELECT categoria, descricao, valor::float8 AS valor FROM despesas WHERE viagem_id = ANY($1::int[])',
        [ids]
      )
      for (const dsp of desp.rows) planilha[colunaPorRegra(dsp)] += Number(dsp.valor || 0)
    }

    const soma = (lista, campo) => lista.reduce((s, x) => s + Number(x[campo] || 0), 0)
    const porAnalista = []
    for (const v of viagens) {
      const chave = v.responsavelId || 0
      let a = porAnalista.find((x) => x.responsavelId === chave)
      if (!a) {
        a = { responsavelId: chave, nome: v.responsavelNome || 'Sem responsável', viagens: 0, dias: 0, verba: 0, gasto: 0, saldo: 0 }
        porAnalista.push(a)
      }
      a.viagens += 1
      a.dias += v.dias || 0
      a.verba += v.verba
      a.gasto += v.gasto
      a.saldo += v.saldo
    }
    porAnalista.sort((x, y) => y.verba - x.verba)

    res.json({
      success: true,
      data: {
        viagens,
        porAnalista,
        categorias: CATEGORIA_LABEL,
        planilha,
        planilhaLabels: PLANILHA_LABEL,
        totais: {
          verba: soma(viagens, 'verba'),
          gasto: soma(viagens, 'gasto'),
          saldo: soma(viagens, 'verba') - soma(viagens, 'gasto'),
          dias: soma(viagens, 'dias'),
          aPrestar: soma(viagens.filter((v) => v.encerrada && v.saldo > 0), 'saldo'),
          excedido: soma(viagens.filter((v) => v.saldo < 0), 'saldo'),
          alimentacao: soma(viagens, 'alimentacao'),
          transporte: soma(viagens, 'transporte'),
          hospedagem: soma(viagens, 'hospedagem'),
          passagem: soma(viagens, 'passagem'),
          outro: soma(viagens, 'outro'),
          semComprovante: soma(viagens, 'semComprovante'),
        },
      },
    })
  })
)

module.exports = router
