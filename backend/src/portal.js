'use strict'

// Portal do cliente — o que o cliente vê sem entrar no sistema da equipe.
//
// Acesso por link privado (/portal/<token>), com senha opcional definida pelo
// escritório. Lá o cliente acompanha a etapa de cada processo, vê os prazos
// abertos, envia os documentos pendentes, baixa os laudos emitidos (e aprova),
// abre os arquivos marcados como visíveis e "anda o caminho" das fotos de uma
// vistoria — o tour navegável.
//
// Nada daqui usa o login da equipe: a sessão do portal é um token próprio
// (signPortal) que o middleware interno recusa.
const crypto = require('node:crypto')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const express = require('express')
const db = require('./db')
const { signPortal, verifyPortal, hashPassword, verifyPassword, authMiddleware, permitir } = require('./auth')
const { upload, absPath, variantes } = require('./uploads')
const arquivos = require('./arquivos')
const auditoria = require('./auditoria')
const escritorio = require('./escritorio')
const { ETAPA_LABEL } = require('./processos')

const h = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error('[portal]', err.message)
    if (!res.headersSent) res.status(err.status || 500).json({ success: false, message: err.status ? err.message : 'Erro interno' })
  })

// ---- lado da equipe: ativar o portal de um cliente -------------------------
const equipe = express.Router()
equipe.use(authMiddleware)

equipe.get(
  '/clients/:id/portal',
  h(async (req, res) => {
    const { rows } = await db.query('SELECT portal_token AS token, portal_ativo AS ativo, portal_senha <> \'\' AS "temSenha" FROM clients WHERE id = $1', [Number(req.params.id)])
    if (!rows[0]) return res.status(404).json({ success: false, message: 'Cliente não encontrado' })
    const cfg = await escritorio.carregar()
    const base = cfg.url_publica ? String(cfg.url_publica).replace(/\/+$/, '') : ''
    res.json({ success: true, data: { ...rows[0], url: rows[0].token ? `${base}/portal/${rows[0].token}` : null } })
  })
)

// Ativa (gerando o token na primeira vez), desativa, define ou remove a senha.
equipe.put(
  '/clients/:id/portal',
  permitir('admin', 'arquiteto'),
  h(async (req, res) => {
    const id = Number(req.params.id)
    const cur = await db.query('SELECT * FROM clients WHERE id = $1', [id])
    if (!cur.rowCount) return res.status(404).json({ success: false, message: 'Cliente não encontrado' })
    const c = cur.rows[0]
    const b = req.body || {}
    const ativo = 'ativo' in b ? !!b.ativo : c.portal_ativo
    let token = c.portal_token
    if ((ativo && !token) || b.novoToken) token = crypto.randomBytes(18).toString('hex')
    let senha = c.portal_senha
    if ('senha' in b) senha = b.senha ? hashPassword(String(b.senha)) : ''
    await db.query('UPDATE clients SET portal_token = $1, portal_ativo = $2, portal_senha = $3 WHERE id = $4', [token, ativo, senha, id])
    await auditoria.registrar(req, { acao: 'portal', entidade: 'cliente', entidadeId: id, descricao: `Portal do cliente ${ativo ? 'ativado' : 'desativado'}${'senha' in b ? (b.senha ? ' com senha' : ' sem senha') : ''}` })
    const cfg = await escritorio.carregar()
    const base = cfg.url_publica ? String(cfg.url_publica).replace(/\/+$/, '') : ''
    res.json({ success: true, data: { token, ativo, temSenha: !!senha, url: token ? `${base}/portal/${token}` : null } })
  })
)

// ---- lado do cliente -------------------------------------------------------
const publico = express.Router()

async function clientePorToken(token) {
  const { rows } = await db.query(
    `SELECT id, ${db.CLIENTE_NOME} AS nome, email, portal_senha AS senha, portal_ativo AS ativo FROM clients c
     WHERE portal_token = $1 AND excluido_em IS NULL`,
    [String(token || '')]
  )
  const c = rows[0]
  if (!c || !c.ativo) return null
  return c
}

