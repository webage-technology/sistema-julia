'use strict'

// Módulo de vistorias — estrutura: imóveis (com planta e modelo de ambientes),
// vistorias (clonam o modelo do imóvel), pavimentos e ambientes.
// Pavimentos/ambientes com imovel_id são o MODELO; com vistoria_id, a instância.
const express = require('express')
const QRCode = require('qrcode')
const db = require('./db')
const planta = require('./planta')
const { authMiddleware, permitir, PAPEIS_TECNICOS } = require('./auth')
const { upload, absPath, salvarPlantas, listarPlantas } = require('./uploads')

const router = express.Router()
router.use(authMiddleware)

const h = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error('[erro]', err.message)
    res.status(500).json({ success: false, message: 'Erro interno' })
  })

const IMOVEL_COLS = `i.id, i.client_id AS "clientId", i.nome, i.endereco,
  i.planta_nome AS "plantaNome", i.planta_path AS "plantaPath",
  i.planta_path <> '' AS "temPlanta", i.created_at AS "createdAt",
  i.matricula, i.cartorio, i.inscricao, i.lote, i.quadra, i.zoneamento, i.uso,
  i.area_terreno::float8 AS "areaTerreno", i.area_aprovada::float8 AS "areaAprovada", i.area_iptu::float8 AS "areaIptu",
  i.latitude, i.longitude, i.cep, i.municipio, i.uf, i.observacoes`
const AMB_COLS = `a.id, a.pavimento_id AS "pavimentoId", a.nome, a.ordem, a.origem, a.situacao,
  a.nomear_depois AS "nomearDepois", a.nota, a.medidas,
  a.comprimento::float8 AS comprimento, a.largura::float8 AS largura, a.pe_direito::float8 AS "peDireito", a.area::float8 AS area`
