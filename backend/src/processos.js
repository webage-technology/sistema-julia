'use strict'

// Processo de regularização — a entidade-mãe do trabalho do escritório.
//
// Um processo é "a regularização da Casa Pacaembu para o habite-se": tem
// cliente, imóvel, etapa, responsável, e agrega o que acontece ao longo de
// meses — vistorias, protocolos na prefeitura com prazo, documentos que o
// cliente precisa entregar, RRTs e despesas reembolsáveis (taxas, cartório,
// cópias). A vistoria continua sendo a unidade do trabalho de campo; o
// processo é o que responde "em que pé está".
const fs = require('node:fs')
const express = require('express')
const db = require('./db')
const { authMiddleware, permitir, PAPEIS_TECNICOS } = require('./auth')
const { upload, absPath, salvarArquivoGenerico, removerArquivo, nomeOriginal, textoDoForm } = require('./uploads')
const auditoria = require('./auditoria')
const { proximoNumero } = require('./escritorio')

const router = express.Router()
router.use(authMiddleware)

const h = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error('[processos]', err.message)
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Erro interno' })
  })

// Etapas na ordem em que um processo anda. `comunique_se` é quando a
// prefeitura devolveu exigências; `aprovacao` é o deferimento aguardando o
// documento final (habite-se, AVCB, alvará).
const ETAPAS = ['levantamento', 'projeto', 'protocolo', 'comunique_se', 'aprovacao', 'concluido', 'arquivado']
const ETAPA_LABEL = {
  levantamento: 'Levantamento',
  projeto: 'Projeto',
  protocolo: 'Protocolado',
  comunique_se: 'Comunique-se',
  aprovacao: 'Aprovação',
  concluido: 'Concluído',
  arquivado: 'Arquivado',
}
const PRIORIDADES = ['baixa', 'normal', 'alta', 'urgente']
const ORGAOS = ['prefeitura', 'bombeiros', 'cartorio', 'cetesb', 'vigilancia', 'condominio', 'outro']
const TIPOS_PROTOCOLO = ['protocolo', 'comunique_se', 'exigencia', 'resposta', 'deferimento', 'indeferimento', 'vistoria_orgao', 'outro']
const STATUS_PROTOCOLO = ['aberto', 'respondido', 'deferido', 'indeferido', 'cancelado']
const STATUS_DOC = ['pendente', 'recebido', 'vencido', 'dispensado']
const STATUS_RRT = ['emitida', 'registrada', 'baixada', 'cancelada']
const CATEGORIAS_DESPESA = ['taxa_prefeitura', 'cartorio', 'bombeiros', 'copias', 'correio', 'deslocamento', 'outro']