// Sessão: sem senha, o link basta; com senha, o header X-Portal-Sessao.
async function portalAuth(req, res, next) {
  try {
    const c = await clientePorToken(req.params.token)
    if (!c) return res.status(404).json({ success: false, message: 'Link inválido ou portal desativado' })
    if (c.senha) {
      const sess = verifyPortal(req.headers['x-portal-sessao'] || req.query.sessao)
      if (sess !== c.id) return res.status(401).json({ success: false, message: 'Informe a senha do portal', precisaSenha: true })
    }
    req.portalCliente = c
    next()
  } catch (err) {
    console.error('[portal]', err.message)
    res.status(500).json({ success: false, message: 'Erro interno' })
  }
}

publico.get(
  '/portal/:token',
  h(async (req, res) => {
    const c = await clientePorToken(req.params.token)
    if (!c) return res.status(404).json({ success: false, message: 'Link inválido ou portal desativado' })
    const e = await escritorio.carregar()
    const sess = verifyPortal(req.headers['x-portal-sessao'] || req.query.sessao)
    res.json({
      success: true,
      data: {
        cliente: { nome: c.nome },
        escritorio: { nomeFantasia: e.nome_fantasia, telefone: e.telefone, email: e.email, site: e.site, temLogo: !!e.logo, cor: e.cor },
        precisaSenha: !!c.senha,
        autenticado: !c.senha || sess === c.id,
      },
    })
  })
)

publico.post(
  '/portal/:token/entrar',
  h(async (req, res) => {
    const c = await clientePorToken(req.params.token)
    if (!c) return res.status(404).json({ success: false, message: 'Link inválido ou portal desativado' })
    if (c.senha && !verifyPassword((req.body || {}).senha, c.senha)) return res.status(401).json({ success: false, message: 'Senha incorreta' })
    res.json({ success: true, data: { sessao: signPortal(c.id) } })
  })
)

