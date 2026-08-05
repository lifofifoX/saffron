import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import * as btc from '@scure/btc-signer'
import { pubECDSA } from '@scure/btc-signer/utils.js'
import { describe, expect, it, vi } from 'vitest'

import { deriveWalletAddresses } from '$lib/engine/derivation/braid'
import {
  FIXTURE_KEY_ORIGIN_PATH,
  fixtureCosigners,
  fixtureWalletConfig,
} from '$lib/engine/testing/fixtures'
import { decodeRawTx } from '$lib/engine/testing/decode'
import { buildFundingTx } from '$lib/engine/testing/funding'
import { planSimpleTransfer } from '$lib/engine/transfer/simple'
import { simpleTransferToPsbt } from '$lib/engine/transfer/simple-to-psbt'

import { branchForScriptHex, classifyInputs, classifyOutputs } from './classify'
import { analyzePsbt } from './analyze'
import { enrichPsbt } from './enrich'
import { finalizeIfReady } from './finalize'
import { multisigInputFields } from './input-fields'
import { LIBERAL_PSBT_OPTIONS, parsePsbt } from './parse'
import { INPUT_LIMITS } from '$lib/security/input-limits'
import { traceSatFlow } from './satflow'
import {
  collectSignatures,
  mergeSignature,
  quorumStatus,
  verifySignatureForInput,
} from './signatures'

const RECIPIENT_TR = bytesToHex(
  btc.OutScript.encode({
    type: 'tr',
    pubkey: hexToBytes('79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798'),
  }),
)

const config = fixtureWalletConfig(2, 3)
const cosigners = fixtureCosigners(3)
const addresses = deriveWalletAddresses(config)

const walletPrivateKey = sha256(new TextEncoder().encode('saffron-fixture-fee-wallet'))
const walletPublicKey = pubECDSA(walletPrivateKey)
const walletPayment = btc.p2wpkh(walletPublicKey)
const walletScriptHex = bytesToHex(walletPayment.script)

const vaultFunding = buildFundingTx([
  { valueSats: 9_999, scriptHex: addresses.inscriptions.scriptPubkeyHex },
  { valueSats: 546, scriptHex: addresses.inscriptions.scriptPubkeyHex },
])
const walletFunding = buildFundingTx([{ valueSats: 60_000, scriptHex: walletScriptHex }])

const plan = planSimpleTransfer({
  items: [
    {
      outpoint: { txid: vaultFunding.txid, vout: 0 },
      valueSats: 9_999,
      inscriptionIds: ['insc-a'],
      recipientScriptHex: RECIPIENT_TR,
    },
    {
      outpoint: { txid: vaultFunding.txid, vout: 1 },
      valueSats: 546,
      inscriptionIds: ['insc-b'],
      recipientScriptHex: RECIPIENT_TR,
    },
  ],
  quorum: config.quorum,
  inscriptionsScriptHex: addresses.inscriptions.scriptPubkeyHex,
  feeWallet: {
    kind: 'p2wpkh',
    cardinalUtxos: [{ outpoint: { txid: walletFunding.txid, vout: 0 }, valueSats: 60_000 }],
    changeScriptHex: walletScriptHex,
  },
  feeRateSatVb: 8,
})

function buildWorkingPsbt(): string {
  return simpleTransferToPsbt(plan, {
    addresses,
    feeWallet: {
      kind: 'p2wpkh',
      address: walletPayment.address ?? '',
      publicKeyHex: bytesToHex(walletPublicKey),
    },
    prevTxHexByTxid: { [vaultFunding.txid]: vaultFunding.hex },
  }).psbtBase64
}

function signVaultQuorum(transaction: btc.Transaction): void {
  for (const cosigner of cosigners.slice(0, 2)) {
    const child = cosigner.master.derive(`${FIXTURE_KEY_ORIGIN_PATH}/0/0`)
    if (!child.privateKey) throw new Error('missing key')
    transaction.signIdx(child.privateKey, 0)
    transaction.signIdx(child.privateKey, 1)
  }
}

describe('parsePsbt', () => {
  it('accepts base64, hex, and binary forms', () => {
    const base64 = buildWorkingPsbt()
    const bytes = Uint8Array.from(Buffer.from(base64, 'base64'))
    const hex = bytesToHex(bytes)

    for (const form of [base64, hex, bytes]) {
      const parsed = parsePsbt(form)
      expect(parsed.transaction.inputsLength).toBe(3)
    }
  })

  it('rejects garbage input', () => {
    expect(() => parsePsbt('not a psbt')).toThrow()
    expect(() => parsePsbt('deadbeef')).toThrow()
  })

  it('rejects decoded PSBT bytes above the product limit before parsing', () => {
    expect(() => parsePsbt(new Uint8Array(INPUT_LIMITS.psbtDecodedBytes + 1))).toThrow(/too large/)
  })
})

