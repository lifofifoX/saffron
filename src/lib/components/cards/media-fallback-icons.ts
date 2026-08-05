import { normalizeSnapshotContentType } from '$lib/media/snapshot-content-type'

export type MediaFallbackLabel =
  | 'AUDIO'
  | 'TEXT'
  | 'JSON'
  | 'APP'
  | 'VIDEO'
  | 'HTML'
  | 'IMAGE'
  | 'MODEL'
  | 'PDF'
  | 'FILE'

export function mediaFallbackIconClass(label: MediaFallbackLabel): string {
  if (label === 'IMAGE') return 'fa-solid fa-image'
  if (label === 'TEXT') return 'fa-solid fa-file-lines'
  if (label === 'AUDIO') return 'fa-solid fa-volume-high'
  if (label === 'VIDEO') return 'fa-solid fa-film'
  if (label === 'MODEL') return 'fa-solid fa-cube'
  if (label === 'PDF') return 'fa-solid fa-file-pdf'
  if (label === 'JSON' || label === 'APP' || label === 'HTML') return 'fa-solid fa-file-code'
  return 'fa-solid fa-file'
}

export function mediaFallbackLabelForContentType(
  rawContentType: string | null,
): MediaFallbackLabel {
  const normalized = normalizeSnapshotContentType(rawContentType)

  if (normalized?.startsWith('image/')) return 'IMAGE'
  if (normalized?.startsWith('audio/')) return 'AUDIO'
  if (normalized?.startsWith('video/')) return 'VIDEO'
  if (normalized === 'text/html' || normalized === 'application/xhtml+xml') return 'HTML'
  if (normalized?.startsWith('text/')) return 'TEXT'
  if (normalized?.startsWith('application/json')) return 'JSON'
  if (normalized === 'application/pdf') return 'PDF'
  if (normalized?.startsWith('model/')) return 'MODEL'
  if (normalized?.startsWith('application/')) return 'APP'

  return 'FILE'
}
