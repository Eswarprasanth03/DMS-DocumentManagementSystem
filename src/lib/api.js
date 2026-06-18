// Thin API client for the FlowSphere DMS backend.
// Handles base URL, JWT bearer token, JSON + multipart, and error normalization.

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000/api'
const TOKEN_KEY = 'fs_dms_token'

export function getToken() {
  return localStorage.getItem(TOKEN_KEY)
}
export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

class ApiError extends Error {
  constructor(message, status, data) {
    super(message)
    this.status = status
    this.data = data
  }
}

async function request(path, { method = 'GET', body, form, headers = {} } = {}) {
  const opts = { method, headers: { ...headers } }
  const token = getToken()
  if (token) opts.headers.Authorization = `Bearer ${token}`

  if (form) {
    opts.body = form // FormData; browser sets multipart boundary
  } else if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json'
    opts.body = JSON.stringify(body)
  }

  let res
  try {
    res = await fetch(`${BASE}${path}`, opts)
  } catch {
    throw new ApiError('Cannot reach the API server. Is the backend running on :4000?', 0)
  }

  const isJson = res.headers.get('content-type')?.includes('application/json')
  const data = isJson ? await res.json().catch(() => ({})) : await res.text()

  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login') {
      setToken(null)
    }
    throw new ApiError(data?.error || `Request failed (${res.status})`, res.status, data)
  }
  return data
}

export const api = {
  // auth
  login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password } }),
  me: () => request('/auth/me'),

  // dashboard
  stats: () => request('/stats'),
  channels: () => request('/channels'),

  // folders + documents
  folders: () => request('/folders'),
  folderPath: (id) => request(`/folders/${id}/path`),
  documents: (params = {}) => {
    const qs = new URLSearchParams(params).toString()
    return request(`/documents${qs ? `?${qs}` : ''}`)
  },
  document: (id) => request(`/documents/${id}`),
  uploadFile: (file, fields = {}) => {
    const form = new FormData()
    if (file) form.append('file', file)
    Object.entries(fields).forEach(([k, v]) => v != null && form.append(k, v))
    return request('/documents/upload', { method: 'POST', form })
  },
  updateDocument: (id, patch) => request(`/documents/${id}`, { method: 'PATCH', body: patch }),
  reviewDocument: (id, body) => request(`/documents/${id}/review`, { method: 'POST', body }),
  reviewQueue: () => request('/documents/review-queue'),
  documentOcr: (id) => request(`/documents/${id}/ocr`),
  reprocess: (id) => request(`/documents/${id}/reprocess`, { method: 'POST' }),
  approveDocument: (id, body = {}) => request(`/documents/${id}/approve`, { method: 'PATCH', body }),
  rejectDocument: (id, reason) => request(`/documents/${id}/reject`, { method: 'PATCH', body: { reason } }),
  correctDocument: (id, body) => request(`/documents/${id}/correct`, { method: 'PATCH', body }),

  // duplicate management
  duplicates: () => request('/documents/duplicates'),
  dismissDuplicate: (id) => request(`/documents/${id}/dismiss-duplicate`, { method: 'POST' }),
  mergeDuplicate: (targetId, sourceId) => request(`/documents/${targetId}/merge`, { method: 'POST', body: { sourceId } }),
  softDelete: (id, reason, retainedId) => request(`/documents/${id}/soft-delete`, { method: 'POST', body: { reason, retainedId } }),

  // trash / purge
  trash: () => request('/documents/trash'),
  restoreDocument: (id) => request(`/documents/${id}/restore`, { method: 'POST' }),
  purgeDocument: (id, confirm) => request(`/documents/${id}/purge`, { method: 'DELETE', body: { confirm } }),

  // notifications
  notifications: () => request('/notifications'),
  markNotificationRead: (id) => request(`/notifications/${id}/read`, { method: 'PATCH' }),
  readAllNotifications: () => request('/notifications/read-all', { method: 'POST' }),
  rollback: (id, v) => request(`/documents/${id}/rollback/${v}`, { method: 'POST' }),
  versions: (id) => request(`/documents/${id}/versions`),
  documentAudit: (id) => request(`/documents/${id}/audit`),
  deleteDocument: (id, approvals) => request(`/documents/${id}`, { method: 'DELETE', body: { approvals } }),
  // Fetch the original file bytes (authorized) and return an object URL + type.
  fileObjectUrl: async (id) => {
    const blob = await api.fileBlob(id)
    return URL.createObjectURL(blob)
  },
  // Fetch the original file bytes (authorized) as a Blob (for client-side preview).
  fileBlob: async (id) => {
    const res = await fetch(`${BASE}/documents/${id}/file`, {
      headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {},
    })
    if (!res.ok) throw new ApiError(`File request failed (${res.status})`, res.status)
    return res.blob()
  },

  // search
  search: (body) => request('/search', { method: 'POST', body }),
  semanticSearch: (q, opts = {}) => request('/documents/semantic-search', { method: 'POST', body: { q, ...opts } }),

  // trips
  trips: () => request('/trips'),
  detectTrips: () => request('/trips/detect', { method: 'POST' }),
  updateTrip: (id, status) => request(`/trips/${id}`, { method: 'PATCH', body: { status } }),

  // retention
  retention: () => request('/retention'),
  retentionSweep: () => request('/retention/sweep', { method: 'POST' }),
  retentionAction: (id, action) => request(`/documents/${id}/retention-action`, { method: 'POST', body: { action } }),

  // bonds
  bonds: () => request('/bonds'),
  createBond: (body) => request('/bonds', { method: 'POST', body }),
  deleteBond: (id, approvals) => request(`/bonds/${id}`, { method: 'DELETE', body: { approvals } }),

  // audit + compliance
  audit: (params = {}) => {
    const qs = new URLSearchParams(params).toString()
    return request(`/audit${qs ? `?${qs}` : ''}`)
  },
  auditVerify: () => request('/audit/verify'),
  compliancePacks: () => request('/compliance/packs'),
  generatePack: (type) => request(`/compliance/${type}/generate`, { method: 'POST' }),

  // esign
  esign: () => request('/esign'),
  createEnvelope: (body) => request('/esign', { method: 'POST', body }),
  sendEnvelope: (id) => request(`/esign/${id}/send`, { method: 'PATCH' }),
}

export { ApiError }
