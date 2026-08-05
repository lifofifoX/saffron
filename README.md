# Saffron

A self custody vault for Bitcoin Ordinals.

One fixed vault address holds your inscriptions, controlled by a single key or an n-of-m quorum.
Fees always come from a connected Xverse or Unisat hot wallet, never from vault sats. Saffron
never broadcasts; it exports raw hex and PSBTs.

It runs entirely in your browser. There is no server and no accounts. The vault definition
(quorum and public keys, never private keys) lives in localStorage, and chain data is fetched
directly from the endpoints you configure.

> **Warning**
> Saffron is new, unaudited software that moves real Bitcoin and real inscriptions. Bugs,
> misconfiguration, or a lost vault definition can cost you everything in the vault. Test the
> full flow, including a recovery, with a small amount before you trust it with anything you
> care about. Use at your own risk.

## Features

- Inscription gallery with bulk selection and multi item transfers
- Ordinal safe transfers: vault input i maps to output i at the same value, so an inscription
  at any offset lands in the matching output, checked by an independent FIFO sat flow tracer
- Sign arbitrary PSBTs, with inscription warnings before you sign
- Multiple vaults, switchable from the top bar
- Signers: Ledger and Trezor in the browser, plus any PSBT capable wallet. Add that key by xpub,
  export the PSBT, sign it in Sparrow or wherever the key lives, and import it back

## Install

Node 24 and npm 11.

```sh
npm ci
npm run dev          # http://127.0.0.1:5177
```

Chromium only: Trezor Connect and Ledger WebUSB do not work in Firefox or Safari. Quit Ledger
Live before connecting a Ledger.

## Vault types

Multisig vaults are P2WSH sortedmulti at `m/48'/0'/0'/2'`. Single key vaults are P2WPKH under
`m/84'/0'`, on an account you choose at setup. It defaults to a high account so the vault does
not show up in other wallets through ordinary account discovery.

## Backup and restore

**For multisig, your seed phrases alone are not enough.** To spend from an n-of-m vault you also
need the wallet definition: every cosigner xpub, the quorum, and the derivation paths. Lose that
and the coins are unspendable even if you hold every seed. This is the way people most often lose
multisig funds, and it has nothing to do with Saffron specifically.

So, before you fund a multisig vault:

1. Go to Settings and download the backup file. It is a small JSON with the quorum and public
   keys, no secrets, but treat it as private since it reveals your addresses.
2. Store a copy alongside every seed backup, in every location. Whoever finds a seed should find
   the wallet definition with it.
3. Test a restore. Load the file into Saffron on a different browser or machine, or into Sparrow,
   and confirm the vault address matches before sending anything to it.

Restore either by reconnecting the devices at Setup, which needs all m devices present since each
one contributes a public key, or by loading the backup file, which needs no devices at all.

Your funds never depend on Saffron. Any wallet that understands the descriptor
(`wsh(sortedmulti(...))` or `wpkh(...)`) can spend them with the devices and the wallet
definition.

## Data sources

Configurable in Settings.

- ord API (`http://localhost:8080`): inscription listings and satpoints. Point this at your own
  ord instance, run with the JSON API enabled and `--index-addresses`. This endpoint decides
  which outputs hold inscriptions, so it is the one component you should not outsource.
- electrs (`https://mempool.space/api`): UTXOs, previous transactions, fee estimates. Any
  esplora compatible server works, including your own.
- content (`https://ordinals.com`): inscription media, rendered in sandboxed iframes

## Security

Saffron is built for local use on a trusted workstation. Signatures are cryptographically
verified before merge, previous transactions are checked against their txids, and the configured
ord API is an explicit trust boundary. See [SECURITY.md](SECURITY.md).

## Develop

```sh
npm run test:unit
npm run check
npm run lint
npm run build
```

## Disclaimer

Saffron is provided as is, with no warranty of any kind. It moves real Bitcoin and real
inscriptions, and it can lose them if it is misconfigured, misused, or wrong. You alone are
responsible for your keys, your funds, and every transaction you sign.

Verify the vault address against your devices before funding it. Review every transaction on the
device screen, not just in this app. Start with small amounts. Keep tested backups of both your
seeds and the vault definition. Nothing here is financial advice.

## License

MIT. See [LICENSE](LICENSE).
