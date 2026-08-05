<script lang="ts">
  import type { Snippet } from 'svelte'

  type Props = {
    severity?: 'error' | 'warning' | 'info'
    children?: Snippet
    class?: string
  }

  let { severity = 'info', children, class: className = '' }: Props = $props()

  const severityClasses = {
    error: 'border-os-error/40 bg-os-error/10 text-os-error',
    warning: 'border-os-warning/40 bg-os-warning/10 text-os-text-light',
    info: 'border-os-border bg-os-card text-os-text-light',
  }
</script>

<div class="rounded-lg border px-4 py-3 text-sm {severityClasses[severity]} {className}">
  {@render children?.()}
</div>
