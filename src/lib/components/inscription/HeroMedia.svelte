<script lang="ts">
  import { FRAME_ALLOW, FRAME_REFERRER_POLICY, FRAME_SANDBOX } from '$lib/media/frame-security'
  import { endpoints } from '$lib/config'
  import { type ImageRenderingHint, resolveImageRenderingHint } from '$lib/media/image-rendering'

  import { contentCategoryFor, usesPreviewDocument } from './content-category'

  const HERO_IMAGE_RETRY_DELAYS_MS = [250, 1000, 2500] as const

  type Props = {
    inscriptionId: string
    rawContentType: string | null
    name?: string
    heightClass?: string
  }

  let {
    inscriptionId,
    rawContentType,
    name = 'Inscription',
    heightClass = 'h-full',
  }: Props = $props()

  let category = $derived(contentCategoryFor(rawContentType))
  let mediaUrl = $derived(
    usesPreviewDocument(category)
      ? `${$endpoints.contentBaseUrl}/preview/${inscriptionId}`
      : `${$endpoints.contentBaseUrl}/content/${inscriptionId}`,
  )

  let contentLoaded = $state(false)
  let animateTransition = $state(false)
  let contentTimeout: ReturnType<typeof setTimeout> | null = null
  let iframeRenderTimeout: ReturnType<typeof setTimeout> | null = null
  let heroImageRetryTimer: ReturnType<typeof setTimeout> | null = null
  let htmlIframeElement = $state<HTMLIFrameElement | null>(null)
  let modelIframeElement = $state<HTMLIFrameElement | null>(null)
  let pdfIframeElement = $state<HTMLIFrameElement | null>(null)
  let textIframeElement = $state<HTMLIFrameElement | null>(null)
  let heroVideoElement = $state<HTMLVideoElement | null>(null)
  let heroAudioElement = $state<HTMLAudioElement | null>(null)
  let heroImageElement = $state<HTMLImageElement | null>(null)
  let imageRendering = $state<ImageRenderingHint>('auto')
  let embedInteractionEnabled = $state(false)
  let heroImageFailed = $state(false)
  let heroImageLoadKey = $state(0)
  let heroImageRetryCount = $state(0)

  function markLoaded() {
    contentLoaded = true
    clearContentTimeout()
  }

  function clearContentTimeout() {
    if (contentTimeout) clearTimeout(contentTimeout)
    contentTimeout = null
  }

  function armContentTimeout() {
    clearContentTimeout()
    contentTimeout = setTimeout(markLoaded, 5000)
  }

  function clearHeroImageRetryTimer() {
    if (!heroImageRetryTimer) return
    clearTimeout(heroImageRetryTimer)
    heroImageRetryTimer = null
  }

  function retryHeroImageNow() {
    clearHeroImageRetryTimer()
    heroImageFailed = false
    heroImageRetryCount = 0
    heroImageLoadKey += 1
    contentLoaded = false
    armContentTimeout()
  }

  function scheduleHeroImageRetry(): boolean {
    const retryDelay = HERO_IMAGE_RETRY_DELAYS_MS[heroImageRetryCount]
    if (retryDelay === undefined) return false

    const nextRetryCount = heroImageRetryCount + 1
    contentLoaded = false
    clearContentTimeout()
    clearHeroImageRetryTimer()

    heroImageRetryTimer = setTimeout(() => {
      heroImageRetryTimer = null
      heroImageRetryCount = nextRetryCount
      heroImageLoadKey += 1
      armContentTimeout()
    }, retryDelay)

    return true
  }

  function updateImageRendering() {
    if (!heroImageElement) return
    const img = heroImageElement
    if (!img.naturalWidth || !img.naturalHeight) return

    const container = img.parentElement
    if (!container) return

    const displayWidth = container.clientWidth * window.devicePixelRatio
    const displayHeight = container.clientHeight * window.devicePixelRatio

    if (displayWidth < img.naturalWidth || displayHeight < img.naturalHeight) {
      imageRendering = 'auto'
    } else {
      imageRendering = 'pixelated'
    }
  }

  let resolvedImageRenderingHint = $derived(
    resolveImageRenderingHint({ contentType: rawContentType }),
  )
  let usePixelated = $derived(resolvedImageRenderingHint === 'pixelated')
  let itemRenderKey = $derived(`${category}:${mediaUrl}`)
  let isInteractiveEmbed = $derived(category === 'model' || category === 'pdf')

  $effect(() => {
    void itemRenderKey
    contentLoaded = false
    heroImageFailed = false
    heroImageRetryCount = 0
    embedInteractionEnabled = false
    animateTransition = false
    imageRendering = usePixelated ? 'pixelated' : 'auto'
    clearContentTimeout()
    if (iframeRenderTimeout) clearTimeout(iframeRenderTimeout)
    clearHeroImageRetryTimer()
    armContentTimeout()

    requestAnimationFrame(() => {
      if (!contentLoaded) animateTransition = true
    })

    return () => {
      clearContentTimeout()
      if (iframeRenderTimeout) clearTimeout(iframeRenderTimeout)
      clearHeroImageRetryTimer()
    }
  })

  $effect(() => {
    if (!heroImageElement || !usePixelated) return
    updateImageRendering()
    const observer = new ResizeObserver(updateImageRendering)
    if (heroImageElement.parentElement) observer.observe(heroImageElement.parentElement)
    return () => observer.disconnect()
  })

  $effect(() => {
    const iframeElement = htmlIframeElement ?? modelIframeElement ?? pdfIframeElement
    if (!iframeElement) return

    const handleLoad = () => {
      if (iframeRenderTimeout) clearTimeout(iframeRenderTimeout)
      // Recursive HTML inscriptions finish scripts, model viewers fetch their
      // asset, and pdf.js paints its first page during this grace period.
      iframeRenderTimeout = setTimeout(markLoaded, 600)
    }

    iframeElement.addEventListener('load', handleLoad)

    return () => {
      iframeElement.removeEventListener('load', handleLoad)
      if (iframeRenderTimeout) clearTimeout(iframeRenderTimeout)
    }
  })

  $effect(() => {
    if (!textIframeElement) return
    const element = textIframeElement
    element.addEventListener('load', markLoaded)
    return () => element.removeEventListener('load', markLoaded)
  })

  $effect(() => {
    const element = heroVideoElement ?? heroAudioElement
    if (!element) return

    element.addEventListener('canplay', markLoaded)
    element.addEventListener('error', markLoaded)
    return () => {
      element.removeEventListener('canplay', markLoaded)
      element.removeEventListener('error', markLoaded)
    }
  })

  $effect(() => {
    if (!heroImageElement) return
    const img = heroImageElement
    const handleLoad = () => {
      clearHeroImageRetryTimer()
      heroImageFailed = false
      heroImageRetryCount = 0
      updateImageRendering()
      markLoaded()
    }
    const handleError = () => {
      if (scheduleHeroImageRetry()) return

      heroImageFailed = true
      markLoaded()
    }

    img.addEventListener('load', handleLoad)
    img.addEventListener('error', handleError)

    if (img.complete) {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        handleLoad()
      } else {
        handleError()
      }
    }

    return () => {
      img.removeEventListener('load', handleLoad)
      img.removeEventListener('error', handleError)
    }
  })
