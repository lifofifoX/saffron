import type { Component } from 'svelte'

import type { ModalName } from '$lib/stores/ui/modal'

export type ModalLoader = () => Promise<{ default: Component }>

export function createModalRegistry<Name extends string>(loaders: Record<Name, ModalLoader>) {
  const loadedComponents = new Map<Name, Component>()
  const pendingLoads = new Map<Name, Promise<Component>>()

  function getLoaded(name: Name): Component | null {
    return loadedComponents.get(name) ?? null
  }

  function load(name: Name): Promise<Component> {
    const cachedComponent = getLoaded(name)
    if (cachedComponent) return Promise.resolve(cachedComponent)

    const pendingLoad = pendingLoads.get(name)
    if (pendingLoad) return pendingLoad

    const loadPromise = loaders[name]()
      .then((module) => {
        loadedComponents.set(name, module.default)
        return module.default
      })
      .finally(() => {
        pendingLoads.delete(name)
      })

    pendingLoads.set(name, loadPromise)
    return loadPromise
  }

  function preload(name: Name): Promise<void> {
    return load(name).then(() => undefined)
  }

  return {
    getLoaded,
    load,
    preload,
  }
}

const modalLoaders: Record<ModalName, ModalLoader> = {
  confirm: () => import('./ConfirmModal.svelte'),
  transfer: () => import('./TransferDrawer.svelte'),
}

export const modalRegistry = createModalRegistry(modalLoaders)
export const getLoadedModalComponent = modalRegistry.getLoaded
export const loadModalComponent = modalRegistry.load
export const preloadModalComponent = modalRegistry.preload
