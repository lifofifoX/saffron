<script lang="ts">
  import { FRAME_ALLOW, FRAME_REFERRER_POLICY, FRAME_SANDBOX } from '$lib/media/frame-security'
  import { endpoints } from '$lib/config'
  import { resolveImageRenderingHint } from '$lib/media/image-rendering'
  import { normalizeSnapshotContentType } from '$lib/media/snapshot-content-type'

  import { mediaFallbackIconClass, mediaFallbackLabelForContentType } from './media-fallback-icons'

  type Props = {
    inscriptionId: string
    contentType: string | null
    iconSizeClass?: string
  }

  let { inscriptionId, contentType, iconSizeClass = 'text-2xl' }: Props = $props()

  type Phase = 'media' | 'icon'

  let phase = $state<Phase>('media')

  let normalizedType = $derived(normalizeSnapshotContentType(contentType))
  // Plain raster images load as lightweight <img> content; everything else
  // (html, svg, text, audio, video, models, unknown) goes through ord's
  // /preview document, which renders every file type appropriately.
  let isPlainImage = $derived(
    normalizedType !== null &&
      normalizedType.startsWith('image/') &&
      normalizedType !== 'image/svg+xml',
  )
  let contentUrl = $derived(`${$endpoints.contentBaseUrl}/content/${inscriptionId}`)
  let previewUrl = $derived(`${$endpoints.contentBaseUrl}/preview/${inscriptionId}`)
  let renderingHint = $derived(resolveImageRenderingHint({ contentType }))
  let fallbackIcon = $derived(mediaFallbackIconClass(mediaFallbackLabelForContentType(contentType)))

  $effect(() => {
    void inscriptionId
    phase = 'media'
  })
</script>

<div class="relative h-full w-full overflow-hidden bg-os-dark">
  {#if phase === 'icon'}
    <div class="flex h-full w-full items-center justify-center">
      <i class="{fallbackIcon} {iconSizeClass} text-os-text/60"></i>
    </div>
  {:else if isPlainImage}
    <img
      src={contentUrl}
      alt=""
      loading="lazy"
      decoding="async"
      class="h-full w-full object-contain"
      style="image-rendering: {renderingHint}"
      onerror={() => (phase = 'icon')}
    />
  {:else}
    <iframe
      src={previewUrl}
      title="Inscription preview"
      sandbox={FRAME_SANDBOX}
      referrerpolicy={FRAME_REFERRER_POLICY}
      allow={FRAME_ALLOW}
      scrolling="no"
      tabindex="-1"
      loading="lazy"
      class="pointer-events-none h-full w-full border-0"
    ></iframe>
  {/if}
</div>
