'use strict'

// Lixeira — exclusão reversível de clientes, imóveis, vistorias e processos.
//
// Antes, excluir um imóvel apagava vistorias e centenas de fotos em cascata
// depois de um único "confirmar". Agora a exclusão marca `excluido_em`; o
// registro some das telas, mas continua no banco (e as fotos no disco) até um
// administrador restaurar ou apagar de vez por aqui.
//
// Cascata lógica: excluir um cliente marca os imóveis dele, e excluir um
// imóvel marca as vistorias — todos com o MESMO instante, para que restaurar
// o pai traga de volta exatamente o que saiu junto com ele.
const express = require('express')
const db = require('./db')
const { authMiddleware, permitir } = require('./auth')
const { removerPastaVistoria, removerPlantas } = require('./uploads')
const auditoria = require('./auditoria')

const router = express.Router()
router.use(authMiddleware)

const h = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error('[lixeira]', err.message)
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Erro interno' })
  })

const TIPOS = ['clients', 'imoveis', 'vistorias', 'processos']

// Exclusão lógica com cascata (usada pelas rotas DELETE dos cadastros).
async function excluir(tipo, id) {
  const agora = new Date()
  if (tipo === 'clients') {
    await db.query('UPDATE clients SET excluido_em = $2 WHERE id = $1 AND excluido_em IS NULL', [id, agora])
    await db.query('UPDATE imoveis SET excluido_em = $2 WHERE client_id = $1 AND excluido_em IS NULL', [id, agora])
    await db.query(
      'UPDATE vistorias SET excluido_em = $2 WHERE excluido_em IS NULL AND imovel_id IN (SELECT id FROM imoveis WHERE client_id = $1 AND excluido_em = $2)',
      [id, agora]
    )
    await db.query('UPDATE processos SET excluido_em = $2 WHERE client_id = $1 AND excluido_em IS NULL', [id, agora])
  } else if (tipo === 'imoveis') {
    await db.query('UPDATE imoveis SET excluido_em = $2 WHERE id = $1 AND excluido_em IS NULL', [id, agora])
    await db.query('UPDATE vistorias SET excluido_em = $2 WHERE imovel_id = $1 AND excluido_em IS NULL', [id, agora])
  } else if (tipo === 'vistorias') {
    await db.query('UPDATE vistorias SET excluido_em = $2 WHERE id = $1 AND excluido_em IS NULL', [id, agora])
  } else if (tipo === 'processos') {
    await db.query('UPDATE processos SET excluido_em = $2 WHERE id = $1 AND excluido_em IS NULL', [id, agora])
  }
  return agora
}

async function restaurar(tipo, id) {
  if (tipo === 'clients') {
    const c = await db.query('UPDATE clients SET excluido_em = NULL WHERE id = $1 AND excluido_em IS NOT NULL RETURNING excluido_em', [id])
    // Os imóveis que saíram junto (mesmo instante) voltam junto.
    const { rows } = await db.query('SELECT excluido_em FROM clients WHERE id = $1', [id])
    void rows
    if (c.rowCount) {
      const t = c.rows[0].excluido_em
      const im = await db.query('UPDATE imoveis SET excluido_em = NULL WHERE client_id = $1 AND excluido_em = $2 RETURNING id', [id, t])
      for (const i of im.rows) await db.query('UPDATE vistorias SET excluido_em = NULL WHERE imovel_id = $1 AND excluido_em = $2', [i.id, t])
      await db.query('UPDATE processos SET excluido_em = NULL WHERE client_id = $1 AND excluido_em = $2', [id, t])
    }
    return c.rowCount > 0
  }
  if (tipo === 'imoveis') {
    const pai = await db.query('SELECT c.excluido_em FROM imoveis i JOIN clients c ON c.id = i.client_id WHERE i.id = $1', [id])
    if (pai.rows[0]?.excluido_em) throw Object.assign(new Error('Restaure o cliente antes do imóvel'), { status: 422 })
    const r = await db.query('UPDATE imoveis SET excluido_em = NULL WHERE id = $1 AND excluido_em IS NOT NULL RETURNING excluido_em', [id])
    if (r.rowCount) await db.query('UPDATE vistorias SET excluido_em = NULL WHERE imovel_id = $1 AND excluido_em = $2', [id, r.rows[0].excluido_em])
    return r.rowCount > 0
  }
  if (tipo === 'vistorias') {
    const pai = await db.query('SELECT i.excluido_em FROM vistorias v JOIN imoveis i ON i.id = v.imovel_id WHERE v.id = $1', [id])
    if (pai.rows[0]?.excluido_em) throw Object.assign(new Error('Restaure o imóvel antes da vistoria'), { status: 422 })
    const r = await db.query('UPDATE vistorias SET excluido_em = NULL WHERE id = $1 AND excluido_em IS NOT NULL', [id])
    return r.rowCount > 0
  }
  if (tipo === 'processos') {
    const pai = await db.query('SELECT c.excluido_em FROM processos p JOIN clients c ON c.id = p.client_id WHERE p.id = $1', [id])
    if (pai.rows[0]?.excluido_em) throw Object.assign(new Error('Restaure o cliente antes do processo'), { status: 422 })
    const r = await db.query('UPDATE processos SET excluido_em = NULL WHERE id = $1 AND excluido_em IS NOT NULL', [id])
    return r.rowCount > 0
  }
  return false
}

