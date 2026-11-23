/**
 * Owner recovery without AgentFlow's backend (docs/OWNER-GUIDE.md, docs/SECURITY.md). Browser-safe, viem only.
 *
 * Every write here is a transaction the wallet's ROOT OWNER sends from their own EOA straight to the Kernel ("Path A"): Kernel v3.3
 * accepts it because the root ECDSA validator's preCheck requires msg.sender == owner. No EntryPoint, bundler, relayer or server.
 * The withdrawal encoders (src/withdrawal.ts) are byte-identical to the ones the AgentFlow dashboard uses.
 */
import { concatHex, decodeFunctionData, encodeAbiParameters, encodeFunctionData, erc20Abi, formatUnits, getAddress, isAddress, pad, parseAbiItem, parseUnits,
  zeroAddress, type Hex, type PublicClient } from 'viem'
import { ENTRYPOINT_V07, WITHDRAW_TO_ABI, reserveWithdrawalData, withdrawalData, ARC_USDC } from './withdrawal'

export type Addr = `0x${string}`
export interface RecoveryNetwork { name: string; chainId: number; rpcUrl: string; usdc: Addr; eurc: Addr; explorer?: string }
export const ECDSA_VALIDATOR = '0x845ADb2C711129d4f3966735eD98a9F09fC4cE57' as const
export const NETWORKS: Record<'mainnet' | 'testnet', RecoveryNetwork> = {
  mainnet: { name: 'Arc mainnet', chainId: 5042, rpcUrl: 'https://rpc.mainnet.arc.io', usdc: ARC_USDC, eurc: '0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1', explorer: 'https://explorer.arc.io' },
  testnet: { name: 'Arc Testnet', chainId: 5042002, rpcUrl: 'https://rpc.testnet.arc.io', usdc: ARC_USDC, eurc: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a', explorer: 'https://testnet.arcscan.app' },
}

export const KERNEL_ABI = [
  { type: 'function', name: 'execute', stateMutability: 'payable', outputs: [], inputs: [{ name: 'mode', type: 'bytes32' }, { name: 'executionCalldata', type: 'bytes' }] },
  { type: 'function', name: 'invalidateNonce', stateMutability: 'payable', outputs: [], inputs: [{ name: 'nonce', type: 'uint32' }] },
  { type: 'function', name: 'uninstallValidation', stateMutability: 'payable', outputs: [], inputs: [{ name: 'vId', type: 'bytes21' }, { name: 'deinitData', type: 'bytes' }, { name: 'hookDeinitData', type: 'bytes' }] },
  { type: 'function', name: 'currentNonce', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint32' }] },
  { type: 'function', name: 'validNonceFrom', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint32' }] },
  { type: 'function', name: 'rootValidator', stateMutability: 'view', inputs: [], outputs: [{ type: 'bytes21' }] },
  { type: 'function', name: 'validationConfig', stateMutability: 'view', inputs: [{ type: 'bytes21' }], outputs: [{ type: 'tuple', components: [{ name: 'nonce', type: 'uint32' }, { name: 'hook', type: 'address' }] }] },
  { type: 'function', name: 'permissionConfig', stateMutability: 'view', inputs: [{ type: 'bytes4' }], outputs: [{ type: 'tuple', components: [{ name: 'permissionFlag', type: 'bytes2' }, { name: 'signer', type: 'address' }, { name: 'policyData', type: 'bytes22[]' }] }] },
] as const
const ECDSA_ABI = [{ type: 'function', name: 'ecdsaValidatorStorage', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'address' }] }] as const
const EP_BALANCE_ABI = [{ type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ type: 'address' }], outputs: [{ type: 'uint256' }] }] as const
export const PERMISSION_INSTALLED = parseAbiItem('event PermissionInstalled(bytes4 permission, uint32 nonce)')
/** emitted when a permission is enabled for a selector (AgentFlow's installs emit this, not PermissionInstalled) */
export const SELECTOR_SET = parseAbiItem('event SelectorSet(bytes4 selector, bytes21 vId, bool allowed)')
const NO_HOOK = '0x0000000000000000000000000000000000000001'

export const permissionVId = (pid: Hex): Hex => `0x02${pid.slice(2, 10).toLowerCase()}${'00'.repeat(16)}` as Hex

