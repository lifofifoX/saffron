<script lang="ts">
  import { errorMessage } from '$lib/utils/error-message'
  import { assertPsbtFileSize, INPUT_LIMITS } from '$lib/security/input-limits'

  import type { SignSession } from './sign-session.svelte'

  type Props = {
    session: SignSession
    onImported?: () => void
  }

  let { session, onImported }: Props = $props()

  let pasted = $state('')
  let importError = $state('')

  function runImport(raw: string | Uint8Array) {
    try {
      session.importSignedPsbt(raw)
      pasted = ''
      importError = ''
      onImported?.()
    } catch (error) {
      importError = errorMessage(error)
    }
  }

  async function handleFile(event: Event & { currentTarget: EventTarget & HTMLInputElement }) {
    const inputElement = event.currentTarget
    const file = inputElement.files?.[0]
    if (!file) return

    try {
      assertPsbtFileSize(file.size)
      const buffer = new Uint8Array(await file.arrayBuffer())
      const isBinary = buffer.length > 5 && buffer[0] === 0x70 && buffer[4] === 0xff

      runImport(isBinary ? buffer : new TextDecoder().decode(buffer).trim())
    } catch (error) {
      importError = errorMessage(error)
    } finally {
      inputElement.value = ''
    }
  }
</script>

<div class="flex flex-col gap-2">
  <textarea
    bind:value={pasted}
    rows={3}
    maxlength={INPUT_LIMITS.psbtTextCharacters}
    placeholder="cHNidP8B…"
    spellcheck="false"
    class="w-full rounded-lg border border-os-border bg-os-dark px-3 py-2 font-mono text-[11px] text-os-text-light focus:border-os-orange/50"
  ></textarea>

  <div class="flex items-center gap-2">
    <label class="os-row-btn os-row-btn-surface cursor-pointer">
      <i class="fa-solid fa-folder-open text-[10px]"></i>
      Upload .psbt
      <input
        type="file"
        accept=".psbt,.txt,application/octet-stream"
        class="hidden"
        onchange={handleFile}
      />
    </label>
    <button
      class="os-row-btn os-row-btn-primary"
      disabled={pasted.trim().length === 0}
      onclick={() => runImport(pasted.trim())}
    >
      Import
    </button>
  </div>

  {#if importError}
    <p class="text-[11px] text-os-error">{importError}</p>
  {/if}
</div>
