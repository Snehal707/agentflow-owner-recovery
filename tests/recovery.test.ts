/**
 * Recovery page tests (no network): (1) known-answer calldata vectors — the exact transaction bytes AgentFlow's own builders produce
 * (generated from the AgentFlow repository); (2) the pre-signature decoder refuses anything the page doesn't build; (3) the standalone
 * artifact builds reproducibly, its .sha256 is correct, and it contains no backend routes, external resources or browser storage.
 */
import { describe, expect, test } from 'bun:test'
import { createHash } from 'crypto'
import { mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { concatHex, encodeFunctionData, erc20Abi, pad, type Hex } from 'viem'
import { buildOwnerRecovery, ARTIFACT } from '../scripts/build'
import { NETWORKS, KERNEL_ABI, describeOwnerTx, depositWithdrawalTx, resetTx, revokeTx, tokenWithdrawalTx, parseDestination } from '../src/recovery'
import { ENTRYPOINT_V07, reserveWithdrawalData, withdrawalData } from '../src/withdrawal'

const K = '0x1111111111111111111111111111111111111111' as const, TO = '0x2222222222222222222222222222222222222222' as const

describe('known-answer calldata (identical to the AgentFlow dashboard builders)', () => {
  const V = {
    "usdc_5000000": "0xe9ae5c5300000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000007836000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a9059cbb000000000000000000000000222222222222222222222222222222222222222200000000000000000000000000000000000000000000000000000000004c4b400000000000000000",
    "deposit_1e16": "0xe9ae5c530000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000780000000071727De22E5E9d8BAf0edAc6f37da0320000000000000000000000000000000000000000000000000000000000000000205c28780000000000000000000000002222222222222222222222222222222222222222000000000000000000000000000000000000000000000000002386f26fc100000000000000000000",
    "reset_from_3": "0x1f1b92e30000000000000000000000000000000000000000000000000000000000000004",
    "revoke_4eb4b6db_2": "0xe6f3d50a024eb4b6db000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000001800000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000030000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000",
    "eurc_7": "0xe9ae5c53000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000078bEf5f6d51CB62b58e6A8f77868681825C6fe21c10000000000000000000000000000000000000000000000000000000000000000a9059cbb000000000000000000000000222222222222222222222222222222222222222200000000000000000000000000000000000000000000000000000000000000070000000000000000"
  } as const
  test('USDC withdrawal, gas deposit withdrawal, reset, revoke, EURC withdrawal', () => {
    expect(withdrawalData(TO, 5_000_000n)).toBe(V.usdc_5000000)
    expect(reserveWithdrawalData(TO, 10n ** 16n)).toBe(V.deposit_1e16)
    expect(resetTx(K, 3).data).toBe(V.reset_from_3)
    expect(revokeTx(K, '0x4eb4b6db', 2).data).toBe(V.revoke_4eb4b6db_2)
    expect(tokenWithdrawalTx(K, NETWORKS.mainnet.eurc, 'EURC', TO, 7n).data).toBe(V.eurc_7)
  })
})

const net = NETWORKS.testnet
const single = (target: Hex, value: bigint, data: Hex, mode: Hex = pad('0x00', { size: 32 })) =>
  encodeFunctionData({ abi: KERNEL_ABI, functionName: 'execute', args: [mode, concatHex([target, pad(`0x${value.toString(16)}`, { size: 32 }), data])] })
const transfer = (to: Hex, v: bigint) => encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [to, v] })
const refused = (tx: { to: Hex; data: Hex }) => describeOwnerTx(tx as never, K, net).some((l) => l.startsWith('UNEXPECTED'))

