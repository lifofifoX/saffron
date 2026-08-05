<script lang="ts">
  import type { Component } from 'svelte'

  import { activeModal } from '$lib/stores/ui'
  import type { ModalName } from '$lib/stores/ui/modal'
  import { scheduleDialogBodyStyleRestore } from '$lib/utils/dialog-body-styles'

  import { getLoadedModalComponent, loadModalComponent } from './registry.js'

  let ModalComponent = $state<Component | null>(null)
  let currentModal = $state<ModalName | null>(null)

  $effect(() => {
    const name = $activeModal

    if (!name) {
      if (!currentModal) return
      ModalComponent = null
      currentModal = null
      scheduleDialogBodyStyleRestore()
      return
    }

    if (name === currentModal && ModalComponent) return

    currentModal = name
    const cachedComponent = getLoadedModalComponent(name)
    if (cachedComponent) {
      ModalComponent = cachedComponent
      return
    }

    ModalComponent = null
    loadModalComponent(name).then((component) => {
      if ($activeModal === name) {
        ModalComponent = component
      }
    })
  })
</script>

{#if ModalComponent}
  <ModalComponent />
{/if}
