# Security model and deferred work

Last reviewed: 2026-08-04.

Saffron is a browser-only, watch-only vault coordinator. It stores public wallet configuration and
extended public keys, never seed phrases or private keys. Hardware devices authorize vault spends;
Xverse or Unisat authorizes fee-wallet inputs. Saffron exports transactions and does not broadcast.

## Scope

This security model is limited to preventing loss, redirection, or unintended spending of BTC and
inscriptions when Saffron is run locally on a trusted workstation. Rune correctness and protection,
public or multi-user hosting, and issues whose only impact is privacy or availability are out of
scope. Those issues remain useful hardening work, but they are not release blockers unless they can
cross an asset-security boundary.

## Accepted trust boundaries

- **Ord API:** The configured ord API is authoritative for inscription membership. Saffron
  verifies response shape, outpoints, values, offsets, and cross-response consistency, but it cannot
  independently prove that the API did not omit an asset. This is an accepted product assumption.
- **Electrs API:** Electrs supplies confirmed UTXOs, previous transactions, and fee estimates.
  Previous-transaction bytes are checked against their committed transaction IDs before signing.
- **Hardware and wallet software:** Hardware displays are the final user-confirmation boundary.
  Vault and supported fee-wallet signatures are verified locally. Responses are pinned to the
  original unsigned transaction, selected signer, and complete requested input set before merge.
- **Trezor Connect:** Trezor operation depends on the versioned runtime hosted at
  `connect.trezor.io`. That origin can supply the xpubs from which a new vault address is derived, so
  compromise of the hosted runtime could substitute an address before funding. This vendor trust is
  accepted. The URL is version-pinned, but that is not a content-integrity guarantee. Before funding,
  verify the complete vault descriptor/address independently from the devices or a separate trusted
  wallet workflow; the current UI does not provide hardware attestation of the final vault address.
- **Local application context:** Saffron is intended to run through loopback on a trusted
  workstation, not as a public or multi-user service. A party that publishes it must separately own
  TLS, CSP, anti-framing, and other response-header policy.
- **Inscription previews:** Preview content is untrusted and may be active inside its sandboxed
  frame. Tracking, resource exhaustion, and preview failure are accepted non-asset risks in the
  local-only model; preview behavior must not be treated as an authorization signal.

## Applied security controls

- Data endpoints require HTTPS, with cleartext HTTP limited to browser loopback development.
- The application sends no referrer information on outbound requests or navigation.
- Font Awesome loads through a regular local stylesheet rather than a custom inline bootstrap
  script, reducing the CSP exception surface.
- API responses have bounded body reads and remain under an abort deadline while consumed.
- Inscription detail IDs are validated, URL-encoded, and bound to the returned API object.
- Unsupported address indexes and invalid signing derivation paths are rejected at configuration
  save/import and use time, and persisted derived addresses are checked before display.
- Standard imported-PSBT destinations are displayed as Bitcoin addresses rather than raw scripts.
- Imported PSBTs estimate final signed size and block fees above 500 sat/vB or 10% of total input
  value. Generated transfers reject fee rates above the same rate limit.
- Vault and fee-wallet ECDSA signatures must be canonical low-S signatures. Supported P2WPKH,
  P2SH-P2WPKH, and Taproot fee-wallet signatures and finalized witnesses are verified before merge.
- Hardware sessions verify the connected device's fingerprint and account xpub, require the selected
  cosigner on every vault input, and reject partial or unexpected signature sets before mutation.
- Trezor signing preserves the reviewed transaction version, locktime, per-input sequence, branch,
  and child derivation, and rejects unsupported shapes before opening the device workflow.
- Xverse is asked only for the payment address used by Saffron.
- Application fonts are self-hosted; no font request leaves the origin.
- Untrusted PSBTs are limited to 8 MiB decoded and 16 MiB on disk or as encoded text. Local JSON
  backup files and text are limited to 1 MiB, with file sizes checked before browser reads.
- Dependency lifecycle scripts are disabled by repository policy. CI installs from the lockfile,
  checks for source or repository-local Git configuration changes, and verifies registry signatures.
- Production dependency scans fail CI at high severity. Dependabot checks npm and GitHub Actions
  for updates weekly.

## Deferred security work

These items were not changed because a minimal patch would guess policy, depend on hardware
testing, or address a non-asset issue outside the local-only scope.

| Area                                     | Why it is deferred                                                                                                                                                                                 | Required decision or implementation                                                                                                                                          |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dependency override hardware regression  | Compatible overrides for Trezor `protobufjs` and `sats-connect` Axios/Valibot pass unit, type, and build checks, but this environment cannot exercise physical Trezor or Xverse-extension signing. | Before release, complete one Trezor connection/signing flow and one Xverse connection/signing flow. Prefer upstream package releases once they carry the fixed dependencies. |
| Active inscription previews              | Removing scripts breaks several preview formats. In local-only use, tracking, resource exhaustion, and rendering failures are non-asset privacy/availability issues.                               | If preview isolation becomes an asset boundary, design inert snapshots/placeholders and an explicit enable step on a separate origin.                                        |
| Content Security Policy and host headers | There is no supported public deployment. SvelteKit bootstrap code, protobuf code generation, Trezor Connect, WebUSB, and inscription frames also require a tested host-specific policy.            | Reassess before any public deployment; add CSP, `frame-ancestors`, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, and `Permissions-Policy` without broad `unsafe-eval`.  |

## Current dependency scan

As of the review date, `npm audit --omit=dev` reports 10 low-severity dependency entries and no
moderate, high, or critical entries. Exact npm overrides keep Trezor on `protobufjs` 7.6.5,
deduplicate `sats-connect` onto Axios 1.19.0 and Valibot 1.4.2, and lift SvelteKit's `cookie` to
0.7.2. These are compatibility bridges until the parent packages publish those fixed dependencies;
keep the physical regression requirement above when changing them.

Dependabot alerts report one accepted runtime exception:

- **Package path:** `@trezor/connect-web` > `@trezor/connect` > `@trezor/utxo-lib` >
  `tiny-secp256k1` 1.1.7 > `elliptic` 6.6.1.
- **Advisory:** Elliptic uses a cryptographic primitive with a risky implementation (low). No
  patched release exists, so no upgrade or override resolves it.
- **Reachability:** `elliptic` is reached only through Trezor Connect's own transaction handling.
  Saffron performs no signature verification with it. Every device signature is independently
  verified against a locally computed digest using `@noble/curves`, and every vault address is
  re-derived locally, so a weakness in this primitive cannot make Saffron accept a signature or an
  address it would otherwise reject. Trezor's on-device display remains the authoritative
  confirmation surface.
- **Resolution:** Clears when Trezor moves `@trezor/utxo-lib` to `tiny-secp256k1` 2.x, which
  replaces `elliptic` with a WASM implementation. Do not force that transitive upgrade without the
  physical device regression tests required above.

`npm audit signatures` verifies registry signatures for 495 installed packages and attestations for 102. Signatures establish package provenance, not runtime safety. Repository `.npmrc` disables all
dependency lifecycle scripts, including the transitive Stellar SDK postinstall that previously
attempted to change `blame.ignoreRevsFile`.

The production build also warns that `vm-browserify` contains `eval`; removing or containing that
dependency is public-deployment hardening, not an established BTC or inscription-loss path.

## Release verification

Before release, run:

```sh
npm ci
npm run security:install-state
npm run security:signatures
npm run security:audit
npm run test:unit
npm run check
npm run lint
npm run build
```

Known vulnerability exceptions must record the exact package path, advisory, reachability analysis,
owner, and review date rather than relying only on npm's aggregate severity.
