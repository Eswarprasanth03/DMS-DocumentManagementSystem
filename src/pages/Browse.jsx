import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, PageHeader, Badge, StateBadge, Button, EmptyState, Input, Loading, ErrorState } from '../components/ui.jsx'
import {
  IconFolder, IconFolderOpen, IconFile, IconChevronRight, IconChevronDown, IconBrain, IconLock, IconSearch, IconX,
} from '../components/icons.jsx'
import { useApi } from '../hooks/useApi.js'
import { api } from '../lib/api.js'
import { formatAmount } from '../lib/format.js'

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

function TreeNode({ node, selectedId, onSelect, depth = 0 }) {
  const [open, setOpen] = useState(depth < 2)
  const hasChildren = node.children?.length > 0
  const selected = node.id === selectedId
  const Icon = hasChildren && open ? IconFolderOpen : IconFolder
  return (
    <div>
      <button
        onClick={() => { onSelect(node.id); if (hasChildren) setOpen((o) => !o) }}
        className={`w-full flex items-center gap-1.5 rounded-lg pr-2 py-1.5 text-sm transition ${
          selected ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-gray-700 hover:bg-gray-50'
        }`}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
      >
        {hasChildren ? (open ? <IconChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" /> : <IconChevronRight className="w-3.5 h-3.5 text-gray-400 shrink-0" />) : <span className="w-3.5 shrink-0" />}
        <Icon className={`w-4 h-4 shrink-0 ${selected ? 'text-indigo-500' : 'text-gray-400'}`} />
        <span className="truncate">{node.name}</span>
      </button>
      {hasChildren && open && node.children.map((c) => (
        <TreeNode key={c.id} node={c} selectedId={selectedId} onSelect={onSelect} depth={depth + 1} />
      ))}
    </div>
  )
}

export default function Browse() {
  const { data: treeData, loading, error, reload } = useApi(() => api.folders(), [])
  const [selectedId, setSelectedId] = useState(null)
  const [files, setFiles] = useState(null)
  const [filesLoading, setFilesLoading] = useState(false)

  const [showDupes, setShowDupes] = useState(false)
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

  useEffect(() => {
    if (tree.length && !selectedId) setSelectedId(firstLeaf(tree))
  }, [tree, selectedId])

  useEffect(() => {
    if (!selectedId) return
    let active = true
    setFilesLoading(true)
    api.documents({ folderId: selectedId })
      .then((r) => active && setFiles(r.documents))
      .finally(() => active && setFilesLoading(false))
    return () => { active = false }
  }, [selectedId])

  const breadcrumb = useMemo(() => (selectedId ? findPath(tree, selectedId) || [] : []), [tree, selectedId])

  if (loading) return <Loading label="Loading folders…" />
  if (error) return <ErrorState error={error} onRetry={reload} />

  // Hide duplicates (and tombstoned docs) from the folder view; they're still
  // detected and stored for audit, just not shown to avoid clutter.
  const liveFiles = (files || []).filter((d) => !d.tombstone)
  const isDupe = (d) => d.duplicate || d.status === 'Duplicate'
  const hiddenDupes = liveFiles.filter(isDupe).length
  const visibleFiles = showDupes ? liveFiles : liveFiles.filter((d) => !isDupe(d))

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
          <div className="px-2 mb-2 text-[10px] font-semibold tracking-wider uppercase text-slate-500">Folder tree</div>
          {tree.length === 0 ? (
            <div className="px-2 py-4 text-xs text-gray-400">No folders yet. Upload a document to auto-create folders.</div>
          ) : (
            <div className="space-y-0.5">
              {tree.map((n) => <TreeNode key={n.id} node={n} selectedId={selectedId} onSelect={setSelectedId} />)}
            </div>
          )}
        </Card>

        <div className="lg:col-span-3">
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
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">
                {breadcrumb.at(-1)?.name || 'Files'}
                <span className="ml-2 text-xs font-normal text-gray-400">{visibleFiles.length} files</span>
              </h3>
              {hiddenDupes > 0 && (
                <button onClick={() => setShowDupes((s) => !s)} title="Toggle duplicates" className="focus:outline-none">
                  <Badge tone={showDupes ? 'brand' : 'warning'}>
                    {showDupes ? `Hide ${hiddenDupes} duplicate${hiddenDupes > 1 ? 's' : ''}` : `${hiddenDupes} duplicate${hiddenDupes > 1 ? 's' : ''} hidden`}
                  </Badge>
                </button>
              )}
            </div>

            {filesLoading ? (
              <div className="py-12"><Loading label="Loading files…" /></div>
            ) : visibleFiles.length === 0 ? (
              <EmptyState
                icon={<IconFolderOpen className="w-12 h-12" />}
                title="This folder is empty"
                hint="Folders are created on demand when classified documents need them. Drop a file to populate it."
                action={<Link to="/upload"><Button>Upload here</Button></Link>}
              />
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b border-gray-100">
                    <th className="px-5 py-2 font-semibold">Name</th>
                    <th className="py-2 font-semibold">Type</th>
                    <th className="py-2 font-semibold">Date</th>
                    <th className="py-2 font-semibold text-right">Amount</th>
                    <th className="py-2 font-semibold">Status</th>
                    <th className="px-5 py-2 font-semibold text-right">AI</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {visibleFiles.map((d) => (
                    <tr key={d.id} className="hover:bg-gray-50">
                      <td className="px-5 py-3">
                        <Link to={`/document/${d.id}`} className="flex items-center gap-2 text-gray-800 hover:text-indigo-600">
                          <IconFile className="w-4 h-4 text-gray-400" />
                          <span className="truncate max-w-[220px]">{d.name}</span>
                          {d.bonded && <IconLock className="w-3.5 h-3.5 text-indigo-500" />}
                        </Link>
                      </td>
                      <td className="py-3 text-gray-600">{d.type}</td>
                      <td className="py-3 text-gray-600">{d.date}</td>
                      <td className="py-3 text-right text-gray-800">{formatAmount(d.amount, d.currency)}</td>
                      <td className="py-3"><StateBadge state={d.status} /></td>
                      <td className="px-5 py-3 text-right">
                        <Badge tone={d.confidence >= 0.75 ? 'success' : 'warning'}>
                          <IconBrain className="w-3 h-3" /> {Math.round(d.confidence * 100)}%
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>
      </div>
      )}
    </div>
  )
}
