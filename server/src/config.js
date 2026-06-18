import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Load environment variables from server/.env if present (Node 20.6+ native).
const envPath = path.resolve(__dirname, '..', '.env')
if (fs.existsSync(envPath) && typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(envPath)
  } catch (err) {
    console.warn('[config] could not load .env:', err.message)
  }
}

export const config = {
  port: Number(process.env.PORT) || 4000,
  jwtSecret: process.env.JWT_SECRET || 'flowsphere-dms-dev-secret-change-in-prod',
  jwtExpiresIn: '12h',
  region: 'India (Mumbai)',
  // Persistence driver: 'json' (local file, zero-config) or 'mongo' (MongoDB).
  dbDriver: process.env.DB_DRIVER || 'json',
  // Auto-seed demo data on startup? Off by default so restarts never modify your
  // data. Use `npm run server:seed` to load/reset demo data on demand.
  seedOnStart: process.env.SEED_ON_START === 'true',
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017',
  mongoDb: process.env.MONGODB_DB || 'flowsphere_dms',
  // Redis (BullMQ background workers). Dedicated FlowSphere instance.
  redisUrl: process.env.REDIS_URL || 'redis://127.0.0.1:6380',
  // Data + storage live on the local filesystem so the app runs with zero
  // external services (stands in for MongoDB Atlas + MinIO from the guide).
  dataDir: path.resolve(__dirname, '..', 'data'),
  dbFile: path.resolve(__dirname, '..', 'data', 'db.json'),
  uploadsDir: path.resolve(__dirname, '..', 'data', 'uploads'),
  // Live ingest channel folders (watched by the background watchers).
  dropDir: path.resolve(__dirname, '..', 'data', 'drop'),
  scannerDir: path.resolve(__dirname, '..', 'data', 'scanner'),
  maildropDir: path.resolve(__dirname, '..', 'data', 'maildrop'),
  processedDir: path.resolve(__dirname, '..', 'data', 'processed'),
  // OCR pipeline:
  //  - digital PDFs  → pdf-parse text layer (always)
  //  - scanned PDFs / images → Vision LLM OCR when available, else Tesseract.
  // OCR_VISION: 'auto' (use NVIDIA vision when a key is set) | 'off'.
  // OCR_ENGINE: 'tesseract' enables Tesseract fallback for images/scanned PDFs.
  ocrVision: process.env.OCR_VISION || 'auto',
  ocrEngine: process.env.OCR_ENGINE || 'auto',
  ocrLanguage: process.env.OCR_LANGUAGE || 'eng',
  ocrMaxPages: Number(process.env.OCR_MAX_PAGES) || 5,
  // LLM classifier provider: 'gemini' | 'nvidia' | 'none' (deterministic).
  llmProvider: process.env.LLM_PROVIDER || (process.env.GEMINI_API_KEY ? 'gemini' : 'none'),
  // Google Gemini
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  // NVIDIA NIM (OpenAI-compatible)
  nvidiaApiKey: process.env.NVIDIA_API_KEY || '',
  nvidiaBaseUrl: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
  nvidiaModel: process.env.NVIDIA_MODEL || 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
  // Semantic search embeddings (NVIDIA retrieval model; hash fallback offline).
  embedModel: process.env.EMBED_MODEL || 'nvidia/nv-embedqa-e5-v5',
  // Classification confidence below this routes a doc to manual review.
  confidenceThreshold: 0.75,
  // Retention escalation windows (days).
  retention: { warnT90: 90, warnT30: 30 },
  // Trip detection: taxi + hotel within this window (hours).
  tripWindowHours: 72,
}