describe('classify + enrich', () => {
  it('classifies vault inputs as ours and wallet pieces as external', () => {
    const { transaction } = parsePsbt(buildWorkingPsbt())

    const inputs = classifyInputs(transaction, addresses)
    expect(inputs[0]?.class).toEqual({ kind: 'ours', branch: 0 })
    expect(inputs[1]?.class).toEqual({ kind: 'ours', branch: 0 })
    expect(inputs[2]?.class).toEqual({ kind: 'external' })

    const outputs = classifyOutputs(transaction, addresses)
    expect(outputs.every((output) => output.class.kind === 'external')).toBe(true)

    expect(branchForScriptHex(addresses.inscriptions.scriptPubkeyHex, addresses)).toEqual({
      kind: 'ours',
      branch: 0,
    })
  })

  it('rebuilds Trezor eligibility on a stripped vault-only PSBT', async () => {
    const stripped = new btc.Transaction(LIBERAL_PSBT_OPTIONS)
    for (const vout of [0, 1]) {
      stripped.addInput({
        txid: vaultFunding.txid,
        index: vout,
        sequence: 0xfffffffd,
        witnessUtxo: {
          script: hexToBytes(addresses.inscriptions.scriptPubkeyHex),
          amount: vout === 0 ? 9_999n : 546n,
        },
      })
    }
    stripped.addOutput({ script: hexToBytes(RECIPIENT_TR), amount: 9_000n })

    const before = classifyInputs(stripped, addresses)
    expect(before.every((input) => !input.hasNonWitnessUtxo && !input.hasBip32Derivation)).toBe(
      true,
    )

    const report = await enrichPsbt(stripped, addresses, {
      getPrevTxHex: (txid) => {
        if (txid !== vaultFunding.txid) throw new Error(`no prevtx for ${txid}`)
        return Promise.resolve(vaultFunding.hex)
      },
    })

    expect(report.trezorEligible).toBe(true)

    const after = classifyInputs(stripped, addresses)
    expect(
      after.every(
        (input) => input.hasNonWitnessUtxo && input.hasBip32Derivation && input.hasWitnessScript,
      ),
    ).toBe(true)
  })

  it('marks PSBTs with external inputs as Trezor-ineligible', async () => {
    const { transaction } = parsePsbt(buildWorkingPsbt())

    const report = await enrichPsbt(transaction, addresses, {
      getPrevTxHex: (txid) => {
        if (txid === vaultFunding.txid) return Promise.resolve(vaultFunding.hex)
        if (txid === walletFunding.txid) return Promise.resolve(walletFunding.hex)
        throw new Error(`no prevtx for ${txid}`)
      },
    })

    expect(report.trezorEligible).toBe(false)
  })
})

