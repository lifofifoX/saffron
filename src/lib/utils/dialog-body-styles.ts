const DIALOG_BODY_STYLE_PROPERTIES = [
  'overflow',
  'pointer-events',
  'padding-right',
  'margin-right',
  '--scrollbar-width',
] as const

export function restoreDialogBodyStylesIfIdle(): void {
  if (typeof document === 'undefined') return
  if (document.querySelector('[role="dialog"]')) return

  const { body } = document
  if (!body) return

  for (const property of DIALOG_BODY_STYLE_PROPERTIES) {
    body.style.removeProperty(property)
  }
}

export function scheduleDialogBodyStyleRestore(): void {
  if (typeof document === 'undefined') return

  const restore = () => restoreDialogBodyStylesIfIdle()
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(restore)
    return
  }

  setTimeout(restore, 0)
}