// ---------- builders (each is { to, data }: sent by the owner EOA to the wallet) ----------
export interface OwnerTx { to: Addr; data: Hex; summary: string }

/** revoke ALL delegated access: every permission installed below `currentNonce + 1` stops validating */
export function resetTx(kernel: Addr, currentNonce: number): OwnerTx {
  return { to: kernel, data: encodeFunctionData({ abi: KERNEL_ABI, functionName: 'invalidateNonce', args: [currentNonce + 1] }),
    summary: `Reset delegated access: invalidateNonce(${currentNonce + 1}). Every agent permission installed so far stops working.` }
}
/** revoke ONE permission (same encoding as the dashboard's prepareRevoke: deinit = abi.encode(bytes[policyCount + 1]) of empty bytes) */
export function revokeTx(kernel: Addr, permissionId: Hex, policyCount: number): OwnerTx {
  const deinit = encodeAbiParameters([{ type: 'bytes[]' }], [Array.from({ length: policyCount + 1 }, () => '0x' as Hex)])
  return { to: kernel, data: encodeFunctionData({ abi: KERNEL_ABI, functionName: 'uninstallValidation', args: [permissionVId(permissionId), deinit, '0x'] }),
    summary: `Revoke agent permission ${permissionId.slice(0, 10)}: uninstallValidation.` }
}
/** ERC-20 withdrawal (USDC or EURC, 6 dp). For USDC this is byte-identical to the dashboard's withdrawalData. */
export function tokenWithdrawalTx(kernel: Addr, token: Addr, symbol: string, destination: Addr, units: bigint): OwnerTx {
  const data = token.toLowerCase() === ARC_USDC.toLowerCase() ? withdrawalData(destination, units)
    : encodeFunctionData({ abi: KERNEL_ABI, functionName: 'execute', args: [pad('0x00', { size: 32 }), concatHex([token, pad('0x00', { size: 32 }),
      encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [destination, units] })])] })
  return { to: kernel, data, summary: `Withdraw ${formatUnits(units, 6)} ${symbol} to ${destination} (ERC-20 transfer from the wallet).` }
}
/** EntryPoint deposit (gas reserve) withdrawal, native USDC in wei; the dashboard's reserveWithdrawalData */
export function depositWithdrawalTx(kernel: Addr, destination: Addr, wei: bigint): OwnerTx {
  return { to: kernel, data: reserveWithdrawalData(destination, wei), summary: `Recover the gas deposit: ${formatUnits(wei, 18)} USDC to ${destination} (EntryPoint.withdrawTo).` }
}

/** validates a destination the owner typed (never the zero address, the wallet itself, a token or the EntryPoint) */
export function parseDestination(input: string, kernel: Addr, net: RecoveryNetwork): Addr {
  const s = input.trim()
  if (!isAddress(s)) throw new Error('Enter a valid address (0x followed by 40 hex characters).')
  const a = getAddress(s)
  if ([zeroAddress, kernel, net.usdc, net.eurc, ENTRYPOINT_V07].some((x) => x.toLowerCase() === a.toLowerCase())) throw new Error('The destination must be an address you control, not the wallet, a token, the EntryPoint or the zero address.')
  return a
}
export function parseAmount(input: string, decimals: number, max: bigint): bigint {
  const s = input.trim()
  if (!new RegExp(`^(?:0|[1-9]\\d*)(?:\\.\\d{1,${decimals}})?$`).test(s)) throw new Error(`Enter an amount with at most ${decimals} decimal places.`)
  const v = parseUnits(s, decimals)
  if (v <= 0n) throw new Error('Enter an amount greater than zero.')
  if (v > max) throw new Error('That is more than the wallet holds.')
  return v
}

