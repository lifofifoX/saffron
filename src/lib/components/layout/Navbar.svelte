<script lang="ts">
  import { goto } from '$app/navigation'
  import { page } from '$app/stores'
  import TruncatedId from '$lib/components/common/TruncatedId.svelte'
  import OsSheet from '$lib/components/common/ui/OsSheet.svelte'
  import { mobileMenuOpen } from '$lib/stores/ui'
  import { hasWallet, setActiveVault, vaultList, walletConfig } from '$lib/stores/wallet-config'

  let vaultsOpen = $state(false)

  function switchVault(id: string, active: boolean) {
    vaultsOpen = false
    if (active) return

    setActiveVault(id)
    if ($page.url.pathname.startsWith('/inscription')) void goto('/')
  }

  function newVault() {
    vaultsOpen = false
    void goto('/setup')
  }
</script>

<header class="app-topbar">
  <div class="flex min-w-0 items-center gap-3">
    <button
      class="md:hidden flex h-10 w-10 items-center justify-center rounded-lg text-os-text transition-colors hover:bg-os-hover/40 hover:text-os-text-light"
      onclick={() => mobileMenuOpen.set(true)}
      aria-label="Open menu"
    >
      <i class="fa-solid fa-bars text-sm"></i>
    </button>

    <a href="/" class="flex items-center gap-2.5" aria-label="Saffron home">
      <span class="text-lg leading-none">🌸</span>
      <span class="text-[17px] font-bold tracking-tight text-os-orange">saffron</span>
      <span
        class="mt-0.5 hidden font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-os-text sm:inline"
      >
        vault
      </span>
    </a>
  </div>

  <div class="flex items-center gap-3">
    {#if $hasWallet && $walletConfig}
      <button
        class="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] font-medium transition-colors hover:bg-os-hover/40"
        onclick={() => (vaultsOpen = true)}
        aria-label="Switch vault"
      >
        <span
          class="flex h-[30px] w-[30px] items-center justify-center rounded-full border border-os-border bg-os-orange/10"
        >
          <i class="fa-solid fa-shield-halved text-[12px] text-os-orange"></i>
        </span>
        <span class="hidden max-w-[180px] truncate text-os-text-light sm:inline">
          {$walletConfig.name}
        </span>
        <i class="fa-solid fa-chevron-down text-[9px] text-os-text"></i>
      </button>
    {:else}
      <a href="/setup" class="os-row-btn os-row-btn-primary">
        <i class="fa-solid fa-plus text-[10px]"></i>
        <span>Set up vault</span>
      </a>
    {/if}
  </div>
</header>

<OsSheet
  open={vaultsOpen}
  onOpenChange={(nextOpen) => (vaultsOpen = nextOpen)}
  title="Vaults"
  testId="vaults-sheet"
  overlayClass="fixed inset-0 bg-black/60 backdrop-blur-sm z-[55]"
  contentClass="fixed top-0 right-0 bottom-0 w-full max-w-sm bg-os-card z-[56] flex flex-col transition-transform duration-300 ease-out data-[state=open]:translate-x-0 data-[state=closed]:translate-x-full"
>
  <div class="flex h-14 shrink-0 items-center justify-between px-4">
    <h2 class="text-sm font-bold text-os-text-light">Vaults</h2>
    <button
      class="flex h-8 w-8 items-center justify-center rounded-lg text-os-text transition-colors hover:bg-os-hover hover:text-white"
      onclick={() => (vaultsOpen = false)}
      aria-label="Close vaults"
    >
      <i class="fa-solid fa-xmark text-sm"></i>
    </button>
  </div>

  <div class="h-px shrink-0 bg-os-border"></div>

  <div class="flex flex-1 flex-col gap-2 overflow-y-auto p-3">
    {#each $vaultList as entry (entry.id)}
      <button
        type="button"
        class="flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors {entry.active
          ? 'border-os-orange/50 bg-os-dark'
          : 'border-os-border/70 bg-os-dark hover:border-os-orange/30'}"
        onclick={() => switchVault(entry.id, entry.active)}
      >
        <span
          class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-os-border {entry.active
            ? 'bg-os-orange/10 text-os-orange'
            : 'bg-os-hover/20 text-os-text'}"
        >
          <span class="text-[17px] leading-none">◉</span>
        </span>

        <span class="min-w-0 flex-1">
          <span class="block truncate text-sm font-semibold text-os-text-light">
            {entry.name}
          </span>
          <span class="mt-1 flex items-center gap-2">
            <span class="os-badge">
              <i class="fa-solid fa-shield-halved text-[10px] text-os-purple"></i>
              {entry.quorumLabel}
            </span>
            {#if entry.addressIntegrityOk && entry.address}
              <TruncatedId
                value={entry.address}
                head={10}
                tail={6}
                class="truncate text-[10px] text-os-text"
              />
            {:else}
              <span class="truncate text-[10px] text-os-error">Address check failed</span>
            {/if}
          </span>
        </span>

        {#if entry.active}
          <i class="fa-solid fa-check shrink-0 text-[11px] text-os-orange"></i>
        {/if}
      </button>
    {/each}
  </div>

  <div class="shrink-0 border-t border-os-border p-3">
    <button class="os-row-btn os-row-btn-surface w-full" onclick={newVault}>
      <i class="fa-solid fa-plus text-[10px]"></i>
      New vault
    </button>
  </div>
</OsSheet>