// Apaga de vez — inclusive os arquivos no disco.
async function apagar(tipo, id) {
  if (tipo === 'vistorias') {
    const r = await db.query('DELETE FROM vistorias WHERE id = $1 AND excluido_em IS NOT NULL', [id])
    if (r.rowCount) await removerPastaVistoria(id)
    return r.rowCount > 0
  }
  if (tipo === 'imoveis') {
    const vs = await db.query('SELECT id FROM vistorias WHERE imovel_id = $1', [id])
    const r = await db.query('DELETE FROM imoveis WHERE id = $1 AND excluido_em IS NOT NULL', [id])
    if (r.rowCount) {
      for (const v of vs.rows) await removerPastaVistoria(v.id)
      await removerPlantas(id)
    }
    return r.rowCount > 0
  }
  if (tipo === 'clients') {
    const im = await db.query('SELECT COUNT(*)::int AS c FROM imoveis WHERE client_id = $1', [id])
    if (im.rows[0].c > 0) throw Object.assign(new Error('Apague antes os imóveis deste cliente (estão na lixeira)'), { status: 422 })
    const pr = await db.query('SELECT COUNT(*)::int AS c FROM processos WHERE client_id = $1', [id])
    if (pr.rows[0].c > 0) throw Object.assign(new Error('Apague antes os processos deste cliente (estão na lixeira)'), { status: 422 })
    const r = await db.query('DELETE FROM clients WHERE id = $1 AND excluido_em IS NOT NULL', [id])
    return r.rowCount > 0
  }
  if (tipo === 'processos') {
    const r = await db.query('DELETE FROM processos WHERE id = $1 AND excluido_em IS NOT NULL', [id])
    return r.rowCount > 0
  }
  return false
}

router.get(
  '/lixeira',
  permitir('admin'),
  h(async (_req, res) => {
    const [clients, imoveis, vistorias, processos] = await Promise.all([
      db.query(`SELECT id, ${db.CLIENTE_NOME} AS nome, excluido_em AS "excluidoEm" FROM clients c WHERE excluido_em IS NOT NULL ORDER BY excluido_em DESC`),
      db.query(
        `SELECT i.id, i.nome, i.endereco, ${db.CLIENTE_NOME} AS "clienteNome", i.excluido_em AS "excluidoEm",
          (SELECT COUNT(*)::int FROM vistorias v WHERE v.imovel_id = i.id) AS vistorias
         FROM imoveis i JOIN clients c ON c.id = i.client_id WHERE i.excluido_em IS NOT NULL ORDER BY i.excluido_em DESC`
      ),
      db.query(
        `SELECT v.id, v.tipo_servico AS "tipoServico", to_char(v.data_vistoria, 'YYYY-MM-DD') AS "dataVistoria",
          i.nome AS "imovelNome", ${db.CLIENTE_NOME} AS "clienteNome", v.excluido_em AS "excluidoEm",
          (SELECT COUNT(*)::int FROM fotos f WHERE f.vistoria_id = v.id) AS fotos
         FROM vistorias v JOIN imoveis i ON i.id = v.imovel_id JOIN clients c ON c.id = i.client_id
         WHERE v.excluido_em IS NOT NULL ORDER BY v.excluido_em DESC`
      ),
      db.query(
        `SELECT p.id, p.numero, p.titulo, ${db.CLIENTE_NOME} AS "clienteNome", p.excluido_em AS "excluidoEm"
         FROM processos p JOIN clients c ON c.id = p.client_id WHERE p.excluido_em IS NOT NULL ORDER BY p.excluido_em DESC`
      ),
    ])
    res.json({ success: true, data: { clients: clients.rows, imoveis: imoveis.rows, vistorias: vistorias.rows, processos: processos.rows } })
  })
)

router.post(
  '/lixeira/:tipo/:id/restaurar',
  permitir('admin'),
  h(async (req, res) => {
    const { tipo } = req.params
    if (!TIPOS.includes(tipo)) return res.status(422).json({ success: false, message: 'Tipo inválido' })
    try {
      const ok = await restaurar(tipo, Number(req.params.id))
      if (!ok) return res.status(404).json({ success: false, message: 'Registro não está na lixeira' })
    } catch (err) {
      if (err.status) return res.status(err.status).json({ success: false, message: err.message })
      throw err
    }
    await auditoria.registrar(req, { acao: 'restaurar', entidade: tipo, entidadeId: Number(req.params.id), descricao: `${tipo} #${req.params.id} restaurado da lixeira` })
    res.json({ success: true, message: 'Restaurado' })
  })
)

router.delete(
  '/lixeira/:tipo/:id',
  permitir('admin'),
  h(async (req, res) => {
    const { tipo } = req.params
    if (!TIPOS.includes(tipo)) return res.status(422).json({ success: false, message: 'Tipo inválido' })
    try {
      const ok = await apagar(tipo, Number(req.params.id))
      if (!ok) return res.status(404).json({ success: false, message: 'Registro não está na lixeira' })
    } catch (err) {
      if (err.status) return res.status(err.status).json({ success: false, message: err.message })
      throw err
    }
    await auditoria.registrar(req, { acao: 'apagar', entidade: tipo, entidadeId: Number(req.params.id), descricao: `${tipo} #${req.params.id} apagado definitivamente` })
    res.json({ success: true, message: 'Apagado definitivamente' })
  })
)

module.exports = { router, excluir, restaurar, apagar }
