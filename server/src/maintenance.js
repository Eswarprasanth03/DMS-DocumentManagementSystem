import { store } from './store.js'
import * as storage from './storage.js'
import { audit } from './audit.js'

export const PURGE_AFTER_DAYS = 30

// Permanently purge soft-deleted documents past their recovery window.
export async function purgeExpiredTrash() {
  const cutoff = Date.now() - PURGE_AFTER_DAYS * 86400000
  const expired = store.all('documents').filter(
    (d) => d.deletedAt && new Date(d.deletedAt).getTime() < cutoff,
  )
  for (const d of expired) {
    if (d.storageKey) { try { await storage.deleteFile(d.storageKey) } catch { /* ignore */ } }
    store.all('versions', (v) => v.docId === d.id).forEach((v) => store.remove('versions', v.id))
    store.remove('documents', d.id)
    audit({ user: 'System', action: 'delete', doc: d.name, docId: d.id, detail: 'Auto-purged after 30-day recovery window', ip: 'scheduler' })
  }
  return { purged: expired.length }
}