/** plain-language description of a transaction the page is about to ask the owner to sign (decoded from the calldata itself) */
export function describeOwnerTx(tx: { to: Addr; data: Hex }, kernel: Addr, net: RecoveryNetwork): string[] {
  if (tx.to.toLowerCase() !== kernel.toLowerCase()) return [`UNEXPECTED: the transaction goes to ${tx.to}, not your wallet ${kernel}.`]
  let d: ReturnType<typeof decodeFunctionData<typeof KERNEL_ABI>>
  try { d = decodeFunctionData({ abi: KERNEL_ABI, data: tx.data }) } catch { return ['UNEXPECTED: a wallet function this page does not use.'] }
  if (d.functionName === 'invalidateNonce') return [`Your wallet ${kernel}`, `calls invalidateNonce(${d.args[0]}): every agent permission installed before stops working.`]
  if (d.functionName === 'uninstallValidation') return [`Your wallet ${kernel}`, `uninstalls the permission ${String(d.args[0]).slice(4, 12)} (uninstallValidation).`]
  if (d.functionName !== 'execute') return [`UNEXPECTED: ${d.functionName}`]
  const [mode, exec] = d.args as [Hex, Hex]
  if (mode !== pad('0x00', { size: 32 })) return ['UNEXPECTED: not a single-call execution.']
  const target = getAddress(`0x${exec.slice(2, 42)}`), value = BigInt(`0x${exec.slice(42, 106)}`), inner = `0x${exec.slice(106)}` as Hex
  if (value !== 0n) return [`UNEXPECTED: the call sends ${formatUnits(value, 18)} native USDC to ${target}.`]
  if (target.toLowerCase() === ENTRYPOINT_V07.toLowerCase()) {
    let w: ReturnType<typeof decodeFunctionData<typeof WITHDRAW_TO_ABI>>
    try { w = decodeFunctionData({ abi: WITHDRAW_TO_ABI, data: inner }) } catch { return ['UNEXPECTED: an EntryPoint call other than withdrawTo.'] }
    return [`Your wallet ${kernel}`, `withdraws ${formatUnits(w.args[1], 18)} USDC of its gas deposit from the EntryPoint`, `to ${w.args[0]}.`]
  }
  const sym = target.toLowerCase() === net.usdc.toLowerCase() ? 'USDC' : target.toLowerCase() === net.eurc.toLowerCase() ? 'EURC' : null
  if (!sym) return [`UNEXPECTED: a call to ${target}.`]
  let t: ReturnType<typeof decodeFunctionData<typeof erc20Abi>>
  try { t = decodeFunctionData({ abi: erc20Abi, data: inner }) } catch { return [`UNEXPECTED: an unknown ${sym} call.`] }
  if (t.functionName !== 'transfer') return [`UNEXPECTED: ${sym}.${t.functionName}.`]
  return [`Your wallet ${kernel}`, `transfers ${formatUnits(t.args[1] as bigint, 6)} ${sym}`, `to ${t.args[0]}.`]
}

// ---------- reads (public RPC only) ----------
export interface WalletState {
  kernel: Addr; hasCode: boolean; rootValidator: Hex; rootIsEcdsa: boolean; rootOwner: Addr | null
  native: bigint; usdc: bigint; eurc: bigint; deposit: bigint; currentNonce: number; validNonceFrom: number
}
export async function readWallet(pub: PublicClient, kernel: Addr, net: RecoveryNetwork): Promise<WalletState> {
  const code = await pub.getCode({ address: kernel })
  if (!code || code === '0x') return { kernel, hasCode: false, rootValidator: '0x', rootIsEcdsa: false, rootOwner: null, native: 0n, usdc: 0n, eurc: 0n, deposit: 0n, currentNonce: 0, validNonceFrom: 0 }
  const rootValidator = await pub.readContract({ address: kernel, abi: KERNEL_ABI, functionName: 'rootValidator' }).catch(() => {
    throw new Error('This address is a contract, but not a Kernel (AgentFlow) wallet.')
  }) as Hex
  const rootIsEcdsa = rootValidator.toLowerCase() === `0x01${ECDSA_VALIDATOR.slice(2)}`.toLowerCase()
  const rootOwner = rootIsEcdsa ? getAddress(await pub.readContract({ address: ECDSA_VALIDATOR, abi: ECDSA_ABI, functionName: 'ecdsaValidatorStorage', args: [kernel] }) as Addr) : null
  const [native, usdc, eurc, deposit, currentNonce, validNonceFrom] = await Promise.all([
    pub.getBalance({ address: kernel }),
    pub.readContract({ address: net.usdc, abi: erc20Abi, functionName: 'balanceOf', args: [kernel] }),
    pub.readContract({ address: net.eurc, abi: erc20Abi, functionName: 'balanceOf', args: [kernel] }).catch(() => 0n),
    pub.readContract({ address: ENTRYPOINT_V07, abi: EP_BALANCE_ABI, functionName: 'balanceOf', args: [kernel] }),
    pub.readContract({ address: kernel, abi: KERNEL_ABI, functionName: 'currentNonce' }),
    pub.readContract({ address: kernel, abi: KERNEL_ABI, functionName: 'validNonceFrom' }),
  ])
  return { kernel, hasCode: true, rootValidator, rootIsEcdsa, rootOwner, native, usdc, eurc, deposit, currentNonce: Number(currentNonce), validNonceFrom: Number(validNonceFrom) }
}

