import { store, nowIso } from './store.js'

// Create an in-app notification for a user (by name or email).
// Surfaced via GET /api/notifications and the top-bar bell.
export function notify({ to, tone = 'info', title, detail = '', docId = null }) {
  if (!to || !title) return null
  return store.insert('notifications', {
    to, tone, title, detail, docId, read: false, ts: nowIso(),
  })
}