describe('pre-signature decoder', () => {
  test('describes every transaction the page builds, without refusing it', () => {
    for (const tx of [resetTx(K, 3), revokeTx(K, '0x4eb4b6db', 2), tokenWithdrawalTx(K, net.usdc, 'USDC', TO, 5_000_000n),
      tokenWithdrawalTx(K, net.eurc, 'EURC', TO, 7n), depositWithdrawalTx(K, TO, 10n ** 16n)]) expect(refused(tx)).toBe(false)
    expect(describeOwnerTx(tokenWithdrawalTx(K, net.usdc, 'USDC', TO, 5_000_000n), K, net).join(' ')).toContain('transfers 5 USDC')
  })
  test('refuses calldata the page would never build', () => {
    const cases: [string, { to: Hex; data: Hex }][] = [
      ['sent to another address than the wallet', { to: TO, data: resetTx(K, 3).data }],
      ['batch execution mode', { to: K, data: single(net.usdc, 0n, transfer(TO, 1n), pad('0x01', { size: 32, dir: 'right' })) }],
      ['native value attached to the call', { to: K, data: single(TO, 1n, '0x') }],
      ['a call to an unknown contract', { to: K, data: single('0x3333333333333333333333333333333333333333', 0n, transfer(TO, 1n)) }],
      ['an approval instead of a transfer', { to: K, data: single(net.usdc, 0n, encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [TO, 1n] })) }],
      ['an unknown token call', { to: K, data: single(net.usdc, 0n, '0xdeadbeef') }],
      ['an EntryPoint call other than withdrawTo', { to: K, data: single(ENTRYPOINT_V07, 0n, ('0xb760faf9' + '0'.repeat(64)) as Hex) }],
      ['a wallet function the page does not use (upgradeTo)', { to: K, data: ('0x3659cfe6' + '0'.repeat(64)) as Hex }],
    ]
    for (const [why, tx] of cases) expect([why, refused(tx)]).toEqual([why, true])
  })
  test('refuses destinations that are not an address the owner controls', () => {
    for (const bad of ['0x0000000000000000000000000000000000000000', K, net.usdc, net.eurc, ENTRYPOINT_V07, 'not-an-address', '0x1234'])
      expect(() => parseDestination(bad, K, net)).toThrow()
    expect(parseDestination(TO, K, net)).toBe('0x2222222222222222222222222222222222222222')
  })
})

describe('standalone artifact', () => {
  test('builds reproducibly: two clean builds are byte-identical, and the .sha256 file matches the html', async () => {
    const a = await buildOwnerRecovery(mkdtempSync(join(tmpdir(), 'afr-a-')))
    const b = await buildOwnerRecovery(mkdtempSync(join(tmpdir(), 'afr-b-')))
    expect(a.sha256).toBe(b.sha256)
    expect(readFileSync(a.file).equals(readFileSync(b.file))).toBe(true)
    expect(createHash('sha256').update(readFileSync(a.file)).digest('hex')).toBe(a.sha256)
    expect(readFileSync(`${a.file}.sha256`, 'utf8')).toBe(`${a.sha256}  ${ARTIFACT}\n`)
  }, 120_000)
  test('is self-contained: strict CSP, one inline script, no external resources, backend routes or browser storage', async () => {
    const o = await buildOwnerRecovery(mkdtempSync(join(tmpdir(), 'afr-c-')))
    const html = readFileSync(o.file, 'utf8')
    expect(html).toMatch(/<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src https: http:\/\/127\.0\.0\.1:\* http:\/\/localhost:\*/)
    expect(html.match(/<script\b[^>]*>/g)).toEqual(['<script>'])
    expect(html).not.toMatch(/<link\b|<iframe\b|@import|src=["']https?:/i)
    for (const s of ['/api/v3', '/api/me', '/api/kernel', '/api/siwe', '/mcp', '/oauth', 'localStorage', 'indexedDB', 'sessionStorage']) expect([s, html.includes(s)]).toEqual([s, false])
    expect(html).not.toMatch(/\beval\(|new Function\(/)
    expect(html).toContain(o.build) // the page names the commit it was built from
  }, 120_000)
})
