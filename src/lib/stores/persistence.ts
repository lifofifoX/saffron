import { type Writable, writable } from 'svelte/store'
import type { z } from 'zod'

import { browser } from '$app/environment'

function parseSerializedValue(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

export function readLocalStorageValue(key: string): unknown {
  if (!browser) return undefined

  const stored = localStorage.getItem(key)
  if (stored === null) return undefined

  return parseSerializedValue(stored)
}

export function readPersistedValue<T>(key: string, fallback: T, schema: z.ZodType<T>): T {
  const value = readLocalStorageValue(key)
  if (value === undefined) return fallback

  const parsed = schema.safeParse(value)
  return parsed.success ? parsed.data : fallback
}

export function writePersistedValue<T>(key: string, value: T): void {
  if (!browser) return

  localStorage.setItem(key, JSON.stringify(value))
}

export function persistedStore<T>(key: string, defaultValue: T, schema: z.ZodType<T>): Writable<T> {
  const store = writable<T>(readPersistedValue(key, defaultValue, schema))

  if (browser) {
    store.subscribe((value) => {
      writePersistedValue(key, value)
    })
  }

  return store
}
