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

module.exports = { query, pool, init }
