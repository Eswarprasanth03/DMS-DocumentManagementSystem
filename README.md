# FlowSphere DMS — Standalone Document Management System

A **complete, working full-stack** standalone DMS, built from the *DMS Standalone
Sprint Plan* (feature set) and the *FlowSphere Design & Theme* documentation
(visual system).

> **Automate. Orchestrate. Scale.** — capture, classify, organise, secure,
> search, retain and audit documents automatically, with zero manual filing.

It runs **end-to-end with no external services**: its own React frontend, Express
API, file storage, a deterministic AI/document pipeline, an immutable audit
trail, a retention scheduler, and a zero-config datastore.

## Quick start

```bash
# 1. install both apps (frontend + server)
npm run setup

# 2. run frontend + backend together
npm run dev:all
```

- Frontend: http://localhost:5173
- API: http://localhost:4000/api

Sign in with a demo account (password is `demo`):

| Email | Role | Access |
| --- | --- | --- |
| priya@flowsphere.io | Admin | everything |
| arjun@flowsphere.io | Manager | most modules |
| sara@flowsphere.io | Viewer | read-only (dashboard, browse, search, audit) |

Roles are enforced both in the UI (RBAC navigation) and on every API route.

> Run apps separately if you prefer: `npm run dev` (frontend) and
> `npm run server` (API). Reset demo data anytime with `npm run server:seed`.

## Architecture

```
┌──────────────┐      REST + JWT      ┌─────────────────────────────┐
│  React 19    │  ───────────────►    │  Express API (:4000)        │
│  Vite        │                      │  • JWT auth + RBAC          │
│  Router 7    │  ◄───────────────    │  • document pipeline        │
│  Tailwind v4 │      JSON            │  • retention scheduler      │
└──────────────┘                      │  • immutable audit (hash)   │
                                      │  • local file storage       │
                                      │  • JSON datastore (db.json) │
                                      └─────────────────────────────┘
```

The guide proposes MongoDB + MinIO + Redis + Gemini. For a self-contained build
this uses the documented **fallbacks** — a local JSON datastore (for MongoDB),
local filesystem storage (for MinIO), **deterministic local hashing embeddings +
in-memory cosine** search, and rule-based OCR/classification — so identical
retrieval math runs with zero setup. Swap the data/storage/AI adapters for the
managed services to scale up.

## Live ingest channels

All five capture channels from the guide are **genuinely live** — every channel
runs the identical pipeline (`server/src/ingest.js`):

| Channel | How to use |
| --- | --- |
| Manual upload | Drag & drop on the **Capture & Upload** screen |
| API push | `POST /api/documents/upload` |
| **Hot-folder watcher** | Drop any file into `server/data/drop/` |
| **Scanner (scan-to-folder)** | Drop a scan/image into `server/data/scanner/` |
| **Email-to-ingest** | Drop an `.eml` into `server/data/maildrop/` — attachments are MIME-parsed and ingested |

Watched folders are created automatically on first run; processed originals move
to `server/data/processed/`. The Upload screen shows each channel's live status
and processed counts.

## OCR & classifier engines (pluggable)

Both AI steps are real adapters behind one interface, with the deterministic
local model as the always-available fallback:

```bash
# Real OCR for scanned images (optional dependency tesseract.js is installed):
OCR_ENGINE=tesseract npm run server

# Real LLM classification via Google Gemini:
GEMINI_API_KEY=your_key npm run server
```

With no env vars set, it uses the deterministic OCR text-extractor + keyword
classifier so it runs fully offline. Each document records which engines were
used (`classifier`, `ocrEngine`, `channel`).

## Folder → file access control

Sensitive categories (`Contracts`, `Tax`, `Bank`) are restricted to
**Admin/Manager** via folder `allowedRoles`; documents **inherit** the nearest
ancestor folder's permissions. A Viewer's folder tree, document lists, single
documents, and search results are all filtered accordingly (verified: Viewer
gets `403` on a contract a Manager/Admin can open).

