import { normalizeSnapshotContentType } from '$lib/media/snapshot-content-type'

export type ContentCategory =
  | 'image'
  | 'html'
  | 'text'
  | 'video'
  | 'model'
  | 'pdf'
  | 'audio'
  | 'other'

export function contentCategoryFor(rawContentType: string | null): ContentCategory {
  const normalized = normalizeSnapshotContentType(rawContentType)
  if (!normalized) return 'other'

  if (normalized === 'text/html' || normalized === 'application/xhtml+xml') return 'html'
  if (normalized === 'application/pdf') return 'pdf'
  if (normalized.startsWith('image/')) return 'image'
  if (normalized.startsWith('video/')) return 'video'
  if (normalized.startsWith('audio/')) return 'audio'
  if (normalized.startsWith('model/')) return 'model'
  if (normalized.startsWith('text/')) return 'text'

  return 'other'
}

// html/text/model/pdf render through ord's /preview/ document; everything else
// loads raw /content/ bytes.
export function usesPreviewDocument(category: ContentCategory): boolean {
  return category === 'html' || category === 'text' || category === 'model' || category === 'pdf'
}