publico.get(
  '/portal/:token/dados',
  portalAuth,
  h(async (req, res) => {
    const cid = req.portalCliente.id
    const [processos, vistorias, laudos, arqs] = await Promise.all([
      db.query(
        `SELECT p.id, p.numero, p.titulo, p.tipo, p.etapa, to_char(p.previsao, 'YYYY-MM-DD') AS previsao, i.nome AS "imovelNome",
          u.name AS "responsavelNome", u.telefone AS "responsavelTelefone", u.email AS "responsavelEmail"
         FROM processos p LEFT JOIN imoveis i ON i.id = p.imovel_id LEFT JOIN users u ON u.id = p.responsavel_id
         WHERE p.client_id = $1 AND p.excluido_em IS NULL ORDER BY p.etapa IN ('concluido','arquivado'), p.updated_at DESC`,
        [cid]
      ),
      db.query(
        `SELECT v.id, v.tipo_servico AS "tipoServico", to_char(v.data_vistoria, 'YYYY-MM-DD') AS "dataVistoria", v.status, v.processo_id AS "processoId",
          i.nome AS "imovelNome", (SELECT COUNT(*)::int FROM fotos f WHERE f.vistoria_id = v.id AND f.ambiente_id IS NOT NULL) AS fotos
         FROM vistorias v JOIN imoveis i ON i.id = v.imovel_id WHERE i.client_id = $1 AND v.excluido_em IS NULL AND i.excluido_em IS NULL
         ORDER BY v.data_vistoria DESC NULLS LAST, v.id DESC`,
        [cid]
      ),
      db.query(
        `SELECT l.id, l.modelo, l.numero, l.versao, l.titulo, l.emitido_em AS "emitidoEm", l.assinado_arquivo <> '' AS "temAssinado",
          l.aprovado_em AS "aprovadoEm", l.aprovacao_comentario AS "aprovacaoComentario", l.vistoria_id AS "vistoriaId", l.processo_id AS "processoId", i.nome AS "imovelNome"
         FROM laudos l JOIN vistorias v ON v.id = l.vistoria_id JOIN imoveis i ON i.id = v.imovel_id
         WHERE i.client_id = $1 AND l.visivel_cliente ORDER BY l.id DESC`,
        [cid]
      ),
      db.query(
        `SELECT a.id, a.nome, a.categoria, a.nome_original AS "nomeOriginal", a.created_at AS "createdAt", a.processo_id AS "processoId",
          a.enviado_pelo_cliente AS "enviadoPeloCliente"
         FROM arquivos a LEFT JOIN processos p ON p.id = a.processo_id LEFT JOIN imoveis i ON i.id = a.imovel_id
         WHERE (a.client_id = $1 OR p.client_id = $1 OR i.client_id = $1) AND a.visivel_cliente
           AND NOT EXISTS (SELECT 1 FROM arquivos n WHERE n.substitui_id = a.id) ORDER BY a.id DESC`,
        [cid]
      ),
    ])
    const ids = processos.rows.map((p) => p.id)
    const [protocolos, documentos] = ids.length
      ? await Promise.all([
          db.query(
            `SELECT pr.processo_id AS "processoId", pr.tipo, pr.orgao, pr.numero, pr.assunto, to_char(pr.data, 'YYYY-MM-DD') AS data,
              to_char(pr.prazo, 'YYYY-MM-DD') AS prazo, pr.status
             FROM protocolos pr WHERE pr.processo_id = ANY($1::int[]) ORDER BY pr.data DESC NULLS LAST, pr.id DESC`,
            [ids]
          ),
          db.query(
            `SELECT d.id, d.processo_id AS "processoId", d.nome, d.obrigatorio,
              CASE WHEN d.status = 'recebido' AND d.validade IS NOT NULL AND d.validade < CURRENT_DATE THEN 'vencido' ELSE d.status END AS status,
              to_char(d.validade, 'YYYY-MM-DD') AS validade, d.observacao
             FROM processo_documentos d WHERE d.processo_id = ANY($1::int[]) ORDER BY d.status = 'pendente' DESC, d.ordem, d.id`,
            [ids]
          ),
        ])
      : [{ rows: [] }, { rows: [] }]
    res.json({
      success: true,
      data: {
        processos: processos.rows.map((p) => ({
          ...p,
          etapaLabel: ETAPA_LABEL[p.etapa] || p.etapa,
          protocolos: protocolos.rows.filter((x) => x.processoId === p.id),
          documentos: documentos.rows.filter((x) => x.processoId === p.id),
        })),
        vistorias: vistorias.rows,
        laudos: laudos.rows,
        arquivos: arqs.rows,
        etapas: Object.entries(ETAPA_LABEL).map(([id, label]) => ({ id, label })),
      },
    })
  })
)

// O cliente envia um documento pendente: vira arquivo do GED (marcado como
// enviado pelo cliente) e o item da lista passa a "recebido".
publico.post(
  '/portal/:token/documentos/:docId/enviar',
  portalAuth,
  upload.single('arquivo'),
  h(async (req, res) => {
    const cid = req.portalCliente.id
    const docId = Number(req.params.docId)
    const d = await db.query(
      'SELECT d.*, p.responsavel_id AS "responsavelId", p.titulo AS "processoTitulo" FROM processo_documentos d JOIN processos p ON p.id = d.processo_id WHERE d.id = $1 AND p.client_id = $2 AND p.excluido_em IS NULL',
      [docId, cid]
    )
    if (!d.rowCount) {
      if (req.file) await fsp.unlink(req.file.path).catch(() => {})
      return res.status(404).json({ success: false, message: 'Documento não encontrado' })
    }
    if (!req.file) return res.status(422).json({ success: false, message: 'Arquivo não enviado' })
    const doc = d.rows[0]
    req.user = null
    const arquivoId = await arquivos.inserir(req, {
      processoId: doc.processo_id,
      clientId: cid,
      categoria: 'documento-pessoal',
      nome: doc.nome,
      descricao: 'Enviado pelo cliente pelo portal',
      visivelCliente: true,
      substituiId: doc.arquivo_id || null,
      peloCliente: true,
    })
    await db.query("UPDATE processo_documentos SET status = 'recebido', arquivo_id = $1, recebido_em = CURRENT_DATE WHERE id = $2", [arquivoId, docId])
    await auditoria.registrar(req, { acao: 'documento', entidade: 'processo_documento', entidadeId: docId, processoId: doc.processo_id, descricao: `Cliente enviou "${doc.nome}" pelo portal` })
    try {
      const notificacoes = require('./notificacoes')
      await notificacoes.notificar({
        chave: `portal-doc-${docId}-${arquivoId}`,
        tipo: 'portal',
        titulo: `Documento recebido pelo portal: ${doc.nome}`,
        mensagem: `${req.portalCliente.nome} enviou "${doc.nome}" para o processo ${doc.processoTitulo}.`,
        usuarios: doc.responsavelId ? [doc.responsavelId] : [],
        processoId: doc.processo_id,
        link: `/processos/${doc.processo_id}?aba=documentos`,
      })
    } catch (err) {
      console.error('[portal] notificação: %s', err.message)
    }
    res.json({ success: true, message: 'Documento enviado' })
  })
)

