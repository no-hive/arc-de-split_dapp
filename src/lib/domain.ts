import { formatUnits, parseUnits, type Address } from 'viem';
export type Draft = { id: string; name: string; amount: string };
export type Bill = { code: number; merchant: Address; total: bigint; paidTotal: bigint; creationBlock?: bigint; items: { name: string; amount: bigint; payer: Address }[] };
export function amountOf(value: string): bigint {
  if (!/^\d{1,7}(?:[.,]\d{1,6})?$/.test(value.trim())) throw new Error('Use a price with up to six decimal places.');
  const amount = parseUnits(value.trim().replace(',', '.'), 6);
  if (amount <= 0n || amount > 1_000_000_000_000n) throw new Error('Each price must be between 0.000001 and 1,000,000 USDC.');
  return amount;
}
export function draftItems(rows: Draft[]) {
  const filled = rows.filter(r => r.name.trim() || r.amount.trim());
  if (!filled.length || filled.length > 60) throw new Error('Add between 1 and 60 items.');
  return filled.map((r, index) => {
    const name = r.name.trim();
    if (!name || new TextEncoder().encode(name).length > 96) throw new Error(`Item ${index + 1} needs a name of up to 96 bytes.`);
    try { return { name, amount: amountOf(r.amount) }; }
    catch (e) { throw new Error(`Item ${index + 1}: ${(e as Error).message}`); }
  });
}
export function money(value: bigint) {
  const [whole, fraction = ''] = formatUnits(value, 6).split('.');
  return `${BigInt(whole).toLocaleString('en-US')}.${fraction.padEnd(2, '0')}`;
}
export const shortAddress = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;
export const draft = (): Draft => ({ id: crypto.randomUUID(), name: '', amount: '' });
export function errorMessage(error: unknown): string {
  const messages: string[] = []; let current = error as { message?: string; code?: number; cause?: unknown } | undefined;
  for (let i = 0; current && i < 8; i++, current = current.cause as typeof current) { if (current.code === 4001) return 'Request declined in your wallet. You can try again.'; if (current.message) messages.push(current.message); }
  const message = messages.join(' ');
  if (/Item paid or duplicate|already been paid/i.test(message)) return 'Someone just paid one of these items. Refresh the bill and choose the remaining items.';
  if (/Bill not found/i.test(message)) return 'No bill found with this number. Check it with your server.';
  if (/No bill codes left/i.test(message)) return 'All order numbers have been used. This contract cannot create more bills.';
  if (/ERC20InsufficientAllowance|insufficient allowance/i.test(message)) return 'Approve USDC spending in your wallet, then try the payment again.';
  if (/SafeERC20FailedOperation/i.test(message)) return 'The USDC transfer failed. Check your balance and spending approval.';
  if (/insufficient funds|exceeds balance|ERC20InsufficientBalance/i.test(message)) return 'Your USDC balance is too low. Leave enough USDC for the network fee.';
  if (/rejected|denied|declined/i.test(message)) return 'Request declined in your wallet. You can try again.';
  if (/timeout|timed out|HTTP|fetch|network|disconnected/i.test(message)) return 'Could not reach the network. Check your connection and try again.';
  if (/reverted/i.test(message)) return 'The transaction was not completed. Refresh the bill and try again.';
  return error instanceof Error && error.name === 'Error' && !/^\w.*(Request|RPC|Contract)/.test(message) && message.length < 200 ? error.message : 'Something went wrong. Please try again.';
}
