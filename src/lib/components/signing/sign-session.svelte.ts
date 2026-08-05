import { base64 } from '@scure/base'
import { errorMessage } from '$lib/utils/error-message'
import { bytesToHex } from '@noble/hashes/utils.js'
import type * as btc from '@scure/btc-signer'

import { currentElectrsClient, currentOrdClient } from '$lib/data/clients'
import { getInscriptionsAtOutpoint } from '$lib/data/inscription-lookup'
import { getPrevTxHex } from '$lib/clients/prevtx-cache'
import type { CosignerConfig, WalletConfig } from '$lib/engine/config/schema'
import { analyzePsbt, type PsbtAnalysis } from '$lib/engine/psbt/analyze'
import { finalizeIfReady, type FinalizedArtifacts } from '$lib/engine/psbt/finalize'
import { parsePsbt } from '$lib/engine/psbt/parse'
import {
  collectSignatures,
  finalizeInputs,
  mergeSignature,
  mergeWalletSignedInputs,
  quorumStatus,
  verifySignatureForInput,
} from '$lib/engine/psbt/signatures'
import { childPubkeyHex } from '$lib/engine/derivation/braid'
import type { WalletAddresses } from '$lib/engine/types'
import type { DeviceKind } from '$lib/devices/kinds'
import { type DeviceInputContext, signPsbtWithDevice } from '$lib/devices/sign'
import {
  serializeWitnessStack,
  signMixedWithTrezor,
  type TrezorMixedInput,
} from '$lib/devices/trezor-direct'
import { scriptHexToAddress } from '$lib/engine/address'
import { type ConnectedFeeWallet, signWithFeeWallet } from '$lib/wallets/providers'

export type CosignerRowState = {
  cosigner: CosignerConfig
  device: DeviceKind | null
  status: 'pending' | 'busy' | 'signed' | 'error' | 'skipped'
  messages: string[]
  error: string
  addedSignatures: number
}

export class SignSession {
  addresses: WalletAddresses
  walletConfig: WalletConfig

  workingTransaction = $state<btc.Transaction | null>(null)
  workingBase64 = $state('')
  analysis = $state<PsbtAnalysis | null>(null)
  analysisError = $state('')
  analyzing = $state(false)

  rows = $state<CosignerRowState[]>([])
  artifacts = $state<FinalizedArtifacts | null>(null)

  feeWalletStep = $state<{
    wallet: ConnectedFeeWallet
    inputIndexes: number[]
    status: 'pending' | 'busy' | 'signed' | 'error'
    error: string
  } | null>(null)

  constructor(walletConfig: WalletConfig, addresses: WalletAddresses) {
    this.walletConfig = walletConfig
    this.addresses = addresses
    this.rows = walletConfig.extendedPublicKeys.map((cosigner) => ({
      cosigner,
      device:
        cosigner.method === 'trezor' ? 'TREZOR' : cosigner.method === 'ledger' ? 'LEDGER' : null,
      status: 'pending',
      messages: [],
      error: '',
      addedSignatures: 0,
    }))
  }

  get requiredSigners(): number {
    return this.walletConfig.quorum.requiredSigners
  }

  get signedCount(): number {
    return this.rows.filter((row) => row.status === 'signed').length
  }

  get quorumMet(): boolean {
    const transaction = this.workingTransaction
    if (!transaction) return false
    return quorumStatus(transaction, this.addresses).met
  }

  get trezorEligible(): boolean {
    return this.analysis?.trezorEligible ?? false
  }

  async loadPsbt(raw: string | Uint8Array): Promise<void> {
    this.analysisError = ''
    this.analysis = null
    this.artifacts = null
    this.analyzing = true

    try {
      const parsed = parsePsbt(raw)
      this.workingTransaction = parsed.transaction

      const ord = currentOrdClient()
      const electrs = currentElectrsClient()

      this.analysis = await analyzePsbt(parsed.transaction, this.addresses, {
        getPrevTxHex: (txid) => getPrevTxHex(electrs, txid),
        getInscriptionsAtOutpoint: (txid, vout, valueSats) =>
          getInscriptionsAtOutpoint(ord, txid, vout, valueSats),
      })

      this.workingBase64 = base64.encode(parsed.transaction.toPSBT(0))
      this.refreshRowsFromTransaction()
    } catch (error) {
      this.workingTransaction = null
      this.workingBase64 = ''
      this.analysisError = errorMessage(error)
    } finally {
      this.analyzing = false
    }
  }