publico.get(
  '/portal/:token/laudos/:id/pdf',
  portalAuth,
  h(async (req, res) => {
    const { rows } = await db.query(
      `SELECT l.numero, l.versao, l.arquivo, l.assinado_arquivo FROM laudos l JOIN vistorias v ON v.id = l.vistoria_id JOIN imoveis i ON i.id = v.imovel_id
       WHERE l.id = $1 AND i.client_id = $2 AND l.visivel_cliente`,
      [Number(req.params.id), req.portalCliente.id]
    )
    if (!rows[0]) return res.status(404).json({ success: false, message: 'Laudo não encontrado' })
    const rel = rows[0].assinado_arquivo || rows[0].arquivo
    if (!fs.existsSync(absPath(rel))) return res.status(404).json({ success: false, message: 'Arquivo indisponível' })
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `inline; filename="${rows[0].numero}-v${rows[0].versao}.pdf"`)
    res.sendFile(absPath(rel))
  })
)

publico.post(
  '/portal/:token/laudos/:id/aprovar',
  portalAuth,
  h(async (req, res) => {
    const id = Number(req.params.id)
    const { rows } = await db.query(
      `SELECT l.id, l.numero, l.versao, l.processo_id, v.responsavel_id AS "responsavelId" FROM laudos l JOIN vistorias v ON v.id = l.vistoria_id JOIN imoveis i ON i.id = v.imovel_id
       WHERE l.id = $1 AND i.client_id = $2 AND l.visivel_cliente`,
      [id, req.portalCliente.id]
    )
    if (!rows[0]) return res.status(404).json({ success: false, message: 'Laudo não encontrado' })
    const comentario = String((req.body || {}).comentario || '').slice(0, 1000)
    await db.query('UPDATE laudos SET aprovado_em = now(), aprovacao_comentario = $1 WHERE id = $2', [comentario, id])
    await auditoria.registrar(req, { acao: 'aprovar', entidade: 'laudo', entidadeId: id, processoId: rows[0].processo_id, descricao: `Cliente aprovou o laudo ${rows[0].numero} v${rows[0].versao}${comentario ? `: ${comentario}` : ''}` })
    try {
      const notificacoes = require('./notificacoes')
      await notificacoes.notificar({
        chave: `portal-aprov-${id}`,
        tipo: 'portal',
        titulo: `Laudo ${rows[0].numero} v${rows[0].versao} aprovado pelo cliente`,
        mensagem: comentario || `${req.portalCliente.nome} aprovou o laudo pelo portal.`,
        usuarios: rows[0].responsavelId ? [rows[0].responsavelId] : [],
        processoId: rows[0].processo_id,
        link: `/relatorios?aba=emitidos`,
      })
    } catch (err) {
      console.error('[portal] notificação: %s', err.message)
    }
    res.json({ success: true, message: 'Aprovação registrada' })
  })
)

