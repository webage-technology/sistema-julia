'use strict'

// Painel inicial e busca global.
//   • /painel: o que precisa de atenção hoje — as próximas vistorias, os
//     relatórios que ainda não saíram, a SUA próxima vistoria (a de quem está
//     olhando o painel), processos por etapa, prazos, documentos pendentes,
//     verba das viagens, avisos não lidos e o estado do backup.
//   • /busca?q=: uma caixa só (Ctrl+K) que acha cliente, imóvel, processo,
//     vistoria, protocolo, laudo e arquivo.
const express = require('express')
const db = require('./db')
const { authMiddleware } = require('./auth')
const { listarPrazos } = require('./processos')
const escritorio = require('./escritorio')

const router = express.Router()
router.use(authMiddleware)

// Pedaços que as três listas de vistoria do painel repetem.
const VISTORIA_COLS = `v.id, to_char(v.data_vistoria, 'YYYY-MM-DD') AS "dataVistoria", v.tipo_servico AS "tipoServico",
  v.status, i.nome AS "imovelNome", v.imovel_id AS "imovelId", ${db.CLIENTE_NOME} AS "clienteNome",
  v.responsavel_id AS "responsavelId", u.name AS "responsavelNome"`
const VISTORIA_DE = `FROM vistorias v JOIN imoveis i ON i.id = v.imovel_id JOIN clients c ON c.id = i.client_id
  LEFT JOIN users u ON u.id = v.responsavel_id`
const VISTORIA_VIVA = 'v.excluido_em IS NULL AND i.excluido_em IS NULL'

const h = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error('[painel]', err.message)
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Erro interno' })
  })

