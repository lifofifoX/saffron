<script lang="ts">
  import Banner from '$lib/components/common/Banner.svelte'
  import { browser } from '$app/environment'

  let unsupported = $derived.by(() => {
    if (!browser) return false
    if (!window.isSecureContext) return true

    const nav = navigator as Navigator & { hid?: unknown; usb?: unknown }
    return nav.hid === undefined && nav.usb === undefined
  })
</script>

{#if unsupported}
  <Banner severity="warning" class="flex items-start gap-3">
    <i class="fa-solid fa-triangle-exclamation text-os-warning mt-0.5"></i>
    <div>
      <p class="font-semibold text-os-text-light">Hardware wallets need Chrome</p>
      <p class="text-os-text mt-1">
        Trezor and Ledger connections rely on WebUSB/WebHID, which only work in Chromium browsers
        (Chrome, Brave, Edge) over HTTPS or localhost.
      </p>
    </div>
  </Banner>
{/if}