publico.get(
  '/portal/:token/arquivos/:id/download',
  portalAuth,
  h(async (req, res) => {
    const cid = req.portalCliente.id
    const { rows } = await db.query(
      `SELECT a.arquivo, a.nome_original FROM arquivos a LEFT JOIN processos p ON p.id = a.processo_id LEFT JOIN imoveis i ON i.id = a.imovel_id
       WHERE a.id = $1 AND a.visivel_cliente AND (a.client_id = $2 OR p.client_id = $2 OR i.client_id = $2)`,
      [Number(req.params.id), cid]
    )
    if (!rows[0]) return res.status(404).json({ success: false, message: 'Arquivo não encontrado' })
    await arquivos.enviarArquivo(res, rows[0].arquivo, rows[0].nome_original, req.query.download === '1')
  })
)

// Tour: a vistoria como caminho — pavimento → ambiente → fotos na ordem real.
publico.get(
  '/portal/:token/vistorias/:vid/tour',
  portalAuth,
  h(async (req, res) => {
    const vid = Number(req.params.vid)
    const v = await db.query(
      `SELECT v.id, v.tipo_servico AS "tipoServico", to_char(v.data_vistoria, 'YYYY-MM-DD') AS "dataVistoria", i.nome AS "imovelNome", i.endereco
       FROM vistorias v JOIN imoveis i ON i.id = v.imovel_id WHERE v.id = $1 AND i.client_id = $2 AND v.excluido_em IS NULL`,
      [vid, req.portalCliente.id]
    )
    if (!v.rowCount) return res.status(404).json({ success: false, message: 'Vistoria não encontrada' })
    const pavs = await db.query('SELECT id, nome FROM pavimentos WHERE vistoria_id = $1 ORDER BY ordem, id', [vid])
    const ambs = await db.query(
      `SELECT a.id, a.pavimento_id AS "pavimentoId", a.nome, a.nota FROM ambientes a JOIN pavimentos p ON p.id = a.pavimento_id
       WHERE p.vistoria_id = $1 AND a.situacao <> 'nao_existe' ORDER BY a.ordem, a.id`,
      [vid]
    )
    const fotos = await db.query(
      `SELECT f.id, f.ambiente_id AS "ambienteId", f.legenda, f.claquete, f.destaque, f.capturada_em AS "capturadaEm",
        row_number() OVER (ORDER BY f.capturada_em NULLS LAST, f.id)::int AS ordem
       FROM fotos f WHERE f.vistoria_id = $1 AND f.ambiente_id IS NOT NULL ORDER BY f.capturada_em NULLS LAST, f.id`,
      [vid]
    )
    // Ordem REAL dos ambientes: pela primeira foto tirada em cada um.
    const primeira = new Map()
    for (const f of fotos.rows) if (!primeira.has(f.ambienteId)) primeira.set(f.ambienteId, f.ordem)
    const pavimentos = pavs.rows.map((p) => ({
      ...p,
      ambientes: ambs.rows
        .filter((a) => a.pavimentoId === p.id && primeira.has(a.id))
        .sort((x, y) => primeira.get(x.id) - primeira.get(y.id))
        .map((a) => ({ ...a, fotos: fotos.rows.filter((f) => f.ambienteId === a.id) })),
    })).filter((p) => p.ambientes.length)
    res.json({ success: true, data: { vistoria: v.rows[0], pavimentos, totalFotos: fotos.rows.length } })
  })
)

publico.get(
  '/portal/:token/fotos/:id/:variant(web|thumb)',
  portalAuth,
  h(async (req, res) => {
    const { rows } = await db.query(
      `SELECT f.arquivo FROM fotos f JOIN vistorias v ON v.id = f.vistoria_id JOIN imoveis i ON i.id = v.imovel_id
       WHERE f.id = $1 AND i.client_id = $2`,
      [Number(req.params.id), req.portalCliente.id]
    )
    if (!rows[0]) return res.status(404).end()
    const v = variantes(rows[0].arquivo)
    let abs = absPath(v[req.params.variant])
    if (!fs.existsSync(abs)) abs = absPath(v.orig)
    if (!fs.existsSync(abs)) return res.status(404).end()
    res.sendFile(abs, { headers: { 'Cache-Control': 'private, max-age=86400' } })
  })
)

publico.get('/portal/:token/logo', h((req, res) => escritorio.enviarLogo(req, res)))

module.exports = { publico, equipe }