router.get(
  '/painel',
  h(async (req, res) => {
    const eu = Number(req.user.sub)
    const [etapas, atrasados, prazos, proximas, pendentes, minhaProxima, meuResumo, statusVistorias, docs, financeiro, naoLidas, laudos, fotosMes] = await Promise.all([
      db.query("SELECT etapa, COUNT(*)::int AS n FROM processos WHERE excluido_em IS NULL GROUP BY etapa"),
      db.query(
        "SELECT COUNT(*)::int AS n FROM processos WHERE excluido_em IS NULL AND previsao < CURRENT_DATE AND etapa NOT IN ('concluido','arquivado')"
      ),
      listarPrazos(7),
      // Próximas vistorias: as que estão por vir, não só as desta semana — a
      // agenda de campo é o que o escritório olha primeiro.
      db.query(
        `SELECT ${VISTORIA_COLS}, (v.data_vistoria - CURRENT_DATE)::int AS dias
         ${VISTORIA_DE}
         WHERE ${VISTORIA_VIVA} AND v.status <> 'concluida' AND v.data_vistoria >= CURRENT_DATE
         ORDER BY v.data_vistoria, v.id LIMIT 8`
      ),
      // Relatórios pendentes: o campo acabou (status 'relatorio') e o laudo não
      // saiu. `rascunhos` diz se alguém já começou a escrever.
      db.query(
        `SELECT ${VISTORIA_COLS}, (CURRENT_DATE - v.data_vistoria)::int AS "diasParado",
          (SELECT COUNT(*)::int FROM relatorios r WHERE r.vistoria_id = v.id) AS rascunhos,
          (SELECT COUNT(*)::int FROM laudos l WHERE l.vistoria_id = v.id) AS emitidos
         ${VISTORIA_DE}
         WHERE ${VISTORIA_VIVA} AND v.status = 'relatorio'
         ORDER BY v.data_vistoria NULLS LAST, v.id LIMIT 8`
      ),
      // A vistoria mais próxima de QUEM está olhando o painel (é responsável por
      // ela): vai com o detalhe de quem precisa sair para o campo.
      db.query(
        `SELECT ${VISTORIA_COLS}, (v.data_vistoria - CURRENT_DATE)::int AS dias,
          v.participantes, i.endereco, i.municipio, i.uf, i.planta_path <> '' AS "temPlanta",
          pr.numero AS "processoNumero", v.processo_id AS "processoId",
          (SELECT COUNT(*)::int FROM ambientes a JOIN pavimentos p ON p.id = a.pavimento_id WHERE p.vistoria_id = v.id) AS ambientes,
          (SELECT COUNT(*)::int FROM fotos f WHERE f.vistoria_id = v.id) AS fotos,
          (SELECT COALESCE(NULLIF(vg.titulo, ''), vg.destino, 'Viagem') FROM viagem_vistorias vv
            JOIN viagens vg ON vg.id = vv.viagem_id WHERE vv.vistoria_id = v.id ORDER BY vg.id LIMIT 1) AS "viagemTitulo"
         ${VISTORIA_DE} LEFT JOIN processos pr ON pr.id = v.processo_id
         WHERE ${VISTORIA_VIVA} AND v.responsavel_id = $1 AND v.status <> 'concluida' AND v.data_vistoria >= CURRENT_DATE
         ORDER BY v.data_vistoria, v.id LIMIT 1`,
        [eu]
      ),
      db.query(
        `SELECT COUNT(*) FILTER (WHERE v.status <> 'concluida')::int AS abertas,
          COUNT(*) FILTER (WHERE v.data_vistoria = CURRENT_DATE)::int AS hoje,
          COUNT(*) FILTER (WHERE v.status = 'relatorio')::int AS relatorios
         FROM vistorias v WHERE v.excluido_em IS NULL AND v.responsavel_id = $1`,
        [eu]
      ),
      db.query('SELECT status, COUNT(*)::int AS n FROM vistorias WHERE excluido_em IS NULL GROUP BY status'),
      db.query(
        `SELECT COUNT(*)::int AS n, COUNT(DISTINCT d.processo_id)::int AS processos FROM processo_documentos d JOIN processos p ON p.id = d.processo_id
         WHERE d.obrigatorio AND d.status = 'pendente' AND p.excluido_em IS NULL AND p.etapa NOT IN ('concluido','arquivado')`
      ),
      // Verba de viagem: o adiantamento que está na mão dos analistas (viagens
      // que ainda não voltaram), o que já se gastou no mês e o saldo das
      // viagens encerradas que ninguém prestou contas ainda.
      db.query(
        `SELECT
          COALESCE(SUM(v.verba) FILTER (WHERE COALESCE(v.fim, v.inicio) >= CURRENT_DATE OR v.inicio IS NULL), 0)::float8 AS "verbaEmCampo",
          COALESCE((SELECT SUM(d.valor) FROM despesas d WHERE date_trunc('month', d.data) = date_trunc('month', CURRENT_DATE)), 0)::float8 AS "gastoMes",
          COALESCE(SUM(
            CASE WHEN COALESCE(v.fim, v.inicio) < CURRENT_DATE
              THEN v.verba - (SELECT COALESCE(SUM(d.valor), 0) FROM despesas d WHERE d.viagem_id = v.id)
              ELSE 0 END
          ), 0)::float8 AS "aPrestarContas"
         FROM viagens v`
      ),
      db.query(
        "SELECT COUNT(*)::int AS n FROM notificacoes WHERE canal = 'interno' AND (user_id = $1 OR user_id IS NULL) AND lida_em IS NULL",
        [req.user.sub]
      ),
      db.query(
        `SELECT l.id, l.modelo, l.numero, l.versao, l.titulo, l.emitido_em AS "emitidoEm", l.vistoria_id AS "vistoriaId", i.nome AS "imovelNome"
         FROM laudos l JOIN vistorias v ON v.id = l.vistoria_id JOIN imoveis i ON i.id = v.imovel_id ORDER BY l.id DESC LIMIT 5`
      ),
      db.query("SELECT COUNT(*)::int AS n FROM fotos WHERE created_at >= date_trunc('month', CURRENT_DATE)"),
    ])
    const porEtapa = {}
    for (const e of etapas.rows) porEtapa[e.etapa] = e.n
    const porStatus = {}
    for (const s of statusVistorias.rows) porStatus[s.status] = s.n
    res.json({
      success: true,
      data: {
        processos: { total: etapas.rows.reduce((s, e) => s + e.n, 0), porEtapa, atrasados: atrasados.rows[0].n },
        prazos: { itens: prazos.slice(0, 20), total: prazos.length, vencidos: prazos.filter((p) => p.vencido).length },
        vistorias: {
          proximas: proximas.rows,
          relatoriosPendentes: pendentes.rows,
          porStatus,
          fotosMes: fotosMes.rows[0].n,
        },
        minhas: { ...meuResumo.rows[0], proxima: minhaProxima.rows[0] || null },
        documentos: docs.rows[0],
        financeiro: financeiro.rows[0],
        notificacoes: { naoLidas: naoLidas.rows[0].n },
        laudos: laudos.rows,
        backup: req.user.role === 'admin' ? await escritorio.estadoBackup() : null,
      },
    })
  })
)

