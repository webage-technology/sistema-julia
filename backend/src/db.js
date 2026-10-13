'use strict'

// Camada de dados PostgreSQL (driver `pg`). Cria o schema e semeia o admin no
// boot. As tabelas são criadas com CREATE TABLE IF NOT EXISTS (idempotente).
const { Pool } = require('pg')
const { hashPassword } = require('./auth')

const pool = new Pool({
  host: process.env.DB_HOST || 'db',
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || 'sysjulia',
  password: process.env.DB_PASSWORD || 'sysjulia',
  database: process.env.DB_NAME || 'sistema_julia',
  max: 5,
})

function query(text, params) {
  return pool.query(text, params)
}

// Como o cliente aparece nas listas: pessoa jurídica é conhecida pela empresa
// (razão social), pessoa física pelo próprio nome. Fragmento de SQL para que
// todas as consultas que trazem o cliente respondam a mesma coisa — espera a
// tabela `clients` com o apelido `c`.
const CLIENTE_NOME = "CASE WHEN c.tipo = 'pj' AND c.company <> '' THEN c.company ELSE c.name END"

async function init() {
  // O backend pode subir antes do Postgres aceitar conexões — espera com retry.
  for (let i = 0; i < 30; i++) {
    try {
      await pool.query('SELECT 1')
      break
    } catch (err) {
      if (i === 29) throw err
      console.log('[db] aguardando o Postgres…')
      await new Promise((r) => setTimeout(r, 2000))
    }
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL,
      email      TEXT NOT NULL UNIQUE,
      password   TEXT NOT NULL,
      role       TEXT NOT NULL DEFAULT 'user',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS clients (
      id         SERIAL PRIMARY KEY,
      name       TEXT NOT NULL,
      email      TEXT NOT NULL DEFAULT '',
      phone      TEXT NOT NULL DEFAULT '',
      company    TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  // Pessoa física ou jurídica: 'pf' → CPF, 'pj' → CNPJ. `documento` guarda só os
  // dígitos (a máscara é da tela), o que mantém a busca e a comparação simples.
  await pool.query("ALTER TABLE clients ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'pj'")
  await pool.query("ALTER TABLE clients ADD COLUMN IF NOT EXISTS documento TEXT NOT NULL DEFAULT ''")

  // ---- Módulo de vistorias -------------------------------------------------
  // Cliente → Imóvel → Vistoria → Pavimento → Ambiente → Foto.
  // RESTRICT em imoveis.client_id: excluir um cliente com imóveis exige decisão
  // explícita (proteção contra perda de vistorias por engano).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS imoveis (
      id          SERIAL PRIMARY KEY,
      client_id   INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
      nome        TEXT NOT NULL,
      endereco    TEXT NOT NULL DEFAULT '',
      planta_path TEXT NOT NULL DEFAULT '',
      planta_nome TEXT NOT NULL DEFAULT '',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS vistorias (
      id            SERIAL PRIMARY KEY,
      imovel_id     INTEGER NOT NULL REFERENCES imoveis(id) ON DELETE CASCADE,
      tipo_servico  TEXT NOT NULL DEFAULT '',
      data_vistoria DATE,
      participantes TEXT NOT NULL DEFAULT '',
      status        TEXT NOT NULL DEFAULT 'preparo',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  // Pavimentos servem a dois donos: como MODELO do imóvel (imovel_id) ou como
  // instância de uma vistoria (vistoria_id) — exatamente um dos dois é nulo.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS pavimentos (
      id          SERIAL PRIMARY KEY,
      imovel_id   INTEGER REFERENCES imoveis(id) ON DELETE CASCADE,
      vistoria_id INTEGER REFERENCES vistorias(id) ON DELETE CASCADE,
      nome        TEXT NOT NULL,
      ordem       INTEGER NOT NULL DEFAULT 0,
      CHECK ((imovel_id IS NULL) <> (vistoria_id IS NULL))
    )
  `)
  // origem: 'planta' (pré-cadastrado) | 'campo' (criado durante a captura —
  // divergência planta × real). situacao: 'previsto' | 'nao_existe'.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ambientes (
      id            SERIAL PRIMARY KEY,
      pavimento_id  INTEGER NOT NULL REFERENCES pavimentos(id) ON DELETE CASCADE,
      nome          TEXT NOT NULL,
      ordem         INTEGER NOT NULL DEFAULT 0,
      origem        TEXT NOT NULL DEFAULT 'planta',
      situacao      TEXT NOT NULL DEFAULT 'previsto',
      nomear_depois BOOLEAN NOT NULL DEFAULT false,
      nota          TEXT NOT NULL DEFAULT '',
      medidas       TEXT NOT NULL DEFAULT ''
    )
  `)
  // A ordem do caminho não é coluna: deriva sempre de (capturada_em, id).
  // ambiente_id nulo = foto aguardando conferência (upload em lote).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fotos (
      id            SERIAL PRIMARY KEY,
      vistoria_id   INTEGER NOT NULL REFERENCES vistorias(id) ON DELETE CASCADE,
      ambiente_id   INTEGER REFERENCES ambientes(id) ON DELETE SET NULL,
      capturada_em  TIMESTAMPTZ,
      arquivo       TEXT NOT NULL,
      nome_original TEXT NOT NULL DEFAULT '',
      claquete      BOOLEAN NOT NULL DEFAULT false,
      destaque      BOOLEAN NOT NULL DEFAULT false,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await pool.query(
    'CREATE INDEX IF NOT EXISTS idx_fotos_vistoria ON fotos (vistoria_id, capturada_em, id)'
  )
  // Esta foto entra no LIP (Laudo de Inspeção Predial)? Por padrão sim: o laudo
  // é feito das fotos da vistoria e a curadoria é por exclusão. A claquete é a
  // planta apontada, não é foto do ambiente — nasce de fora.
  // A carga inicial roda UMA vez (quando a coluna é criada); repetir a cada boot
  // desmarcaria de novo o que a Julia tivesse reincluído à mão.
  const temLip = await pool.query(
    "SELECT 1 FROM information_schema.columns WHERE table_name = 'fotos' AND column_name = 'lip'"
  )
  if (!temLip.rowCount) {
    await pool.query('ALTER TABLE fotos ADD COLUMN lip BOOLEAN NOT NULL DEFAULT true')
    await pool.query('UPDATE fotos SET lip = false WHERE claquete')
  }

  // ---- Relatórios da vistoria (EVTL: divergências planta × realidade) ------
  // Cada divergência aponta a foto da PLANTA (normalmente a claquete do
  // ambiente) e a foto ATUAL que evidencia a mudança.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS divergencias (
      id             SERIAL PRIMARY KEY,
      vistoria_id    INTEGER NOT NULL REFERENCES vistorias(id) ON DELETE CASCADE,
      ambiente_id    INTEGER REFERENCES ambientes(id) ON DELETE SET NULL,
      titulo         TEXT NOT NULL DEFAULT '',
      descricao      TEXT NOT NULL DEFAULT '',
      foto_planta_id INTEGER REFERENCES fotos(id) ON DELETE SET NULL,
      foto_atual_id  INTEGER REFERENCES fotos(id) ON DELETE SET NULL,
      ordem          INTEGER NOT NULL DEFAULT 0,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_divergencias_vistoria ON divergencias (vistoria_id, ordem, id)')

  // ---- Biblioteca de modelos de documento ----------------------------------
  // O acervo do escritório: os .docx que a Julia já usa (laudos, declarações,
  // pareceres) ficam guardados aqui e são preenchidos com os dados dos cadastros
  // na hora de gerar. `tipo`:
  //   'nativo' — montado por código, com as fotos da vistoria (chave identifica qual)
  //   'docx'   — arquivo enviado, preenchido pelos campos {{...}} que ele tiver
  await pool.query(`
    CREATE TABLE IF NOT EXISTS modelos (
      id            SERIAL PRIMARY KEY,
      nome          TEXT NOT NULL,
      descricao     TEXT NOT NULL DEFAULT '',
      tipo          TEXT NOT NULL DEFAULT 'docx',
      chave         TEXT NOT NULL DEFAULT '',
      arquivo       TEXT NOT NULL DEFAULT '',
      nome_original TEXT NOT NULL DEFAULT '',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  // O Relatório Fotográfico é o modelo que já vem com o sistema.
  await pool.query(
    `INSERT INTO modelos (nome, descricao, tipo, chave)
     SELECT 'Relatório fotográfico',
       'Capa, localização do imóvel e as fotos da vistoria em duas colunas, numeradas e legendadas — uma seção por ambiente.',
       'nativo', 'fotografico'
     WHERE NOT EXISTS (SELECT 1 FROM modelos WHERE chave = 'fotografico')`
  )

  // ---- Relatórios (documentos) ---------------------------------------------
  // Um relatório é um DOCUMENTO de uma vistoria: o modelo (hoje 'fotografico'),
  // a capa e o texto que a Julia escreve. Existir como linha é o que permite a
  // área de Relatórios ver todos num contexto amplo — e filtrar por vistoria,
  // imóvel ou cliente quando se entra por dentro deles.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS relatorios (
      id          SERIAL PRIMARY KEY,
      vistoria_id INTEGER NOT NULL REFERENCES vistorias(id) ON DELETE CASCADE,
      modelo      TEXT NOT NULL DEFAULT 'fotografico',
      titulo      TEXT NOT NULL DEFAULT 'Relatório fotográfico',
      subtitulo   TEXT NOT NULL DEFAULT '',
      data_texto  TEXT NOT NULL DEFAULT '',
      fonte       TEXT NOT NULL DEFAULT 'Plenno Arquitetura',
      texto       TEXT NOT NULL DEFAULT '',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  await pool.query('CREATE INDEX IF NOT EXISTS idx_relatorios_vistoria ON relatorios (vistoria_id, id)')
  // De qual modelo da biblioteca este relatório saiu. Apagar o modelo não apaga
  // os documentos já feitos com ele — por isso SET NULL, e não CASCADE.
  await pool.query(
    'ALTER TABLE relatorios ADD COLUMN IF NOT EXISTS modelo_id INTEGER REFERENCES modelos(id) ON DELETE SET NULL'
  )
  await pool.query(
    "UPDATE relatorios r SET modelo_id = m.id FROM modelos m WHERE m.chave = r.modelo AND r.modelo_id IS NULL"
  )
  // Quais fotos entram em CADA relatório (dois relatórios da mesma vistoria
  // podem levar recortes diferentes). O LIP continua com a sua marca em fotos.lip.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS relatorio_fotos (
      relatorio_id INTEGER NOT NULL REFERENCES relatorios(id) ON DELETE CASCADE,
      foto_id      INTEGER NOT NULL REFERENCES fotos(id) ON DELETE CASCADE,
      PRIMARY KEY (relatorio_id, foto_id)
    )
  `)
  // A legenda é da FOTO, não do relatório: "Imagem 07. Bilheteria – Praia
  // Vermelha." descreve o que está na imagem e serve a qualquer documento.
  // Vazia, o relatório cai no nome do ambiente.
  await pool.query("ALTER TABLE fotos ADD COLUMN IF NOT EXISTS legenda TEXT NOT NULL DEFAULT ''")

  // ---- Viagem, cronograma e prestação de contas ----------------------------
  // Quem faz a vistoria (a equipe tem mais de um profissional).
  await pool.query(
    'ALTER TABLE vistorias ADD COLUMN IF NOT EXISTS responsavel_id INTEGER REFERENCES users(id) ON DELETE SET NULL'
  )
  // Viagem: uma ida a campo que pode cobrir VÁRIAS vistorias (vários imóveis,
  // do mesmo cliente ou não). O vínculo fica em viagem_vistorias.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS viagens (
      id          SERIAL PRIMARY KEY,
      vistoria_id INTEGER REFERENCES vistorias(id) ON DELETE CASCADE,
      destino     TEXT NOT NULL DEFAULT '',
      verba       NUMERIC(12,2) NOT NULL DEFAULT 0,
      observacoes TEXT NOT NULL DEFAULT '',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  // Campos próprios da viagem (antes ela era um apêndice da vistoria).
  await pool.query("ALTER TABLE viagens ADD COLUMN IF NOT EXISTS titulo TEXT NOT NULL DEFAULT ''")
  await pool.query('ALTER TABLE viagens ADD COLUMN IF NOT EXISTS inicio DATE')
  await pool.query('ALTER TABLE viagens ADD COLUMN IF NOT EXISTS fim DATE')
  await pool.query(
    'ALTER TABLE viagens ADD COLUMN IF NOT EXISTS responsavel_id INTEGER REFERENCES users(id) ON DELETE SET NULL'
  )
  // Solta o vínculo 1-para-1 antigo com a vistoria.
  // Campos do relatório de despesas em Excel (planilha da Julia).
  await pool.query("ALTER TABLE viagens ADD COLUMN IF NOT EXISTS processo TEXT NOT NULL DEFAULT ''")
  await pool.query("ALTER TABLE viagens ADD COLUMN IF NOT EXISTS lider_conferente TEXT NOT NULL DEFAULT ''")
  await pool.query('ALTER TABLE viagens ADD COLUMN IF NOT EXISTS retencao NUMERIC(12,2) NOT NULL DEFAULT 0')
  await pool.query("ALTER TABLE viagens ADD COLUMN IF NOT EXISTS motivo_retencao TEXT NOT NULL DEFAULT ''")
  await pool.query('ALTER TABLE viagens ALTER COLUMN vistoria_id DROP NOT NULL')
  await pool.query('ALTER TABLE viagens DROP CONSTRAINT IF EXISTS viagens_vistoria_id_key')
  await pool.query(`
    CREATE TABLE IF NOT EXISTS viagem_vistorias (
      viagem_id   INTEGER NOT NULL REFERENCES viagens(id) ON DELETE CASCADE,
      vistoria_id INTEGER NOT NULL REFERENCES vistorias(id) ON DELETE CASCADE,
      PRIMARY KEY (viagem_id, vistoria_id)
    )
  `)
  // Migra o vínculo antigo (viagens criadas quando era uma por vistoria).
  await pool.query(`
    INSERT INTO viagem_vistorias (viagem_id, vistoria_id)
    SELECT id, vistoria_id FROM viagens WHERE vistoria_id IS NOT NULL
    ON CONFLICT DO NOTHING
  `)
  // Cronograma: cada trecho da viagem (voo, ônibus, hotel, deslocamento…).
  // `notificar` + `lembrete_min` viram alarme no calendário exportado (.ics).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS viagem_itens (
      id           SERIAL PRIMARY KEY,
      viagem_id    INTEGER NOT NULL REFERENCES viagens(id) ON DELETE CASCADE,
      tipo         TEXT NOT NULL DEFAULT 'outro',
      titulo       TEXT NOT NULL,
      inicio       TIMESTAMPTZ,
      fim          TIMESTAMPTZ,
      origem       TEXT NOT NULL DEFAULT '',
      destino      TEXT NOT NULL DEFAULT '',
      codigo       TEXT NOT NULL DEFAULT '',
      valor        NUMERIC(12,2) NOT NULL DEFAULT 0,
      notificar    BOOLEAN NOT NULL DEFAULT true,
      lembrete_min INTEGER NOT NULL DEFAULT 120,
      obs          TEXT NOT NULL DEFAULT ''
    )
  `)
  // Item do tipo "tarefa" (levar EPI, perguntar o horário do almoço…) se marca
  // como feito na viagem e na agenda.
  await pool.query('ALTER TABLE viagem_itens ADD COLUMN IF NOT EXISTS concluido BOOLEAN NOT NULL DEFAULT false')
  // Gastos da viagem com o comprovante anexado (foto ou PDF).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS despesas (
      id            SERIAL PRIMARY KEY,
      vistoria_id   INTEGER REFERENCES vistorias(id) ON DELETE CASCADE,
      categoria     TEXT NOT NULL DEFAULT 'outro',
      descricao     TEXT NOT NULL DEFAULT '',
      valor         NUMERIC(12,2) NOT NULL DEFAULT 0,
      data          DATE,
      arquivo       TEXT NOT NULL DEFAULT '',
      nome_original TEXT NOT NULL DEFAULT '',
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)
  // A despesa passou a pertencer à VIAGEM (a verba é da viagem inteira).
  await pool.query(
    'ALTER TABLE despesas ADD COLUMN IF NOT EXISTS viagem_id INTEGER REFERENCES viagens(id) ON DELETE CASCADE'
  )
  await pool.query(`
    UPDATE despesas d SET viagem_id = v.id
    FROM viagens v WHERE v.vistoria_id = d.vistoria_id AND d.viagem_id IS NULL
  `)
  await pool.query('ALTER TABLE despesas ALTER COLUMN vistoria_id DROP NOT NULL')
  await pool.query('CREATE INDEX IF NOT EXISTS idx_despesas_viagem ON despesas (viagem_id)')
  await pool.query('CREATE INDEX IF NOT EXISTS idx_itens_viagem ON viagem_itens (viagem_id, inicio)')

  // ---- Camada de regularização (processos, protocolos, documentos, GED,
  // RRT, áreas, não conformidades, checklists, pinos, laudos, portal,
  // notificações, financeiro, auditoria, lixeira) — src/schema-regularizacao.js
  await require('./schema-regularizacao').migrar(pool)

  const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM users')
  if (rows[0].c === 0) {
    await pool.query('INSERT INTO users (name, email, password, role) VALUES ($1, $2, $3, $4)', [
      'Administrador',
      'admin@sistema-julia.local',
      hashPassword('admin123'),
      'admin',
    ])
    console.log('[seed] admin criado → admin@sistema-julia.local / admin123')
  }
}

module.exports = { query, pool, init, CLIENTE_NOME }
