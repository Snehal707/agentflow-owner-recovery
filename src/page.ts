/**
 * AgentFlow owner recovery page (standalone; built into ONE html file by scripts/build.ts).
 * No AgentFlow server, no third-party scripts at runtime. Reads go to the RPC shown on the page; every write is a transaction the
 * wallet's root owner signs and sends from their own browser wallet directly to the Kernel (docs/SECURITY.md).
 * Before each signature the page decodes the calldata it built (describeOwnerTx) and simulates it from the owner's address.
 */
import { createPublicClient, formatUnits, getAddress, http, isAddress, type Hex, type PublicClient } from 'viem'
import {
  NETWORKS, depositWithdrawalTx, describeOwnerTx, discoverPermissionIds, findDeployBlock, parseAmount, parseDestination, permissionStatus, readWallet,
  resetTx, revokeTx, tokenWithdrawalTx, type Addr, type OwnerTx, type RecoveryNetwork, type WalletState,
} from './recovery'

type Eip1193 = { request(a: { method: string; params?: unknown[] }): Promise<unknown> }
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const val = (id: string) => ($<HTMLInputElement>(id).value ?? '').trim()
const show = (id: string, on: boolean) => { $(id).hidden = !on }
const say = (id: string, text: string, kind: 'ok' | 'warn' | 'err' | '' = '') => { const e = $(id); e.textContent = text; e.className = `msg ${kind}` }

let net: RecoveryNetwork = NETWORKS.mainnet
let pub: PublicClient
let state: WalletState | null = null
let account: Addr | null = null
/** the reviewed transaction, bound to the exact context it was built and decoded in (chain, wallet, owner account) */
let pending: { tx: OwnerTx; chainId: number; kernel: Addr; account: Addr } | null = null
declare const __RECOVERY_BUILD__: string
/** any change of network, wallet or account discards a reviewed transaction: it was decoded for the previous context */
function dropPending() { pending = null; show('review', false); $<HTMLButtonElement>('send').disabled = true }

function readNetwork(): RecoveryNetwork {
  const sel = val('network')
  if (sel === 'mainnet' || sel === 'testnet') return { ...NETWORKS[sel], rpcUrl: val('rpc') || NETWORKS[sel].rpcUrl }
  for (const id of ['usdc', 'eurc']) if (!isAddress(val(id))) throw new Error(`Custom network: enter the ${id.toUpperCase()} token address.`)
  const chainId = Number(val('chainId'))
  if (!Number.isInteger(chainId) || chainId <= 0) throw new Error('Custom network: enter the chain id.')
  return { name: 'Custom', chainId, rpcUrl: val('rpc'), usdc: getAddress(val('usdc')), eurc: getAddress(val('eurc')) }
}
function onNetworkChange() {
  const sel = val('network'), custom = sel === 'custom'
  show('customFields', custom)
  if (!custom) $<HTMLInputElement>('rpc').value = NETWORKS[sel as 'mainnet' | 'testnet'].rpcUrl
}

const fmt6 = (v: bigint) => formatUnits(v, 6), fmt18 = (v: bigint) => formatUnits(v, 18)
function render() {
  const ok = !!state?.hasCode
  show('walletPanel', ok); show('actions', ok && isOwner())
  if (!state) return
  if (!state.hasCode) { say('walletMsg', 'No wallet contract at this address on this network.', 'err'); return }
  $('stUsdc').textContent = `${fmt6(state.usdc)} USDC`
  $('stEurc').textContent = `${fmt6(state.eurc)} EURC`
  $('stDeposit').textContent = `${fmt18(state.deposit)} USDC`
  $('stOwner').textContent = state.rootOwner ?? 'unknown (not the standard owner validator)'
  $('stNonces').textContent = `current ${state.currentNonce}, permissions valid from ${state.validNonceFrom}`
  if (!state.rootIsEcdsa) say('walletMsg', 'This wallet\'s root validator is not the ECDSA owner validator. This page can\'t act for it.', 'err')
  else if (!account) say('walletMsg', 'Read. Connect the owner wallet to act.', '')
  else if (!isOwner()) say('walletMsg', `The connected account ${account} is not this wallet's owner. Actions are disabled.`, 'err')
  else say('walletMsg', 'Connected as the owner.', 'ok')
}
const isOwner = () => !!(state?.rootOwner && account && state.rootOwner.toLowerCase() === account.toLowerCase())