router.get(
  '/busca',
  h(async (req, res) => {
    const q = String(req.query.q || '').trim()
    if (q.length < 2) return res.json({ success: true, data: { clientes: [], imoveis: [], processos: [], vistorias: [], protocolos: [], laudos: [], arquivos: [] } })
    const like = `%${q}%`
    const numero = /^#?(\d+)$/.exec(q) ? Number(/^#?(\d+)$/.exec(q)[1]) : null
    const [clientes, imoveis, processos, vistorias, protocolos, laudos, arquivos] = await Promise.all([
      db.query(
        `SELECT id, ${db.CLIENTE_NOME} AS nome, documento, email FROM clients c
         WHERE excluido_em IS NULL AND (name ILIKE $1 OR company ILIKE $1 OR documento ILIKE $1 OR email ILIKE $1) ORDER BY name LIMIT 8`,
        [like]
      ),
      db.query(
        `SELECT i.id, i.nome, i.endereco, ${db.CLIENTE_NOME} AS "clienteNome" FROM imoveis i JOIN clients c ON c.id = i.client_id
         WHERE i.excluido_em IS NULL AND (i.nome ILIKE $1 OR i.endereco ILIKE $1 OR i.matricula ILIKE $1 OR i.inscricao ILIKE $1) ORDER BY i.nome LIMIT 8`,
        [like]
      ),
      db.query(
        `SELECT p.id, p.numero, p.titulo, p.etapa, ${db.CLIENTE_NOME} AS "clienteNome" FROM processos p JOIN clients c ON c.id = p.client_id
         WHERE p.excluido_em IS NULL AND (p.numero ILIKE $1 OR p.titulo ILIKE $1 OR p.tipo ILIKE $1 OR ($2::int IS NOT NULL AND p.id = $2)) ORDER BY p.id DESC LIMIT 8`,
        [like, numero]
      ),
      db.query(
        `SELECT v.id, v.tipo_servico AS "tipoServico", to_char(v.data_vistoria, 'YYYY-MM-DD') AS "dataVistoria", v.status, i.nome AS "imovelNome"
         FROM vistorias v JOIN imoveis i ON i.id = v.imovel_id
         WHERE v.excluido_em IS NULL AND (($2::int IS NOT NULL AND v.id = $2) OR i.nome ILIKE $1 OR v.tipo_servico ILIKE $1) ORDER BY v.id DESC LIMIT 8`,
        [like, numero]
      ),
      db.query(
        `SELECT pr.id, pr.numero, pr.assunto, pr.orgao, pr.status, pr.processo_id AS "processoId", p.titulo AS "processoTitulo"
         FROM protocolos pr JOIN processos p ON p.id = pr.processo_id
         WHERE p.excluido_em IS NULL AND (pr.numero ILIKE $1 OR pr.assunto ILIKE $1) ORDER BY pr.id DESC LIMIT 8`,
        [like]
      ),
      db.query(
        `SELECT l.id, l.numero, l.versao, l.modelo, l.titulo, l.vistoria_id AS "vistoriaId", i.nome AS "imovelNome"
         FROM laudos l JOIN vistorias v ON v.id = l.vistoria_id JOIN imoveis i ON i.id = v.imovel_id
         WHERE l.numero ILIKE $1 OR l.titulo ILIKE $1 ORDER BY l.id DESC LIMIT 8`,
        [like]
      ),
      db.query(
        `SELECT a.id, a.nome, a.categoria, a.processo_id AS "processoId", a.imovel_id AS "imovelId", a.client_id AS "clientId"
         FROM arquivos a WHERE (a.nome ILIKE $1 OR a.nome_original ILIKE $1) AND NOT EXISTS (SELECT 1 FROM arquivos n WHERE n.substitui_id = a.id)
         ORDER BY a.id DESC LIMIT 8`,
        [like]
      ),
    ])
    res.json({
      success: true,
      data: {
        clientes: clientes.rows,
        imoveis: imoveis.rows,
        processos: processos.rows,
        vistorias: vistorias.rows,
        protocolos: protocolos.rows,
        laudos: laudos.rows,
        arquivos: arquivos.rows,
      },
    })
  })
)

module.exports = { router }
