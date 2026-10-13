'use strict'

// Notificações — o sistema avisa, em vez de esperar alguém olhar.
//
// O que gera aviso (varredura a cada 10 minutos):
//   • protocolo/comunique-se com prazo vencendo ou vencido;
//   • documento recebido com validade vencendo;
//   • vistoria marcada para amanhã;
//   • processo parado com documentos obrigatórios pendentes (uma vez por semana);
//   • backup atrasado (administradores);
// e o que outros módulos disparam na hora (laudo emitido, documento enviado
// pelo cliente, laudo aprovado).
//
// Canais: interno (sino na tela, sempre), e-mail (SMTP via nodemailer) e
// WhatsApp (Evolution API) — os dois últimos configurados em Configurações.
// `chave` única evita repetir o mesmo aviso a cada varredura.
const express = require('express')
const db = require('./db')
const { authMiddleware, permitir } = require('./auth')
const escritorio = require('./escritorio')

const router = express.Router()
router.use(authMiddleware)

const h = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error('[notificacoes]', err.message)
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Erro interno' })
  })

// ------------------------------------------------------------- provedores
async function enviarEmail(cfg, { para, assunto, texto, html }) {
  const smtp = cfg?.smtp || {}
  if (!smtp.host || !para) throw new Error('SMTP não configurado')
  const nodemailer = require('nodemailer')
  const transporte = nodemailer.createTransport({
    host: smtp.host,
    port: Number(smtp.porta) || 587,
    secure: !!smtp.seguro,
    auth: smtp.usuario ? { user: smtp.usuario, pass: smtp.senha || '' } : undefined,
  })
  await transporte.sendMail({
    from: smtp.de || smtp.usuario,
    to: para,
    subject: assunto,
    text: texto,
    html: html || `<p>${String(texto || '').replace(/\n/g, '<br>')}</p>`,
  })
}

