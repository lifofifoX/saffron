import { writable } from 'svelte/store'

type ToastType = 'success' | 'error' | 'info'
type Toast = {
  id: number
  message: string
  type: ToastType
}

export const toasts = writable<Toast[]>([])
let toastId = 0

export function addToast(message: string, type: ToastType = 'success'): void {
  const id = ++toastId
  toasts.update((items) => [...items, { id, message, type }])

  setTimeout(() => {
    toasts.update((items) => items.filter((toast) => toast.id !== id))
  }, 3000)
}
