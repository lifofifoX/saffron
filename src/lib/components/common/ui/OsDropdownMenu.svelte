<script lang="ts">
  import { DropdownMenu } from 'bits-ui'
  import type { Snippet } from 'svelte'

  type Props = {
    trigger?: Snippet
    children?: Snippet
    triggerClass?: string
    contentClass?: string
    align?: 'start' | 'center' | 'end'
    side?: 'top' | 'right' | 'bottom' | 'left'
    sideOffset?: number
    disabled?: boolean
    preventScroll?: boolean
    testId?: string
  }

  let {
    trigger,
    children,
    triggerClass = '',
    contentClass = '',
    align = 'end',
    side = 'bottom',
    sideOffset = 8,
    disabled = false,
    preventScroll = false,
    testId = '',
  }: Props = $props()
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger
    class={triggerClass}
    {disabled}
    data-testid={testId ? `${testId}-trigger` : undefined}
  >
    {@render trigger?.()}
  </DropdownMenu.Trigger>

  <DropdownMenu.Portal>
    <DropdownMenu.Content
      class="z-[70] rounded-xl border border-os-border bg-os-card p-1 shadow-xl {contentClass}"
      {align}
      {side}
      {sideOffset}
      {preventScroll}
      data-testid={testId ? `${testId}-content` : undefined}
    >
      {@render children?.()}
    </DropdownMenu.Content>
  </DropdownMenu.Portal>
</DropdownMenu.Root>
