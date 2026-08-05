<script lang="ts">
  import { addToast } from '$lib/stores/ui'

  type Props = {
    value: string
    label?: string
    class?: string
  }

  let { value, label = 'Copy', class: className = '' }: Props = $props()

  let copied = $state(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      copied = true
      addToast('Copied to clipboard')
      setTimeout(() => (copied = false), 1500)
    } catch {
      addToast('Copy failed', 'error')
    }
  }
</script>

<button
  type="button"
  onclick={copy}
  aria-label={label}
  title={label}
  class="inline-flex items-center justify-center text-os-text hover:text-os-text-light transition-colors {className}"
>
  <i class="fa-solid {copied ? 'fa-check text-os-success' : 'fa-copy'} text-xs"></i>
</button>