describe('verified prevouts', () => {
  it('uses a txid-verified embedded nonWitnessUtxo without fetching it', async () => {
    const selfContained = new btc.Transaction(LIBERAL_PSBT_OPTIONS)
    selfContained.addInput({
      txid: vaultFunding.txid,
      index: 0,
      sequence: 0xfffffffd,
      nonWitnessUtxo: hexToBytes(vaultFunding.hex),
    })
    selfContained.addOutput({ script: hexToBytes(RECIPIENT_TR), amount: 9_000n })
    const getPrevTxHex = vi.fn(() => Promise.reject(new Error('must not fetch')))

    await expect(enrichPsbt(selfContained, addresses, { getPrevTxHex })).resolves.toMatchObject({})
    expect(getPrevTxHex).not.toHaveBeenCalled()
  })

  it('rejects an embedded nonWitnessUtxo that does not match the input txid', async () => {
    const mismatched = new btc.Transaction(LIBERAL_PSBT_OPTIONS)
    mismatched.addInput({
      txid: vaultFunding.txid,
      index: 0,
      sequence: 0xfffffffd,
      nonWitnessUtxo: hexToBytes(walletFunding.hex),
    })
    mismatched.addOutput({ script: hexToBytes(RECIPIENT_TR), amount: 9_000n })

    await expect(
      enrichPsbt(mismatched, addresses, {
        getPrevTxHex: () => Promise.reject(new Error('must not fetch')),
      }),
    ).rejects.toThrow(`nonWitnessUtxo does not hash to ${vaultFunding.txid}`)
  })

  it('rejects a supplied witnessScript that does not match the vault', async () => {
    const forged = new btc.Transaction(LIBERAL_PSBT_OPTIONS)
    const canonical = multisigInputFields(addresses.inscriptions)
    forged.addInput({
      txid: vaultFunding.txid,
      index: 0,
      sequence: 0xfffffffd,
      nonWitnessUtxo: hexToBytes(vaultFunding.hex),
      witnessScript: Uint8Array.of(0x51),
      bip32Derivation: canonical.bip32Derivation,
    })
    forged.addOutput({ script: hexToBytes(RECIPIENT_TR), amount: 9_000n })

    await expect(
      enrichPsbt(forged, addresses, {
        getPrevTxHex: () => Promise.reject(new Error('must not fetch')),
      }),
    ).rejects.toThrow('could not safely enrich vault input 0')
  })

  it('rejects a supplied bip32Derivation that does not match the vault', async () => {
    const forged = new btc.Transaction(LIBERAL_PSBT_OPTIONS)
    const canonical = multisigInputFields(addresses.inscriptions)
    forged.addInput({
      txid: vaultFunding.txid,
      index: 0,
      sequence: 0xfffffffd,
      nonWitnessUtxo: hexToBytes(vaultFunding.hex),
      ...(canonical.witnessScript ? { witnessScript: canonical.witnessScript } : {}),
      bip32Derivation: [[walletPublicKey, { fingerprint: 0, path: [] }]],
    })
    forged.addOutput({ script: hexToBytes(RECIPIENT_TR), amount: 9_000n })

    await expect(
      enrichPsbt(forged, addresses, {
        getPrevTxHex: () => Promise.reject(new Error('must not fetch')),
      }),
    ).rejects.toThrow('could not safely enrich vault input 0')
  })

  it('fails closed when finalized external inputs forge balanced values to invert sat flow', async () => {
    const externalAPrivateKey = sha256(new TextEncoder().encode('external-a'))
    const externalBPrivateKey = sha256(new TextEncoder().encode('external-b'))
    const attackerPrivateKey = sha256(new TextEncoder().encode('attacker'))
    const externalA = btc.p2wpkh(pubECDSA(externalAPrivateKey))
    const externalB = btc.p2wpkh(pubECDSA(externalBPrivateKey))
    const attacker = btc.p2wpkh(pubECDSA(attackerPrivateKey))

    const externalAFunding = buildFundingTx([
      { valueSats: 1_000, scriptHex: bytesToHex(externalA.script) },
    ])
    const exploitVaultFunding = buildFundingTx([
      { valueSats: 1_000, scriptHex: addresses.inscriptions.scriptPubkeyHex },
    ])
    const externalBFunding = buildFundingTx([
      { valueSats: 100, scriptHex: bytesToHex(externalB.script) },
    ])

    const honest = new btc.Transaction({ version: 2 })
    honest.addInput({
      txid: externalAFunding.txid,
      index: 0,
      sequence: 0xfffffffd,
      witnessUtxo: { script: externalA.script, amount: 1_000n },
    })
    honest.addInput({
      txid: exploitVaultFunding.txid,
      index: 0,
      sequence: 0xfffffffd,
      witnessUtxo: {
        script: hexToBytes(addresses.inscriptions.scriptPubkeyHex),
        amount: 1_000n,
      },
    })
    honest.addInput({
      txid: externalBFunding.txid,
      index: 0,
      sequence: 0xfffffffd,
      witnessUtxo: { script: externalB.script, amount: 100n },
    })
    honest.addOutput({
      script: hexToBytes(addresses.inscriptions.scriptPubkeyHex),
      amount: 500n,
    })
    honest.addOutput({ script: attacker.script, amount: 1_500n })
    honest.signIdx(externalAPrivateKey, 0)
    honest.finalizeIdx(0)
    honest.signIdx(externalBPrivateKey, 2)
    honest.finalizeIdx(2)

    const forged = new btc.Transaction({ version: 2 })
    forged.addInput({
      txid: externalAFunding.txid,
      index: 0,
      sequence: 0xfffffffd,
      witnessUtxo: { script: externalA.script, amount: 100n },
    })
    forged.addInput({
      txid: exploitVaultFunding.txid,
      index: 0,
      sequence: 0xfffffffd,
      witnessUtxo: {
        script: hexToBytes(addresses.inscriptions.scriptPubkeyHex),
        amount: 1_000n,
      },
    })
    forged.addInput({
      txid: externalBFunding.txid,
      index: 0,
      sequence: 0xfffffffd,
      witnessUtxo: { script: externalB.script, amount: 1_000n },
    })
    forged.addOutput({
      script: hexToBytes(addresses.inscriptions.scriptPubkeyHex),
      amount: 500n,
    })
    forged.addOutput({ script: attacker.script, amount: 1_500n })
    const externalAWitness = honest.getInput(0).finalScriptWitness
    const externalBWitness = honest.getInput(2).finalScriptWitness
    if (!externalAWitness || !externalBWitness) throw new Error('external input did not finalize')
    forged.updateInput(0, { finalScriptWitness: externalAWitness }, true)
    forged.updateInput(2, { finalScriptWitness: externalBWitness }, true)

    const trackedSat = {
      label: 'victim-inscription',
      outpoint: { txid: exploitVaultFunding.txid, vout: 0 },
      offsetSats: 0,
    }
    const outputs = [
      { scriptHex: addresses.inscriptions.scriptPubkeyHex, valueSats: 500 },
      { scriptHex: bytesToHex(attacker.script), valueSats: 1_500 },
    ]
    expect(
      traceSatFlow(
        [
          { outpoint: { txid: externalAFunding.txid, vout: 0 }, valueSats: 100 },
          { outpoint: { txid: exploitVaultFunding.txid, vout: 0 }, valueSats: 1_000 },
          { outpoint: { txid: externalBFunding.txid, vout: 0 }, valueSats: 1_000 },
        ],
        outputs,
        [trackedSat],
      )[0]?.outputIndex,
    ).toBe(0)
    expect(
      traceSatFlow(
        [
          { outpoint: { txid: externalAFunding.txid, vout: 0 }, valueSats: 1_000 },
          { outpoint: { txid: exploitVaultFunding.txid, vout: 0 }, valueSats: 1_000 },
          { outpoint: { txid: externalBFunding.txid, vout: 0 }, valueSats: 100 },
        ],
        outputs,
        [trackedSat],
      )[0]?.outputIndex,
    ).toBe(1)

    const prevTxHexByTxid: Record<string, string> = {
      [externalAFunding.txid]: externalAFunding.hex,
      [exploitVaultFunding.txid]: exploitVaultFunding.hex,
      [externalBFunding.txid]: externalBFunding.hex,
    }
    await expect(
      analyzePsbt(forged, addresses, {
        getPrevTxHex: (txid) => Promise.resolve(prevTxHexByTxid[txid] ?? ''),
        getInscriptionsAtOutpoint: () => {
          throw new Error('inscription lookup should not run after prevout mismatch')
        },
      }),
    ).rejects.toThrow(`input 0 witnessUtxo does not match ${externalAFunding.txid}:0`)
  })

  it('attaches a verified prevtx when an external input has no UTXO metadata', async () => {
    const external = new btc.Transaction(LIBERAL_PSBT_OPTIONS)
    external.addInput({ txid: walletFunding.txid, index: 0, sequence: 0xfffffffd })
    external.addOutput({ script: hexToBytes(RECIPIENT_TR), amount: 59_000n })

    await enrichPsbt(external, addresses, {
      getPrevTxHex: (txid) => {
        if (txid !== walletFunding.txid) throw new Error(`no prevtx for ${txid}`)
        return Promise.resolve(walletFunding.hex)
      },
    })

    const [classified] = classifyInputs(external, addresses)
    expect(classified?.class.kind).toBe('external')
    expect(classified?.valueSats).toBe(60_000)
    expect(external.getInput(0).nonWitnessUtxo).toBeDefined()
  })

  it('rejects a witnessUtxo script that differs from the verified prevout', async () => {
    const external = new btc.Transaction(LIBERAL_PSBT_OPTIONS)
    external.addInput({
      txid: walletFunding.txid,
      index: 0,
      sequence: 0xfffffffd,
      witnessUtxo: {
        script: hexToBytes(RECIPIENT_TR),
        amount: 60_000n,
      },
    })
    external.addOutput({ script: hexToBytes(RECIPIENT_TR), amount: 59_000n })

    await expect(
      enrichPsbt(external, addresses, {
        getPrevTxHex: (txid) => {
          if (txid !== walletFunding.txid) throw new Error(`no prevtx for ${txid}`)
          return Promise.resolve(walletFunding.hex)
        },
      }),
    ).rejects.toThrow(`input 0 witnessUtxo does not match ${walletFunding.txid}:0`)
  })

  it('fails analysis when any inscription lookup fails', async () => {
    const { transaction } = parsePsbt(buildWorkingPsbt())

    await expect(
      analyzePsbt(transaction, addresses, {
        getPrevTxHex: (txid) => {
          if (txid === vaultFunding.txid) return Promise.resolve(vaultFunding.hex)
          if (txid === walletFunding.txid) return Promise.resolve(walletFunding.hex)
          throw new Error(`no prevtx for ${txid}`)
        },
        getInscriptionsAtOutpoint: () => Promise.reject(new Error('ord unavailable')),
      }),
    ).rejects.toThrow('could not check input 0 for inscriptions')
  })

  it('passes verified prevout values into inscription checks', async () => {
    const { transaction } = parsePsbt(buildWorkingPsbt())
    const getInscriptionsAtOutpoint = vi.fn(() => Promise.resolve([]))

    await analyzePsbt(transaction, addresses, {
      getPrevTxHex: (txid) => {
        if (txid === vaultFunding.txid) return Promise.resolve(vaultFunding.hex)
        if (txid === walletFunding.txid) return Promise.resolve(walletFunding.hex)
        throw new Error(`no prevtx for ${txid}`)
      },
      getInscriptionsAtOutpoint,
    })

    expect(getInscriptionsAtOutpoint.mock.calls).toEqual([
      [vaultFunding.txid, 0, 9_999],
      [vaultFunding.txid, 1, 546],
      [walletFunding.txid, 0, 60_000],
    ])
  })
})

