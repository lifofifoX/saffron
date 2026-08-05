<script lang="ts">
  import { afterNavigate } from '$app/navigation'
  import { page } from '$app/stores'
  import OsSheet from '$lib/components/common/ui/OsSheet.svelte'
  import { mobileMenuOpen } from '$lib/stores/ui'

  type NavEntry = {
    label: string
    icon?: string
    glyph?: string
    href: string
    active: boolean
  }

  let path = $derived($page.url.pathname)

  function matchesRoutePrefix(pathname: string, prefix: string): boolean {
    return pathname === prefix || pathname.startsWith(`${prefix}/`)
  }

  let vaultItems = $derived.by<NavEntry[]>(() => [
    {
      label: 'Inscriptions',
      glyph: '◉',
      href: '/',
      active: path === '/' || matchesRoutePrefix(path, '/inscription'),
    },
    {
      label: 'Sign PSBT',
      icon: 'fa-file-signature',
      href: '/sign',
      active: matchesRoutePrefix(path, '/sign'),
    },
  ])

  let generalItems = $derived.by<NavEntry[]>(() => [
    {
      label: 'Settings',
      icon: 'fa-gear',
      href: '/settings',
      active: matchesRoutePrefix(path, '/settings'),
    },
  ])

  afterNavigate(() => {
    mobileMenuOpen.set(false)
  })
</script>

{#snippet navLink(item: NavEntry)}
  <a href={item.href} class="nav-item" class:active={item.active}>
    {#if item.glyph}
      <span class="w-4 text-center text-[13px] leading-none">{item.glyph}</span>
    {:else}
      <i class="fa-solid {item.icon} w-4 text-center text-[13px]"></i>
    {/if}
    <span>{item.label}</span>
  </a>
{/snippet}

<!-- Desktop sidebar -->
<aside class="app-sidebar" role="navigation">
  <nav class="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2.5 py-4">
    <div class="nav-section-label">Vault</div>
    {#each vaultItems as item (item.href)}
      {@render navLink(item)}
    {/each}

    <div class="nav-section-label mt-5">General</div>
    {#each generalItems as item (item.href)}
      {@render navLink(item)}
    {/each}
  </nav>
</aside>

<OsSheet
  open={$mobileMenuOpen}
  onOpenChange={(nextOpen) => mobileMenuOpen.set(nextOpen)}
  title="Navigation"
  testId="mobile-nav-sheet"
  overlayClass="md:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-[55]"
  contentClass="md:hidden fixed top-0 left-0 bottom-0 w-[260px] bg-os-card z-[56] flex flex-col transition-transform duration-300 ease-out data-[state=open]:translate-x-0 data-[state=closed]:-translate-x-full"
>
  <div class="flex h-14 shrink-0 items-center justify-between px-4">
    <a href="/" class="flex items-center gap-2">
      <span class="text-base">🌸</span>
      <span class="text-base font-bold tracking-tight text-os-orange">saffron</span>
    </a>
    <button
      class="flex h-8 w-8 items-center justify-center rounded-lg text-os-text transition-colors hover:bg-os-hover hover:text-white"
      onclick={() => mobileMenuOpen.set(false)}
      aria-label="Close menu"
    >
      <i class="fa-solid fa-xmark text-sm"></i>
    </button>
  </div>

  <div class="h-px bg-os-border"></div>

  <nav class="mt-4 flex flex-col gap-0.5 px-2.5">
    <div class="nav-section-label">Vault</div>
    {#each vaultItems as item (item.href)}
      {@render navLink(item)}
    {/each}

    <div class="nav-section-label mt-5">General</div>
    {#each generalItems as item (item.href)}
      {@render navLink(item)}
    {/each}
  </nav>
</OsSheet>
