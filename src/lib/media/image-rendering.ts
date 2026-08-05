import { normalizeSnapshotContentType } from './snapshot-content-type.js'

export const IMAGE_RENDERING_HINTS = ['auto', 'pixelated'] as const

export type ImageRenderingHint = (typeof IMAGE_RENDERING_HINTS)[number]

const PIXELATED_FALLBACK_CONTENT_TYPES = new Set([
  'image/apng',
  'image/gif',
  'image/png',
  'image/webp',
])

export function normalizeImageRenderingHint(
  value: string | null | undefined,
): ImageRenderingHint | null {
  if (typeof value !== 'string') return null

  const normalized = value.trim().toLowerCase()
  if (normalized === 'auto' || normalized === 'pixelated') return normalized
  return null
}

export function resolveImageRenderingHint({
  explicitHint,
  contentType,
}: {
  explicitHint?: string | null
  contentType?: string | null
} = {}): ImageRenderingHint {
  const normalizedHint = normalizeImageRenderingHint(explicitHint)
  if (normalizedHint) return normalizedHint

  const normalizedContentType = normalizeSnapshotContentType(contentType)
  if (!normalizedContentType) return 'auto'

  return PIXELATED_FALLBACK_CONTENT_TYPES.has(normalizedContentType) ? 'pixelated' : 'auto'
}
