# AgentFlow owner recovery page — owner guide

> Official source: **https://github.com/Snehal707/agentflow-owner-recovery** — releases only. Any other copy is unofficial.

The recovery page is a single HTML file that lets you, the owner of an AgentFlow wallet, act on that wallet **without AgentFlow**:
no AgentFlow website, server, database or AI-agent connection is involved. With it you can:

- **stop all agents at once** (reset delegated access) or revoke one agent;
- **withdraw USDC and EURC** from the wallet to an address you control;
- **recover the wallet's gas deposit** (unused network-fee prepayments held by the EntryPoint).

Every action is a transaction **you sign in your own browser wallet**, with the wallet's owner account. The page never sees your keys.

## 1. Get it now, before you need it

1. Open the official releases page: `https://github.com/Snehal707/agentflow-owner-recovery/releases`. Only releases tagged `vX.Y.Z` and marked **Immutable**
   are official. Do not use copies sent by email, chat or social media, or offered by anyone claiming to be support.
2. Download two files from the release: `agentflow-owner-recovery.html` and `agentflow-owner-recovery.html.sha256`.

## 2. Verify the file

Do at least one of these. Option A is strongest.

**A. With the GitHub CLI** (`gh`, a version that has `gh release verify-asset`):

```
gh release verify-asset vX.Y.Z agentflow-owner-recovery.html -R Snehal707/agentflow-owner-recovery
gh attestation verify agentflow-owner-recovery.html -R Snehal707/agentflow-owner-recovery
```

The first checks that the file is exactly an asset of that immutable release. The second checks that it was built by that
repository's release workflow. Both must succeed and must name `Snehal707/agentflow-owner-recovery`.

**B. By checksum.** Compute the file's SHA-256 and compare it, character by character, with the value in the release notes **and**
with the value AgentFlow publishes elsewhere (for example in the dashboard):

```
Windows:  certutil -hashfile agentflow-owner-recovery.html SHA256
macOS:    shasum -a 256 agentflow-owner-recovery.html
Linux:    sha256sum -c agentflow-owner-recovery.html.sha256
```

A matching checksum proves the file wasn't changed; it does not by itself prove who published it. That is why option A, or two
independent sources for the checksum, matters.

Finally, open the file and check the **Build** line at the bottom: it must equal the commit shown on the release.

## 3. Save it

Keep the verified file somewhere you can reach without AgentFlow and without your usual computer: a second device, an encrypted
USB drive, or a personal cloud folder. Keep the `.sha256` file with it and re-check the checksum before you use a stored copy.

## 4. Use it

1. **Open the page.** Many wallet extensions don't connect to pages opened as a local file. If yours doesn't (or you aren't sure),
   serve the folder on your own computer and open it in the browser that has your wallet:
   ```
   python -m http.server 8000 --bind 127.0.0.1
   ```
   then open `http://127.0.0.1:8000/agentflow-owner-recovery.html`. (Alternatively, allow your wallet extension access to file URLs.)
2. **Network:** choose Arc mainnet. Leave the RPC on the default official endpoint unless you know why to change it — the page trusts
   the RPC for what it *shows* (balances, agents, simulations).
3. **Wallet:** paste your AgentFlow wallet address, then **Read wallet**.
4. **Connect owner wallet.** Actions appear only if the connected account is the wallet's owner.
5. **Stop all agents first** with *Reset delegated access* if you suspect any problem.
6. Withdraw USDC and EURC to an address you control, and recover the gas deposit.

Before every signature the page shows, in plain words, what the transaction does, and simulates it. In your wallet's prompt, check
that the transaction goes **to your AgentFlow wallet address**, sends **0** value, and is on the **Arc** network. If the wallet prompt
and the page disagree, reject it. If you change the network, the wallet address or the account, the page discards the reviewed
transaction and you must review again.

Your owner account needs a little native USDC on Arc to pay network fees (a few thousandths of a USDC per action at typical fees).

## 5. What it cannot do

- Recover a wallet whose **owner key is lost**, or protect one whose owner key is **compromised**: whoever holds the owner key can always
  act as the owner, including installing new agents after a reset.
- Act for wallets whose owner is not the standard ECDSA owner account (e.g. passkeys or other validators).
- Send a transaction for you when your owner account has **no gas**; there is no "someone else submits" mode.
- Undo token **approvals** (allowances) or recover **lending positions** — neither is in its scope.
- Revoke access you yourself granted through a custom (delegatecall) transaction in another app.
- Withdraw while a token issuer blocks the wallet, or recover funds already sent.
- Check data on its own: it relies on the RPC for what it displays; the blockchain itself enforces who may act.

## 6. Your responsibility

- **Your owner key is the wallet.** Keep the recovery phrase offline, never type it into any website (including this page — it never
  asks for it), and prefer a hardware wallet. AgentFlow can't reset or replace it.
- If you believe your owner key is exposed: from a safe device, reset delegated access and move all funds to a new wallet you control
  immediately, then stop using the old one.
- Download only from the official releases page and verify before use. AgentFlow will never send you a recovery file or ask you to sign
  anything outside this page and your AgentFlow dashboard.
