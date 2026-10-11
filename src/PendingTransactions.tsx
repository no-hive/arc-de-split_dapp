import { useMemo, useState, useSyncExternalStore } from 'react';
import { publicClient, explorerTx } from './lib/config';
import { createdBillCode } from './lib/registry';
import { pendingSnapshot, parsePending, subscribePending, removePending, type PendingTransaction } from './lib/pending';
import { errorMessage } from './lib/domain';
export function usePendingTransactions() {
  const raw = useSyncExternalStore(subscribePending, pendingSnapshot, () => '[]');
  return useMemo(() => parsePending(raw), [raw]);
}
export default function PendingTransactions({ items, onConfirmed }: { items: PendingTransaction[]; onConfirmed: (item: PendingTransaction, code?: number) => void }) {
  const [checking, setChecking] = useState(''), [message, setMessage] = useState('');
  async function check(item: PendingTransaction) {
    setChecking(item.hash); setMessage('');
    try {
      const receipt = await publicClient.getTransactionReceipt({ hash: item.hash });
      removePending(item.hash);
      if (receipt.status !== 'success') { setMessage('The transaction reverted. You can review the bill and try again.'); return; }
      const code = item.kind === 'create' ? createdBillCode(receipt, item.account) : item.code;
      if (item.kind === 'create' && code === undefined) { setMessage('Transaction confirmed without a bill creation event. Check it in the explorer.'); return; }
      onConfirmed(item, code);
    } catch (error) {
      setMessage(/not found/i.test(String(error)) ? 'No receipt yet. Check the transaction in the explorer; it may still be pending or have been replaced.' : errorMessage(error));
    } finally { setChecking(''); }
  }
  return <section className="pending-transactions" aria-label="Submitted transactions">
    {items.map(item => <div className="transaction-status" key={item.hash}>
      <div><strong>{item.kind === 'create' ? 'Bill creation' : item.kind === 'approve' ? 'USDC approval' : 'Bill payment'} submitted</strong><p>Check confirmation before submitting again.</p><a href={explorerTx(item.hash)} target="_blank" rel="noopener noreferrer">View transaction ↗</a><div className="pending-actions"><button className="link-button" disabled={Boolean(checking)} onClick={() => void check(item)}>{checking === item.hash ? 'Checking…' : 'Check status'}</button><button className="link-button" disabled={Boolean(checking)} onClick={() => { if (window.confirm('Remove this reminder? This does not cancel the transaction. Check its status in the explorer before submitting again.')) removePending(item.hash); }}>Dismiss reminder</button></div></div>
    </div>)}
    {message && <p className="error" role="status">{message}</p>}
  </section>;
}
