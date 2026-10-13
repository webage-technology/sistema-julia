'use strict'

// Limpeza de dados — o administrador escolhe o que apagar e o sistema apaga de
// VEZ (não passa pela lixeira). Serve para zerar a base depois dos testes, sem
// precisar derrubar o banco.
//
// Cada grupo diz quais tabelas apaga e quais pastas de uploads vão junto; os
// filhos saem sozinhos pelas chaves estrangeiras (ON DELETE CASCADE). A ordem
// do array é a ordem da limpeza — filho antes do pai —, e quem esbarra num
// RESTRICT (clients) declara em `exige` os grupos que precisa arrastar junto.
const fsp = require('node:fs/promises')
const express = require('express')
const db = require('./db')
const { authMiddleware, permitir } = require('./auth')
const { absPath, removerArquivo } = require('./uploads')
const auditoria = require('./auditoria')

const router = express.Router()
router.use(authMiddleware)

const h = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error('[dados]', err.message)
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Erro interno' })
  })

const CONFIRMACAO = 'APAGAR'

const GRUPOS = [
  { chave: 'auditoria', label: 'Auditoria', descricao: 'O histórico de quem fez o quê, quando.', tabelas: ['auditoria'] },
  { chave: 'notificacoes', label: 'Notificações', descricao: 'Os avisos enviados por e-mail e WhatsApp.', tabelas: ['notificacoes'] },
  { chave: 'laudos', label: 'Laudos emitidos', descricao: 'Os PDFs emitidos e assinados, com os arquivos no disco.', tabelas: ['laudos'], pastas: ['laudos'] },
  { chave: 'relatorios', label: 'Relatórios', descricao: 'Os relatórios fotográficos montados nas vistorias.', tabelas: ['relatorios'] },
  { chave: 'viagens', label: 'Viagens e despesas', descricao: 'Cronogramas, verbas e comprovantes de despesa.', tabelas: ['viagens', 'despesas'], pastas: ['despesas'] },
  { chave: 'arquivos', label: 'Arquivos (GED)', descricao: 'Os documentos anexados a clientes, imóveis, vistorias e processos.', tabelas: ['arquivos'], pastas: ['arquivos'] },
  { chave: 'processos', label: 'Processos', descricao: 'Com protocolos, documentos exigidos, RRTs e despesas do processo.', tabelas: ['processos'], pastas: ['despesas-processo'] },
  {
    chave: 'vistorias',
    label: 'Vistorias e fotos',
    descricao: 'Com pavimentos, ambientes, fotos, divergências, checklists, laudos e relatórios.',
    tabelas: ['vistorias'],
    pastas: ['vistorias', 'laudos'],
  },
  { chave: 'imoveis', label: 'Imóveis', descricao: 'Com plantas, pinos e as vistorias de cada imóvel.', tabelas: ['imoveis'], pastas: ['plantas'], exige: ['vistorias'] },
  { chave: 'clients', label: 'Clientes', descricao: 'Arrasta os imóveis e os processos do cliente.', tabelas: ['clients'], exige: ['imoveis', 'processos'] },
  {
    chave: 'modelos',
    label: 'Textos padrão, documentos e checklists',
    descricao: 'Os modelos por tipo de serviço configurados nesta tela.',
    tabelas: ['textos_padrao', 'documentos_modelo', 'checklist_modelos'],
  },
  { chave: 'sequencias', label: 'Numeração', descricao: 'Zera os contadores: processos e laudos recomeçam do 1.', tabelas: ['sequencias'] },
  // Só a si mesmo o administrador não apaga — senão ninguém mais entra.
  { chave: 'users', label: 'Usuários (menos você)', descricao: 'Os demais usuários, com os links de redefinição de senha.', tabelas: ['users'], condicao: 'id <> $1' },
]

const porChave = (chave) => GRUPOS.find((g) => g.chave === chave)

