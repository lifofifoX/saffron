<script lang="ts">
  import { Dialog } from 'bits-ui'
  import type { Snippet } from 'svelte'
  import type { FlyParams } from 'svelte/transition'
  import { fade, fly } from 'svelte/transition'

  type Props = {
    onClose: () => void
    open?: boolean
    panelClass?: string
    title?: string
    overlayClass?: string
    contentTransition?: FlyParams
    disableContentTransition?: boolean
    overlayTransitionDuration?: number
    preventScroll?: boolean
    onOpenAutoFocus?: (event: Event) => void
    children?: Snippet
    testId?: string
  }

  let {
    onClose,
    open = true,
    panelClass = '',
    title = 'Dialog',
    overlayClass = 'fixed inset-0 bg-black/60 backdrop-blur-sm z-[60]',
    contentTransition = { y: 18, duration: 220 },
    disableContentTransition = false,
    overlayTransitionDuration = 150,
    preventScroll = true,
    onOpenAutoFocus = () => {},
    children,
    testId = '',
  }: Props = $props()
</script>

<Dialog.Root
  {open}
  onOpenChange={(nextOpen) => {
    if (!nextOpen) onClose()
  }}
>
  <Dialog.Portal>
    <Dialog.Overlay forceMount>
      {#snippet child({ props, open: dialogOpen })}
        {#if dialogOpen}
          <div
            {...props}
            class={overlayClass}
            transition:fade={{ duration: overlayTransitionDuration }}
            data-testid={testId ? `${testId}-overlay` : undefined}
          ></div>
        {/if}
      {/snippet}
    </Dialog.Overlay>

    <Dialog.Content forceMount {preventScroll} {onOpenAutoFocus}>
      {#snippet child({ props, open: dialogOpen })}
        {#if dialogOpen}
          {#if disableContentTransition}
            <div
              {...props}
              class={panelClass}
              data-testid={testId ? `${testId}-content` : undefined}
            >
              <Dialog.Title class="sr-only">{title}</Dialog.Title>
              {@render children?.()}
            </div>
          {:else}
            <div
              {...props}
              class={panelClass}
              transition:fly={contentTransition}
              data-testid={testId ? `${testId}-content` : undefined}
            >
              <Dialog.Title class="sr-only">{title}</Dialog.Title>
              {@render children?.()}
            </div>
          {/if}
        {/if}
      {/snippet}
    </Dialog.Content>
  </Dialog.Portal>
</Dialog.Root>