describe('imported PSBT fee policy', () => {
  it('blocks a valid transaction that burns nearly all input value as fees', async () => {
    const funding = buildFundingTx([
      { valueSats: 100_000, scriptHex: addresses.payments.scriptPubkeyHex },
    ])
    const transaction = new btc.Transaction({ version: 2 })
    transaction.addInput({
      txid: funding.txid,
      index: 0,
      sequence: 0xfffffffd,
      nonWitnessUtxo: hexToBytes(funding.hex),
      witnessUtxo: {
        script: hexToBytes(addresses.payments.scriptPubkeyHex),
        amount: 100_000n,
      },
      ...multisigInputFields(addresses.payments),
    })
    transaction.addOutput({ script: hexToBytes(RECIPIENT_TR), amount: 546n })

    const analysis = await analyzePsbt(transaction, addresses, {
      getPrevTxHex: () => Promise.reject(new Error('embedded prevtx should be used')),
      getInscriptionsAtOutpoint: () => Promise.resolve([]),
    })

    expect(analysis.feeSats).toBe(99_454)
    expect(analysis.feeRateSatVb).toBeGreaterThan(500)
    expect(analysis.warnings).toContainEqual({
      severity: 'danger',
      message: expect.stringContaining('Excessive transaction fee'),
    })
  })
})

