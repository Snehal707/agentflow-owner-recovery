# Releasing

Releases are built by GitHub Actions from the tagged public commit and published **by hand** after testing. Nothing else signs or
hosts the file.

## One-time repository settings

- **Settings → Releases → "Enable release immutability"** (applies only to releases published after it is enabled).
- Actions enabled. The workflow needs no secrets: it uses the built-in `GITHUB_TOKEN` and GitHub's OIDC token for attestations.

## Each release

1. On a reviewed commit of `main`, create and push an annotated tag `vX.Y.Z`.
2. `.github/workflows/release.yml` runs with pinned actions (by commit SHA) and Bun 1.4.3 from `bun.lock`: typecheck, build with
   `RECOVERY_BUILD_COMMIT` = the tagged commit, tests, a check that the page names that commit and isn't dirty, `sha256sum -c`, a
   build-provenance attestation (`actions/attest`), and a **draft** release with `agentflow-owner-recovery.html` and its `.sha256`.
3. Independently rebuild the tag on another machine:
   ```
   git checkout vX.Y.Z && bun install --frozen-lockfile
   RECOVERY_BUILD_COMMIT=$(git rev-parse HEAD) bun run build
   ```
   `dist/agentflow-owner-recovery.html.sha256` must equal the draft asset's checksum.
4. Download the draft asset and test that exact file:
   - `gh release download vX.Y.Z -R Snehal707/agentflow-owner-recovery -p agentflow-owner-recovery.html`
   - `gh attestation verify agentflow-owner-recovery.html -R Snehal707/agentflow-owner-recovery`
   - the browser suite in the AgentFlow repository against this file (local chain, Arc Testnet and mainnet forks, `file://` and
     `127.0.0.1`), requiring the page to show the tagged commit.
5. Publish the draft. It becomes immutable and GitHub adds a release attestation. Download it again and run
   `gh release verify vX.Y.Z -R Snehal707/agentflow-owner-recovery` and
   `gh release verify-asset vX.Y.Z agentflow-owner-recovery.html -R Snehal707/agentflow-owner-recovery`.
6. Publish the tag and SHA-256 through a second channel (the AgentFlow dashboard or docs) so owners can compare independently.

A published release cannot be changed. If something is wrong, release a new version and say so in the old release's notes.