## Backend — the document intelligence pipeline

On every capture (manual, API, hot-folder, scanner, or email):

1. **OCR** — text extracted from the file content.
2. **Classify** — document type + confidence (LayoutLM/LLM fallback: keyword model).
3. **Auto-name** — `type-vendor-INV-number.pdf`.
4. **File** — auto-creates `Client → Year → Trip → Category` folders on demand.
5. **Metadata & tags** — 12+ fields (type, vendor, date, amount, GSTIN, client,
   category, **department**, retention, **relationship** (owned/shared/bonded),
   confidence…), AI vs manual source tracked per tag.
6. **Dedup** — checksum + (vendor + amount + date) match flags duplicates.
7. **Embed** — deterministic vector for semantic search.

Plus: **trip detection** (taxi + hotel within 72h), a **retention engine**
(6 rule types, T-90/T-30 escalation, archive/extend/delete, permanent locks),
**permanent bonds** (two-admin delete), **version history + rollback**, an
**immutable hash-chained audit log** (tamper-evident), and **compliance packs**
(ISO / SOC 2 / DPDP / GST) generated from the verified trail.

### Key API routes

`POST /auth/login` · `GET /stats` · `GET /folders` · `GET /documents` ·
`POST /documents/upload` · `PATCH /documents/:id` · `POST /documents/:id/review` ·
`POST /documents/:id/rollback/:v` · `POST /search` · `GET/POST /trips` ·
`GET /retention` · `POST /documents/:id/retention-action` · `GET/POST /bonds` ·
`GET /audit` · `GET /audit/verify` · `POST /compliance/:type/generate` ·
`GET/POST /esign`

## Frontend

Tailwind CSS v4 (utility-first, no custom CSS layer), a single `AppShell`
(dark `slate-900` sidebar, white top bar, `gray-50` canvas), indigo/violet accent,
and **semantic** status colours. Every screen has real loading / empty / error
states wired to the live API.

| Screen | Feature |
| --- | --- |
| Login | JWT auth, RBAC role accounts |
| Dashboard | live pipeline health, attention queue, recent docs, trips |
| Capture & Upload | real upload → OCR → classify → file, live queue, dedup warning |
| Browse | live folder tree + breadcrumbs + file list |
| Document viewer | preview, tag edit (→ version + audit), versions + rollback, audit, eSign |
| Search | faceted + semantic search, RBAC-filtered |
| Trip Detection | 72h grouping, confirm/dismiss, re-run detection |
| Doc Review | manual review queue for confidence < 0.75 |
| Retention | 6 rule types, sweep, archive/extend/delete |
| Permanent Bonds | create, inter-company lock, two-admin delete |
| Audit Trail | filterable, hash-chain integrity badge |
| Compliance Export | generate + download ISO/SOC2/DPDP/GST packs |
| eSign | DocuSign / Adobe envelopes |
| Settings | AI pipeline + DPDP 2023 config |

## Project structure

```
.
├── src/                 # React frontend
│   ├── components/       # AppShell, icons, UI primitives
│   ├── context/          # AuthContext (JWT session + RBAC)
│   ├── hooks/            # useApi (loading/error/reload)
│   ├── lib/              # api client, theme tokens, formatters
│   └── pages/            # one file per screen
└── server/              # Express backend
    └── src/
        ├── index.js      # app + retention scheduler
        ├── routes.js     # all REST endpoints
        ├── pipeline.js   # classify, dedup, embeddings, folders, retention, trips
        ├── auth.js       # JWT + bcrypt + RBAC
        ├── audit.js      # immutable hash-chained log
        ├── store.js      # zero-config JSON datastore
        ├── seed.js       # demo data via the real pipeline
        └── data/         # db.json + uploaded files (git-ignored)
```

## Build

```bash
npm run build           # frontend production build
```
