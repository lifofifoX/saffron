<script lang="ts">
  import Banner from '$lib/components/common/Banner.svelte'
  import { errorMessage } from '$lib/utils/error-message'
  import DecodedPsbtView from '$lib/components/sign/DecodedPsbtView.svelte'
  import ExportPanel from '$lib/components/signing/ExportPanel.svelte'
  import { SignSession } from '$lib/components/signing/sign-session.svelte'
  import SigningPanel from '$lib/components/signing/SigningPanel.svelte'
  import { loadVerifiedWallet } from '$lib/persistence/wallet-store'
  import { assertPsbtFileSize, INPUT_LIMITS } from '$lib/security/input-limits'

  let psbtText = $state('')
  let session = $state<SignSession | null>(null)
  let walletError = $state('')

  function createSession(): SignSession | null {
    try {
      const wallet = loadVerifiedWallet()
      if (!wallet) {
        walletError = 'No vault configured.'
        return null
      }

      return new SignSession(wallet.config, wallet.addresses)
    } catch (error) {
      walletError = errorMessage(error)
      return null
    }
  }

  async function analyzeText() {
    const nextSession = createSession()
    if (!nextSession) return

    session = nextSession
    await nextSession.loadPsbt(psbtText)
  }

  async function handleFile(event: Event & { currentTarget: EventTarget & HTMLInputElement }) {
    const inputElement = event.currentTarget
    const file = inputElement.files?.[0]
    if (!file) return

    try {
      assertPsbtFileSize(file.size)

      const nextSession = createSession()
      if (!nextSession) return

      const buffer = new Uint8Array(await file.arrayBuffer())
      const isBinary = buffer.length > 5 && buffer[0] === 0x70 && buffer[4] === 0xff

      session = nextSession
      if (isBinary) {
        await nextSession.loadPsbt(buffer)
      } else {
        psbtText = new TextDecoder().decode(buffer)
        await nextSession.loadPsbt(psbtText)
      }
    } catch (error) {
      walletError = errorMessage(error)
    } finally {
      inputElement.value = ''
    }
  }

  function reset() {
    session = null
    psbtText = ''
  }
</script>

<div class="mx-auto max-w-6xl px-4 py-6 flex flex-col gap-4">
  <div class="flex items-center justify-between gap-3">
    <div>
      <h1 class="text-[21px] font-semibold tracking-tight text-os-text-light">
        Sign a transaction
      </h1>
      <p class="text-sm text-os-text mt-1">
        Paste or upload a PSBT. Saffron shows exactly what it spends, flags any inscriptions
        involved, then collects signatures from your devices.
      </p>
    </div>
    {#if session}
      <button class="os-row-btn rounded-lg shrink-0" onclick={reset}>
        <i class="fa-solid fa-xmark text-[10px]"></i>
        Start over
      </button>
    {/if}
  </div>

  {#if walletError}
    <Banner severity="error">{walletError}</Banner>
  {/if}

  {#if !session || (!session.analysis && !session.analyzing && session.analysisError === '')}
    <div class="rounded-xl border border-os-border bg-os-card p-5 flex flex-col gap-3">
      <textarea
        bind:value={psbtText}
        rows={7}
        maxlength={INPUT_LIMITS.psbtTextCharacters}
        placeholder="cHNidP8B…"
        spellcheck="false"
        class="w-full rounded-lg border border-os-border bg-os-dark px-3 py-2 font-mono text-[11px] text-os-text-light focus:border-os-orange/50"
      ></textarea>

      <div class="flex items-center gap-2">
        <label class="os-row-btn rounded-lg cursor-pointer">
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
          class="os-row-btn os-row-btn-primary rounded-lg"
          disabled={psbtText.trim().length === 0}
          onclick={() => void analyzeText()}
        >
          <i class="fa-solid fa-magnifying-glass text-[10px]"></i>
          Decode
        </button>
      </div>
    </div>
  {/if}

  {#if session?.analyzing}
    <div
      class="flex items-center gap-2 rounded-xl border border-os-border bg-os-card px-4 py-3 text-sm text-os-text"
    >
      <span class="os-spinner"></span>
      Decoding and checking for inscriptions…
    </div>
  {/if}

  {#if session?.analysisError}
    <Banner severity="error">
      {session.analysisError}
      <button class="ml-2 underline" onclick={reset}>Start over</button>
    </Banner>
  {/if}

  {#if session?.analysis}
    <DecodedPsbtView analysis={session.analysis} />
    <SigningPanel {session} />
    <ExportPanel
      artifacts={session.artifacts}
      partialPsbtBase64={session.partialPsbtBase64()}
      signedCount={session.signedCount}
      requiredSigners={session.requiredSigners}
    />
  {/if}
</div>
