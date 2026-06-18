import { config } from './config.js'
import { embed as hashEmbed } from './pipeline.js'

// Semantic-search embeddings.
//   - NVIDIA retrieval model (nv-embedqa) when a key is set — true semantic vectors.
//   - Deterministic local hash embedding (64-dim) as an offline fallback.
// query vs passage input types matter for asymmetric retrieval models.

const HASH_MODEL = 'hash-64'

export function embeddingModel() {
  return config.nvidiaApiKey ? config.embedModel : HASH_MODEL
}

export function cosine(a, b) {
  if (!a || !b || a.length !== b.length) return 0
  let dot = 0; let na = 0; let nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  const d = Math.sqrt(na) * Math.sqrt(nb)
  return d ? dot / d : 0
}

async function nvidiaEmbed(texts, inputType) {
  const url = `${config.nvidiaBaseUrl.replace(/\/$/, '')}/embeddings`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.nvidiaApiKey}` },
      body: JSON.stringify({
        model: config.embedModel,
        input: texts.map((t) => String(t || '').slice(0, 2000) || ' '),
        input_type: inputType,
        encoding_format: 'float',
        truncate: 'END',
      }),
      signal: controller.signal,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    return data.data.map((d) => d.embedding)
  } finally {
    clearTimeout(timer)
  }
}

// Embed a single query string. Returns { vector, model }.
export async function embedQuery(text) {
  if (config.nvidiaApiKey) {
    try {
      const [v] = await nvidiaEmbed([text], 'query')
      if (v) return { vector: v, model: config.embedModel }
    } catch (err) {
      console.warn('[embeddings] query embed failed, using hash:', err.message)
    }
  }
  return { vector: hashEmbed(text), model: HASH_MODEL }
}

// Embed many passages (batched). Returns { vectors, model }.
export async function embedPassages(texts) {
  if (config.nvidiaApiKey && texts.length) {
    try {
      const vectors = []
      const BATCH = 50
      for (let i = 0; i < texts.length; i += BATCH) {
        const chunk = texts.slice(i, i + BATCH)
        const vs = await nvidiaEmbed(chunk, 'passage')
        vectors.push(...vs)
      }
      if (vectors.length === texts.length) return { vectors, model: config.embedModel }
    } catch (err) {
      console.warn('[embeddings] passage embed failed, using hash:', err.message)
    }
  }
  return { vectors: texts.map((t) => hashEmbed(t)), model: HASH_MODEL }
}