const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v))
const dinheiro = (v) => {
  const n = Number(String(v ?? '').replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}
const dataOuNulo = (v) => (v && /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : null)

const PROC_COLS = `p.id, p.numero, p.client_id AS "clientId", p.imovel_id AS "imovelId", p.titulo, p.tipo, p.etapa,
  p.prioridade, p.responsavel_id AS "responsavelId", u.name AS "responsavelNome", p.descricao,
  to_char(p.inicio, 'YYYY-MM-DD') AS inicio, to_char(p.previsao, 'YYYY-MM-DD') AS previsao,
  to_char(p.concluido_em, 'YYYY-MM-DD') AS "concluidoEm", p.created_at AS "createdAt", p.updated_at AS "updatedAt",
  ${db.CLIENTE_NOME} AS "clienteNome", i.nome AS "imovelNome", i.endereco AS "imovelEndereco",
  (SELECT COUNT(*)::int FROM protocolos pr WHERE pr.processo_id = p.id AND pr.status = 'aberto') AS "protocolosAbertos",
  (SELECT to_char(MIN(pr.prazo), 'YYYY-MM-DD') FROM protocolos pr WHERE pr.processo_id = p.id AND pr.status = 'aberto' AND pr.prazo IS NOT NULL) AS "proximoPrazo",
  (SELECT COUNT(*)::int FROM processo_documentos d WHERE d.processo_id = p.id AND d.obrigatorio AND d.status = 'pendente') AS "docsPendentes",
  (SELECT COUNT(*)::int FROM vistorias v WHERE v.processo_id = p.id AND v.excluido_em IS NULL) AS vistorias`

const PROC_DE = `FROM processos p
  JOIN clients c ON c.id = p.client_id
  LEFT JOIN imoveis i ON i.id = p.imovel_id
  LEFT JOIN users u ON u.id = p.responsavel_id`

const PROTO_COLS = `pr.id, pr.processo_id AS "processoId", pr.orgao, pr.tipo, pr.numero, pr.assunto,
  to_char(pr.data, 'YYYY-MM-DD') AS data, to_char(pr.prazo, 'YYYY-MM-DD') AS prazo, pr.status, pr.resposta,
  to_char(pr.respondido_em, 'YYYY-MM-DD') AS "respondidoEm", pr.observacoes, pr.arquivo_id AS "arquivoId",
  pr.created_at AS "createdAt",
  (pr.status = 'aberto' AND pr.prazo IS NOT NULL AND pr.prazo < CURRENT_DATE) AS vencido,
  CASE WHEN pr.prazo IS NULL THEN NULL ELSE (pr.prazo - CURRENT_DATE) END AS "diasParaPrazo"`

const DOC_COLS = `d.id, d.processo_id AS "processoId", d.nome, d.obrigatorio,
  CASE WHEN d.status = 'recebido' AND d.validade IS NOT NULL AND d.validade < CURRENT_DATE THEN 'vencido' ELSE d.status END AS status,
  d.arquivo_id AS "arquivoId", a.nome_original AS "arquivoNome", to_char(d.validade, 'YYYY-MM-DD') AS validade,
  to_char(d.recebido_em, 'YYYY-MM-DD') AS "recebidoEm", d.observacao, d.ordem`

const RRT_COLS = `r.id, r.processo_id AS "processoId", r.vistoria_id AS "vistoriaId", r.user_id AS "userId",
  u.name AS "profissionalNome", u.registro AS "profissionalRegistro", r.tipo, r.numero, r.atividade,
  to_char(r.data, 'YYYY-MM-DD') AS data, r.valor::float8 AS valor, r.status, r.arquivo_id AS "arquivoId",
  a.nome_original AS "arquivoNome", r.observacoes, r.created_at AS "createdAt"`

const DESP_COLS = `dp.id, dp.processo_id AS "processoId", dp.categoria, dp.descricao, dp.valor::float8 AS valor,
  to_char(dp.data, 'YYYY-MM-DD') AS data, dp.reembolsavel, to_char(dp.reembolsado_em, 'YYYY-MM-DD') AS "reembolsadoEm",
  dp.arquivo <> '' AS "temComprovante", dp.nome_original AS "nomeOriginal", dp.created_at AS "createdAt"`

async function carregarProcesso(id) {
  const { rows } = await db.query(`SELECT ${PROC_COLS} ${PROC_DE} WHERE p.id = $1 AND p.excluido_em IS NULL`, [id])
  return rows[0] || null
}

const listarProtocolos = (pid) =>
  db.query(`SELECT ${PROTO_COLS} FROM protocolos pr WHERE pr.processo_id = $1 ORDER BY pr.data DESC NULLS LAST, pr.id DESC`, [pid])
const listarDocumentos = (pid) =>
  db.query(
    `SELECT ${DOC_COLS} FROM processo_documentos d LEFT JOIN arquivos a ON a.id = d.arquivo_id
     WHERE d.processo_id = $1 ORDER BY d.ordem, d.id`,
    [pid]
  )
const listarRrts = (pid) =>
  db.query(
    `SELECT ${RRT_COLS} FROM rrts r LEFT JOIN users u ON u.id = r.user_id LEFT JOIN arquivos a ON a.id = r.arquivo_id
     WHERE r.processo_id = $1 ORDER BY r.data DESC NULLS LAST, r.id DESC`,
    [pid]
  )
const listarDespesas = (pid) =>
  db.query(`SELECT ${DESP_COLS} FROM despesas_processo dp WHERE dp.processo_id = $1 ORDER BY dp.data DESC NULLS LAST, dp.id DESC`, [pid])

function resumoFinanceiro(despesas) {
  const soma = (lista) => lista.reduce((s, x) => s + Number(x.valor || 0), 0)
  return {
    despesas: soma(despesas),
    reembolsoPendente: soma(despesas.filter((d) => d.reembolsavel && !d.reembolsadoEm)),
  }
}

// ---------------------------------------------------------------- processos
router.get(
  '/processos',
  h(async (req, res) => {
    const { rows } = await db.query(
      `SELECT ${PROC_COLS} ${PROC_DE}
       WHERE p.excluido_em IS NULL
         AND ($1::text IS NULL OR p.etapa = $1)
         AND ($2::int IS NULL OR p.client_id = $2)
         AND ($3::int IS NULL OR p.imovel_id = $3)
         AND ($4::int IS NULL OR p.responsavel_id = $4)
       ORDER BY array_position($5::text[], p.etapa), p.updated_at DESC, p.id DESC`,
      [req.query.etapa || null, num(req.query.clientId), num(req.query.imovelId), num(req.query.responsavelId), ETAPAS]
    )
    res.json({ success: true, data: rows, etapas: ETAPAS, etapaLabel: ETAPA_LABEL })
  })
)

router.post(
  '/processos',
  h(async (req, res) => {
    const b = req.body || {}
    if (!num(b.clientId) || !String(b.titulo || '').trim()) {
      return res.status(422).json({ success: false, message: 'Cliente e título são obrigatórios' })
    }
    const cli = await db.query('SELECT 1 FROM clients WHERE id = $1 AND excluido_em IS NULL', [num(b.clientId)])
    if (!cli.rowCount) return res.status(422).json({ success: false, message: 'Cliente não encontrado' })
    if (num(b.imovelId)) {
      const im = await db.query('SELECT 1 FROM imoveis WHERE id = $1 AND client_id = $2 AND excluido_em IS NULL', [num(b.imovelId), num(b.clientId)])
      if (!im.rowCount) return res.status(422).json({ success: false, message: 'O imóvel precisa ser do mesmo cliente' })
    }
    const numero = await proximoNumero('PROC')
    const tipo = String(b.tipo || '').trim()
    const { rows } = await db.query(
      `INSERT INTO processos (numero, client_id, imovel_id, titulo, tipo, etapa, prioridade, responsavel_id, descricao, inicio, previsao)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [
        numero,
        num(b.clientId),
        num(b.imovelId),
        String(b.titulo).trim(),
        tipo,
        ETAPAS.includes(b.etapa) ? b.etapa : 'levantamento',
        PRIORIDADES.includes(b.prioridade) ? b.prioridade : 'normal',
        num(b.responsavelId) || req.user.sub,
        String(b.descricao || ''),
        dataOuNulo(b.inicio) || new Date().toISOString().slice(0, 10),
        dataOuNulo(b.previsao),
      ]
    )
    const id = rows[0].id
    // A lista de documentos exigidos nasce do modelo do tipo de serviço.
    if (tipo) await aplicarDocumentosModelo(id, tipo)
    if (num(b.vistoriaId)) await db.query('UPDATE vistorias SET processo_id = $1 WHERE id = $2', [id, num(b.vistoriaId)])
    await auditoria.registrar(req, { acao: 'criar', entidade: 'processo', entidadeId: id, processoId: id, descricao: `Processo ${numero} criado: ${String(b.titulo).trim()}` })
    res.json({ success: true, data: { id, numero } })
  })
)

async function aplicarDocumentosModelo(processoId, tipo) {
  const norm = (s) => String(s || '').trim().toLowerCase()
  const modelo = await db.query('SELECT nome, obrigatorio, descricao, ordem FROM documentos_modelo WHERE lower(tipo_servico) = lower($1) ORDER BY ordem, id', [tipo])
  const jaTem = await db.query('SELECT nome FROM processo_documentos WHERE processo_id = $1', [processoId])
  const nomes = new Set(jaTem.rows.map((r) => norm(r.nome)))
  let n = 0
  for (const m of modelo.rows) {
    if (nomes.has(norm(m.nome))) continue
    await db.query(
      `INSERT INTO processo_documentos (processo_id, nome, obrigatorio, observacao, ordem)
       VALUES ($1,$2,$3,$4,(SELECT COALESCE(MAX(ordem), -1) + 1 FROM processo_documentos WHERE processo_id = $1))`,
      [processoId, m.nome, m.obrigatorio, m.descricao || '']
    )
    nomes.add(norm(m.nome))
    n++
  }
  return n
}

router.get(
  '/processos/:id',
  h(async (req, res) => {
    const id = Number(req.params.id)
    const p = await carregarProcesso(id)
    if (!p) return res.status(404).json({ success: false, message: 'Processo não encontrado' })
    const [vistorias, protocolos, documentos, rrts, despesas, arquivos, laudos] = await Promise.all([
      db.query(
        `SELECT v.id, v.tipo_servico AS "tipoServico", to_char(v.data_vistoria, 'YYYY-MM-DD') AS "dataVistoria", v.status,
          i.nome AS "imovelNome", u.name AS "responsavelNome",
          (SELECT COUNT(*)::int FROM fotos f WHERE f.vistoria_id = v.id) AS fotos
         FROM vistorias v JOIN imoveis i ON i.id = v.imovel_id LEFT JOIN users u ON u.id = v.responsavel_id
         WHERE v.processo_id = $1 AND v.excluido_em IS NULL ORDER BY v.data_vistoria DESC NULLS LAST, v.id DESC`,
        [id]
      ),
      listarProtocolos(id),
      listarDocumentos(id),
      listarRrts(id),
      listarDespesas(id),
      db.query('SELECT COUNT(*)::int AS c FROM arquivos a WHERE a.processo_id = $1 AND NOT EXISTS (SELECT 1 FROM arquivos n WHERE n.substitui_id = a.id)', [id]),
      db.query(
        `SELECT l.id, l.modelo, l.numero, l.versao, l.titulo, l.emitido_em AS "emitidoEm", l.assinado_em AS "assinadoEm",
          l.aprovado_em AS "aprovadoEm", l.vistoria_id AS "vistoriaId"
         FROM laudos l WHERE l.processo_id = $1 OR l.vistoria_id IN (SELECT id FROM vistorias WHERE processo_id = $1)
         ORDER BY l.id DESC`,
        [id]
      ),
    ])
    res.json({
      success: true,
      data: {
        ...p,
        vistorias: vistorias.rows,
        protocolos: protocolos.rows,
        documentos: documentos.rows,
        rrts: rrts.rows,
        despesas: despesas.rows,
        laudos: laudos.rows,
        arquivos: arquivos.rows[0].c,
        resumo: resumoFinanceiro(despesas.rows),
        etapas: ETAPAS,
        etapaLabel: ETAPA_LABEL,
      },
    })
  })
)

router.put(
  '/processos/:id',
  h(async (req, res) => {
    const id = Number(req.params.id)
    const cur = await db.query('SELECT * FROM processos WHERE id = $1 AND excluido_em IS NULL', [id])
    if (!cur.rowCount) return res.status(404).json({ success: false, message: 'Processo não encontrado' })
    const a = cur.rows[0]
    const b = req.body || {}
    const etapa = ETAPAS.includes(b.etapa) ? b.etapa : a.etapa
    const concluidoEm =
      'concluidoEm' in b ? dataOuNulo(b.concluidoEm) : etapa === 'concluido' && !a.concluido_em ? new Date().toISOString().slice(0, 10) : a.concluido_em
    await db.query(
      `UPDATE processos SET titulo=$1, tipo=$2, etapa=$3, prioridade=$4, responsavel_id=$5, descricao=$6, inicio=$7, previsao=$8,
        concluido_em=$9, imovel_id=$10, updated_at=now() WHERE id=$11`,
      [
        String(b.titulo ?? a.titulo).trim() || a.titulo,
        b.tipo ?? a.tipo,
        etapa,
        PRIORIDADES.includes(b.prioridade) ? b.prioridade : a.prioridade,
        'responsavelId' in b ? num(b.responsavelId) : a.responsavel_id,
        b.descricao ?? a.descricao,
        'inicio' in b ? dataOuNulo(b.inicio) : a.inicio,
        'previsao' in b ? dataOuNulo(b.previsao) : a.previsao,
        concluidoEm,
        'imovelId' in b ? num(b.imovelId) : a.imovel_id,
        id,
      ]
    )
    if (etapa !== a.etapa) {
      await auditoria.registrar(req, { acao: 'etapa', entidade: 'processo', entidadeId: id, processoId: id, descricao: `Etapa: ${ETAPA_LABEL[a.etapa] || a.etapa} → ${ETAPA_LABEL[etapa]}` })
    } else {
      await auditoria.registrar(req, { acao: 'editar', entidade: 'processo', entidadeId: id, processoId: id, descricao: 'Dados do processo' })
    }
    // Tipo novo: os documentos exigidos daquele tipo entram (sem duplicar).
    if (b.tipo && b.tipo !== a.tipo) await aplicarDocumentosModelo(id, b.tipo)
    res.json({ success: true, data: await carregarProcesso(id) })
  })
)

// Exclusão vai para a lixeira (reversível em /lixeira).
router.delete(
  '/processos/:id',
  permitir(...PAPEIS_TECNICOS),
  h(async (req, res) => {
    const id = Number(req.params.id)
    const r = await db.query('UPDATE processos SET excluido_em = now() WHERE id = $1 AND excluido_em IS NULL RETURNING numero, titulo', [id])
    if (!r.rowCount) return res.status(404).json({ success: false, message: 'Processo não encontrado' })
    await auditoria.registrar(req, { acao: 'excluir', entidade: 'processo', entidadeId: id, processoId: id, descricao: `Processo ${r.rows[0].numero} enviado à lixeira` })
    res.json({ success: true, message: 'Processo enviado para a lixeira' })
  })
)

// Vistorias do processo.
router.post(
  '/processos/:id/vistorias',
  h(async (req, res) => {
    const id = Number(req.params.id)
    const vid = num((req.body || {}).vistoriaId)
    const p = await carregarProcesso(id)
    if (!p) return res.status(404).json({ success: false, message: 'Processo não encontrado' })
    const v = await db.query('SELECT imovel_id FROM vistorias WHERE id = $1 AND excluido_em IS NULL', [vid])
    if (!v.rowCount) return res.status(422).json({ success: false, message: 'Vistoria não encontrada' })
    await db.query('UPDATE vistorias SET processo_id = $1 WHERE id = $2', [id, vid])
    // Processo sem imóvel herda o da vistoria.
    if (!p.imovelId) await db.query('UPDATE processos SET imovel_id = $1 WHERE id = $2 AND imovel_id IS NULL', [v.rows[0].imovel_id, id])
    await auditoria.registrar(req, { acao: 'vincular', entidade: 'vistoria', entidadeId: vid, processoId: id, descricao: `Vistoria #${vid} incluída no processo` })
    res.json({ success: true, message: 'Vistoria incluída' })
  })
)

router.delete(
  '/processos/:id/vistorias/:vid',
  h(async (req, res) => {
    await db.query('UPDATE vistorias SET processo_id = NULL WHERE id = $1 AND processo_id = $2', [Number(req.params.vid), Number(req.params.id)])
    res.json({ success: true, message: 'Vistoria desvinculada' })
  })
)

// Aplica (de novo) o modelo de documentos do tipo — para processos criados
// antes de o modelo existir, ou depois de editar o modelo.
router.post(
  '/processos/:id/documentos/aplicar',
  h(async (req, res) => {
    const id = Number(req.params.id)
    const p = await carregarProcesso(id)
    if (!p) return res.status(404).json({ success: false, message: 'Processo não encontrado' })
    const tipo = String((req.body || {}).tipo || p.tipo || '')
    if (!tipo) return res.status(422).json({ success: false, message: 'O processo não tem tipo de serviço' })
    const n = await aplicarDocumentosModelo(id, tipo)
    res.json({ success: true, data: { adicionados: n, documentos: (await listarDocumentos(id)).rows } })
  })
)

// ---------------------------------------------------------------- protocolos
router.post(
  '/processos/:id/protocolos',
  h(async (req, res) => {
    const id = Number(req.params.id)
    const p = await carregarProcesso(id)
    if (!p) return res.status(404).json({ success: false, message: 'Processo não encontrado' })
    const b = req.body || {}
    if (!String(b.assunto || '').trim()) return res.status(422).json({ success: false, message: 'Descreva o assunto do protocolo' })
    const { rows } = await db.query(
      `INSERT INTO protocolos (processo_id, orgao, tipo, numero, assunto, data, prazo, status, observacoes, arquivo_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [
        id,
        ORGAOS.includes(b.orgao) ? b.orgao : 'prefeitura',
        TIPOS_PROTOCOLO.includes(b.tipo) ? b.tipo : 'protocolo',
        String(b.numero || '').trim(),
        String(b.assunto).trim(),
        dataOuNulo(b.data) || new Date().toISOString().slice(0, 10),
        dataOuNulo(b.prazo),
        STATUS_PROTOCOLO.includes(b.status) ? b.status : 'aberto',
        String(b.observacoes || ''),
        num(b.arquivoId),
      ]
    )
    // Um comunique-se muda a etapa do processo sozinho: é o que ele significa.
    if (b.tipo === 'comunique_se' && !['concluido', 'arquivado'].includes(p.etapa)) {
      await db.query("UPDATE processos SET etapa = 'comunique_se', updated_at = now() WHERE id = $1", [id])
    } else if (b.tipo === 'protocolo' && p.etapa === 'projeto') {
      await db.query("UPDATE processos SET etapa = 'protocolo', updated_at = now() WHERE id = $1", [id])
    }
    await auditoria.registrar(req, { acao: 'criar', entidade: 'protocolo', entidadeId: rows[0].id, processoId: id, descricao: `${b.tipo === 'comunique_se' ? 'Comunique-se' : 'Protocolo'} ${b.numero || ''}: ${String(b.assunto).trim()}${b.prazo ? ` (prazo ${b.prazo})` : ''}` })
    res.json({ success: true, data: (await listarProtocolos(id)).rows })
  })
)

router.put(
  '/protocolos/:id',
  h(async (req, res) => {
    const id = Number(req.params.id)
    const cur = await db.query('SELECT * FROM protocolos WHERE id = $1', [id])
    if (!cur.rowCount) return res.status(404).json({ success: false, message: 'Protocolo não encontrado' })
    const a = cur.rows[0]
    const b = req.body || {}
    const status = STATUS_PROTOCOLO.includes(b.status) ? b.status : a.status
    await db.query(
      `UPDATE protocolos SET orgao=$1, tipo=$2, numero=$3, assunto=$4, data=$5, prazo=$6, status=$7, resposta=$8,
        respondido_em=$9, observacoes=$10, arquivo_id=$11 WHERE id=$12`,
      [
        ORGAOS.includes(b.orgao) ? b.orgao : a.orgao,
        TIPOS_PROTOCOLO.includes(b.tipo) ? b.tipo : a.tipo,
        b.numero ?? a.numero,
        String(b.assunto ?? a.assunto).trim() || a.assunto,
        'data' in b ? dataOuNulo(b.data) : a.data,
        'prazo' in b ? dataOuNulo(b.prazo) : a.prazo,
        status,
        b.resposta ?? a.resposta,
        'respondidoEm' in b ? dataOuNulo(b.respondidoEm) : status !== 'aberto' && a.status === 'aberto' && !a.respondido_em ? new Date().toISOString().slice(0, 10) : a.respondido_em,
        b.observacoes ?? a.observacoes,
        'arquivoId' in b ? num(b.arquivoId) : a.arquivo_id,
        id,
      ]
    )
    if (status !== a.status) {
      await auditoria.registrar(req, { acao: 'status', entidade: 'protocolo', entidadeId: id, processoId: a.processo_id, descricao: `Protocolo ${a.numero || a.assunto}: ${a.status} → ${status}` })
      if (status === 'deferido') await db.query("UPDATE processos SET etapa = 'aprovacao', updated_at = now() WHERE id = $1 AND etapa IN ('protocolo','comunique_se')", [a.processo_id])
    }
    res.json({ success: true, data: (await listarProtocolos(a.processo_id)).rows })
  })
)

router.delete(
  '/protocolos/:id',
  permitir(...PAPEIS_TECNICOS),
  h(async (req, res) => {
    const id = Number(req.params.id)
    const cur = await db.query('DELETE FROM protocolos WHERE id = $1 RETURNING processo_id, assunto', [id])
    if (!cur.rowCount) return res.status(404).json({ success: false, message: 'Protocolo não encontrado' })
    await auditoria.registrar(req, { acao: 'excluir', entidade: 'protocolo', entidadeId: id, processoId: cur.rows[0].processo_id, descricao: `Protocolo excluído: ${cur.rows[0].assunto}` })
    res.json({ success: true, data: (await listarProtocolos(cur.rows[0].processo_id)).rows })
  })
)

// ---------------------------------------------------------------- documentos
router.post(
  '/processos/:id/documentos',
  h(async (req, res) => {
    const id = Number(req.params.id)
    const p = await carregarProcesso(id)
    if (!p) return res.status(404).json({ success: false, message: 'Processo não encontrado' })
    const b = req.body || {}
    if (!String(b.nome || '').trim()) return res.status(422).json({ success: false, message: 'Nome do documento é obrigatório' })
    await db.query(
      `INSERT INTO processo_documentos (processo_id, nome, obrigatorio, status, observacao, ordem)
       VALUES ($1,$2,$3,$4,$5,(SELECT COALESCE(MAX(ordem), -1) + 1 FROM processo_documentos WHERE processo_id = $1))`,
      [id, String(b.nome).trim(), b.obrigatorio !== false, STATUS_DOC.includes(b.status) ? b.status : 'pendente', String(b.observacao || '')]
    )
    res.json({ success: true, data: (await listarDocumentos(id)).rows })
  })
)

router.put(
  '/processo-documentos/:id',
  h(async (req, res) => {
    const id = Number(req.params.id)
    const cur = await db.query('SELECT * FROM processo_documentos WHERE id = $1', [id])
    if (!cur.rowCount) return res.status(404).json({ success: false, message: 'Documento não encontrado' })
    const a = cur.rows[0]
    const b = req.body || {}
    const status = STATUS_DOC.includes(b.status) ? b.status : a.status
    const recebido = status === 'recebido' && a.status !== 'recebido'
    await db.query(
      `UPDATE processo_documentos SET nome=$1, obrigatorio=$2, status=$3, arquivo_id=$4, validade=$5, recebido_em=$6, observacao=$7 WHERE id=$8`,
      [
        String(b.nome ?? a.nome).trim() || a.nome,
        'obrigatorio' in b ? !!b.obrigatorio : a.obrigatorio,
        status,
        'arquivoId' in b ? num(b.arquivoId) : a.arquivo_id,
        'validade' in b ? dataOuNulo(b.validade) : a.validade,
        'recebidoEm' in b ? dataOuNulo(b.recebidoEm) : recebido ? new Date().toISOString().slice(0, 10) : a.recebido_em,
        b.observacao ?? a.observacao,
        id,
      ]
    )
    if (status !== a.status) {
      await auditoria.registrar(req, { acao: 'documento', entidade: 'processo_documento', entidadeId: id, processoId: a.processo_id, descricao: `Documento "${a.nome}": ${a.status} → ${status}` })
    }
    res.json({ success: true, data: (await listarDocumentos(a.processo_id)).rows })
  })
)

router.delete(
  '/processo-documentos/:id',
  h(async (req, res) => {
    const cur = await db.query('DELETE FROM processo_documentos WHERE id = $1 RETURNING processo_id', [Number(req.params.id)])
    if (!cur.rowCount) return res.status(404).json({ success: false, message: 'Documento não encontrado' })
    res.json({ success: true, data: (await listarDocumentos(cur.rows[0].processo_id)).rows })
  })
)

// ---------------------------------------------------------------- RRT / ART
router.post(
  '/processos/:id/rrts',
  h(async (req, res) => {
    const id = Number(req.params.id)
    const p = await carregarProcesso(id)
    if (!p) return res.status(404).json({ success: false, message: 'Processo não encontrado' })
    const b = req.body || {}
    const { rows } = await db.query(
      `INSERT INTO rrts (processo_id, vistoria_id, user_id, tipo, numero, atividade, data, valor, status, arquivo_id, observacoes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [
        id,
        num(b.vistoriaId),
        num(b.userId) || req.user.sub,
        b.tipo === 'ART' ? 'ART' : 'RRT',
        String(b.numero || '').trim(),
        String(b.atividade || ''),
        dataOuNulo(b.data),
        dinheiro(b.valor),
        STATUS_RRT.includes(b.status) ? b.status : 'emitida',
        num(b.arquivoId),
        String(b.observacoes || ''),
      ]
    )
    await auditoria.registrar(req, { acao: 'criar', entidade: 'rrt', entidadeId: rows[0].id, processoId: id, descricao: `${b.tipo === 'ART' ? 'ART' : 'RRT'} ${b.numero || ''} registrada` })
    res.json({ success: true, data: (await listarRrts(id)).rows })
  })
)

router.put(
  '/rrts/:id',
  h(async (req, res) => {
    const id = Number(req.params.id)
    const cur = await db.query('SELECT * FROM rrts WHERE id = $1', [id])
    if (!cur.rowCount) return res.status(404).json({ success: false, message: 'RRT não encontrada' })
    const a = cur.rows[0]
    const b = req.body || {}
    await db.query(
      `UPDATE rrts SET vistoria_id=$1, user_id=$2, tipo=$3, numero=$4, atividade=$5, data=$6, valor=$7, status=$8, arquivo_id=$9, observacoes=$10 WHERE id=$11`,
      [
        'vistoriaId' in b ? num(b.vistoriaId) : a.vistoria_id,
        'userId' in b ? num(b.userId) : a.user_id,
        b.tipo === 'ART' || b.tipo === 'RRT' ? b.tipo : a.tipo,
        b.numero ?? a.numero,
        b.atividade ?? a.atividade,
        'data' in b ? dataOuNulo(b.data) : a.data,
        'valor' in b ? dinheiro(b.valor) : a.valor,
        STATUS_RRT.includes(b.status) ? b.status : a.status,
        'arquivoId' in b ? num(b.arquivoId) : a.arquivo_id,
        b.observacoes ?? a.observacoes,
        id,
      ]
    )
    res.json({ success: true, data: (await listarRrts(a.processo_id)).rows })
  })
)

router.delete(
  '/rrts/:id',
  permitir(...PAPEIS_TECNICOS),
  h(async (req, res) => {
    const cur = await db.query('DELETE FROM rrts WHERE id = $1 RETURNING processo_id', [Number(req.params.id)])
    if (!cur.rowCount) return res.status(404).json({ success: false, message: 'RRT não encontrada' })
    res.json({ success: true, data: (await listarRrts(cur.rows[0].processo_id)).rows })
  })
)

// ------------------------------------------------- despesas do processo
router.post(
  '/processos/:id/despesas',
  upload.single('comprovante'),
  h(async (req, res) => {
    const id = Number(req.params.id)
    const p = await carregarProcesso(id)
    if (!p) {
      if (req.file) await fs.promises.unlink(req.file.path).catch(() => {})
      return res.status(404).json({ success: false, message: 'Processo não encontrado' })
    }
    const b = req.body || {}
    let arquivo = ''
    if (req.file) arquivo = await salvarArquivoGenerico(req.file.path, nomeOriginal(req.file), 'despesas-processo')
    const { rows } = await db.query(
      `INSERT INTO despesas_processo (processo_id, categoria, descricao, valor, data, reembolsavel, arquivo, nome_original)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [
        id,
        CATEGORIAS_DESPESA.includes(b.categoria) ? b.categoria : 'outro',
        textoDoForm(b.descricao),
        dinheiro(b.valor),
        dataOuNulo(b.data) || new Date().toISOString().slice(0, 10),
        !(b.reembolsavel === 'false' || b.reembolsavel === false || b.reembolsavel === '0'),
        arquivo,
        req.file ? nomeOriginal(req.file) : '',
      ]
    )
    await auditoria.registrar(req, { acao: 'criar', entidade: 'despesa_processo', entidadeId: rows[0].id, processoId: id, descricao: `Despesa ${b.categoria || 'outro'} de R$ ${dinheiro(b.valor).toFixed(2)}` })
    res.json({ success: true, data: (await listarDespesas(id)).rows })
  })
)

router.put(
  '/despesas-processo/:id',
  h(async (req, res) => {
    const id = Number(req.params.id)
    const cur = await db.query('SELECT * FROM despesas_processo WHERE id = $1', [id])
    if (!cur.rowCount) return res.status(404).json({ success: false, message: 'Despesa não encontrada' })
    const a = cur.rows[0]
    const b = req.body || {}
    await db.query(
      `UPDATE despesas_processo SET categoria=$1, descricao=$2, valor=$3, data=$4, reembolsavel=$5, reembolsado_em=$6 WHERE id=$7`,
      [
        CATEGORIAS_DESPESA.includes(b.categoria) ? b.categoria : a.categoria,
        b.descricao ?? a.descricao,
        'valor' in b ? dinheiro(b.valor) : a.valor,
        'data' in b ? dataOuNulo(b.data) : a.data,
        'reembolsavel' in b ? !!b.reembolsavel : a.reembolsavel,
        'reembolsadoEm' in b ? dataOuNulo(b.reembolsadoEm) : a.reembolsado_em,
        id,
      ]
    )
    res.json({ success: true, data: (await listarDespesas(a.processo_id)).rows })
  })
)

router.delete(
  '/despesas-processo/:id',
  permitir(...PAPEIS_TECNICOS, 'financeiro'),
  h(async (req, res) => {
    const cur = await db.query('DELETE FROM despesas_processo WHERE id = $1 RETURNING processo_id, arquivo', [Number(req.params.id)])
    if (!cur.rowCount) return res.status(404).json({ success: false, message: 'Despesa não encontrada' })
    if (cur.rows[0].arquivo) await removerArquivo(cur.rows[0].arquivo)
    res.json({ success: true, data: (await listarDespesas(cur.rows[0].processo_id)).rows })
  })
)

router.get(
  '/despesas-processo/:id/comprovante',
  h(async (req, res) => {
    const { rows } = await db.query('SELECT arquivo, nome_original FROM despesas_processo WHERE id = $1', [Number(req.params.id)])
    if (!rows[0]?.arquivo) return res.status(404).json({ success: false, message: 'Sem comprovante' })
    res.sendFile(absPath(rows[0].arquivo), {
      headers: { 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(rows[0].nome_original || 'comprovante')}` },
    })
  })
)

// ---------------------------------------------------------------- prazos
// Tudo que tem data para vencer, numa lista só: protocolos abertos e documentos
// recebidos com validade. Alimenta a agenda, o painel e as notificações.
// Inclui o que já venceu (é o mais urgente).
async function listarPrazos(dias = 30) {
  const d = Math.min(Math.max(Number(dias) || 30, 1), 730)
  const [protocolos, documentos] = await Promise.all([
    db.query(
      `SELECT pr.id, pr.tipo, pr.numero, pr.assunto, pr.orgao, to_char(pr.prazo, 'YYYY-MM-DD') AS data,
        p.id AS "processoId", p.numero AS "processoNumero", p.titulo AS "processoTitulo", ${db.CLIENTE_NOME} AS "clienteNome",
        p.responsavel_id AS "responsavelId", (pr.prazo < CURRENT_DATE) AS vencido, (pr.prazo - CURRENT_DATE) AS dias
       FROM protocolos pr JOIN processos p ON p.id = pr.processo_id JOIN clients c ON c.id = p.client_id
       WHERE pr.status = 'aberto' AND pr.prazo IS NOT NULL AND pr.prazo <= CURRENT_DATE + $1::int AND p.excluido_em IS NULL
       ORDER BY pr.prazo`,
      [d]
    ),
    db.query(
      `SELECT dc.id, dc.nome, to_char(dc.validade, 'YYYY-MM-DD') AS data, p.id AS "processoId", p.numero AS "processoNumero",
        p.titulo AS "processoTitulo", ${db.CLIENTE_NOME} AS "clienteNome", p.responsavel_id AS "responsavelId",
        (dc.validade < CURRENT_DATE) AS vencido, (dc.validade - CURRENT_DATE) AS dias
       FROM processo_documentos dc JOIN processos p ON p.id = dc.processo_id JOIN clients c ON c.id = p.client_id
       WHERE dc.status = 'recebido' AND dc.validade IS NOT NULL AND dc.validade <= CURRENT_DATE + $1::int AND p.excluido_em IS NULL
         AND p.etapa NOT IN ('concluido','arquivado')
       ORDER BY dc.validade`,
      [d]
    ),
  ])
  const itens = [
    ...protocolos.rows.map((x) => ({
      chave: `protocolo-${x.id}`,
      tipo: 'protocolo',
      subtipo: x.tipo,
      id: x.id,
      data: x.data,
      dias: x.dias,
      vencido: x.vencido,
      titulo: `${x.tipo === 'comunique_se' ? 'Comunique-se' : 'Protocolo'} ${x.numero || ''}`.trim(),
      detalhe: `${x.assunto} · ${x.orgao}`,
      processoId: x.processoId,
      processoNumero: x.processoNumero,
      processoTitulo: x.processoTitulo,
      clienteNome: x.clienteNome,
      responsavelId: x.responsavelId,
      link: `/processos/${x.processoId}?protocolo=${x.id}`,
    })),
    ...documentos.rows.map((x) => ({
      chave: `documento-${x.id}`,
      tipo: 'documento',
      id: x.id,
      data: x.data,
      dias: x.dias,
      vencido: x.vencido,
      titulo: `Validade: ${x.nome}`,
      detalhe: x.processoTitulo,
      processoId: x.processoId,
      processoNumero: x.processoNumero,
      processoTitulo: x.processoTitulo,
      clienteNome: x.clienteNome,
      responsavelId: x.responsavelId,
      link: `/processos/${x.processoId}?aba=documentos`,
    })),
  ]
  itens.sort((a, b) => String(a.data).localeCompare(String(b.data)))
  return itens
}

router.get(
  '/prazos',
  h(async (req, res) => res.json({ success: true, data: await listarPrazos(req.query.dias || 30) }))
)

// A visão de dinheiro do escritório (verba das viagens, o adiantamento que o
// analista recebe para ir a campo) vive em src/viagens.js — rota /financeiro.

module.exports = { router, listarPrazos, ETAPAS, ETAPA_LABEL, carregarProcesso, aplicarDocumentosModelo }
