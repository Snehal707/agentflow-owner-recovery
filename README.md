# AgentFlow owner recovery

A single, self-contained HTML page that lets the owner of an AgentFlow wallet (a ZeroDev Kernel smart account on Arc) act on that
wallet **without AgentFlow**: stop all agents, revoke one agent, withdraw USDC and EURC, and recover the wallet's gas deposit. Every
action is a transaction the owner signs in their own browser wallet; the page never sees keys and talks to nothing but the Arc RPC
shown on the page and the owner's wallet.

- **Owners:** read [docs/OWNER-GUIDE.md](docs/OWNER-GUIDE.md). Download only from this repository's
  [Releases](https://github.com/Snehal707/agentflow-owner-recovery/releases) and verify before use.
- **Security model and limits:** [docs/SECURITY.md](docs/SECURITY.md).
- **Maintainers:** [docs/RELEASING.md](docs/RELEASING.md).

## Verify a release

```
gh release verify-asset vX.Y.Z agentflow-owner-recovery.html -R Snehal707/agentflow-owner-recovery
gh attestation verify agentflow-owner-recovery.html -R Snehal707/agentflow-owner-recovery
```

Releases are immutable, built by GitHub Actions from the tagged commit (`.github/workflows/release.yml`), and the page shows that commit
in its footer.

## Build it yourself

Requires [Bun](https://bun.sh) 1.4.3.

```
bun install --frozen-lockfile
bun run build        # dist/agentflow-owner-recovery.html and .sha256
bun run test
```

A build of a tagged commit with `RECOVERY_BUILD_COMMIT=<that commit>` produces the same file, byte for byte, as the release.

## Layout

```
src/page.html      page template (strict Content-Security-Policy, inline styles)
src/page.ts        page logic (UI, review, signing via the injected wallet)
src/recovery.ts    calldata builders, pre-signature decoder, chain reads
src/withdrawal.ts  withdrawal encoders (byte-identical to AgentFlow's)
scripts/build.ts   one-file build + SHA-256
tests/             calldata vectors, decoder refusals, reproducibility, artifact contents
```

## License

MIT, see [LICENSE](LICENSE). The built HTML file bundles [viem](https://github.com/wevm/viem), ox, abitype, @noble/curves and
@noble/hashes (all MIT); their license notices are included at the end of the file.