async function readState() {
  dropPending()
  try {
    net = readNetwork(); pub = createPublicClient({ transport: http(net.rpcUrl) })
    const chain = await pub.getChainId()
    if (chain !== net.chainId) throw new Error(`The RPC is on chain ${chain}, not ${net.chainId}.`)
    const k = val('kernel'); if (!isAddress(k)) throw new Error('Enter the wallet (Kernel) address.')
    say('walletMsg', 'Reading…'); state = await readWallet(pub, getAddress(k), net); render()
  } catch (e) { state = null; render(); say('walletMsg', (e as Error).message, 'err') }
}

function wallet(): Eip1193 {
  const eth = (window as unknown as { ethereum?: Eip1193 }).ethereum
  if (!eth) throw new Error('No browser wallet found. Open this page in a browser with your owner wallet installed.')
  return eth
}
async function connect() {
  try {
    const accts = await wallet().request({ method: 'eth_requestAccounts' }) as string[]
    const next = getAddress(accts[0]!)
    if (next !== account) dropPending()
    account = next; $('account').textContent = account; render()
  } catch (e) { say('walletMsg', (e as Error).message, 'err') }
}
async function ensureChain() {
  const id = parseInt(await wallet().request({ method: 'eth_chainId' }) as string, 16)
  if (id === net.chainId) return
  await wallet().request({ method: 'wallet_switchEthereumChain', params: [{ chainId: `0x${net.chainId.toString(16)}` }] })
  const now = parseInt(await wallet().request({ method: 'eth_chainId' }) as string, 16)
  if (now !== net.chainId) throw new Error(`Your wallet is on chain ${now}; switch it to ${net.name} (${net.chainId}).`)
}

/** review: decoded description + simulation from the owner's address; nothing is signed until "Sign and send" */
async function review(tx: OwnerTx) {
  if (!state || !isOwner()) return
  pending = { tx, chainId: net.chainId, kernel: state.kernel, account: account! }
  const lines = describeOwnerTx(tx, state.kernel, net)
  $('reviewText').textContent = lines.join('\n')
  show('review', true); say('reviewMsg', 'Simulating…')
  const unexpected = lines.some((l) => l.startsWith('UNEXPECTED'))
  $<HTMLButtonElement>('send').disabled = true
  if (unexpected) { say('reviewMsg', 'Refusing to sign: the transaction is not what this page expects.', 'err'); return }
  try { await pub.call({ account: account!, to: tx.to, data: tx.data }); say('reviewMsg', 'Simulation: succeeds. Check the details, then sign in your wallet.', 'ok'); $<HTMLButtonElement>('send').disabled = false }
  catch (e) { say('reviewMsg', `Simulation failed: ${(e as { shortMessage?: string }).shortMessage ?? (e as Error).message}`.split('\n')[0]!, 'err') }
}
async function send() {
  if (!pending || !account) return
  const p = pending, tx = p.tx; $<HTMLButtonElement>('send').disabled = true
  if (p.chainId !== net.chainId || p.kernel !== state?.kernel || p.account !== account) { dropPending(); say('walletMsg', 'The network, wallet or account changed after the review. Review the transaction again.', 'err'); return }
  try {
    await ensureChain()
    say('reviewMsg', 'Waiting for your wallet…')
    // chainId is part of the request: a wallet that has moved to another chain must refuse it
    const hash = await wallet().request({ method: 'eth_sendTransaction', params: [{ from: account, to: tx.to, data: tx.data, chainId: `0x${p.chainId.toString(16)}` }] }) as Hex
    say('reviewMsg', `Sent ${hash}. Waiting for confirmation…`)
    const r = await pub.waitForTransactionReceipt({ hash })
    pending = null
    // refresh what the page shows BEFORE reporting the result, so "Confirmed" never sits next to stale balances or permissions
    say('reviewMsg', 'Included. Refreshing the wallet state…')
    state = await readWallet(pub, state!.kernel, net); render(); await refreshPermissions()
    const link = net.explorer ? ` ${net.explorer}/tx/${hash}` : ''
    say('reviewMsg', r.status === 'success' ? `Confirmed in block ${r.blockNumber}: ${hash}.${link}` : `The transaction reverted: ${hash}.${link}`, r.status === 'success' ? 'ok' : 'err')
    $('history').prepend(Object.assign(document.createElement('li'), { textContent: `${r.status === 'success' ? '✓' : '✗'} ${tx.summary} — ${hash}` }))
  } catch (e) { say('reviewMsg', (e as Error).message.split('\n')[0]!, 'err'); $<HTMLButtonElement>('send').disabled = false }
}

