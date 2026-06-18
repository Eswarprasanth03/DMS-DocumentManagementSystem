import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { config } from './config.js'
import { store } from './store.js'

export const ROLE_PERMS = {
  Admin: ['*'],
  Manager: [
    'dashboard', 'upload', 'browse', 'search', 'trips', 'review',
    'retention', 'bonds', 'audit', 'compliance', 'esign', 'settings',
  ],
  Viewer: ['dashboard', 'browse', 'search', 'audit'],
}

export function hashPassword(pw) {
  return bcrypt.hashSync(pw, 10)
}
export function verifyPassword(pw, hash) {
  return bcrypt.compareSync(pw, hash)
}

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role, name: user.name },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn },
  )
}

export function can(role, perm) {
  const perms = ROLE_PERMS[role] || []
  return perms.includes('*') || perms.includes(perm)
}

// Express middleware: require a valid JWT.
export function authRequired(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Authentication required' })
  try {
    const payload = jwt.verify(token, config.jwtSecret)
    const user = store.findById('users', payload.sub)
    if (!user) return res.status(401).json({ error: 'User no longer exists' })
    req.user = { id: user.id, name: user.name, email: user.email, role: user.role }
    next()
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
}

// Express middleware factory: require a permission for the route.
export function requirePerm(perm) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' })
    if (!can(req.user.role, perm)) {
      return res.status(403).json({ error: `Forbidden: '${perm}' not allowed for role ${req.user.role}` })
    }
    next()
  }
}

export function sanitizeUser(u) {
  if (!u) return null
  const { passwordHash, ...rest } = u
  return rest
}