  private deviceInputContexts(): DeviceInputContext[] {
    const analysis = this.analysis
    if (!analysis) return []

    return analysis.inputs
      .filter((input) => input.class.kind === 'ours')
      .map((input) => ({
        inputIndex: input.inputIndex,
        branch: input.class.kind === 'ours' ? input.class.branch : 0,
        valueSats: input.valueSats ?? 0,
      }))
  }

  private expectedPubkey(cosigner: CosignerConfig, branch: 0 | 1): string {
    const info = branch === 0 ? this.addresses.inscriptions : this.addresses.payments
    const derived = childPubkeyHex(
      cosigner.xpub,
      branch,
      this.walletConfig.startingAddressIndex,
    ).toLowerCase()
    const matches = info.bip32Derivation.filter(
      (candidate) =>
        candidate.xfp.toLowerCase() === cosigner.xfp.toLowerCase() &&
        candidate.pubkeyHex.toLowerCase() === derived,
    )
    if (matches.length !== 1) {
      throw new Error(`vault branch ${branch} does not identify the selected cosigner exactly once`)
    }
    return derived
  }

  private coveredInputIndexes(cosigner: CosignerConfig): Set<number> {
    const transaction = this.workingTransaction
    const analysis = this.analysis
    if (!transaction || !analysis) return new Set()

    const candidates = collectSignatures(transaction)
    const expectedInputs = analysis.inputs.filter((input) => input.class.kind === 'ours')
    const coveredInputs = new Set<number>()

    for (const input of expectedInputs) {
      if (input.class.kind !== 'ours') continue
      const expectedPubkey = this.expectedPubkey(cosigner, input.class.branch)
      const covered = candidates.some((candidate) => {
        if (candidate.inputIndex !== input.inputIndex) return false
        return (
          verifySignatureForInput({
            psbtBase64: this.workingBase64,
            inputIndex: candidate.inputIndex,
            signatureHex: candidate.signatureHex,
            inputValueSats: input.valueSats ?? 0,
          })?.toLowerCase() === expectedPubkey
        )
      })
      if (covered) coveredInputs.add(input.inputIndex)
    }

    return coveredInputs
  }

  private signatureCoverage(cosigner: CosignerConfig): { complete: boolean; count: number } {
    const expectedCount =
      this.analysis?.inputs.filter((input) => input.class.kind === 'ours').length ?? 0
    const count = this.coveredInputIndexes(cosigner).size
    return { complete: expectedCount > 0 && count === expectedCount, count }
  }

  private refreshRowsFromTransaction(): void {
    for (const row of this.rows) {
      if (row.status === 'busy') continue
      const coverage = this.signatureCoverage(row.cosigner)
      row.status = coverage.complete ? 'signed' : 'pending'
      row.error = ''
      row.addedSignatures = coverage.count
    }
  }

  canSignWith(row: CosignerRowState): { allowed: boolean; reason: string } {
    if (!this.workingTransaction || !this.analysis)
      return { allowed: false, reason: 'No PSBT loaded' }
    if (this.analysis.warnings.some((warning) => warning.severity === 'danger')) {
      return { allowed: false, reason: 'Transaction has a danger warning' }
    }
    if (this.quorumMet) return { allowed: false, reason: 'Quorum already met' }
    if (row.status === 'signed') return { allowed: false, reason: 'Already signed' }
    if (this.rows.some((other) => other.status === 'busy')) {
      return { allowed: false, reason: 'Another device is busy' }
    }
    if (row.device === null) {
      return { allowed: false, reason: 'Signs outside Saffron' }
    }
    if (
      row.device === 'TREZOR' &&
      !this.trezorEligible &&
      this.feeWalletStep !== null &&
      this.feeWalletStep.status !== 'signed'
    ) {
      return { allowed: false, reason: 'Sign the fee with the hot wallet first' }
    }
    return { allowed: true, reason: '' }
  }

  attachFeeWallet(wallet: ConnectedFeeWallet, inputIndexes: number[]): void {
    this.feeWalletStep = { wallet, inputIndexes, status: 'pending', error: '' }
  }

  async signWithConnectedWallet(): Promise<void> {
    const step = this.feeWalletStep
    const transaction = this.workingTransaction
    const analysis = this.analysis
    if (!step || !transaction || !analysis || step.status === 'busy' || step.status === 'signed') {
      return
    }
    if (analysis.warnings.some((warning) => warning.severity === 'danger')) {
      step.status = 'error'
      step.error = 'Transaction has a danger warning'
      return
    }

    step.status = 'busy'
    step.error = ''

    try {
      const signedBase64 = await signWithFeeWallet(
        step.wallet,
        this.workingBase64,
        step.inputIndexes,
      )
      mergeWalletSignedInputs(transaction, signedBase64, step.inputIndexes)
      finalizeInputs(transaction, step.inputIndexes)
      step.status = 'signed'
      this.finalizeIfQuorum(transaction)
    } catch (error) {
      step.status = 'error'
      step.error = errorMessage(error)
    }
  }

