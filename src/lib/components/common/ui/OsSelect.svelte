<script lang="ts">
  import { Select } from 'bits-ui'

  import type { OsSelectOption } from '$lib/components/common/ui/types'

  type Props = {
    options: OsSelectOption[]
    value: string
    onValueChange?: (value: string) => void
    iconClass?: string
    triggerClass?: string
    contentClass?: string
    itemClass?: string
    placeholder?: string
    ariaLabel?: string
    testId?: string
    align?: 'start' | 'center' | 'end'
    sideOffset?: number
    disabled?: boolean
    frameless?: boolean
    large?: boolean
  }

  let {
    options,
    value,
    onValueChange = () => {},
    iconClass = '',
    triggerClass = '',
    contentClass = '',
    itemClass = '',
    placeholder = 'Select an option',
    ariaLabel = 'Select option',
    testId = '',
    align = 'end',
    sideOffset = 6,
    disabled = false,
    frameless = false,
    large = false,
  }: Props = $props()

  // Covers the synthesized click mobile browsers may emit after touchend once the menu is gone.
  const POST_TOUCH_CLICK_SHIELD_MS = 450

  let open = $state(false)
  let touchOpened = $state(false)
  let postTouchShieldVisible = $state(false)
  let postTouchShieldTimeout: number | null = null

  const iconMode = $derived(iconClass.length > 0)
  const selectedOption = $derived(options.find((option) => option.value === value))
  const selectedLabel = $derived(selectedOption?.label || placeholder)
  const triggerBaseClass = $derived(
    iconMode
      ? 'flex items-center justify-center rounded-lg border border-os-border bg-os-dark text-os-text transition cursor-pointer focus:border-os-orange/50 focus:outline-none hover:text-white hover:bg-os-hover'
      : frameless
        ? 'relative appearance-none h-8 bg-transparent pl-2.5 pr-7 text-left text-xs text-os-text-light cursor-pointer focus:outline-none data-[placeholder]:text-os-text transition'
        : large
          ? 'relative appearance-none h-10 bg-os-dark border border-os-border rounded-lg pl-3 pr-8 text-left text-sm text-os-text-light cursor-pointer hover:border-os-hover focus:border-os-orange/50 focus:outline-none data-[placeholder]:text-os-text transition'
          : 'relative appearance-none h-8 bg-os-dark border border-os-border rounded-lg pl-2.5 pr-7 text-left text-xs text-os-text-light cursor-pointer hover:border-os-hover focus:border-os-orange/50 focus:outline-none data-[placeholder]:text-os-text transition',
  )
  const touchShieldVisible = $derived((open && touchOpened) || postTouchShieldVisible)

  function clearPostTouchShieldTimeout(): void {
    if (postTouchShieldTimeout !== null) {
      window.clearTimeout(postTouchShieldTimeout)
      postTouchShieldTimeout = null
    }
  }

  function clearPostTouchShield(): void {
    clearPostTouchShieldTimeout()
    postTouchShieldVisible = false
  }

  function armPostTouchShield(): void {
    clearPostTouchShieldTimeout()
    postTouchShieldVisible = true
    postTouchShieldTimeout = window.setTimeout(() => {
      postTouchShieldVisible = false
      postTouchShieldTimeout = null
    }, POST_TOUCH_CLICK_SHIELD_MS)
  }

  function handleTriggerPointerDown(event: PointerEvent): void {
    if (event.pointerType !== 'touch') touchOpened = false
  }

  function handleTriggerPointerUp(event: PointerEvent): void {
    touchOpened = event.pointerType === 'touch'
  }

  function handleItemPointerUp(event: PointerEvent): void {
    if (event.pointerType === 'touch') armPostTouchShield()
  }

  function handleShieldEvent(event: Event): void {
    if (open) return
    event.preventDefault()
    event.stopPropagation()
    clearPostTouchShield()
  }

  $effect(() => {
    if (!open) touchOpened = false
  })

  $effect(() => {
    return () => {
      clearPostTouchShieldTimeout()
    }
  })
</script>

<Select.Root type="single" {value} {onValueChange} items={options} {disabled} bind:open>
  <Select.Trigger
    class="{triggerBaseClass} {triggerClass}"
    aria-label={ariaLabel}
    data-testid={testId ? `${testId}-trigger` : undefined}
    onpointerdown={handleTriggerPointerDown}
    onpointerup={handleTriggerPointerUp}
  >
    {#if iconMode}
      <i class={iconClass}></i>
    {:else}
      <span class="flex min-w-0 items-center gap-2">
        <span class="truncate">{selectedLabel}</span>
      </span>
      <i
        class="fa-solid fa-chevron-down absolute right-2 top-1/2 -translate-y-1/2 text-os-text text-[10px] pointer-events-none"
      ></i>
    {/if}
  </Select.Trigger>

  <Select.Portal>
    {#if touchShieldVisible}
      <div
        class="fixed inset-0 z-[69] bg-transparent"
        aria-hidden="true"
        onpointerdown={handleShieldEvent}
        onpointerup={handleShieldEvent}
        onclick={handleShieldEvent}
      ></div>
    {/if}
    <Select.Content
      {align}
      {sideOffset}
      class="z-[70] min-w-[var(--bits-floating-anchor-width)] max-w-[calc(100vw-2rem)] rounded-lg border border-os-border bg-os-card p-1 shadow-[0_12px_32px_rgba(0,0,0,0.48)] {contentClass}"
      data-testid={testId ? `${testId}-content` : undefined}
    >
      <Select.Viewport class="max-h-64 overflow-auto">
        {#each options as option (option.value)}
          <Select.Item
            value={option.value}
            label={option.label}
            disabled={option.disabled ?? false}
            class="w-full flex cursor-pointer items-center justify-between gap-2 rounded-md {large
              ? 'px-3 py-2 text-[13px]'
              : 'px-2.5 py-1.5 text-xs'} text-os-text-light outline-none transition-colors data-highlighted:bg-os-hover/40 data-[selected=true]:bg-os-hover/25 data-disabled:cursor-default data-disabled:opacity-40 data-disabled:pointer-events-none {itemClass}"
            data-testid={testId ? `${testId}-item-${option.value}` : undefined}
            onpointerup={handleItemPointerUp}
          >
            {#snippet children({ selected })}
              <span class="flex-1 min-w-0 flex flex-col gap-px">
                <span class="truncate">{option.label}</span>
                {#if option.description}
                  <span class="truncate text-[11px] text-os-text">{option.description}</span>
                {/if}
              </span>
              {#if selected}
                <i class="fa-solid fa-check text-os-orange text-[10px]"></i>
              {/if}
            {/snippet}
          </Select.Item>
        {/each}
      </Select.Viewport>
    </Select.Content>
  </Select.Portal>
</Select.Root>