// ---------- actions ----------
const guard = (id: string, f: () => OwnerTx | Promise<OwnerTx>) => async () => { try { say(id, ''); await review(await f()) } catch (e) { say(id, (e as Error).message, 'err') } }
const doReset = guard('resetMsg', () => resetTx(state!.kernel, state!.currentNonce))
const doWithdraw = guard('withdrawMsg', () => {
  const sym = val('token'), token = sym === 'EURC' ? net.eurc : net.usdc, bal = sym === 'EURC' ? state!.eurc : state!.usdc
  return tokenWithdrawalTx(state!.kernel, token, sym, parseDestination(val('withdrawTo'), state!.kernel, net), parseAmount(val('withdrawAmount'), 6, bal))
})
const doDeposit = guard('depositMsg', () => {
  if (state!.deposit === 0n) throw new Error('The wallet has no gas deposit.')
  return depositWithdrawalTx(state!.kernel, parseDestination(val('depositTo'), state!.kernel, net), state!.deposit)
})
function maxWithdraw() { const bal = val('token') === 'EURC' ? state?.eurc : state?.usdc; $<HTMLInputElement>('withdrawAmount').value = fmt6(bal ?? 0n) }

// ---------- agent permissions ----------
const known = new Set<string>()
async function refreshPermissions() {
  const list = $('permList'); list.textContent = ''
  if (!state) return
  for (const id of known) {
    const li = document.createElement('li')
    try {
      const s = await permissionStatus(pub, state.kernel, id as Hex, state.validNonceFrom)
      li.textContent = `${s.permissionId}: ${s.why} `
      if (s.live && isOwner()) {
        const b = Object.assign(document.createElement('button'), { textContent: `Revoke ${s.permissionId}`, type: 'button' })
        b.onclick = guard('permMsg', () => revokeTx(state!.kernel, s.permissionId, s.policyCount)); li.append(b)
      }
    } catch (e) { li.textContent = `${id}: could not read (${(e as Error).message.split('\n')[0]})` }
    list.append(li)
  }
}
async function addIds() {
  const bad: string[] = []
  for (const raw of val('permIds').split(/[\s,]+/).filter(Boolean)) { if (/^0x[0-9a-fA-F]{8}$/.test(raw)) known.add(raw.toLowerCase()); else bad.push(raw) }
  say('permMsg', bad.length ? `Not a permission id (0x + 8 hex): ${bad.join(', ')}` : '', bad.length ? 'err' : '')
  await refreshPermissions()
}
async function scan() {
  if (!state) return
  try {
    const head = await pub.getBlockNumber(), chunk = BigInt(val('scanChunk') || '10000')
    let from: bigint
    if (val('scanFrom')) from = BigInt(val('scanFrom'))
    else { say('permMsg', 'Finding the block the wallet was created in…'); from = (await findDeployBlock(pub, state.kernel)) ?? head; $<HTMLInputElement>('scanFrom').value = String(from) }
    const ids = await discoverPermissionIds(pub, state.kernel, from, head, chunk, (d, t) => say('permMsg', `Scanning blocks… ${((Number(d) / Number(t)) * 100).toFixed(0)}%`))
    ids.forEach((i) => known.add(i)); await refreshPermissions()
    say('permMsg', `Found ${ids.length} installed permission(s) since block ${from}.`, 'ok')
  } catch (e) { say('permMsg', `Scan failed (the RPC may limit log ranges; try a smaller chunk or a later start block): ${(e as Error).message.split('\n')[0]}`, 'err') }
}

window.addEventListener('DOMContentLoaded', () => {
  $('network').onchange = () => { dropPending(); onNetworkChange() }; onNetworkChange()
  for (const id of ['rpc', 'chainId', 'usdc', 'eurc', 'kernel']) $(id).addEventListener('input', dropPending)
  $('build').textContent = __RECOVERY_BUILD__
  $('read').onclick = readState; $('connect').onclick = connect
  $('reset').onclick = doReset; $('withdraw').onclick = doWithdraw; $('max').onclick = maxWithdraw; $('deposit').onclick = doDeposit
  $('addIds').onclick = addIds; $('scan').onclick = scan
  $('send').onclick = send; $('cancel').onclick = dropPending
})
