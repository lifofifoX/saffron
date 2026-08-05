// Shared clipboard-with-checkmark state: one instance per component, keys
// distinguish multiple copy targets.
export class CopyFeedback {
  copiedKey = $state<string | null>(null)

  #timer: ReturnType<typeof setTimeout> | null = null

  async copy(key: string, value: string): Promise<void> {
    await navigator.clipboard.writeText(value)

    this.copiedKey = key
    if (this.#timer) clearTimeout(this.#timer)
    this.#timer = setTimeout(() => {
      this.copiedKey = null
    }, 1500)
  }

  copied(key: string): boolean {
    return this.copiedKey === key
  }
}
