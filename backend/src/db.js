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
