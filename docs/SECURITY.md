# Security model and limits

## What the page can ask the owner to sign

Only transactions from the connected owner account **to the AgentFlow wallet itself**, with **no value**, on the chosen chain
(`chainId` is part of the request):

| Action | Call on the wallet |
|---|---|
| Stop all agents | `invalidateNonce(currentNonce + 1)` — every agent permission installed so far stops validating |
| Revoke one agent | `uninstallValidation(0x02 ‖ permissionId ‖ 0…, …)` — only permission-type validations, never the owner (root) validator |
| Withdraw USDC / EURC | `execute(single: token.transfer(destination, amount))` |
| Recover the gas deposit | `execute(single: EntryPoint.withdrawTo(destination, amount))` |

The wallet (ZeroDev Kernel v3.1/v3.3) accepts these only from its root owner: its ECDSA owner validator checks
`msg.sender == owner`. Nothing the page can build touches the owner validator, so the owner cannot be locked out.

Before every signature the page decodes the calldata it built back into plain words and simulates it from the owner's address.
Anything it does not recognize — another target, batch mode, value, another contract or function, an approval — is refused and never
reaches the wallet. A reviewed transaction is bound to the chain, wallet and account it was built for and is discarded when any of them
changes.

## What the page does not do

- No AgentFlow server, database or agent connection; no third-party scripts at runtime; no browser storage. One inline script, a strict
  Content-Security-Policy (`default-src 'none'`), network access only to the RPC the owner chooses (HTTPS or localhost).
- It never asks for a recovery phrase or private key; signing happens in the owner's wallet.

## Trust and residual risks

| Risk | Mitigation |
|---|---|
| The RPC decides what the page *shows* (balances, agents, simulation result, the nonce a reset uses). A malicious RPC could mislead the owner or make a reset cover fewer permissions. | Default is Arc's official RPC; owners are told not to change it without reason and to check the wallet's own prompt. The chain enforces ownership and the exact calldata. |
| Copied or phishing versions of the file | Releases are immutable, built by GitHub Actions from the tagged commit, with GitHub's release attestation and a build-provenance attestation; the footer shows the build commit. |
| Address poisoning / clipboard malware when typing a destination | Destinations are validated and shown checksummed in the review; owners compare with the wallet prompt. |
| Wallet extensions that don't inject into `file://` pages | Serve the file on `127.0.0.1` (documented in the owner guide). |

## Unsupported cases

- Lost or compromised owner key (whoever holds it is the owner, and can re-install agents after a reset).
- Wallets whose owner is not the standard ECDSA owner validator (e.g. passkeys).
- An owner account without native USDC for gas (no "someone else submits" mode).
- Token approvals (allowances) and lending positions.
- Access the owner granted through a delegatecall in another application.

## How it was tested

Unit tests in this repository: calldata known-answer vectors (identical to AgentFlow's builders), decoder refusals, destination
checks, reproducible build, checksum and artifact contents. Before release the built file is also tested end to end in a browser
against Kernel v3.1 and v3.3 wallets with agents installed by AgentFlow, on a local chain and on local forks of Arc Testnet and Arc
mainnet (withdrawals, revoke, reset, gas deposit; wrong owner, chain, wallet, destination and calldata refused), from `file://` and from
`127.0.0.1`. That suite needs AgentFlow's test harness and lives in the AgentFlow repository.

## Reporting a problem

Open a GitHub issue without exploit details, or contact the maintainers privately through GitHub. Never post a recovery phrase,
private key or signed transaction.
