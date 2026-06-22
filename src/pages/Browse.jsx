import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, PageHeader, Badge, StateBadge, Button, EmptyState, Input, Select, Loading, ErrorState } from '../components/ui.jsx'
import {
  IconFolder, IconFolderOpen, IconFile, IconChevronRight, IconChevronDown, IconBrain, IconLock,
  IconSearch, IconX, IconTrash, IconTag, IconDownload,
} from '../components/icons.jsx'
import { useApi } from '../hooks/useApi.js'
import { api } from '../lib/api.js'
import { useAuth } from '../context/AuthContext.jsx'
import { formatAmount } from '../lib/format.js'
import { confidenceTone } from '../lib/theme.js'

function findPath(nodes, id, trail = []) {
  for (const n of nodes) {
    const nextTrail = [...trail, n]
    if (n.id === id) return nextTrail
    if (n.children?.length) {
      const found = findPath(n.children, id, nextTrail)
      if (found) return found
    }
  }
  return null
}

function firstLeaf(nodes) {
  for (const n of nodes) {
    if (!n.children?.length) return n.id
    const leaf = firstLeaf(n.children)
    if (leaf) return leaf
  }
  return nodes[0]?.id || null
}

function flattenFolders(nodes, prefix = '', out = []) {
  for (const n of nodes) {
    const label = prefix ? `${prefix} / ${n.name}` : n.name
    out.push({ id: n.id, label })
    if (n.children?.length) flattenFolders(n.children, label, out)
  }
  return out
}

// Keep folders whose name (or any descendant) matches the filter.
function filterTree(nodes, q) {
  if (!q) return nodes
  const ql = q.toLowerCase()
  const walk = (list) => list
    .map((n) => {
      const kids = n.children ? walk(n.children) : []
      if (n.name.toLowerCase().includes(ql) || kids.length) return { ...n, children: kids }
      return null
    })
    .filter(Boolean)
  return walk(nodes)
}

