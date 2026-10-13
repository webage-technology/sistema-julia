'use strict'

// Cartões de claquete com QR: a equipe fotografa com a câmera do próprio
// celular, entrando em cada ambiente pelo cartão dele, e depois sobe TODAS as
// fotos de uma vez. O sistema lê o QR e separa sozinho: como as fotos são
// tiradas andando o caminho, tudo o que vem depois de um cartão (na ordem de
// captura) pertence àquele ambiente, até o próximo cartão.
//
//   SJ-AMB:<id>  cartão de um ambiente cadastrado (impresso pela vistoria)
//   SJ-NOVO      cartão "novo ambiente" (não previsto na planta): cada vez que
//                aparece abre um "Novo N", renomeado depois na conferência
//
// QR de outra coisa (etiqueta de máquina, extintor) é ignorado.
const sharp = require('sharp')
const jsQR = require('jsqr')
const db = require('./db')

const NOVO = 'SJ-NOVO'
const RE_AMB = /^SJ-AMB:(\d+)$/

const ehCartao = (qr) => qr === NOVO || RE_AMB.test(qr)

// Lê o QR de uma foto. Duas passadas: 1600px pega o cartão de perto (o caso
// normal, ~50 ms); 2400px pega o cartão fotografado de mais longe. Devolve o
// texto do cartão, ou '' se não houver cartão nosso na foto.
async function lerCartao(absFile) {
  for (const lado of [1600, 2400]) {
    const { data, info } = await sharp(absFile, { failOn: 'none' })
      .rotate()
      .resize({ width: lado, height: lado, fit: 'inside', withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const r = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), info.width, info.height, {
      inversionAttempts: 'dontInvert',
    })
    if (r?.data) return ehCartao(r.data.trim()) ? r.data.trim() : ''
    if (Math.max(info.width, info.height) < lado) break // a foto já era menor: maior não há
  }
  return ''
}

const norm = (s) => String(s || '').trim().toLowerCase()
const diaDe = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '')

