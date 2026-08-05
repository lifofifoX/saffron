<script lang="ts">
  import OsModal from '$lib/components/common/ui/OsModal.svelte'
  import { activeModal, closeModal, modalData } from '$lib/stores/ui'
  import type { ConfirmModalData } from '$lib/stores/ui/modal'

  let confirmModalData = $derived(
    typeof $modalData === 'object' && $modalData !== null && !Array.isArray($modalData)
      ? ($modalData as ConfirmModalData)
      : {},
  )
  let title = $derived(confirmModalData.title ?? 'Are you sure?')
  let message = $derived(confirmModalData.message ?? '')
  let confirmLabel = $derived(confirmModalData.confirmLabel ?? 'Confirm')
  let confirmStyle = $derived(confirmModalData.destructive ? 'destructive' : 'default')
  let onConfirm = $derived(confirmModalData.onConfirm ?? null)
  let onCancel = $derived(confirmModalData.onCancel ?? null)
  let handledClose = $state(false)

  $effect(() => {
    if ($activeModal !== 'confirm') return
    void confirmModalData
    handledClose = false
  })

  function handleConfirm() {
    const callback = onConfirm
    handledClose = true
    closeModal()
    if (callback) callback()
  }

  function handleClose() {
    if (handledClose) return
    handledClose = true
    const callback = onCancel
    closeModal()
    if (callback) callback()
  }
</script>

<OsModal
  onClose={handleClose}
  {title}
  panelClass="fixed bottom-0 left-0 right-0 md:top-1/2 md:left-1/2 md:bottom-auto md:right-auto md:-translate-x-1/2 md:-translate-y-1/2 w-full md:max-w-sm bg-os-card border border-os-border rounded-t-2xl md:rounded-2xl z-[61]"
>
  <div class="px-5 pt-5 pb-3">
    <h2 class="text-base font-bold">{title}</h2>
    {#if message}
      <p class="text-sm text-os-text mt-2">{message}</p>
    {/if}
  </div>

  <div class="px-5 pb-5 pt-1 flex items-center gap-2">
    {#if confirmStyle === 'destructive'}
      <button
        class="flex-1 bg-red-500/90 hover:bg-red-500 text-white text-sm font-semibold py-2.5 rounded-xl transition"
        onclick={handleConfirm}
      >
        {confirmLabel}
      </button>
    {:else}
      <button
        class="flex-1 bg-os-orange hover:bg-orange-600 text-white text-sm font-semibold py-2.5 rounded-xl transition"
        onclick={handleConfirm}
      >
        {confirmLabel}
      </button>
    {/if}
    <button
      class="px-4 py-2.5 rounded-xl border border-os-border text-sm text-os-text hover:text-white hover:border-os-hover transition"
      onclick={handleClose}
    >
      Cancel
    </button>
  </div>
</OsModal>
