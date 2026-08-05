<script lang="ts">
  import TruncatedId from '$lib/components/common/TruncatedId.svelte'
  import { DEVICE_ICONS, DEVICE_LABELS, type DeviceKind } from '$lib/devices/kinds'

  export type SlotKeyResult = {
    device: DeviceKind | null
    xpub: string
    xfp: string
    bip32Path: string
  }

  export type SlotState = {
    device: DeviceKind | null
    status: 'empty' | 'busy' | 'done' | 'error'
    messages: string[]
    error: string
    result: SlotKeyResult | null
  }

  type Props = {
    index: number
    slot: SlotState
    disabled: boolean
    trezorOnly?: boolean
    expectedPath: string
    onConnect: (device: DeviceKind) => void
    onManual: (entry: { xpub: string; xfp: string; bip32Path: string }) => void
    onClear: () => void
  }

  let {
    index,
    slot,
    disabled,
    trezorOnly = false,
    expectedPath,
    onConnect,
    onManual,
    onClear,
  }: Props = $props()

  let manualOpen = $state(false)
  let manualXpub = $state('')
  let manualXfp = $state('')
  let manualPath = $state('')

  $effect(() => {
    if (!manualOpen) manualPath = expectedPath
  })

  function focusOnMount(node: HTMLInputElement) {
    node.focus()
  }

  function submitManual() {
    onManual({
      xpub: manualXpub.trim(),
      xfp: manualXfp.trim().toLowerCase(),
      bip32Path: manualPath.trim(),
    })
  }
</script>

<div class="rounded-xl border border-os-border bg-os-card p-4 flex flex-col gap-3">
  <div class="flex items-center justify-between">
    <span class="os-label">
      Key {index + 1}
    </span>
    {#if slot.status === 'done'}
      <button
        class="text-[11px] text-os-text hover:text-os-error transition-colors"
        onclick={onClear}
      >
        <i class="fa-solid fa-xmark mr-1"></i>Remove
      </button>
    {/if}
  </div>

  {#if slot.status === 'done' && slot.result}
    <div class="flex items-center gap-3">
      <span
        class="flex h-9 w-9 items-center justify-center rounded-lg bg-os-purple/15 text-os-purple"
      >
        <i
          class="fa-solid {slot.result.device
            ? DEVICE_ICONS[slot.result.device]
            : 'fa-font'} text-sm"
        ></i>
      </span>
      <div class="min-w-0">
        <p class="text-sm font-semibold text-os-text-light">
          {slot.result.device ? DEVICE_LABELS[slot.result.device] : 'Pasted key'}
          <span class="ml-1.5 font-mono text-[11px] text-os-text">{slot.result.xfp}</span>
        </p>
        <TruncatedId value={slot.result.xpub} head={12} tail={8} class="text-[11px] text-os-text" />
      </div>
      <i class="fa-solid fa-circle-check ml-auto text-os-success"></i>
    </div>
  {:else if slot.status === 'busy'}
    <div class="flex flex-col gap-3">
      <div class="flex items-center gap-3">
        <span
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-os-purple/15 text-os-purple"
        >
          <i class="fa-solid {slot.device ? DEVICE_ICONS[slot.device] : 'fa-plug'} text-sm"></i>
        </span>
        <span class="flex items-center gap-2.5 text-sm font-semibold text-os-text-light">
          Waiting for {slot.device ? DEVICE_LABELS[slot.device] : 'device'}
          <span class="os-spinner text-os-text"></span>
        </span>
      </div>

      {#if slot.messages.length > 0}
        <ol class="flex flex-col gap-2 rounded-lg border border-os-border/60 bg-os-dark/60 p-3">
          {#each slot.messages as message, messageIndex (messageIndex)}
            <li class="flex items-start gap-2.5 text-xs leading-relaxed text-os-text">
              <span
                class="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-os-hover/40 font-mono text-[9px] font-semibold text-os-text-light"
              >
                {messageIndex + 1}
              </span>
              {message}
            </li>
          {/each}
        </ol>
      {/if}
    </div>
  {:else}
    {#if slot.status === 'error' && slot.error}
      <p
        class="rounded-lg border border-os-error/40 bg-os-error/10 px-3 py-2 text-[11px] text-os-error"
      >
        {slot.error}
      </p>
    {/if}
    <div class="flex items-center gap-2">
      {#if !trezorOnly}
        <button class="os-row-btn rounded-lg flex-1" {disabled} onclick={() => onConnect('LEDGER')}>
          <i class="fa-solid fa-key text-[10px]"></i>
          Connect Ledger
        </button>
      {/if}
      <button class="os-row-btn rounded-lg flex-1" {disabled} onclick={() => onConnect('TREZOR')}>
        <i class="fa-solid fa-shield text-[10px]"></i>
        Connect Trezor
      </button>
    </div>
    {#if trezorOnly}
      <p class="text-[11px] text-os-text">Single key vaults currently sign with Trezor.</p>
    {/if}

    {#if manualOpen}
      <div class="flex flex-col gap-2 border-t border-os-border/60 pt-3">
        <label class="flex flex-col gap-1.5">
          <span class="os-label">Xpub</span>
          <input
            type="text"
            bind:value={manualXpub}
            use:focusOnMount
            placeholder="xpub…"
            spellcheck="false"
            class="os-input h-9 w-full"
          />
        </label>
        <div class="flex items-end gap-2">
          <label class="flex flex-col gap-1.5">
            <span class="os-label">Fingerprint</span>
            <input
              type="text"
              bind:value={manualXfp}
              placeholder="a0b4196e"
              maxlength={8}
              spellcheck="false"
              class="os-input h-9 w-32"
            />
          </label>
          <label class="flex min-w-0 flex-1 flex-col gap-1.5">
            <span class="os-label">Derivation path</span>
            <input
              type="text"
              bind:value={manualPath}
              spellcheck="false"
              class="os-input h-9 w-full"
            />
          </label>
          <button
            class="os-row-btn os-row-btn-primary"
            disabled={disabled || manualXpub.trim().length === 0 || manualXfp.trim().length !== 8}
            onclick={submitManual}
          >
            Add key
          </button>
        </div>
        <p class="text-[11px] text-os-text">
          The path must be where this xpub actually lives on its seed. The device derives and signs
          at that path later.
        </p>
      </div>
    {:else}
      <button
        class="self-start text-[11px] text-os-text transition-colors hover:text-os-text-light"
        onclick={() => (manualOpen = true)}
      >
        <i class="fa-solid fa-keyboard mr-1"></i>Enter an xpub instead
      </button>
    {/if}
  {/if}
</div>
