import { encodeFunctionData, erc20Abi, getAddress, isAddress, zeroAddress, type Address, type Hex } from 'viem';
import { usdc } from './config';
import { amountOf } from './domain';
export type TransactionRequest = { to: Address; value?: bigint; data?: Hex };
/** Prepare a real USDC transfer; this does not request a signature or send anything. */
export function prepareUsdcTransfer(recipient: string, amount: string): TransactionRequest {
  if (!isAddress(recipient) || recipient.toLowerCase() === zeroAddress) throw new Error('Enter a valid recipient wallet address.');
  return {to:usdc,value:0n,data:encodeFunctionData({abi:erc20Abi,functionName:'transfer',args:[getAddress(recipient),amountOf(amount)]})};
}