</script>

<div
  role="presentation"
  class="w-full bg-os-card flex items-center justify-center overflow-hidden relative {heightClass}"
  onmouseleave={() => {
    if (isInteractiveEmbed) embedInteractionEnabled = false
  }}
>
  {#if !contentLoaded}
    <div class="absolute inset-0 flex items-center justify-center">
      <div
        class="w-8 h-8 border-2 border-os-border border-t-os-orange rounded-full animate-spin"
      ></div>
    </div>
  {/if}

  {#if category === 'html'}
    <iframe
      bind:this={htmlIframeElement}
      src={mediaUrl}
      title={name}
      class="max-w-full max-h-full aspect-square border-0 bg-transparent {animateTransition
        ? 'transition-opacity duration-300'
        : ''} {contentLoaded ? 'opacity-100' : 'opacity-0'}"
      style="color-scheme: normal"
      sandbox={FRAME_SANDBOX}
      referrerpolicy={FRAME_REFERRER_POLICY}
      allow={FRAME_ALLOW}
      scrolling="no"
    ></iframe>
  {:else if category === 'text'}
    <iframe
      bind:this={textIframeElement}
      src={mediaUrl}
      title={name}
      class="max-w-full max-h-full aspect-square border-0 bg-os-dark {animateTransition
        ? 'transition-opacity duration-300'
        : ''} {contentLoaded ? 'opacity-100' : 'opacity-0'}"
      sandbox={FRAME_SANDBOX}
      referrerpolicy={FRAME_REFERRER_POLICY}
      allow={FRAME_ALLOW}
      scrolling="auto"
    ></iframe>
  {:else if category === 'model'}
    <iframe
      bind:this={modelIframeElement}
      src={mediaUrl}
      title={name}
      class="w-full h-full border-0 bg-transparent {animateTransition
        ? 'transition-opacity duration-300'
        : ''} {contentLoaded ? 'opacity-100' : 'opacity-0'} {embedInteractionEnabled
        ? ''
        : 'pointer-events-none'}"
      style="color-scheme: normal"
      sandbox={FRAME_SANDBOX}
      referrerpolicy={FRAME_REFERRER_POLICY}
      allow={FRAME_ALLOW}
      scrolling="no"
    ></iframe>
    {#if !embedInteractionEnabled}
      <!-- Scroll shield: model-viewer hijacks wheel/drag for camera controls. -->
      <button
        type="button"
        class="absolute inset-0 z-10 flex items-end justify-center pb-5 cursor-pointer bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-os-orange focus-visible:ring-inset"
        onclick={() => (embedInteractionEnabled = true)}
        aria-label="Enable 3D model interaction"
      >
        {#if contentLoaded}
          <span
            class="pointer-events-none inline-flex items-center gap-2 rounded-full border border-os-border bg-os-card/90 px-3 py-1.5 text-xs text-os-text"
          >
            <i class="fa-solid fa-cube" aria-hidden="true"></i>
            Click to interact
          </span>
        {/if}
      </button>
    {/if}
  {:else if category === 'pdf'}
    <iframe
      bind:this={pdfIframeElement}
      src={mediaUrl}
      title={name}
      class="w-full h-full border-0 bg-transparent {animateTransition
        ? 'transition-opacity duration-300'
        : ''} {contentLoaded ? 'opacity-100' : 'opacity-0'} {embedInteractionEnabled
        ? ''
        : 'pointer-events-none'}"
      style="color-scheme: normal"
      sandbox={FRAME_SANDBOX}
      referrerpolicy={FRAME_REFERRER_POLICY}
      allow={FRAME_ALLOW}
    ></iframe>
    {#if !embedInteractionEnabled}
      <button
        type="button"
        class="absolute inset-0 z-10 flex items-end justify-center pb-5 cursor-pointer bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-os-orange focus-visible:ring-inset"
        onclick={() => (embedInteractionEnabled = true)}
        aria-label="Enable PDF scrolling"
      >
        {#if contentLoaded}
          <span
            class="pointer-events-none inline-flex items-center gap-2 rounded-full border border-os-border bg-os-card/90 px-3 py-1.5 text-xs text-os-text"
          >
            <i class="fa-solid fa-file-pdf" aria-hidden="true"></i>
            Click to read
          </span>
        {/if}
      </button>
    {/if}
  {:else if category === 'video'}
    <video
      bind:this={heroVideoElement}
      src={mediaUrl}
      class="max-w-full max-h-full object-contain {animateTransition
        ? 'transition-opacity duration-300'
        : ''} {contentLoaded ? 'opacity-100' : 'opacity-0'}"
      controls
      autoplay
      loop
      muted
      playsinline
    ></video>
  {:else if category === 'audio'}
    <div class="flex flex-col items-center gap-4">
      <i class="fa-solid fa-volume-high text-4xl text-os-text/60"></i>
      <audio bind:this={heroAudioElement} src={mediaUrl} controls class="w-64"></audio>
    </div>
  {:else if heroImageFailed}
    <button
      type="button"
      class="w-full h-full flex items-center justify-center bg-os-dark text-os-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-os-orange focus-visible:ring-inset"
      onclick={retryHeroImageNow}
      aria-label="Retry loading {name}"
    >
      <i class="fa-solid fa-image text-6xl" aria-hidden="true"></i>
    </button>
  {:else}
    {#key `${itemRenderKey}:${heroImageLoadKey}`}
      <img
        bind:this={heroImageElement}
        src={mediaUrl}
        alt={name}
        loading="eager"
        fetchpriority="high"
        class="object-contain {contentLoaded ? 'opacity-100' : 'opacity-0'} {usePixelated
          ? 'w-full h-full'
          : 'max-w-full max-h-full'}"
        style={usePixelated ? `image-rendering: ${imageRendering}` : ''}
      />
    {/key}
  {/if}
</div>