  async signWith(rowIndex: number): Promise<void> {
    const row = this.rows[rowIndex]
    const transaction = this.workingTransaction
    if (!row || !transaction) return

    const { allowed } = this.canSignWith(row)
    if (!allowed || row.device === null) return

    row.status = 'busy'
    row.error = ''
    row.messages = []

    try {
      if (row.device === 'TREZOR') {
        await this.signMixedTrezor(rowIndex)
        return
      }

      const transactionForLedger = this.workingTransaction
      if (!transactionForLedger) throw new Error('no transaction loaded')

      const signatures = await signPsbtWithDevice({
        device: row.device,
        cosigner: row.cosigner,
        walletConfig: this.walletConfig,
        psbtV2Base64: base64.encode(transactionForLedger.toPSBT(2)),
        inputs: this.deviceInputContexts(),
        alreadyCoveredInputIndexes: [...this.coveredInputIndexes(row.cosigner)],
        onProgress: (progress) => {
          if (progress.state === 'awaitingDevice') row.messages = progress.messages
        },
      })

      const validatedSignatures: typeof signatures = []
      for (const signature of signatures) {
        const input = this.analysis?.inputs.find(
          (candidate) => candidate.inputIndex === signature.inputIndex,
        )
        if (!input || input.class.kind !== 'ours') {
          throw new Error(
            `the device returned a signature for unexpected input ${signature.inputIndex}`,
          )
        }

        const validatedPubkey = verifySignatureForInput({
          psbtBase64: this.workingBase64,
          inputIndex: signature.inputIndex,
          signatureHex: signature.signatureHex,
          inputValueSats: input.valueSats ?? 0,
        })

        if (
          validatedPubkey?.toLowerCase() !== this.expectedPubkey(row.cosigner, input.class.branch)
        ) {
          throw new Error(
            'the device produced a signature that does not belong to the selected cosigner',
          )
        }

        validatedSignatures.push({ ...signature, pubkeyHex: validatedPubkey })
      }

      let added = 0
      for (const signature of validatedSignatures) {
        if (
          mergeSignature(transaction, {
            inputIndex: signature.inputIndex,
            pubkeyHex: signature.pubkeyHex,
            signatureHex: signature.signatureHex,
          })
        ) {
          added += 1
        }
      }

      row.addedSignatures = added
      if (!this.signatureCoverage(row.cosigner).complete) {
        throw new Error('the selected cosigner did not sign every vault input')
      }
      row.status = 'signed'
      this.finalizeIfQuorum(transaction)
    } catch (error) {
      row.status = 'error'
      row.error = errorMessage(error)
    } finally {
      row.messages = []
    }
  }

  private finalizeIfQuorum(transaction: btc.Transaction): void {
    if (!this.quorumMet) return

    this.artifacts = finalizeIfReady(transaction, this.addresses)
    for (const other of this.rows) {
      if (other.status === 'pending') other.status = 'skipped'
    }
  }

