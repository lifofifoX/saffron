<script lang="ts">
  import { onMount } from 'svelte'

  import { page } from '$app/stores'
  import InscriptionDetail from '$lib/components/inscription/InscriptionDetail.svelte'
  import { refreshVault } from '$lib/stores/vault'

  onMount(() => {
    void refreshVault()
  })
</script>

<div class="mx-auto max-w-6xl px-4 py-6">
  {#key $page.params.id}
    <InscriptionDetail inscriptionId={$page.params.id ?? ''} />
  {/key}
</div>