async function enviarWhatsapp(cfg, { numero, texto }) {
  const wa = cfg?.whatsapp || {}
  if (!wa.url || !wa.instancia || !numero) throw new Error('WhatsApp (Evolution) não configurado')
  const destino = String(numero).replace(/\D/g, '')
  const res = await fetch(`${String(wa.url).replace(/\/+$/, '')}/message/sendText/${encodeURIComponent(wa.instancia)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: wa.apikey || '' },
    body: JSON.stringify({ number: destino, text: texto }),
  })
  if (!res.ok) throw new Error(`Evolution respondeu ${res.status}`)
}

// ------------------------------------------------------------------ núcleo
const COLS = `n.id, n.chave, n.tipo, n.titulo, n.mensagem, n.canal, n.destinatario, n.user_id AS "userId",
  n.processo_id AS "processoId", n.vistoria_id AS "vistoriaId", n.link, n.status, n.erro, n.enviada_em AS "enviadaEm",
  n.lida_em AS "lidaEm", n.created_at AS "createdAt"`

// Cria a notificação (ignora se a chave já existe). Devolve o id ou null.
async function criar({ chave = null, tipo = 'aviso', titulo, mensagem = '', canal = 'interno', destinatario = '', userId = null, processoId = null, vistoriaId = null, link = '' }) {
  const { rows } = await db.query(
    `INSERT INTO notificacoes (chave, tipo, titulo, mensagem, canal, destinatario, user_id, processo_id, vistoria_id, link, status, enviada_em)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, CASE WHEN $5 = 'interno' THEN 'enviada' ELSE 'pendente' END, CASE WHEN $5 = 'interno' THEN now() ELSE NULL END)
     ON CONFLICT (chave) DO NOTHING RETURNING id`,
    [chave, tipo, String(titulo || '').slice(0, 200), String(mensagem || ''), canal, destinatario, userId, processoId, vistoriaId, link]
  )
  return rows[0]?.id || null
}

// Aviso completo: interno para os usuários alvo + e-mail/WhatsApp conforme a
// configuração. `usuarios` = ids; sem nenhum, vai para os administradores.
async function notificar({ chave, tipo, titulo, mensagem, usuarios = [], processoId = null, vistoriaId = null, link = '', emailsExtras = [], whatsappExtras = [] }) {
  const cfg = await escritorio.carregar()
  const notif = cfg.notificacoes || {}
  let alvos = usuarios.filter(Boolean)
  if (!alvos.length) {
    const adm = await db.query("SELECT id FROM users WHERE role = 'admin' AND ativo")
    alvos = adm.rows.map((r) => r.id)
  }
  const criadas = []
  for (const uid of alvos) {
    const id = await criar({ chave: chave ? `${chave}|u${uid}` : null, tipo, titulo, mensagem, canal: 'interno', userId: uid, processoId, vistoriaId, link })
    if (id) criadas.push(id)
  }
  if (notif.email?.ativo) {
    const users = alvos.length ? await db.query('SELECT email FROM users WHERE id = ANY($1::int[]) AND ativo', [alvos]) : { rows: [] }
    const emails = [...new Set([...users.rows.map((u) => u.email), ...emailsExtras].filter(Boolean))]
    for (const e of emails) {
      const id = await criar({ chave: chave ? `${chave}|e${e}` : null, tipo, titulo, mensagem, canal: 'email', destinatario: e, processoId, vistoriaId, link })
      if (id) criadas.push(id)
    }
  }
  if (notif.whatsapp?.ativo) {
    const numeros = [...new Set([notif.whatsapp.destino, ...whatsappExtras].filter(Boolean))]
    for (const n of numeros) {
      const id = await criar({ chave: chave ? `${chave}|w${n}` : null, tipo, titulo, mensagem, canal: 'whatsapp', destinatario: n, processoId, vistoriaId, link })
      if (id) criadas.push(id)
    }
  }
  despachar().catch(() => {})
  return criadas
}

// Envia o que está pendente nos canais externos.
let despachando = false
async function despachar() {
  if (despachando) return
  despachando = true
  try {
    const cfg = await escritorio.carregar()
    const { rows } = await db.query(
      `SELECT ${COLS} FROM notificacoes n WHERE n.status = 'pendente' AND n.canal IN ('email','whatsapp') ORDER BY n.id LIMIT 50`
    )
    const base = cfg.url_publica ? String(cfg.url_publica).replace(/\/+$/, '') : ''
    for (const n of rows) {
      try {
        const texto = `${n.titulo}\n\n${n.mensagem}${n.link && base ? `\n\n${base}${n.link}` : ''}\n\n— ${cfg.nome_fantasia || 'Sistema Julia'}`
        if (n.canal === 'email') await enviarEmail(cfg.notificacoes, { para: n.destinatario, assunto: `[${cfg.nome_fantasia || 'Sistema Julia'}] ${n.titulo}`, texto })
        else await enviarWhatsapp(cfg.notificacoes, { numero: n.destinatario, texto })
        await db.query("UPDATE notificacoes SET status = 'enviada', enviada_em = now(), erro = '' WHERE id = $1", [n.id])
      } catch (err) {
        await db.query("UPDATE notificacoes SET status = 'erro', erro = $2 WHERE id = $1", [n.id, String(err.message || err).slice(0, 300)])
      }
    }
  } finally {
    despachando = false
  }
}

// ------------------------------------------------------------- varredura
async function varrer() {
  const cfg = await escritorio.carregar()
  const dias = Number(cfg.prazo_alerta_dias) || 7
  const processos = require('./processos')
  const hoje = new Date().toISOString().slice(0, 10)

  // Prazos: aviso quando entra na janela; outro quando vence.
  for (const p of await processos.listarPrazos(dias)) {
    const estado = p.vencido ? 'vencido' : 'aviso'
    const titulo = p.vencido ? `VENCIDO: ${p.titulo}` : `Vence em ${p.dias} dia(s): ${p.titulo}`
    await notificar({
      chave: `prazo-${p.chave}-${estado}`,
      tipo: p.vencido ? 'prazo_vencido' : 'prazo',
      titulo,
      mensagem: `${p.detalhe}\nProcesso ${p.processoNumero} — ${p.processoTitulo} (${p.clienteNome}). Data: ${p.data.split('-').reverse().join('/')}.`,
      usuarios: p.responsavelId ? [p.responsavelId] : [],
      processoId: p.processoId,
      link: p.link,
    })
  }

  // Vistoria amanhã.
  const amanha = await db.query(
    `SELECT v.id, v.responsavel_id AS "responsavelId", i.nome AS imovel, i.endereco, ${db.CLIENTE_NOME} AS cliente, v.tipo_servico AS tipo
     FROM vistorias v JOIN imoveis i ON i.id = v.imovel_id JOIN clients c ON c.id = i.client_id
     WHERE v.data_vistoria = CURRENT_DATE + 1 AND v.excluido_em IS NULL AND v.status IN ('preparo','campo')`
  )
  for (const v of amanha.rows) {
    await notificar({
      chave: `vistoria-${v.id}-amanha`,
      tipo: 'vistoria',
      titulo: `Vistoria amanhã: ${v.imovel}`,
      mensagem: `${v.cliente} · ${v.tipo || 'vistoria'}${v.endereco ? `\n${v.endereco}` : ''}`,
      usuarios: v.responsavelId ? [v.responsavelId] : [],
      vistoriaId: v.id,
      link: `/vistorias/${v.id}`,
    })
  }

  // Processo com documentos obrigatórios faltando — lembrete semanal.
  const semana = `${new Date().getFullYear()}-${Math.ceil((Date.now() - new Date(new Date().getFullYear(), 0, 1)) / (7 * 86400000))}`
  const docs = await db.query(
    `SELECT p.id, p.numero, p.titulo, p.responsavel_id AS "responsavelId", ${db.CLIENTE_NOME} AS cliente,
      COUNT(d.id)::int AS pendentes
     FROM processos p JOIN clients c ON c.id = p.client_id
     JOIN processo_documentos d ON d.processo_id = p.id AND d.obrigatorio AND d.status = 'pendente'
     WHERE p.excluido_em IS NULL AND p.etapa NOT IN ('concluido','arquivado')
     GROUP BY p.id, c.tipo, c.company, c.name`
  )
  for (const p of docs.rows) {
    await notificar({
      chave: `docs-${p.id}-${semana}`,
      tipo: 'documentos',
      titulo: `${p.pendentes} documento(s) pendente(s): ${p.titulo}`,
      mensagem: `Processo ${p.numero} (${p.cliente}) ainda aguarda documentos obrigatórios do cliente.`,
      usuarios: p.responsavelId ? [p.responsavelId] : [],
      processoId: p.id,
      link: `/processos/${p.id}?aba=documentos`,
    })
  }

  // Backup atrasado — só interno, para os administradores, uma vez por dia.
  const bk = await escritorio.estadoBackup()
  if (bk.atrasado) {
    await notificar({
      chave: `backup-${hoje}`,
      tipo: 'backup',
      titulo: bk.configurado ? 'Backup atrasado' : 'Backup não configurado',
      mensagem: bk.ultimo
        ? `A última cópia é de ${new Date(bk.ultimo.em).toLocaleString('pt-BR')}. Rode scripts/backup.ps1 ou confira a tarefa agendada.`
        : 'Nenhuma cópia encontrada em backups/. Rode scripts/backup.ps1 e registre a tarefa agendada (scripts/registrar-backup.ps1).',
      link: '/configuracoes?aba=backup',
    })
  }

  await despachar()
}

let timer = null
function iniciarVarredura() {
  if (timer) return
  const rodar = () => varrer().catch((err) => console.error('[notificacoes] varredura: %s', err.message))
  setTimeout(rodar, 20000)
  timer = setInterval(rodar, 10 * 60 * 1000)
}

// -------------------------------------------------------------------- rotas
router.get(
  '/notificacoes',
  h(async (req, res) => {
    const todas = req.query.todas === '1'
    const { rows } = await db.query(
      `SELECT ${COLS} FROM notificacoes n
       WHERE n.canal = 'interno' AND (n.user_id = $1 OR n.user_id IS NULL) AND ($2 OR n.lida_em IS NULL)
       ORDER BY n.id DESC LIMIT 200`,
      [req.user.sub, todas]
    )
    const nl = await db.query(
      "SELECT COUNT(*)::int AS c FROM notificacoes n WHERE n.canal = 'interno' AND (n.user_id = $1 OR n.user_id IS NULL) AND n.lida_em IS NULL",
      [req.user.sub]
    )
    res.json({ success: true, data: rows, naoLidas: nl.rows[0].c })
  })
)

// Pendências de envio externo (só administrador) — para diagnosticar SMTP/WhatsApp.
router.get(
  '/notificacoes/envios',
  permitir('admin'),
  h(async (_req, res) => {
    const { rows } = await db.query(`SELECT ${COLS} FROM notificacoes n WHERE n.canal <> 'interno' ORDER BY n.id DESC LIMIT 100`)
    res.json({ success: true, data: rows })
  })
)

router.post(
  '/notificacoes/:id/lida',
  h(async (req, res) => {
    await db.query('UPDATE notificacoes SET lida_em = now() WHERE id = $1 AND (user_id = $2 OR user_id IS NULL) AND lida_em IS NULL', [Number(req.params.id), req.user.sub])
    res.json({ success: true })
  })
)

router.post(
  '/notificacoes/lidas',
  h(async (req, res) => {
    await db.query('UPDATE notificacoes SET lida_em = now() WHERE (user_id = $1 OR user_id IS NULL) AND lida_em IS NULL', [req.user.sub])
    res.json({ success: true })
  })
)

router.post(
  '/notificacoes/testar',
  permitir('admin'),
  h(async (req, res) => {
    const { canal, destinatario } = req.body || {}
    const cfg = await escritorio.carregar()
    const texto = `Teste de notificação do ${cfg.nome_fantasia || 'Sistema Julia'} em ${new Date().toLocaleString('pt-BR')}.`
    try {
      if (canal === 'email') await enviarEmail(cfg.notificacoes, { para: destinatario, assunto: 'Teste de notificação', texto })
      else if (canal === 'whatsapp') await enviarWhatsapp(cfg.notificacoes, { numero: destinatario, texto })
      else return res.status(422).json({ success: false, message: 'Canal inválido' })
      res.json({ success: true, message: 'Enviado' })
    } catch (err) {
      res.status(422).json({ success: false, message: err.message })
    }
  })
)

router.post(
  '/notificacoes/varrer',
  permitir('admin'),
  h(async (_req, res) => {
    await varrer()
    res.json({ success: true, message: 'Varredura concluída' })
  })
)

module.exports = { router, criar, notificar, despachar, varrer, iniciarVarredura, enviarEmail }