  private async signMixedTrezor(rowIndex: number): Promise<void> {
    const row = this.rows[rowIndex]
    const transaction = this.workingTransaction
    const analysis = this.analysis
    if (!row || !transaction || !analysis) return

    try {
      const mixedInputs: TrezorMixedInput[] = analysis.inputs.map((input) => {
        if (input.class.kind === 'ours') {
          const vaultInfo =
            input.class.branch === 0 ? this.addresses.inscriptions : this.addresses.payments
          const rawInput = transaction.getInput(input.inputIndex)
          return {
            kind: 'vault' as const,
            txid: input.txid,
            vout: input.vout,
            valueSats: input.valueSats ?? 0,
            branch: input.class.branch,
            sequence: rawInput.sequence ?? 0xffffffff,
            vaultInfo,
          }
        }

        const rawInput = transaction.getInput(input.inputIndex)
        const finalScriptSig = rawInput.finalScriptSig?.length ? rawInput.finalScriptSig : null
        const finalScriptWitness = rawInput.finalScriptWitness?.length
          ? rawInput.finalScriptWitness
          : null
        if (!finalScriptSig && !finalScriptWitness) {
          throw new Error(
            'Sign the fee with the hot wallet first. The Trezor verifies external inputs by their finalized signatures.',
          )
        }

        return {
          kind: 'external' as const,
          txid: input.txid,
          vout: input.vout,
          valueSats: input.valueSats ?? 0,
          scriptPubkeyHex: input.spentScriptHex ?? '',
          sequence: rawInput.sequence ?? 0xffffffff,
          ...(finalScriptSig ? { scriptSigHex: bytesToHex(finalScriptSig) } : {}),
          ...(finalScriptWitness ? { witnessHex: serializeWitnessStack(finalScriptWitness) } : {}),
        }
      })

      const outputs = analysis.outputs.map((output) => ({
        address: scriptHexToAddress(output.scriptHex ?? ''),
        valueSats: output.valueSats,
      }))

      const signatures = await signMixedWithTrezor({
        cosigner: row.cosigner,
        inputs: mixedInputs,
        outputs,
        version: transaction.version,
        locktime: transaction.lockTime,
        onProgress: (progress) => {
          if (progress.state === 'awaitingDevice') row.messages = progress.messages
        },
      })

      const validatedSignatures: { inputIndex: number; pubkeyHex: string; signatureHex: string }[] =
        []
      for (const signature of signatures) {
        const input = analysis.inputs.find((entry) => entry.inputIndex === signature.inputIndex)
        if (!input || input.class.kind !== 'ours') {
          throw new Error(
            `the Trezor returned a signature for unexpected input ${signature.inputIndex}`,
          )
        }

        const validated = verifySignatureForInput({
          psbtBase64: this.workingBase64,
          inputIndex: signature.inputIndex,
          signatureHex: signature.signatureHex,
          inputValueSats: input.valueSats ?? 0,
        })
        if (validated?.toLowerCase() !== this.expectedPubkey(row.cosigner, input.class.branch)) {
          throw new Error(
            'The Trezor signature does not belong to the selected cosigner. If the device uses a passphrase, unlock the same passphrase that was active when the vault was created, then retry.',
          )
        }

        validatedSignatures.push({
          inputIndex: signature.inputIndex,
          pubkeyHex: validated,
          signatureHex: signature.signatureHex,
        })
      }

      let added = 0
      for (const signature of validatedSignatures) {
        if (
          mergeSignature(transaction, {
            inputIndex: signature.inputIndex,
            pubkeyHex: signature.pubkeyHex,
            signatureHex: signature.signatureHex,
          })
        ) {
          added += 1
        }
      }

      row.addedSignatures = added
      if (!this.signatureCoverage(row.cosigner).complete) {
        throw new Error('the selected cosigner did not sign every vault input')
      }
      row.status = 'signed'
      this.finalizeIfQuorum(transaction)
    } catch (error) {
      row.status = 'error'
      row.error = errorMessage(error)
    } finally {
      row.messages = []
    }
  }

  // For keys that live outside Saffron (pasted xpubs): merge a PSBT signed
  // elsewhere. Every signature is cryptographically verified against our own
  // digest before it is accepted, and the transaction must be byte-identical.
  importSignedPsbt(raw: string | Uint8Array): number {
    const transaction = this.workingTransaction
    const analysis = this.analysis
    if (!transaction || !analysis) throw new Error('No PSBT loaded')
    if (analysis.warnings.some((warning) => warning.severity === 'danger')) {
      throw new Error('Transaction has a danger warning')
    }
    if (this.quorumMet) throw new Error('Quorum already met')

    const imported = parsePsbt(raw)
    if (bytesToHex(imported.transaction.unsignedTx) !== bytesToHex(transaction.unsignedTx)) {
      throw new Error('That PSBT is for a different transaction.')
    }

    const candidates = collectSignatures(imported.transaction)
    if (candidates.length === 0) throw new Error('That PSBT carries no signatures.')

    let added = 0
    for (const candidate of candidates) {
      const input = analysis.inputs.find((entry) => entry.inputIndex === candidate.inputIndex)
      if (!input || input.class.kind !== 'ours') continue

      const validated = verifySignatureForInput({
        psbtBase64: this.workingBase64,
        inputIndex: candidate.inputIndex,
        signatureHex: candidate.signatureHex,
        inputValueSats: input.valueSats ?? 0,
      })
      if (validated === null) continue

      if (
        mergeSignature(transaction, {
          inputIndex: candidate.inputIndex,
          pubkeyHex: validated,
          signatureHex: candidate.signatureHex,
        })
      ) {
        added += 1
      }
    }

    if (added === 0) {
      throw new Error('No new signatures from this vault in that PSBT.')
    }

    this.refreshRowsFromTransaction()

    this.finalizeIfQuorum(transaction)
    return added
  }

  retry(rowIndex: number): void {
    const row = this.rows[rowIndex]
    if (!row || row.status !== 'error') return

    row.status = 'pending'
    row.error = ''
  }

  partialPsbtBase64(): string {
    const transaction = this.workingTransaction
    if (!transaction) return ''

    return base64.encode(transaction.toPSBT(0))
  }
}