const lixeira = require('./lixeira')
const auditoria = require('./auditoria')
// Campos da ficha cadastral do imóvel (regularização): chave do JSON → coluna.
const FICHA = {
  matricula: 'matricula', cartorio: 'cartorio', inscricao: 'inscricao', lote: 'lote', quadra: 'quadra',
  zoneamento: 'zoneamento', uso: 'uso', cep: 'cep', municipio: 'municipio', uf: 'uf', observacoes: 'observacoes',
}
const FICHA_NUM = { areaTerreno: 'area_terreno', areaAprovada: 'area_aprovada', areaIptu: 'area_iptu', latitude: 'latitude', longitude: 'longitude' }
const numOuNulo = (v) => {
  if (v === undefined || v === null || v === '') return null
  const n = Number(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : null
}
// 'relatorio' = a etapa de fotos foi encerrada e o trabalho passou a ser o laudo.
// Fica entre a conferência e a conclusão: o campo acabou, o relatório não.
const STATUS_VISTORIA = ['preparo', 'campo', 'conferencia', 'relatorio', 'concluida']

// Monta a árvore pavimentos → ambientes de um dono (imóvel ou vistoria).
async function estrutura(dono, id) {
  const col = dono === 'imovel' ? 'imovel_id' : 'vistoria_id'
  const pav = await db.query(
    `SELECT id, nome, ordem FROM pavimentos WHERE ${col} = $1 ORDER BY ordem, id`,
    [id]
  )
  const amb = await db.query(
    `SELECT ${AMB_COLS}, (SELECT COUNT(*)::int FROM fotos f WHERE f.ambiente_id = a.id) AS fotos
     FROM ambientes a JOIN pavimentos p ON p.id = a.pavimento_id
     WHERE p.${col} = $1 ORDER BY a.ordem, a.id`,
    [id]
  )
  return pav.rows.map((p) => ({ ...p, ambientes: amb.rows.filter((a) => a.pavimentoId === p.id) }))
}

// ---------------------------------------------------------------- imóveis
router.get(
  '/imoveis',
  h(async (_req, res) => {
    const { rows } = await db.query(
      `SELECT ${IMOVEL_COLS}, ${db.CLIENTE_NOME} AS "clienteNome",
        (SELECT COUNT(*)::int FROM vistorias v WHERE v.imovel_id = i.id AND v.excluido_em IS NULL) AS vistorias,
        (SELECT COUNT(*)::int FROM processos p WHERE p.imovel_id = i.id AND p.excluido_em IS NULL) AS processos
       FROM imoveis i JOIN clients c ON c.id = i.client_id WHERE i.excluido_em IS NULL ORDER BY i.id DESC`
    )
    res.json({ success: true, data: rows })
  })
)

router.post(
  '/imoveis',
  h(async (req, res) => {
    const { clientId, nome, endereco } = req.body || {}
    if (!clientId || !nome) {
      return res.status(422).json({ success: false, message: 'Cliente e nome são obrigatórios' })
    }
    const cli = await db.query('SELECT 1 FROM clients WHERE id = $1 AND excluido_em IS NULL', [Number(clientId)])
    if (!cli.rowCount) return res.status(422).json({ success: false, message: 'Cliente não encontrado' })
    const { rows } = await db.query(
      `INSERT INTO imoveis (client_id, nome, endereco) VALUES ($1, $2, $3)
       RETURNING id, client_id AS "clientId", nome, endereco`,
      [Number(clientId), nome, endereco || '']
    )
    await auditoria.registrar(req, { acao: 'criar', entidade: 'imovel', entidadeId: rows[0].id, descricao: `Imóvel ${nome}` })
    res.json({ success: true, data: rows[0] })
  })
)

router.get(
  '/imoveis/:id',
  h(async (req, res) => {
    const id = Number(req.params.id)
    const { rows } = await db.query(
      `SELECT ${IMOVEL_COLS}, ${db.CLIENTE_NOME} AS "clienteNome"
       FROM imoveis i JOIN clients c ON c.id = i.client_id WHERE i.id = $1 AND i.excluido_em IS NULL`,
      [id]
    )
    if (!rows[0]) return res.status(404).json({ success: false, message: 'Imóvel não encontrado' })
    const vistorias = await db.query(
      `SELECT v.id, v.tipo_servico AS "tipoServico", to_char(v.data_vistoria, 'YYYY-MM-DD') AS "dataVistoria",
        v.status, v.processo_id AS "processoId", (SELECT COUNT(*)::int FROM fotos f WHERE f.vistoria_id = v.id) AS fotos
       FROM vistorias v WHERE v.imovel_id = $1 AND v.excluido_em IS NULL ORDER BY v.id DESC`,
      [id]
    )
    const processos = await db.query(
      'SELECT id, numero, titulo, tipo, etapa FROM processos WHERE imovel_id = $1 AND excluido_em IS NULL ORDER BY id DESC',
      [id]
    )
    const pinos = await db.query('SELECT COUNT(*)::int AS c FROM planta_pinos WHERE imovel_id = $1', [id])
    res.json({
      success: true,
      data: {
        ...rows[0],
        plantas: listarPlantas(id, rows[0].plantaPath).map((p) => ({ nome: p.nome, pdf: /\.pdf$/i.test(p.rel) })),
        pavimentos: await estrutura('imovel', id),
        vistorias: vistorias.rows,
        processos: processos.rows,
        pinos: pinos.rows[0].c,
      },
    })
  })
)

router.put(
  '/imoveis/:id',
  h(async (req, res) => {
    const id = Number(req.params.id)
    const cur = await db.query('SELECT * FROM imoveis WHERE id = $1 AND excluido_em IS NULL', [id])
    if (!cur.rowCount) return res.status(404).json({ success: false, message: 'Imóvel não encontrado' })
    const i = cur.rows[0]
    const b = req.body || {}
    const { nome, endereco, clientId } = b
    // Ficha cadastral: só o que veio no corpo muda.
    const sets = ['nome = $1', 'endereco = $2', 'client_id = $3']
    const vals = [nome ?? i.nome, endereco ?? i.endereco, clientId ? Number(clientId) : i.client_id]
    for (const [chave, col] of Object.entries(FICHA)) {
      if (chave in b) {
        vals.push(String(b[chave] ?? ''))
        sets.push(`${col} = $${vals.length}`)
      }
    }
    for (const [chave, col] of Object.entries(FICHA_NUM)) {
      if (chave in b) {
        vals.push(numOuNulo(b[chave]))
        sets.push(`${col} = $${vals.length}`)
      }
    }
    vals.push(id)
    await db.query(`UPDATE imoveis SET ${sets.join(', ')} WHERE id = $${vals.length}`, vals)
    const { rows } = await db.query(`SELECT ${IMOVEL_COLS}, ${db.CLIENTE_NOME} AS "clienteNome" FROM imoveis i JOIN clients c ON c.id = i.client_id WHERE i.id = $1`, [id])
    await auditoria.registrar(req, { acao: 'editar', entidade: 'imovel', entidadeId: id, descricao: `Imóvel ${rows[0].nome}` })
    res.json({ success: true, data: rows[0] })
  })
)

// Exclusão vai para a lixeira (leva as vistorias junto; reversível em /lixeira).
router.delete(
  '/imoveis/:id',
  permitir(...PAPEIS_TECNICOS),
  h(async (req, res) => {
    const id = Number(req.params.id)
    const cur = await db.query('SELECT nome FROM imoveis WHERE id = $1 AND excluido_em IS NULL', [id])
    if (!cur.rowCount) return res.status(404).json({ success: false, message: 'Imóvel não encontrado' })
    await lixeira.excluir('imoveis', id)
    await auditoria.registrar(req, { acao: 'excluir', entidade: 'imovel', entidadeId: id, descricao: `Imóvel ${cur.rows[0].nome} enviado à lixeira (com as vistorias)` })
    res.json({ success: true, message: 'Imóvel enviado para a lixeira' })
  })
)

// Plantas do imóvel — aceita VÁRIAS pranchas de uma vez (01/05, 02/05…), que é
// como os projetos vêm: cada prancha traz os ambientes do seu trecho.
router.post(
  '/imoveis/:id/planta',
  upload.array('planta', 20),
  h(async (req, res) => {
    const id = Number(req.params.id)
    const cur = await db.query('SELECT 1 FROM imoveis WHERE id = $1', [id])
    if (!cur.rowCount) return res.status(404).json({ success: false, message: 'Imóvel não encontrado' })
    const arquivos = req.files || []
    if (!arquivos.length) return res.status(422).json({ success: false, message: 'Arquivo não enviado' })
    let salvos
    try {
      salvos = await salvarPlantas(arquivos, id)
    } catch (err) {
      return res.status(422).json({ success: false, message: err.message })
    }
    await db.query('UPDATE imoveis SET planta_path = $1, planta_nome = $2 WHERE id = $3', [
      `plantas/${id}`,
      salvos.length === 1 ? salvos[0].nome : `${salvos.length} pranchas`,
      id,
    ])
    res.json({ success: true, data: { arquivos: salvos.map((s) => s.nome) } })
  })
)

// Abre uma prancha (a primeira, ou a de índice ?arquivo=N).
router.get(
  '/imoveis/:id/planta',
  h(async (req, res) => {
    const id = Number(req.params.id)
    const { rows } = await db.query('SELECT planta_path FROM imoveis WHERE id = $1', [id])
    if (!rows.length) return res.status(404).json({ success: false, message: 'Imóvel não encontrado' })
    const arquivos = listarPlantas(id, rows[0].planta_path)
    if (!arquivos.length) return res.status(404).json({ success: false, message: 'Sem planta' })
    const i = Math.min(Math.max(Number(req.query.arquivo || 0), 0), arquivos.length - 1)
    res.sendFile(absPath(arquivos[i].rel), {
      headers: { 'Content-Disposition': `inline; filename="${encodeURIComponent(arquivos[i].nome)}"` },
    })
  })
)

// Dispara a leitura da planta e responde NA HORA com o número da leitura — o
// trabalho (extração + IA) leva de 30 s a 1,5 min, tempo demais para segurar uma
// requisição (o proxy do Next corta em 30 s). A tela consulta o resultado em
// GET /planta/leituras/:leituraId. Nada é gravado: isto só SUGERE.
router.post(
  '/imoveis/:id/planta/ler',
  h(async (req, res) => {
    const id = Number(req.params.id)
    const { rows } = await db.query('SELECT planta_path FROM imoveis WHERE id = $1', [id])
    if (!rows.length) return res.status(404).json({ success: false, message: 'Imóvel não encontrado' })
    const arquivos = listarPlantas(id, rows[0].planta_path)
    if (!arquivos.length) return res.status(422).json({ success: false, message: 'Envie a planta antes de ler' })
    const visual = !!(req.body || {}).visual
    const pdfs = visual ? arquivos : arquivos.filter((a) => /\.pdf$/i.test(a.rel))
    if (!pdfs.length) {
      return res
        .status(422)
        .json({ success: false, message: 'A leitura por texto funciona com a planta em PDF (gerada pelo CAD). Para imagem ou planta escaneada, use a leitura visual.' })
    }
    // Lê TODAS as pranchas juntas: os pavimentos costumam estar em arquivos
    // diferentes, e é isso que dá o imóvel completo numa leitura só.
    // `visual`: planta escaneada ou com fontes em curvas — vai como imagem ao
    // Claude com visão (src/planta-pinos.js) em vez da extração de texto.
    const leituraId = planta.iniciarLeitura(
      id,
      pdfs.map((p) => ({ caminho: absPath(p.rel), nome: p.nome })),
      { model: (req.body || {}).model, visual }
    )
    res.json({ success: true, data: { leituraId, arquivos: pdfs.length, visual } })
  })
)

// Resultado da leitura: processando | ok (com os dados) | erro.
router.get(
  '/planta/leituras/:leituraId',
  h(async (req, res) => {
    const info = planta.consultarLeitura(req.params.leituraId)
    if (!info) {
      return res.status(404).json({ success: false, message: 'Leitura não encontrada (ou expirada) — leia de novo' })
    }
    res.json({ success: true, data: info })
  })
)

// Cria pavimentos/ambientes em lote no MODELO do imóvel (aplicar a sugestão).
// Ignora o que já existe com o mesmo nome — dá para aplicar de novo sem duplicar.
router.post(
  '/imoveis/:id/estrutura',
  h(async (req, res) => {
    const id = Number(req.params.id)
    const im = await db.query('SELECT 1 FROM imoveis WHERE id = $1', [id])
    if (!im.rowCount) return res.status(404).json({ success: false, message: 'Imóvel não encontrado' })
    const lista = Array.isArray((req.body || {}).pavimentos) ? req.body.pavimentos : []
    if (!lista.length) return res.status(422).json({ success: false, message: 'Nada para adicionar' })

    const norm = (s) => String(s || '').trim().toLowerCase()
    const client = await db.pool.connect()
    let novosPav = 0
    let novosAmb = 0
    try {
      await client.query('BEGIN')
      for (const p of lista) {
        const nomePav = String(p?.nome || '').trim()
        const ambientes = (Array.isArray(p?.ambientes) ? p.ambientes : []).map((a) => String(a || '').trim()).filter(Boolean)
        if (!nomePav || !ambientes.length) continue

        const existentes = await client.query('SELECT id, nome FROM pavimentos WHERE imovel_id = $1', [id])
        let pav = existentes.rows.find((r) => norm(r.nome) === norm(nomePav))
        if (!pav) {
          const novo = await client.query(
            `INSERT INTO pavimentos (imovel_id, nome, ordem)
             VALUES ($1, $2, (SELECT COALESCE(MAX(ordem), -1) + 1 FROM pavimentos WHERE imovel_id = $1))
             RETURNING id, nome`,
            [id, nomePav]
          )
          pav = novo.rows[0]
          novosPav++
        }
        const jaTem = await client.query('SELECT nome FROM ambientes WHERE pavimento_id = $1', [pav.id])
        const nomesExistentes = new Set(jaTem.rows.map((r) => norm(r.nome)))
        for (const nomeAmb of ambientes) {
          if (nomesExistentes.has(norm(nomeAmb))) continue
          await client.query(
            `INSERT INTO ambientes (pavimento_id, nome, ordem)
             VALUES ($1, $2, (SELECT COALESCE(MAX(ordem), -1) + 1 FROM ambientes WHERE pavimento_id = $1))`,
            [pav.id, nomeAmb]
          )
          nomesExistentes.add(norm(nomeAmb))
          novosAmb++
        }
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
    res.json({ success: true, data: { pavimentos: novosPav, ambientes: novosAmb } })
  })
)

// ---------------------------------------------------------------- vistorias
router.get(
  '/vistorias',
  h(async (_req, res) => {
    const { rows } = await db.query(
      `SELECT v.id, v.imovel_id AS "imovelId", v.tipo_servico AS "tipoServico",
        to_char(v.data_vistoria, 'YYYY-MM-DD') AS "dataVistoria", v.status, v.created_at AS "createdAt",
        i.nome AS "imovelNome", i.endereco, ${db.CLIENTE_NOME} AS "clienteNome",
        v.responsavel_id AS "responsavelId", u.name AS "responsavelNome",
        v.processo_id AS "processoId", pr.numero AS "processoNumero",
        (SELECT COUNT(*)::int FROM fotos f WHERE f.vistoria_id = v.id) AS fotos
       FROM vistorias v JOIN imoveis i ON i.id = v.imovel_id JOIN clients c ON c.id = i.client_id
       LEFT JOIN users u ON u.id = v.responsavel_id LEFT JOIN processos pr ON pr.id = v.processo_id
       WHERE v.excluido_em IS NULL AND i.excluido_em IS NULL
       ORDER BY v.id DESC`
    )
    res.json({ success: true, data: rows })
  })
)

// Criar vistoria = clonar o modelo de pavimentos/ambientes do imóvel.
router.post(
  '/vistorias',
  h(async (req, res) => {
    const { imovelId, tipoServico, dataVistoria, participantes, processoId, responsavelId } = req.body || {}
    const im = await db.query('SELECT 1 FROM imoveis WHERE id = $1 AND excluido_em IS NULL', [Number(imovelId || 0)])
    if (!im.rowCount) return res.status(422).json({ success: false, message: 'Imóvel não encontrado' })

    const client = await db.pool.connect()
    let vid
    try {
      await client.query('BEGIN')
      const v = await client.query(
        `INSERT INTO vistorias (imovel_id, tipo_servico, data_vistoria, participantes, processo_id, responsavel_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [Number(imovelId), tipoServico || '', dataVistoria || null, participantes || '', processoId ? Number(processoId) : null, responsavelId ? Number(responsavelId) : null]
      )
      vid = v.rows[0].id
      const pavs = await client.query(
        'SELECT id, nome, ordem FROM pavimentos WHERE imovel_id = $1 ORDER BY ordem, id',
        [Number(imovelId)]
      )
      if (!pavs.rowCount) {
        // Imóvel sem modelo: garante um pavimento para receber ambientes em campo.
        await client.query("INSERT INTO pavimentos (vistoria_id, nome, ordem) VALUES ($1, 'Pavimento único', 0)", [vid])
      }
      for (const p of pavs.rows) {
        const np = await client.query(
          'INSERT INTO pavimentos (vistoria_id, nome, ordem) VALUES ($1, $2, $3) RETURNING id',
          [vid, p.nome, p.ordem]
        )
        await client.query(
          `INSERT INTO ambientes (pavimento_id, nome, ordem, origem)
           SELECT $1, nome, ordem, 'planta' FROM ambientes WHERE pavimento_id = $2`,
          [np.rows[0].id, p.id]
        )
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
    await auditoria.registrar(req, { acao: 'criar', entidade: 'vistoria', entidadeId: vid, processoId: processoId ? Number(processoId) : null, descricao: `Vistoria #${vid} criada (${tipoServico || 'sem tipo'})` })
    res.json({ success: true, data: { id: vid } })
  })
)

router.get(
  '/vistorias/:id',
  h(async (req, res) => {
    const id = Number(req.params.id)
    const { rows } = await db.query(
      `SELECT v.id, v.imovel_id AS "imovelId", v.tipo_servico AS "tipoServico",
        to_char(v.data_vistoria, 'YYYY-MM-DD') AS "dataVistoria", v.participantes, v.status,
        v.responsavel_id AS "responsavelId", u.name AS "responsavelNome",
        v.processo_id AS "processoId", pr.numero AS "processoNumero", pr.titulo AS "processoTitulo",
        i.client_id AS "clientId", i.area_aprovada::float8 AS "areaAprovada", i.area_iptu::float8 AS "areaIptu",
        (SELECT COUNT(*)::int FROM planta_pinos pp WHERE pp.imovel_id = i.id) AS pinos,
        v.created_at AS "createdAt", i.nome AS "imovelNome", i.endereco,
        i.planta_path <> '' AS "temPlanta", ${db.CLIENTE_NOME} AS "clienteNome",
        (SELECT vv.viagem_id FROM viagem_vistorias vv WHERE vv.vistoria_id = v.id ORDER BY vv.viagem_id LIMIT 1) AS "viagemId",
        (SELECT COALESCE(NULLIF(vg.titulo, ''), vg.destino, 'Viagem') FROM viagem_vistorias vv
          JOIN viagens vg ON vg.id = vv.viagem_id WHERE vv.vistoria_id = v.id ORDER BY vg.id LIMIT 1) AS "viagemTitulo"
       FROM vistorias v JOIN imoveis i ON i.id = v.imovel_id JOIN clients c ON c.id = i.client_id
       LEFT JOIN users u ON u.id = v.responsavel_id LEFT JOIN processos pr ON pr.id = v.processo_id
       WHERE v.id = $1 AND v.excluido_em IS NULL`,
      [id]
    )
    if (!rows[0]) return res.status(404).json({ success: false, message: 'Vistoria não encontrada' })
    const tot = await db.query(
      `SELECT COUNT(*)::int AS fotos, COUNT(*) FILTER (WHERE ambiente_id IS NULL)::int AS "semAmbiente"
       FROM fotos WHERE vistoria_id = $1`,
      [id]
    )
    res.json({
      success: true,
      data: { ...rows[0], pavimentos: await estrutura('vistoria', id), totais: tot.rows[0] },
    })
  })
)

router.put(
  '/vistorias/:id',
  h(async (req, res) => {
    const id = Number(req.params.id)
    const cur = await db.query('SELECT * FROM vistorias WHERE id = $1 AND excluido_em IS NULL', [id])
    if (!cur.rowCount) return res.status(404).json({ success: false, message: 'Vistoria não encontrada' })
    const v = cur.rows[0]
    const { tipoServico, dataVistoria, participantes, status, responsavelId, processoId } = req.body || {}
    if (status && !STATUS_VISTORIA.includes(status)) {
      return res.status(422).json({ success: false, message: 'Status inválido' })
    }
    await db.query(
      `UPDATE vistorias SET tipo_servico = $1, data_vistoria = $2, participantes = $3, status = $4,
        responsavel_id = $5, processo_id = $6 WHERE id = $7`,
      [
        tipoServico ?? v.tipo_servico,
        dataVistoria === undefined ? v.data_vistoria : dataVistoria || null,
        participantes ?? v.participantes,
        status ?? v.status,
        responsavelId === undefined ? v.responsavel_id : responsavelId || null,
        processoId === undefined ? v.processo_id : processoId || null,
        id,
      ]
    )
    if (status && status !== v.status) {
      await auditoria.registrar(req, { acao: 'status', entidade: 'vistoria', entidadeId: id, processoId: v.processo_id, descricao: `Vistoria #${id}: ${v.status} → ${status}` })
    }
    res.json({ success: true, message: 'Vistoria atualizada' })
  })
)

// Exclusão vai para a lixeira — as fotos ficam no disco até um administrador
// apagar de vez (ou restaurar).
router.delete(
  '/vistorias/:id',
  permitir(...PAPEIS_TECNICOS),
  h(async (req, res) => {
    const id = Number(req.params.id)
    const cur = await db.query('SELECT processo_id FROM vistorias WHERE id = $1 AND excluido_em IS NULL', [id])
    if (!cur.rowCount) return res.status(404).json({ success: false, message: 'Vistoria não encontrada' })
    await lixeira.excluir('vistorias', id)
    await auditoria.registrar(req, { acao: 'excluir', entidade: 'vistoria', entidadeId: id, processoId: cur.rows[0].processo_id, descricao: `Vistoria #${id} enviada à lixeira` })
    res.json({ success: true, message: 'Vistoria enviada para a lixeira' })
  })
)

// ------------------------------------------ importar vistoria já realizada
// Vistoria antiga: as fotos estão numa PASTA no computador, já separadas por
// pavimento/ambiente — o mesmo formato que "Exportar pastas (ZIP)" gera
// ("01 - Térreo/02 - Cozinha/0042 - 03.jpg"). A tela manda aqui a lista de
// pastas, isto cria os pavimentos e ambientes que faltarem e devolve
// pasta → ambienteId; depois a tela envia foto a foto para /vistorias/:id/fotos
// com o ambiente já resolvido.
//
// Por que não receber o .zip inteiro: uma vistoria passa fácil de centenas de
// fotos e de 1 GB, e teria de caber numa requisição só (o limite de upload aqui
// é 40 MB por arquivo) — sem progresso e sem retomada. Foto a foto, a
// importação reaproveita o caminho que já existe (EXIF, HEIC, miniaturas).
const semPrefixo = (s) => String(s || '').replace(/^\d+\s*-\s*/, '').trim()

router.post(
  '/vistorias/:id/importar',
  h(async (req, res) => {
    const vid = Number(req.params.id)
    const v = await db.query('SELECT 1 FROM vistorias WHERE id = $1', [vid])
    if (!v.rowCount) return res.status(404).json({ success: false, message: 'Vistoria não encontrada' })
    const lista = Array.isArray((req.body || {}).pastas) ? req.body.pastas : []

    const norm = (s) => String(s || '').trim().toLowerCase()
    const client = await db.pool.connect()
    const mapa = {}
    let novosPav = 0
    let novosAmb = 0
    try {
      await client.query('BEGIN')
      for (const bruta of [...new Set(lista.map((p) => String(p || '')))]) {
        const partes = bruta.split('/').map(semPrefixo).filter(Boolean)
        // Raiz da pasta ou "00 - Sem ambiente": a foto entra sem ambiente e vai
        // para a conferência, como qualquer upload em lote.
        if (!partes.length || norm(partes[partes.length - 1]) === 'sem ambiente') {
          mapa[bruta] = null
          continue
        }
        const nomeAmb = partes[partes.length - 1]
        const nomePav = partes.length > 1 ? partes[0] : 'Pavimento único'

        const pavs = await client.query('SELECT id, nome FROM pavimentos WHERE vistoria_id = $1', [vid])
        let pav = pavs.rows.find((p) => norm(p.nome) === norm(nomePav))
        if (!pav) {
          const novo = await client.query(
            `INSERT INTO pavimentos (vistoria_id, nome, ordem)
             VALUES ($1, $2, (SELECT COALESCE(MAX(ordem), -1) + 1 FROM pavimentos WHERE vistoria_id = $1))
             RETURNING id, nome`,
            [vid, nomePav]
          )
          pav = novo.rows[0]
          novosPav++
        }
        const ambs = await client.query('SELECT id, nome FROM ambientes WHERE pavimento_id = $1', [pav.id])
        let amb = ambs.rows.find((a) => norm(a.nome) === norm(nomeAmb))
        if (!amb) {
          const novo = await client.query(
            `INSERT INTO ambientes (pavimento_id, nome, ordem)
             VALUES ($1, $2, (SELECT COALESCE(MAX(ordem), -1) + 1 FROM ambientes WHERE pavimento_id = $1))
             RETURNING id, nome`,
            [pav.id, nomeAmb]
          )
          amb = novo.rows[0]
          novosAmb++
        }
        mapa[bruta] = amb.id
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
    res.json({ success: true, data: { pastas: mapa, pavimentos: novosPav, ambientes: novosAmb } })
  })
)

// ------------------------------------------------ pavimentos e ambientes
// (servem tanto o modelo do imóvel quanto a instância da vistoria)
async function criarPavimento(res, dono, id, nome) {
  const col = dono === 'imovel' ? 'imovel_id' : 'vistoria_id'
  const tabela = dono === 'imovel' ? 'imoveis' : 'vistorias'
  const ok = await db.query(`SELECT 1 FROM ${tabela} WHERE id = $1`, [id])
  if (!ok.rowCount) return res.status(404).json({ success: false, message: 'Registro não encontrado' })
  if (!nome) return res.status(422).json({ success: false, message: 'Nome é obrigatório' })
  const { rows } = await db.query(
    `INSERT INTO pavimentos (${col}, nome, ordem)
     VALUES ($1, $2, (SELECT COALESCE(MAX(ordem), -1) + 1 FROM pavimentos WHERE ${col} = $1))
     RETURNING id, nome, ordem`,
    [id, nome]
  )
  res.json({ success: true, data: { ...rows[0], ambientes: [] } })
}

router.post('/imoveis/:id/pavimentos', h((req, res) => criarPavimento(res, 'imovel', Number(req.params.id), (req.body || {}).nome)))
router.post('/vistorias/:id/pavimentos', h((req, res) => criarPavimento(res, 'vistoria', Number(req.params.id), (req.body || {}).nome)))

router.put(
  '/pavimentos/:id',
  h(async (req, res) => {
    const id = Number(req.params.id)
    const cur = await db.query('SELECT * FROM pavimentos WHERE id = $1', [id])
    if (!cur.rowCount) return res.status(404).json({ success: false, message: 'Pavimento não encontrado' })
    const p = cur.rows[0]
    const { nome, ordem } = req.body || {}
    const { rows } = await db.query(
      'UPDATE pavimentos SET nome = $1, ordem = $2 WHERE id = $3 RETURNING id, nome, ordem',
      [nome ?? p.nome, ordem ?? p.ordem, id]
    )
    res.json({ success: true, data: rows[0] })
  })
)

router.delete(
  '/pavimentos/:id',
  h(async (req, res) => {
    const r = await db.query('DELETE FROM pavimentos WHERE id = $1', [Number(req.params.id)])
    if (!r.rowCount) return res.status(404).json({ success: false, message: 'Pavimento não encontrado' })
    res.json({ success: true, message: 'Pavimento excluído' })
  })
)

// Criar ambiente. Em campo (origem 'campo') pode vir sem nome com nomearDepois:
// entra como "Novo N" e é renomeado na conferência.
router.post(
  '/pavimentos/:id/ambientes',
  h(async (req, res) => {
    const pavimentoId = Number(req.params.id)
    const pav = await db.query('SELECT * FROM pavimentos WHERE id = $1', [pavimentoId])
    if (!pav.rowCount) return res.status(404).json({ success: false, message: 'Pavimento não encontrado' })
    const { nome, origem, nomearDepois } = req.body || {}
    let nomeFinal = (nome || '').trim()
    const depois = Boolean(nomearDepois) && !nomeFinal
    if (!nomeFinal && !depois) return res.status(422).json({ success: false, message: 'Nome é obrigatório' })
    if (depois) {
      const dono = pav.rows[0].vistoria_id
        ? ['p.vistoria_id', pav.rows[0].vistoria_id]
        : ['p.imovel_id', pav.rows[0].imovel_id]
      const c = await db.query(
        `SELECT COUNT(*)::int AS c FROM ambientes a JOIN pavimentos p ON p.id = a.pavimento_id
         WHERE ${dono[0]} = $1 AND a.nomear_depois`,
        [dono[1]]
      )
      nomeFinal = `Novo ${c.rows[0].c + 1}`
    }
    const { rows } = await db.query(
      `INSERT INTO ambientes (pavimento_id, nome, ordem, origem, nomear_depois)
       VALUES ($1, $2, (SELECT COALESCE(MAX(ordem), -1) + 1 FROM ambientes WHERE pavimento_id = $1), $3, $4)
       RETURNING ${AMB_COLS.replaceAll('a.', '')}`,
      [pavimentoId, nomeFinal, origem === 'campo' ? 'campo' : 'planta', depois]
    )
    res.json({ success: true, data: { ...rows[0], fotos: 0 } })
  })
)

router.put(
  '/ambientes/:id',
  h(async (req, res) => {
    const id = Number(req.params.id)
    const cur = await db.query('SELECT * FROM ambientes WHERE id = $1', [id])
    if (!cur.rowCount) return res.status(404).json({ success: false, message: 'Ambiente não encontrado' })
    const a = cur.rows[0]
    const b = req.body || {}
    const { nome, ordem, situacao, nota, medidas, nomearDepois, pavimentoId } = b
    if (situacao && !['previsto', 'nao_existe'].includes(situacao)) {
      return res.status(422).json({ success: false, message: 'Situação inválida' })
    }
    // Medidas estruturadas (quadro de áreas): só o que veio no corpo muda.
    const { rows } = await db.query(
      `UPDATE ambientes SET nome = $1, ordem = $2, situacao = $3, nota = $4, medidas = $5,
        nomear_depois = $6, pavimento_id = $7, comprimento = $9, largura = $10, pe_direito = $11, area = $12
       WHERE id = $8 RETURNING ${AMB_COLS.replaceAll('a.', '')}`,
      [
        (nome ?? a.nome) || a.nome,
        ordem ?? a.ordem,
        situacao ?? a.situacao,
        nota ?? a.nota,
        medidas ?? a.medidas,
        nomearDepois ?? a.nomear_depois,
        pavimentoId ? Number(pavimentoId) : a.pavimento_id,
        id,
        'comprimento' in b ? numOuNulo(b.comprimento) : a.comprimento,
        'largura' in b ? numOuNulo(b.largura) : a.largura,
        'peDireito' in b ? numOuNulo(b.peDireito) : a.pe_direito,
        'area' in b ? numOuNulo(b.area) : a.area,
      ]
    )
    res.json({ success: true, data: rows[0] })
  })
)

router.delete(
  '/ambientes/:id',
  h(async (req, res) => {
    const r = await db.query('DELETE FROM ambientes WHERE id = $1', [Number(req.params.id)])
    if (!r.rowCount) return res.status(404).json({ success: false, message: 'Ambiente não encontrado' })
    res.json({ success: true, message: 'Ambiente excluído' })
  })
)

// ---------------------------------------------------------------- QR code
// PNG de um texto qualquer (cartões de claquete, link de captura).
router.get(
  '/qr',
  h(async (req, res) => {
    const text = String(req.query.text || '')
    if (!text) return res.status(422).json({ success: false, message: 'Texto obrigatório' })
    const png = await QRCode.toBuffer(text, { width: 320, margin: 1 })
    res.type('png').send(png)
  })
)

module.exports = router
