import { get } from 'svelte/store'

import { ElectrsClient } from '$lib/clients/electrs'
import { OrdClient } from '$lib/clients/ord'
import { endpoints } from '$lib/config'

let ordClient: OrdClient | null = null
let ordClientBaseUrl = ''
let electrsClient: ElectrsClient | null = null
let electrsClientBaseUrl = ''

export function currentOrdClient(): OrdClient {
  const { ordBaseUrl } = get(endpoints)
  if (!ordClient || ordClientBaseUrl !== ordBaseUrl) {
    ordClient = new OrdClient(ordBaseUrl)
    ordClientBaseUrl = ordBaseUrl
  }

  return ordClient
}

export function currentElectrsClient(): ElectrsClient {
  const { electrsBaseUrl } = get(endpoints)
  if (!electrsClient || electrsClientBaseUrl !== electrsBaseUrl) {
    electrsClient = new ElectrsClient(electrsBaseUrl)
    electrsClientBaseUrl = electrsBaseUrl
  }

  return electrsClient
}