function TreeNode({ node, selectedId, onSelect, depth = 0, forceOpen = false }) {
  const [open, setOpen] = useState(depth < 1)
  const hasChildren = node.children?.length > 0
  const isOpen = forceOpen || open
  const selected = node.id === selectedId
  const Icon = hasChildren && isOpen ? IconFolderOpen : IconFolder
  return (
    <div>
      <button
        onClick={() => { onSelect(node.id); if (hasChildren) setOpen((o) => !o) }}
        className={`group w-full flex items-center gap-1.5 rounded-lg pr-2 py-1.5 text-sm transition ${
          selected ? 'bg-indigo-50 text-indigo-700 font-medium ring-1 ring-inset ring-indigo-100' : 'text-gray-700 hover:bg-gray-50'
        }`}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
      >
        {hasChildren
          ? (isOpen ? <IconChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" /> : <IconChevronRight className="w-3.5 h-3.5 text-gray-400 shrink-0" />)
          : <span className="w-3.5 shrink-0" />}
        <Icon className={`w-4 h-4 shrink-0 ${selected ? 'text-indigo-500' : 'text-gray-400 group-hover:text-gray-500'}`} />
        <span className="truncate">{node.name}</span>
      </button>
      {hasChildren && isOpen && node.children.map((c) => (
        <TreeNode key={c.id} node={c} selectedId={selectedId} onSelect={onSelect} depth={depth + 1} forceOpen={forceOpen} />
      ))}
    </div>
  )
}

const SORTS = [
  { key: 'name', label: 'Name' },
  { key: 'type', label: 'Type' },
  { key: 'date', label: 'Date' },
  { key: 'amount', label: 'Amount' },
  { key: 'status', label: 'Status' },
  { key: 'confidence', label: 'AI confidence' },
]

export default function Browse() {
  const { can } = useAuth()
  const { data: treeData, loading, error, reload } = useApi(() => api.folders(), [])
  const [selectedId, setSelectedId] = useState(null)
  const [files, setFiles] = useState(null)
  const [filesLoading, setFilesLoading] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  const [showDupes, setShowDupes] = useState(false)
  const [treeQ, setTreeQ] = useState('')
  const [fileQ, setFileQ] = useState('')
  const [view, setView] = useState('list')
  const [sort, setSort] = useState({ key: 'date', dir: 'desc' })

  // Column filters
  const [showFilters, setShowFilters] = useState(false)
  const [fType, setFType] = useState('')
  const [fStatus, setFStatus] = useState('')
  const [fMin, setFMin] = useState('')
  const [fMax, setFMax] = useState('')
  const [fFrom, setFFrom] = useState('')
  const [fTo, setFTo] = useState('')

  // Multi-select
  const [selected, setSelected] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const canEdit = can('upload')

  // Semantic search (by meaning) across all accessible documents.
  const [semQ, setSemQ] = useState('')
  const [semData, setSemData] = useState(null)
  const [semLoading, setSemLoading] = useState(false)
  const semActive = semQ.trim().length > 0

  useEffect(() => {
    const q = semQ.trim()
    if (!q) { setSemData(null); return undefined }
    let active = true
    setSemLoading(true)
    const handle = setTimeout(() => {
      api.semanticSearch(q, { limit: 25 })
        .then((r) => active && setSemData(r))
        .catch(() => active && setSemData({ results: [], error: true }))
        .finally(() => active && setSemLoading(false))
    }, 350)
    return () => { active = false; clearTimeout(handle) }
  }, [semQ])

  const tree = treeData?.tree || []
  const folderOptions = useMemo(() => flattenFolders(tree), [tree])

  useEffect(() => {
    if (tree.length && !selectedId) setSelectedId(firstLeaf(tree))
  }, [tree, selectedId])

  useEffect(() => {
    if (!selectedId) return
    let active = true
    setFilesLoading(true)
    setSelected(new Set())
    api.documents({ folderId: selectedId })
      .then((r) => active && setFiles(r.documents))
      .finally(() => active && setFilesLoading(false))
    return () => { active = false }
  }, [selectedId, refreshKey])

  const breadcrumb = useMemo(() => (selectedId ? findPath(tree, selectedId) || [] : []), [tree, selectedId])
  const visibleTree = useMemo(() => filterTree(tree, treeQ.trim()), [tree, treeQ])

  const liveFiles = useMemo(() => (files || []).filter((d) => !d.tombstone), [files])
  const isHidden = (d) => d.duplicate || d.status === 'Duplicate' || d.nonBusiness
  const hiddenDupes = liveFiles.filter(isHidden).length

  const base = useMemo(() => (showDupes ? liveFiles : liveFiles.filter((d) => !isHidden(d))), [liveFiles, showDupes])
  const distinctTypes = useMemo(() => [...new Set(base.map((d) => d.type).filter(Boolean))].sort(), [base])
  const distinctStatuses = useMemo(() => [...new Set(base.map((d) => d.status).filter(Boolean))].sort(), [base])
  const filtersActive = fType || fStatus || fMin || fMax || fFrom || fTo

  const processed = useMemo(() => {
    let list = base
    const q = fileQ.trim().toLowerCase()
    if (q) {
      list = list.filter((d) =>
        [d.name, d.vendor, d.client, d.type].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)),
      )
    }
    if (fType) list = list.filter((d) => d.type === fType)
    if (fStatus) list = list.filter((d) => d.status === fStatus)
    if (fMin) list = list.filter((d) => (Number(d.amount) || 0) >= Number(fMin))
    if (fMax) list = list.filter((d) => (Number(d.amount) || 0) <= Number(fMax))
    if (fFrom) list = list.filter((d) => d.date && d.date >= fFrom)
    if (fTo) list = list.filter((d) => d.date && d.date <= fTo)

    const dir = sort.dir === 'asc' ? 1 : -1
    return [...list].sort((a, b) => {
      if (sort.key === 'amount' || sort.key === 'confidence') {
        return ((Number(a[sort.key]) || 0) - (Number(b[sort.key]) || 0)) * dir
      }
      const av = String(a[sort.key] ?? '').toLowerCase()
      const bv = String(b[sort.key] ?? '').toLowerCase()
      return av < bv ? -dir : av > bv ? dir : 0
    })
  }, [base, fileQ, fType, fStatus, fMin, fMax, fFrom, fTo, sort])

  const folderTotal = useMemo(() => processed.reduce((s, d) => s + (Number(d.amount) || 0), 0), [processed])

  if (loading) return <Loading label="Loading folders…" />
  if (error) return <ErrorState error={error} onRetry={reload} />

  const clearFilters = () => { setFType(''); setFStatus(''); setFMin(''); setFMax(''); setFFrom(''); setFTo('') }
  const toggleSort = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
  const SortHead = ({ k, children, className = '' }) => (
    <th className={`py-2 font-semibold cursor-pointer select-none hover:text-gray-700 ${className}`} onClick={() => toggleSort(k)}>
      <span className="inline-flex items-center gap-1">
        {children}
        {sort.key === k && <span className="text-indigo-500">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
      </span>
    </th>
  )

  // ---- selection helpers ----
  const allSelected = processed.length > 0 && processed.every((d) => selected.has(d.id))
  const toggleOne = (id) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(processed.map((d) => d.id)))

  // ---- bulk actions ----
  const ids = [...selected]
  const runBulk = async (fn) => {
    setBusy(true)
    try {
      for (const id of ids) { try { await fn(id) } catch (e) { console.error('bulk op failed', id, e.message) } }
      setSelected(new Set())
      setRefreshKey((k) => k + 1)
    } finally { setBusy(false) }
  }
  const bulkMove = async (folderId) => {
    if (!folderId || folderId === selectedId) return
    await runBulk((id) => api.updateDocument(id, { folderId }))
    reload() // refresh tree/counts
  }
  const bulkTag = async () => {
    const tag = window.prompt(`Add a tag to ${ids.length} selected document(s):`)
    if (!tag || !tag.trim()) return
    await runBulk(async (id) => {
      const doc = liveFiles.find((d) => d.id === id)
      const tags = Array.from(new Set([...(doc?.tags || []), tag.trim()]))
      await api.updateDocument(id, { tags })
    })
  }
  const bulkDelete = async () => {
    if (!window.confirm(`Soft-delete ${ids.length} document(s)? They move to Trash (recoverable for 30 days).`)) return
    await runBulk((id) => api.softDelete(id, 'Incorrect Upload'))
  }

  const exportCsv = () => {
    const header = ['Name', 'Type', 'Vendor', 'Client', 'Date', 'Amount', 'Currency', 'Status', 'Confidence']
    const rows = [header, ...processed.map((d) => [
      d.name, d.type, d.vendor, d.client, d.date, d.amount, d.currency, d.status, `${Math.round((d.confidence || 0) * 100)}%`,
    ])]
    const csv = rows.map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${(breadcrumb.at(-1)?.name || 'folder').replace(/\s+/g, '-')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <PageHeader title="Browse Folders" subtitle="On-demand folders: Client → Year → Trip → Category. Permissions inherit folder → file." />

      {/* Semantic search — finds documents by meaning, not just keywords */}
      <div className="relative mb-4">
        <IconBrain className="w-4 h-4 text-indigo-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
        <Input
          value={semQ}
          onChange={(e) => setSemQ(e.target.value)}
          placeholder="Semantic search — e.g. “travel expenses in Mumbai”, “year-end tax filings”…"
          className="pl-10 pr-9 py-2.5"
        />
        {semActive && (
          <button onClick={() => setSemQ('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" title="Clear">
            <IconX className="w-4 h-4" />
          </button>
        )}
      </div>

      {semActive ? (
        <Card className="p-0 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-900">
              Semantic results
              {semData && <span className="ml-2 text-xs font-normal text-gray-400">{semData.results?.length || 0} matches</span>}
            </h3>
            {semData?.model && <Badge tone="brand">{semData.model.includes('hash') ? 'lexical' : 'vector'} · {semData.model.split('/').pop()}</Badge>}
          </div>
          {semLoading ? (
            <div className="py-12"><Loading label="Searching by meaning…" /></div>
          ) : !semData?.results?.length ? (
            <EmptyState icon={<IconSearch className="w-12 h-12" />} title="No semantic matches" hint="Try describing what you're looking for in natural language." />
          ) : (
            <ul className="divide-y divide-gray-50">
              {semData.results.map((d) => (
                <li key={d.id}>
                  <Link to={`/document/${d.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50">
                    <span className="p-2 rounded-lg bg-gray-50 text-gray-500"><IconFile className="w-4 h-4" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900 truncate">{d.name}</span>
                        {d.bonded && <IconLock className="w-3.5 h-3.5 text-indigo-500" />}
                      </div>
                      <div className="text-[11px] text-gray-500">{d.type} · {d.vendor} · {d.client} · {d.date}</div>
                    </div>
                    <span className="text-sm text-gray-800">{formatAmount(d.amount, d.currency)}</span>
                    <Badge tone="brand">{Math.round((d.score || 0) * 100)}% match</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : (
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <Card className="p-3 lg:col-span-1 h-fit">
          <div className="px-1 mb-2 flex items-center justify-between">
            <span className="text-[10px] font-semibold tracking-wider uppercase text-slate-500">Folder tree</span>
            <button onClick={reload} className="text-[10px] text-indigo-600 hover:text-indigo-700">Refresh</button>
          </div>
          <div className="relative mb-2">
            <IconSearch className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <Input value={treeQ} onChange={(e) => setTreeQ(e.target.value)} placeholder="Filter folders…" className="pl-8 py-1.5 text-xs" />
          </div>
          {visibleTree.length === 0 ? (
            <div className="px-2 py-4 text-xs text-gray-400">
              {treeQ ? 'No folders match your filter.' : 'No folders yet. Upload a document to auto-create folders.'}
            </div>
          ) : (
            <div className="space-y-0.5 max-h-[70vh] overflow-auto">
              {visibleTree.map((n) => (
                <TreeNode key={n.id} node={n} selectedId={selectedId} onSelect={setSelectedId} forceOpen={Boolean(treeQ.trim())} />
              ))}
            </div>
          )}
        </Card>

        <div className="lg:col-span-3">
          {/* Breadcrumb */}
          <div className="flex items-center flex-wrap gap-1 text-sm mb-3">
            {breadcrumb.map((b, i) => (
              <span key={b.id} className="flex items-center gap-1">
                {i > 0 && <IconChevronRight className="w-3.5 h-3.5 text-gray-300" />}
                <button onClick={() => setSelectedId(b.id)} className={i === breadcrumb.length - 1 ? 'font-medium text-gray-900' : 'text-gray-500 hover:text-indigo-600'}>
                  {b.name}
                </button>
              </span>
            ))}
          </div>

          <Card className="p-0 overflow-hidden">
            {/* Folder summary header */}
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-3">
                <h3 className="text-sm font-semibold text-gray-900">{breadcrumb.at(-1)?.name || 'Files'}</h3>
                <Badge tone="neutral">{processed.length} files</Badge>
                {folderTotal > 0 && <Badge tone="success">{formatAmount(folderTotal)}</Badge>}
              </div>
              {hiddenDupes > 0 && (
                <button onClick={() => setShowDupes((s) => !s)} title="Toggle duplicates / flagged" className="focus:outline-none">
                  <Badge tone={showDupes ? 'brand' : 'warning'}>
                    {showDupes ? `Hide ${hiddenDupes} flagged` : `${hiddenDupes} flagged hidden`}
                  </Badge>
                </button>
              )}
            </div>

            {/* Toolbar: search · filters · sort · export · view */}
            <div className="px-5 py-2.5 border-b border-gray-100 flex items-center gap-2 flex-wrap bg-gray-50/60">
              <div className="relative flex-1 min-w-[160px]">
                <IconSearch className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <Input value={fileQ} onChange={(e) => setFileQ(e.target.value)} placeholder="Filter (name, vendor, type)…" className="pl-8 py-1.5 text-xs bg-white" />
                {fileQ && (
                  <button onClick={() => setFileQ('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><IconX className="w-3.5 h-3.5" /></button>
                )}
              </div>
              <Button variant={showFilters || filtersActive ? 'primary' : 'secondary'} size="sm" onClick={() => setShowFilters((s) => !s)}>
                Filters{filtersActive ? ' •' : ''}
              </Button>
              <Select
                value={`${sort.key}:${sort.dir}`}
                onChange={(e) => { const [key, dir] = e.target.value.split(':'); setSort({ key, dir }) }}
                className="py-1.5 text-xs"
              >
                {SORTS.map((s) => [
                  <option key={`${s.key}:desc`} value={`${s.key}:desc`}>{s.label} ↓</option>,
                  <option key={`${s.key}:asc`} value={`${s.key}:asc`}>{s.label} ↑</option>,
                ])}
              </Select>
              <Button variant="secondary" size="sm" onClick={exportCsv} disabled={!processed.length} title="Export current view to CSV">
                <IconDownload className="w-3.5 h-3.5" /> CSV
              </Button>
              <div className="inline-flex rounded-lg border border-gray-200 bg-white overflow-hidden">
                <button onClick={() => setView('list')} title="List view" className={`px-2.5 py-1.5 ${view === 'list' ? 'bg-indigo-50 text-indigo-600' : 'text-gray-500 hover:bg-gray-50'}`}>
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>
                </button>
                <button onClick={() => setView('grid')} title="Grid view" className={`px-2.5 py-1.5 border-l border-gray-200 ${view === 'grid' ? 'bg-indigo-50 text-indigo-600' : 'text-gray-500 hover:bg-gray-50'}`}>
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>
                </button>
              </div>
            </div>

            {/* Column filters panel */}
            {showFilters && (
              <div className="px-5 py-3 border-b border-gray-100 bg-white flex flex-wrap items-end gap-3">
                <label className="text-xs text-gray-500">Type
                  <Select value={fType} onChange={(e) => setFType(e.target.value)} className="mt-1 block py-1.5 text-xs">
                    <option value="">All types</option>
                    {distinctTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                  </Select>
                </label>
                <label className="text-xs text-gray-500">Status
                  <Select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className="mt-1 block py-1.5 text-xs">
                    <option value="">All statuses</option>
                    {distinctStatuses.map((s) => <option key={s} value={s}>{s}</option>)}
                  </Select>
                </label>
                <label className="text-xs text-gray-500">Min amount
                  <Input type="number" value={fMin} onChange={(e) => setFMin(e.target.value)} className="mt-1 w-28 py-1.5 text-xs" placeholder="0" />
                </label>
                <label className="text-xs text-gray-500">Max amount
                  <Input type="number" value={fMax} onChange={(e) => setFMax(e.target.value)} className="mt-1 w-28 py-1.5 text-xs" placeholder="∞" />
                </label>
                <label className="text-xs text-gray-500">From
                  <Input type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} className="mt-1 py-1.5 text-xs" />
                </label>
                <label className="text-xs text-gray-500">To
                  <Input type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} className="mt-1 py-1.5 text-xs" />
                </label>
                {filtersActive && (
                  <Button variant="ghost" size="sm" onClick={clearFilters}><IconX className="w-3.5 h-3.5" /> Clear</Button>
                )}
              </div>
            )}

            {/* Bulk selection toolbar */}
            {canEdit && selected.size > 0 && (
              <div className="px-5 py-2.5 border-b border-indigo-100 bg-indigo-50/70 flex items-center gap-2 flex-wrap">
                <span className="text-xs font-medium text-indigo-700">{selected.size} selected</span>
                <Select defaultValue="" onChange={(e) => { bulkMove(e.target.value); e.target.value = '' }} disabled={busy} className="py-1.5 text-xs">
                  <option value="">Move to…</option>
                  {folderOptions.filter((f) => f.id !== selectedId).map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                </Select>
                <Button variant="secondary" size="sm" onClick={bulkTag} disabled={busy}><IconTag className="w-3.5 h-3.5" /> Add tag</Button>
                <Button variant="danger" size="sm" onClick={bulkDelete} disabled={busy}><IconTrash className="w-3.5 h-3.5" /> Delete</Button>
                <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())} disabled={busy}>Clear</Button>
                {busy && <span className="text-xs text-indigo-600">Working…</span>}
              </div>
            )}

            {filesLoading ? (
              <div className="py-12"><Loading label="Loading files…" /></div>
            ) : processed.length === 0 ? (
              <EmptyState
                icon={<IconFolderOpen className="w-12 h-12" />}
                title={fileQ || filtersActive ? 'No files match your filters' : 'This folder is empty'}
                hint={fileQ || filtersActive ? 'Try different filter values.' : 'Folders are created on demand when classified documents need them. Drop a file to populate it.'}
                action={!(fileQ || filtersActive) && <Link to="/upload"><Button>Upload here</Button></Link>}
              />
            ) : view === 'grid' ? (
              <div className="p-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {processed.map((d) => (
                  <div key={d.id} className="relative group">
                    {canEdit && (
                      <input
                        type="checkbox"
                        checked={selected.has(d.id)}
                        onChange={() => toggleOne(d.id)}
                        className="absolute top-3 left-3 z-10 w-4 h-4 accent-indigo-600 cursor-pointer"
                      />
                    )}
                    <Link to={`/document/${d.id}`} className="block">
                      <div className={`rounded-xl border p-4 h-full transition hover:shadow-md hover:-translate-y-0.5 ${selected.has(d.id) ? 'border-indigo-300 ring-1 ring-indigo-200' : 'border-gray-200 hover:border-indigo-200'}`}>
                        <div className="flex items-start justify-between">
                          <span className={`p-2 rounded-lg ${canEdit ? 'ml-6' : ''} bg-gray-50 text-gray-500 group-hover:bg-indigo-50 group-hover:text-indigo-600 transition`}><IconFile className="w-5 h-5" /></span>
                          <Badge tone={confidenceTone(d.confidence)}><IconBrain className="w-3 h-3" /> {Math.round(d.confidence * 100)}%</Badge>
                        </div>
                        <div className="mt-3 flex items-center gap-1.5">
                          <span className="text-sm font-medium text-gray-900 truncate">{d.name}</span>
                          {d.bonded && <IconLock className="w-3.5 h-3.5 text-indigo-500 shrink-0" />}
                        </div>
                        <div className="mt-1 text-[11px] text-gray-500 truncate">{d.type} · {d.vendor || '—'}</div>
                        <div className="mt-3 flex items-center justify-between">
                          <StateBadge state={d.status} />
                          <span className="text-sm font-semibold text-gray-800">{formatAmount(d.amount, d.currency)}</span>
                        </div>
                      </div>
                    </Link>
                  </div>
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b border-gray-100">
                      {canEdit && (
                        <th className="pl-5 py-2 w-8">
                          <input type="checkbox" checked={allSelected} onChange={toggleAll} className="w-4 h-4 accent-indigo-600 cursor-pointer" />
                        </th>
                      )}
                      <SortHead k="name" className={canEdit ? '' : 'px-5'}>Name</SortHead>
                      <SortHead k="type">Type</SortHead>
                      <SortHead k="vendor">Vendor</SortHead>
                      <SortHead k="date">Date</SortHead>
                      <SortHead k="amount" className="text-right">Amount</SortHead>
                      <SortHead k="status">Status</SortHead>
                      <SortHead k="confidence" className="px-5 text-right">AI</SortHead>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {processed.map((d) => (
                      <tr key={d.id} className={`group hover:bg-gray-50 ${selected.has(d.id) ? 'bg-indigo-50/40' : ''}`}>
                        {canEdit && (
                          <td className="pl-5 py-3">
                            <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggleOne(d.id)} className="w-4 h-4 accent-indigo-600 cursor-pointer" />
                          </td>
                        )}
                        <td className={`py-3 ${canEdit ? '' : 'px-5'}`}>
                          <Link to={`/document/${d.id}`} className="flex items-center gap-2 text-gray-800 hover:text-indigo-600">
                            <IconFile className="w-4 h-4 text-gray-400" />
                            <span className="truncate max-w-[220px]">{d.name}</span>
                            {d.bonded && <IconLock className="w-3.5 h-3.5 text-indigo-500" />}
                          </Link>
                        </td>
                        <td className="py-3 text-gray-600">{d.type}</td>
                        <td className="py-3 text-gray-600 truncate max-w-[140px]">{d.vendor || '—'}</td>
                        <td className="py-3 text-gray-600">{d.date}</td>
                        <td className="py-3 text-right text-gray-800">{formatAmount(d.amount, d.currency)}</td>
                        <td className="py-3"><StateBadge state={d.status} /></td>
                        <td className="px-5 py-3 text-right">
                          <Badge tone={confidenceTone(d.confidence)}>
                            <IconBrain className="w-3 h-3" /> {Math.round(d.confidence * 100)}%
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </div>
      )}
    </div>
  )
}
