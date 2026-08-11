'use strict'

// Autenticação: senha com scrypt (stdlib, sem dependência nativa) e sessão via JWT.
const crypto = require('node:crypto')
const jwt = require('jsonwebtoken')

const SECRET = process.env.JWT_SECRET || 'sistema-julia-dev-secret-troque-em-producao'

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex')
  return `${salt}:${hash}`
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false
  const [salt, hash] = stored.split(':')
  const test = crypto.scryptSync(String(password), salt, 64).toString('hex')
  const a = Buffer.from(hash, 'hex')
  const b = Buffer.from(test, 'hex')
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, SECRET, { expiresIn: '7d' })
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : String(req.query.token || '')
  try {
    req.user = jwt.verify(token, SECRET)
    next()
  } catch {
    res.status(401).json({ success: false, message: 'Não autenticado' })
  }
}

module.exports = { hashPassword, verifyPassword, signToken, authMiddleware }
