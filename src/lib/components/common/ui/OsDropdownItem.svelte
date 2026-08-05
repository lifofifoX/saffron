<script lang="ts">
  import { DropdownMenu } from 'bits-ui'
  import type { Snippet } from 'svelte'

  type Props = {
    children?: Snippet
    onSelect?: (() => void) | undefined
    disabled?: boolean
    closeOnSelect?: boolean
    destructive?: boolean
    size?: 'compact' | 'spacious'
    class?: string
    testId?: string
  }

  let {
    children,
    onSelect = () => {},
    disabled = false,
    closeOnSelect = true,
    destructive = false,
    size = 'compact',
    class: className = '',
    testId = '',
  }: Props = $props()

  let sizeClass = $derived(size === 'spacious' ? 'text-sm px-4 py-3' : 'text-xs px-3 py-2')
</script>

<DropdownMenu.Item
  {onSelect}
  {disabled}
  {closeOnSelect}
  class="w-full text-left rounded-lg outline-none cursor-pointer transition-colors data-highlighted:bg-os-hover/40 data-disabled:cursor-not-allowed {destructive
    ? 'text-red-400 data-highlighted:bg-red-500/10'
    : 'text-os-text-light'} {sizeClass} {className}"
  data-testid={testId || undefined}
>
  {@render children?.()}
</DropdownMenu.Item>
