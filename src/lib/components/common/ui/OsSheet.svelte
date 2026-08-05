<script lang="ts">
  import { Dialog } from 'bits-ui'
  import type { Snippet } from 'svelte'

  type Props = {
    open: boolean
    onOpenChange: (open: boolean) => void
    children?: Snippet
    title?: string
    overlayClass?: string
    contentClass?: string
    trapFocus?: boolean
    preventScroll?: boolean
    closeOnInteractOutside?: boolean
    testId?: string
  }

  let {
    open,
    onOpenChange,
    children,
    title = 'Dialog panel',
    overlayClass = '',
    contentClass = '',
    trapFocus = true,
    preventScroll = true,
    closeOnInteractOutside = true,
    testId = '',
  }: Props = $props()
</script>

<Dialog.Root {open} {onOpenChange}>
  <Dialog.Portal>
    <Dialog.Overlay
      class="transition-opacity duration-200 data-[state=open]:opacity-100 data-[state=closed]:opacity-0 {overlayClass}"
      data-testid={testId ? `${testId}-overlay` : undefined}
    />

    <Dialog.Content
      {trapFocus}
      {preventScroll}
      onInteractOutside={(event) => {
        if (!closeOnInteractOutside) event.preventDefault()
      }}
      class="outline-none {contentClass}"
      data-testid={testId ? `${testId}-content` : undefined}
    >
      <Dialog.Title class="sr-only">{title}</Dialog.Title>
      {@render children?.()}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
