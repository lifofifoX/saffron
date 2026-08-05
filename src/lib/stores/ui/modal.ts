import { derived, writable } from 'svelte/store'

export type ConfirmModalData = {
  title?: string
  message?: string
  confirmLabel?: string
  destructive?: boolean
  onConfirm?: () => void
  onCancel?: () => void
}

export type TransferModalData = {
  inscriptionIds: string[]
}

export type ModalDataByName = {
  confirm: ConfirmModalData
  transfer: TransferModalData
}

export type ModalName = keyof ModalDataByName

type ActiveModalState = { name: ModalName; data: ModalDataByName[ModalName] } | null

const activeModalState = writable<ActiveModalState>(null)

export const activeModal = derived(activeModalState, (state) => state?.name ?? null)
export const modalData = derived(activeModalState, (state) => state?.data ?? null)

export function openModal<TName extends ModalName>(
  name: TName,
  data: ModalDataByName[TName],
): void {
  activeModalState.set({ name, data })
}

export function closeModal(): void {
  activeModalState.set(null)
}