// Nomes de tabela vêm da constante acima (nunca do corpo do pedido).
const contar = async (grupo, userId) => {
  let total = 0
  for (const t of grupo.tabelas) {
    const { rows } = await db.query(
      `SELECT COUNT(*)::int AS c FROM ${t}${grupo.condicao ? ` WHERE ${grupo.condicao}` : ''}`,
      grupo.condicao ? [userId] : []
    )
    total += rows[0].c
  }
  return total
}

// O que existe hoje em cada grupo — a tela mostra o número antes de apagar.
router.get(
  '/dados/resumo',
  permitir('admin'),
  h(async (req, res) => {
    const data = []
    for (const g of GRUPOS) {
      data.push({ chave: g.chave, label: g.label, descricao: g.descricao, exige: g.exige || [], registros: await contar(g, req.user.sub) })
    }
    res.json({ success: true, data })
  })
)

router.post(
  '/dados/limpar',
  permitir('admin'),
  h(async (req, res) => {
    const { grupos, confirmacao } = req.body || {}
    if (String(confirmacao || '').trim().toUpperCase() !== CONFIRMACAO) {
      return res.status(422).json({ success: false, message: `Escreva ${CONFIRMACAO} para confirmar` })
    }
    // Expande as dependências (clientes → imóveis → vistorias) e volta para a
    // ordem do array (filho antes do pai).
    const pedidos = new Set()
    const fila = [...(Array.isArray(grupos) ? grupos : [])]
    while (fila.length) {
      const c = fila.shift()
      const g = porChave(c)
      if (!g) return res.status(422).json({ success: false, message: `Grupo inválido: ${c}` })
      if (pedidos.has(g.chave)) continue
      pedidos.add(g.chave)
      fila.push(...(g.exige || []))
    }
    if (!pedidos.size) return res.status(422).json({ success: false, message: 'Escolha ao menos um grupo' })
    const escolhidos = GRUPOS.filter((g) => pedidos.has(g.chave))

    // Tudo ou nada: se um DELETE falhar, nada é apagado (os arquivos do disco
    // só saem depois do COMMIT).
    const apagados = {}
    // Os anexos do GED saem por cascata (o processo leva os documentos dele
    // junto), então guardamos a lista antes para apagar do disco, depois, só o
    // que realmente sumiu do banco.
    const anexosAntes = (await db.query('SELECT id, arquivo FROM arquivos')).rows
    const cliente = await db.pool.connect()
    try {
      await cliente.query('BEGIN')
      for (const g of escolhidos) {
        let n = 0
        for (const t of g.tabelas) {
          const r = await cliente.query(`DELETE FROM ${t}${g.condicao ? ` WHERE ${g.condicao}` : ''}`, g.condicao ? [req.user.sub] : [])
          n += r.rowCount
        }
        apagados[g.chave] = n
      }
      await cliente.query('COMMIT')
    } catch (err) {
      await cliente.query('ROLLBACK').catch(() => {})
      console.error('[dados] limpeza abortada:', err.message)
      return res.status(422).json({ success: false, message: `Não consegui apagar: ${err.message}` })
    } finally {
      cliente.release()
    }
    for (const g of escolhidos) {
      for (const p of g.pastas || []) await fsp.rm(absPath(p), { recursive: true, force: true }).catch(() => {})
    }
    const vivos = new Set((await db.query('SELECT id FROM arquivos')).rows.map((a) => a.id))
    for (const a of anexosAntes) if (!vivos.has(a.id) && a.arquivo) await removerArquivo(a.arquivo)

    const resumo = escolhidos.map((g) => `${g.label} (${apagados[g.chave]})`).join(', ')
    await auditoria.registrar(req, { acao: 'limpar', entidade: 'sistema', descricao: `Limpeza de dados: ${resumo}` })
    res.json({ success: true, data: { apagados }, message: `Dados apagados: ${resumo}` })
  })
)

module.exports = router
