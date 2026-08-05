<script lang="ts">
  import '../app.css'

  import { onMount, type Snippet } from 'svelte'

  import { onNavigate } from '$app/navigation'
  import { navigating } from '$app/stores'
  import Toast from '$lib/components/common/Toast.svelte'
  import Navbar from '$lib/components/layout/Navbar.svelte'
  import Sidebar from '$lib/components/layout/Sidebar.svelte'
  import ModalHost from '$lib/components/modals/ModalHost.svelte'

  let { children }: { children: Snippet } = $props()

  onMount(() => {
    void import('$lib/devices/trezor-init')
      .then((module) => module.initTrezorConnectAsSaffron())
      .catch(() => {})
  })

  onNavigate((navigation) => {
    if (!document.startViewTransition) return

    return new Promise((resolve) => {
      document.startViewTransition(async () => {
        resolve()
        await navigation.complete
      })
    })
  })
</script>

{#if $navigating}
  <div class="os-nav-progress">
    <div class="os-nav-progress-bar"></div>
  </div>
{/if}

<Sidebar />
<Navbar />

<main class="pt-[var(--topbar-h)] pb-8 pl-[var(--sidebar-w)]">
  {@render children()}
</main>

<ModalHost />
<Toast />
