import { concatHex, encodeFunctionData, erc20Abi, pad, type Hex } from 'viem'

/** USDC on Arc (mainnet and testnet use the same address): an ERC-20 view of Arc's native USDC, 6 decimals */
export const ARC_USDC = '0x3600000000000000000000000000000000000000' as const
/** EntryPoint v0.7: holds the wallet's gas deposit (unused network-fee prefunds) */
export const ENTRYPOINT_V07 = '0x0000000071727De22E5E9d8BAf0edAc6f37da032' as const
export const WITHDRAW_TO_ABI = [{ type: 'function', name: 'withdrawTo', stateMutability: 'nonpayable', outputs: [], inputs: [{ name: 'withdrawAddress', type: 'address' }, { name: 'withdrawAmount', type: 'uint256' }] }] as const

/** USDC withdrawal sent by the owner straight to the wallet: execute(single: USDC.transfer(destination, units)), units in 6 dp */
export function withdrawalData(destination: `0x${string}`, units: bigint): Hex {
  const transfer = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [destination, units] })
  return encodeFunctionData({ abi: [{ type: 'function', name: 'execute', stateMutability: 'payable', outputs: [], inputs: [{ name: 'mode', type: 'bytes32' }, { name: 'executionCalldata', type: 'bytes' }] }], functionName: 'execute', args: [pad('0x00', { size: 32 }), concatHex([ARC_USDC, pad('0x00', { size: 32 }), transfer])] })
}

/**
 * Gas deposit withdrawal: execute(single: EntryPoint.withdrawTo(destination, wei)). Only the wallet itself can withdraw its
 * EntryPoint deposit (withdrawTo uses msg.sender), so the owner sends this to the wallet. Native USDC has 18 decimals on Arc.
 */
export function reserveWithdrawalData(destination: `0x${string}`, wei: bigint): Hex {
  const inner = encodeFunctionData({ abi: WITHDRAW_TO_ABI, functionName: 'withdrawTo', args: [destination, wei] })
  return encodeFunctionData({ abi: [{ type: 'function', name: 'execute', stateMutability: 'payable', outputs: [], inputs: [{ name: 'mode', type: 'bytes32' }, { name: 'executionCalldata', type: 'bytes' }] }], functionName: 'execute', args: [pad('0x00', { size: 32 }), concatHex([ENTRYPOINT_V07, pad('0x00', { size: 32 }), inner])] })
}
