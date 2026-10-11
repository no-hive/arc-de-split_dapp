import { erc20Abi, parseEventLogs, zeroAddress, type Address, type Hash, type TransactionReceipt } from 'viem';
import { publicClient, registryAddress, usdc, chain } from './config';
import { registryAbi } from './registry-abi';
import { connectedClient } from './wallet-client';
import { addPending, removePending, type PendingTransaction } from './pending';
import type { Bill } from './domain';
export type Session = { account: Address; client: ReturnType<typeof connectedClient> };
export type Progress = { message: string; hash?: Hash };
export type Reporter = (progress: Progress) => void;
export type RegistryClient = typeof publicClient;
export type BillItem = { name: string; amount: bigint };

export function createdBillCode(receipt: TransactionReceipt, account: Address): number | undefined {
  const events = parseEventLogs({ abi: registryAbi, eventName: 'BillCreated', logs: receipt.logs.filter(log => log.address.toLowerCase() === registryAddress.toLowerCase()) });
  return events.find(event => event.args.merchant.toLowerCase() === account.toLowerCase())?.args.code;
}

export function selectedAmount(bill: Bill, indices: number[]): bigint {
  if (!indices.length) throw new Error('Choose at least one item.');
  if (new Set(indices).size !== indices.length) throw new Error('An item was selected more than once.');
  return indices.reduce((total, i) => {
    if (!Number.isInteger(i) || i < 0 || !bill.items[i]) throw new Error('Invalid item selection. Refresh the bill.');
    if (bill.items[i].payer.toLowerCase() !== zeroAddress) throw new Error('An item has already been paid.');
    return total + bill.items[i].amount;
  }, 0n);
}

/** All receipt state comes from Arc; no local bill data or direct transfers. */
export function registryService(client: RegistryClient = publicClient) {
  async function assertNetwork() {
    if (await client.getChainId() !== chain.id) throw new Error('The configured RPC is not Arc Mainnet. Check VITE_RPC_URL.');
  }
  async function readBill(code: number, blockNumber?: bigint): Promise<Bill> {
    if (!Number.isInteger(code) || code < 100000 || code > 999999) throw new Error('Enter the six-digit order number.');
    const b = await client.readContract({ address: registryAddress, abi: registryAbi, functionName: 'getBill', args: [code], blockNumber });
    return { code, merchant: b.merchant, total: b.totalAmount, paidTotal: b.paidAmount, items: b.items.map(i => ({ name: i.name, amount: i.price, payer: i.paidBy })) };
  }
  async function confirm(pending: PendingTransaction, report: Reporter, message: string) {
    let tracked = pending;
    let replaced = false;
    addPending(tracked); report({ message, hash: tracked.hash });
    // A timeout never means failure: the persisted hash remains available for recovery.
    const receipt = await client.waitForTransactionReceipt({ hash: pending.hash, confirmations: 1, timeout: 180_000, pollingInterval: 2000,
      onReplaced: replacement => {
        replaced = replacement.reason !== 'repriced';
        removePending(tracked.hash);
        tracked = { ...pending, hash: replacement.transactionReceipt.transactionHash };
        addPending(tracked); report({ message, hash: tracked.hash });
      },
    });
    removePending(tracked.hash);
    if (replaced) throw new Error('The transaction was cancelled or replaced in your wallet. Review the bill before trying again.');
    if (receipt.status !== 'success') throw new Error('The transaction reverted. No bill changes were saved.');
    return receipt;
  }
  async function createBill(session: Session, items: BillItem[], report: Reporter) {
    await assertNetwork();
    report({ message: 'Checking your bill…' });
    const { request } = await client.simulateContract({ address: registryAddress, abi: registryAbi, functionName: 'createBill', args: [items.map(i => i.name), items.map(i => i.amount)], account: session.account });
    report({ message: 'Confirm bill creation in your wallet…' });
    const hash = await session.client.writeContract({ ...request, chain });
    const receipt = await confirm({ hash, kind: 'create', account: session.account }, report, 'Creating your bill on Arc…');
    const code = createdBillCode(receipt, session.account);
    if (code === undefined) throw new Error('Transaction confirmed without a bill creation event. Check the transaction in the explorer.');
    return { code, hash: receipt.transactionHash };
  }
  async function payItems(session: Session, code: number, indices: number[], expectedTotal: bigint, report: Reporter) {
    await assertNetwork();
    async function validateSelection() {
      const amount = selectedAmount(await readBill(code), indices);
      if (amount !== expectedTotal) throw new Error('The selected amount changed. Review your payment again.');
      return amount;
    }
    report({ message: 'Checking items and USDC approval…' });
    const amount = await validateSelection();
    const [balance, allowance] = await Promise.all([
      client.readContract({ address: usdc, abi: erc20Abi, functionName: 'balanceOf', args: [session.account] }),
      client.readContract({ address: usdc, abi: erc20Abi, functionName: 'allowance', args: [session.account, registryAddress] }),
    ]);
    if (balance < amount) throw new Error('Your USDC balance is too low. Leave enough USDC for the network fee.');
    if (allowance < amount) {
      const { request } = await client.simulateContract({ address: usdc, abi: erc20Abi, functionName: 'approve', args: [registryAddress, amount], account: session.account });
      report({ message: 'Approve the selected USDC amount in your wallet…' });
      const hash = await session.client.writeContract({ ...request, chain });
      await confirm({ hash, kind: 'approve', account: session.account, code }, report, 'Confirming USDC approval…');
    }
    report({ message: 'Checking your items before payment…' });
    await validateSelection();
    const { request } = await client.simulateContract({ address: registryAddress, abi: registryAbi, functionName: 'payItems', args: [code, indices.map(BigInt)], account: session.account });
    report({ message: 'Confirm payment in your wallet…' });
    const hash = await session.client.writeContract({ ...request, chain });
    const receipt = await confirm({ hash, kind: 'pay', account: session.account, code }, report, 'Confirming your payment on Arc…');
    const events = parseEventLogs({ abi: registryAbi, eventName: 'ItemsPaid', logs: receipt.logs.filter(log => log.address.toLowerCase() === registryAddress.toLowerCase()) });
    const event = events.find(e => e.args.code === code && e.args.payer.toLowerCase() === session.account.toLowerCase() && e.args.amount === amount && e.args.indices.length === indices.length && e.args.indices.every((v, i) => v === BigInt(indices[i])));
    if (!event) throw new Error('Transaction confirmed without the expected payment event. Refresh the bill and check the explorer.');
    return { hash: receipt.transactionHash };
  }
  return { readBill, createBill, payItems, assertNetwork };
}
export const registry = registryService();