describe('signatures + finalize', () => {
  it('collects, verifies, merges, and finalizes at quorum plus wallet', () => {
    const workingBase64 = buildWorkingPsbt()
    const { transaction } = parsePsbt(workingBase64)

    expect(finalizeIfReady(transaction, addresses)).toBeNull()

    for (const [signerIndex, cosigner] of cosigners.slice(0, 2).entries()) {
      const signingCopy = parsePsbt(workingBase64).transaction

      const child = cosigner.master.derive(`${FIXTURE_KEY_ORIGIN_PATH}/0/0`)
      if (!child.privateKey) throw new Error('missing key')
      signingCopy.signIdx(child.privateKey, 0)
      signingCopy.signIdx(child.privateKey, 1)

      const produced = collectSignatures(signingCopy)
      expect(produced.length).toBe(2)

      for (const signature of produced) {
        const inputValue = plan.vaultInputs[signature.inputIndex]?.valueSats ?? 0
        const validatedPubkey = verifySignatureForInput({
          psbtBase64: workingBase64,
          inputIndex: signature.inputIndex,
          signatureHex: signature.signatureHex,
          inputValueSats: inputValue,
        })
        expect(validatedPubkey).toBe(signature.pubkeyHex)

        expect(mergeSignature(transaction, signature)).toBe(true)
        expect(mergeSignature(transaction, signature)).toBe(false)
      }

      const quorum = quorumStatus(transaction, addresses)
      expect(quorum.met).toBe(signerIndex === 1)
    }

    // Not finalizable until the fee wallet signs its own input.
    expect(finalizeIfReady(transaction, addresses)).toBeNull()
    transaction.signIdx(walletPrivateKey, 2)

    const artifacts = finalizeIfReady(transaction, addresses)
    expect(artifacts).not.toBeNull()
    expect(artifacts?.rawTxHex.length).toBeGreaterThan(200)
    expect(artifacts?.txid).toMatch(/^[0-9a-f]{64}$/)
    expect(artifacts?.feeSats).toBe(plan.feeSats)

    // The planner's vsize is a worst-case estimate; the real transaction must
    // come in at or barely under it (signature length variance only).
    const actualVsize = decodeRawTx(artifacts?.rawTxHex ?? '').vsize
    expect(plan.vsize).toBeGreaterThanOrEqual(actualVsize)
    expect(plan.vsize - actualVsize).toBeLessThanOrEqual(6)
  })

  it('rejects a signature transplanted onto a same-script sibling input', () => {
    const workingBase64 = buildWorkingPsbt()

    const signingCopy = parsePsbt(workingBase64).transaction
    const cosigner = cosigners[0]
    if (!cosigner) throw new Error('missing cosigner')

    const child = cosigner.master.derive(`${FIXTURE_KEY_ORIGIN_PATH}/0/0`)
    if (!child.privateKey) throw new Error('missing key')
    signingCopy.signIdx(child.privateKey, 0)

    const [signature] = collectSignatures(signingCopy)
    if (!signature) throw new Error('no signature produced')

    const transplanted = verifySignatureForInput({
      psbtBase64: workingBase64,
      inputIndex: 1,
      signatureHex: signature.signatureHex,
      inputValueSats: plan.vaultInputs[1]?.valueSats ?? 0,
    })

    expect(transplanted).toBeNull()
  })

  it('rejects a cryptographically valid high-S vault signature', () => {
    const workingBase64 = buildWorkingPsbt()
    const signingCopy = parsePsbt(workingBase64).transaction
    const cosigner = cosigners[0]
    if (!cosigner) throw new Error('missing cosigner')

    const child = cosigner.master.derive(`${FIXTURE_KEY_ORIGIN_PATH}/0/0`)
    if (!child.privateKey) throw new Error('missing key')
    signingCopy.signIdx(child.privateKey, 0)

    const [signature] = collectSignatures(signingCopy)
    if (!signature) throw new Error('no signature produced')
    const bytes = hexToBytes(signature.signatureHex)
    const parsed = secp256k1.Signature.fromBytes(bytes.subarray(0, -1), 'der')
    const highSignature = new secp256k1.Signature(
      parsed.r,
      secp256k1.Point.Fn.ORDER - parsed.s,
    ).toBytes('der')

    expect(
      verifySignatureForInput({
        psbtBase64: workingBase64,
        inputIndex: 0,
        signatureHex: bytesToHex(Uint8Array.from([...highSignature, 0x01])),
        inputValueSats: plan.vaultInputs[0]?.valueSats ?? 0,
      }),
    ).toBeNull()
  })

  it('does not count or finalize invalid preloaded vault signatures', () => {
    const { transaction } = parsePsbt(buildWorkingPsbt())
    const [validCosigner, bogusCosigner] = cosigners
    if (!validCosigner || !bogusCosigner) throw new Error('missing cosigner')

    const validChild = validCosigner.master.derive(`${FIXTURE_KEY_ORIGIN_PATH}/0/0`)
    const bogusChild = bogusCosigner.master.derive(`${FIXTURE_KEY_ORIGIN_PATH}/0/0`)
    if (!validChild.privateKey || !bogusChild.publicKey) throw new Error('missing key')

    for (const inputIndex of [0, 1]) {
      transaction.signIdx(validChild.privateKey, inputIndex)
      transaction.updateInput(
        inputIndex,
        { partialSig: [[bogusChild.publicKey, Uint8Array.of(1)]] },
        true,
      )
    }
    transaction.signIdx(walletPrivateKey, 2)

    expect(quorumStatus(transaction, addresses)).toMatchObject({
      met: false,
      perInput: [
        { inputIndex: 0, have: 1, need: 2 },
        { inputIndex: 1, have: 1, need: 2 },
      ],
    })
    expect(finalizeIfReady(transaction, addresses)).toBeNull()
  })
})
