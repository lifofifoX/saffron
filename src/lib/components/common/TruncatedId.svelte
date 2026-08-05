<script lang="ts">
  type Props = {
    value: string
    head?: number
    tail?: number
    class?: string
  }

  let { value, head = 8, tail = 6, class: className = '' }: Props = $props()

  let truncated = $derived(
    value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`,
  )
</script>

<span class="font-mono {className}" title={value}>{truncated}</span>