export interface PermissionStatus { permissionId: Hex; live: boolean; installNonce: number; policyCount: number; why: string }
/** a permission is usable only while it is installed (hook set) and its install nonce is not below validNonceFrom */
export async function permissionStatus(pub: PublicClient, kernel: Addr, permissionId: Hex, validNonceFrom: number): Promise<PermissionStatus> {
  const vc = await pub.readContract({ address: kernel, abi: KERNEL_ABI, functionName: 'validationConfig', args: [permissionVId(permissionId)] }) as { nonce: number; hook: Addr }
  const pc = await pub.readContract({ address: kernel, abi: KERNEL_ABI, functionName: 'permissionConfig', args: [permissionId.slice(0, 10) as Hex] }) as { policyData: readonly Hex[] }
  const installed = vc.hook.toLowerCase() !== zeroAddress
  const live = installed && Number(vc.nonce) >= validNonceFrom
  const why = !installed ? 'not installed (revoked)' : !live ? 'switched off by a reset' : vc.hook.toLowerCase() === NO_HOOK ? 'active' : `active (hook ${vc.hook})`
  return { permissionId: permissionId.slice(0, 10).toLowerCase() as Hex, live, installNonce: Number(vc.nonce), policyCount: pc.policyData.length, why }
}

/** the block the wallet contract was created in (binary search over historical getCode; the same method as the server's
 *  allowance scanner). Lets a history scan start there instead of at block 0. null when the wallet has no code. */
export async function findDeployBlock(pub: PublicClient, kernel: Addr): Promise<bigint | null> {
  const head = await pub.getBlockNumber()
  const has = async (b: bigint) => { const c = await pub.getCode({ address: kernel, blockNumber: b }); return !!c && c !== '0x' }
  if (!(await has(head))) return null
  let lo = 0n, hi = head
  while (lo < hi) { const mid = (lo + hi) / 2n; if (await has(mid)) hi = mid; else lo = mid + 1n }
  return lo
}

/** permission ids from the wallet's own events, scanned in chunks (public RPCs limit log ranges): SelectorSet with a permission-type
 *  validation id (0x02 ‖ permissionId ‖ 0…), which every AgentFlow install emits, plus PermissionInstalled where a path emits it */
export async function discoverPermissionIds(pub: PublicClient, kernel: Addr, fromBlock: bigint, toBlock: bigint, chunk = 10_000n,
  onProgress?: (done: bigint, total: bigint) => void): Promise<Hex[]> {
  const ids = new Set<string>()
  for (let a = fromBlock; a <= toBlock; a += chunk) {
    const b = a + chunk - 1n < toBlock ? a + chunk - 1n : toBlock
    const logs = await pub.getLogs({ address: kernel, events: [PERMISSION_INSTALLED, SELECTOR_SET], fromBlock: a, toBlock: b })
    for (const l of logs) {
      if (l.eventName === 'PermissionInstalled' && l.args.permission) ids.add(l.args.permission.toLowerCase())
      if (l.eventName === 'SelectorSet' && l.args.vId && l.args.vId.slice(0, 4).toLowerCase() === '0x02') ids.add(`0x${l.args.vId.slice(4, 12)}`.toLowerCase())
    }
    onProgress?.(b - fromBlock + 1n, toBlock - fromBlock + 1n)
  }
  return [...ids] as Hex[]
}
