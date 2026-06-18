// Centralized style tokens for FlowSphere DMS.
// Semantic, not decorative — color always carries the same meaning anywhere.
// Mirrors the Design & Theme reference: emerald=good, amber=warn, rose=bad,
// sky/indigo=info, gray=neutral.

export const statusStyles = {
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  warning: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  error: 'bg-rose-100 text-rose-700 ring-rose-600/20',
  info: 'bg-sky-100 text-sky-700 ring-sky-600/20',
  neutral: 'bg-gray-100 text-gray-600 ring-gray-500/20',
  brand: 'bg-indigo-50 text-indigo-700 ring-indigo-600/20',
}

// Map domain-specific states to a semantic family.
const STATE_TO_TONE = {
  // classification / review
  classified: 'success',
  filed: 'success',
  processing: 'info',
  ocr: 'info',
  queued: 'neutral',
  'needs review': 'warning',
  'low confidence': 'warning',
  duplicate: 'error',
  failed: 'error',
  // retention
  active: 'success',
  expiring: 'warning',
  expired: 'error',
  archived: 'neutral',
  permanent: 'brand',
  locked: 'brand',
  // audit / generic
  passed: 'success',
  acknowledged: 'success',
  pending: 'warning',
  overdue: 'warning',
  rejected: 'error',
  draft: 'neutral',
  idle: 'neutral',
  signed: 'success',
  sent: 'info',
}

export function toneForState(state = '') {
  return STATE_TO_TONE[state.toLowerCase()] || 'neutral'
}

// Threshold coloring for confidence / compliance percentages.
export function thresholdTone(value) {
  if (value >= 90) return 'success'
  if (value >= 60) return 'warning'
  return 'error'
}

// Confidence (0..1) coloring used in the classification pipeline.
export function confidenceTone(conf) {
  if (conf >= 0.75) return 'success'
  if (conf >= 0.5) return 'warning'
  return 'error'
}

export const barColors = {
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  error: 'bg-rose-500',
  info: 'bg-sky-500',
  neutral: 'bg-gray-400',
  brand: 'bg-indigo-500',
}
