export const SNAPSHOT_RENDERABLE_CONTENT_TYPE_PREFIXES = [
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
  'image/',
  'video/',
  'model/gltf+json',
  'model/gltf-binary',
] as const

export function normalizeSnapshotContentType(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null

  const normalized = value.trim().toLowerCase()
  if (!normalized) return null

  const [mimeType] = normalized.split(';', 1)
  const trimmedMimeType = mimeType?.trim()
  return trimmedMimeType || null
}

export function isRenderableSnapshotContentType(contentType: string | null | undefined): boolean {
  const normalized = normalizeSnapshotContentType(contentType)
  if (!normalized) return false

  return SNAPSHOT_RENDERABLE_CONTENT_TYPE_PREFIXES.some((prefix) => normalized.startsWith(prefix))
}

// SVG snapshots are stored as vector passthrough, which browsers render but
// social crawlers (Discord/X) reject for og:image. Raster kinds only.
