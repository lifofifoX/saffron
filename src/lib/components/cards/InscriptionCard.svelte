<script lang="ts">
  import InscriptionThumb from '$lib/components/cards/InscriptionThumb.svelte'
  import type { InscriptionHolding } from '$lib/engine/types'

  type Props = {
    inscription: InscriptionHolding
    selecting?: boolean
    selected?: boolean
    onToggleSelect?: () => void
  }

  let { inscription, selecting = false, selected = false, onToggleSelect }: Props = $props()

  let mimeChip = $derived(inscription.contentType?.split(';')[0]?.split('/')[1] ?? 'unknown')
</script>

<a
  href="/inscription/{inscription.id}"
  class="group relative block w-full overflow-hidden rounded-xl border bg-os-card text-left transition-colors {selected
    ? 'border-os-orange'
    : 'border-os-border hover:border-os-purple/60'}"
  onclick={(event) => {
    if (!selecting || !onToggleSelect) return
    event.preventDefault()
    onToggleSelect()
  }}
>
  {#if onToggleSelect}
    <button
      type="button"
      class="absolute top-2 left-2 z-10 flex h-6 w-6 items-center justify-center rounded-md border transition {selected
        ? 'border-os-orange bg-os-orange text-white opacity-100'
        : `border-os-border bg-os-dark/80 text-transparent backdrop-blur hover:text-os-text ${
            selecting ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}"
      aria-label={selected ? 'Deselect inscription' : 'Select inscription'}
      aria-pressed={selected}
      onclick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onToggleSelect()
      }}
    >
      <i class="fa-solid fa-check text-[11px]"></i>
    </button>
  {/if}
  <div class="aspect-square overflow-hidden bg-os-dark">
    <div
      class="h-full w-full transition-transform duration-300 motion-safe:group-hover:scale-[1.03]"
    >
      <InscriptionThumb inscriptionId={inscription.id} contentType={inscription.contentType} />
    </div>
  </div>

  <div class="flex items-center justify-between gap-2 px-2.5 py-2">
    <span class="text-xs font-semibold text-os-text-light truncate">
      {inscription.number !== null ? `#${inscription.number.toLocaleString('en-US')}` : 'pending'}
    </span>
    <span class="text-[10px] font-medium text-os-text uppercase shrink-0">{mimeChip}</span>
  </div>
</a>