// Devolve: `cartoes` e `semAmbiente` contam a vistoria inteira; `separadas`,
// `ambientes` e `ambientesCriados` contam só o que ESTA passada mudou.
//
// Separa as fotos da vistoria pelos cartões lidos. Por padrão só preenche as
// fotos SEM ambiente (o que já foi ajustado à mão na conferência fica como
// está); `refazer` reatribui tudo que vem depois de um cartão.
// A cada novo dia o "ambiente atual" zera: a primeira foto do dia tem de ser
// um cartão — senão a manhã de quinta cairia no último ambiente de quarta.
async function separar(vid, { refazer = false } = {}) {
  const r = { cartoes: 0, separadas: 0, ambientesCriados: 0, semAmbiente: 0, ambientes: 0, alteradas: [] }
  const client = await db.pool.connect()
  try {
    await client.query('BEGIN')
    const ambs = await client.query(
      `SELECT a.id, a.nome, a.pavimento_id AS "pavimentoId", p.nome AS pavimento
       FROM ambientes a JOIN pavimentos p ON p.id = a.pavimento_id WHERE p.vistoria_id = $1`,
      [vid]
    )
    const daVistoria = new Map(ambs.rows.map((a) => [a.id, a]))
    const fotos = await client.query(
      `SELECT id, ambiente_id AS "ambienteId", qr, claquete, capturada_em AS "capturadaEm"
       FROM fotos WHERE vistoria_id = $1 ORDER BY capturada_em NULLS LAST, id`,
      [vid]
    )

    // Pavimento onde nasce o "Novo N": o do ambiente atual; senão o primeiro
    // da vistoria; senão um "Pavimento único" criado agora.
    const pavimentoPara = async (atual) => {
      if (atual && daVistoria.has(atual)) return daVistoria.get(atual).pavimentoId
      const p = await client.query('SELECT id FROM pavimentos WHERE vistoria_id = $1 ORDER BY ordem, id LIMIT 1', [vid])
      if (p.rowCount) return p.rows[0].id
      const novo = await client.query(
        `INSERT INTO pavimentos (vistoria_id, nome, ordem) VALUES ($1, 'Pavimento único', 0) RETURNING id`,
        [vid]
      )
      return novo.rows[0].id
    }
    const criarAmbiente = async (pavimentoId, nome, nomearDepois) => {
      const novo = await client.query(
        `INSERT INTO ambientes (pavimento_id, nome, ordem, origem, nomear_depois)
         VALUES ($1, $2, (SELECT COALESCE(MAX(ordem), -1) + 1 FROM ambientes WHERE pavimento_id = $1), 'campo', $3)
         RETURNING id, nome, pavimento_id AS "pavimentoId"`,
        [pavimentoId, nome, nomearDepois]
      )
      const pav = await client.query('SELECT nome FROM pavimentos WHERE id = $1', [pavimentoId])
      const a = { ...novo.rows[0], pavimento: pav.rows[0]?.nome || '' }
      daVistoria.set(a.id, a)
      r.ambientesCriados++
      return a.id
    }

    const ambienteDoCartao = async (f, atual, repetido) => {
      if (f.qr === NOVO) {
        // Já separado antes: o cartão continua apontando o "Novo N" dele.
        if (f.ambienteId && daVistoria.has(f.ambienteId)) return f.ambienteId
        // Foto do cartão refeita (duas seguidas, sem foto do ambiente no meio):
        // é o mesmo ambiente novo, não um segundo.
        if (repetido && atual) return atual
        const c = await client.query(
          `SELECT COUNT(*)::int AS c FROM ambientes a JOIN pavimentos p ON p.id = a.pavimento_id
           WHERE p.vistoria_id = $1 AND a.nomear_depois`,
          [vid]
        )
        return criarAmbiente(await pavimentoPara(atual), `Novo ${c.rows[0].c + 1}`, true)
      }
      const id = Number(RE_AMB.exec(f.qr)?.[1])
      if (daVistoria.has(id)) return id
      // Cartão impresso em outra vistoria (do mesmo imóvel, normalmente): acha
      // o ambiente pelo nome; se esta vistoria não tem, cria com o mesmo nome.
      const orig = await client.query(
        'SELECT a.nome, p.nome AS pavimento FROM ambientes a JOIN pavimentos p ON p.id = a.pavimento_id WHERE a.id = $1',
        [id]
      )
      if (!orig.rowCount) return null
      const o = orig.rows[0]
      const lista = [...daVistoria.values()]
      const igual =
        lista.find((a) => norm(a.nome) === norm(o.nome) && norm(a.pavimento) === norm(o.pavimento)) ||
        lista.find((a) => norm(a.nome) === norm(o.nome))
      if (igual) return igual.id
      const pav = await client.query('SELECT id FROM pavimentos WHERE vistoria_id = $1 AND lower(nome) = lower($2) LIMIT 1', [vid, o.pavimento])
      const pavimentoId = pav.rowCount
        ? pav.rows[0].id
        : (
            await client.query(
              `INSERT INTO pavimentos (vistoria_id, nome, ordem)
               VALUES ($1, $2, (SELECT COALESCE(MAX(ordem), -1) + 1 FROM pavimentos WHERE vistoria_id = $1)) RETURNING id`,
              [vid, o.pavimento]
            )
          ).rows[0].id
      return criarAmbiente(pavimentoId, o.nome, false)
    }

    const usados = new Set()
    let atual = null
    let dia = ''
    let anteriorFoiNovo = false
    for (const f of fotos.rows) {
      const d = diaDe(f.capturadaEm)
      if (d !== dia) {
        dia = d
        atual = null
        anteriorFoiNovo = false
      }
      if (f.qr) {
        const amb = await ambienteDoCartao(f, atual, anteriorFoiNovo && f.qr === NOVO)
        anteriorFoiNovo = f.qr === NOVO
        if (amb) {
          atual = amb
          r.cartoes++
          if (f.ambienteId !== amb || !f.claquete) {
            await client.query('UPDATE fotos SET ambiente_id = $1, claquete = true, lip = false WHERE id = $2', [amb, f.id])
            usados.add(amb)
          }
          continue
        }
      }
      anteriorFoiNovo = false
      if (atual == null) {
        if (!f.ambienteId) r.semAmbiente++
        continue
      }
      if (!f.ambienteId || (refazer && f.ambienteId !== atual)) {
        await client.query('UPDATE fotos SET ambiente_id = $1 WHERE id = $2', [atual, f.id])
        r.separadas++
        r.alteradas.push(f.id)
        usados.add(atual)
      }
    }
    await client.query('COMMIT')
    r.ambientes = usados.size
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
  return r
}

module.exports = { lerCartao, separar, ehCartao, NOVO }
