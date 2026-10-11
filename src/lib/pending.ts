import type { Address, Hash } from 'viem';
import { storagePrefix } from './config';
export type PendingTransaction = { hash: Hash; kind: 'create' | 'approve' | 'pay'; account: Address; code?: number };
export const pendingKey = `${storagePrefix}:pending`;
const eventName = 'arc-de-split:pending-updated';
let fallback = '[]';
export function pendingSnapshot(): string {
  try { return localStorage.getItem(pendingKey) || '[]'; } catch { return fallback; }
}
export function parsePending(raw: string): PendingTransaction[] {
  try { const items = JSON.parse(raw); return Array.isArray(items) ? items.filter(p => /^0x[0-9a-f]{64}$/i.test(p.hash) && /^0x[0-9a-f]{40}$/i.test(p.account) && ['create', 'approve', 'pay'].includes(p.kind)) : []; } catch { return []; }
}
function save(items: PendingTransaction[]) {
  fallback = JSON.stringify(items);
  try { localStorage.setItem(pendingKey, fallback); } catch { /* Tracking still works in memory. */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(eventName));
}
export function addPending(item: PendingTransaction) { save([...parsePending(pendingSnapshot()).filter(p => p.hash !== item.hash), item]); }
export function removePending(hash: Hash) { save(parsePending(pendingSnapshot()).filter(p => p.hash !== hash)); }
export function subscribePending(listener: () => void) {
  const storage = (event: StorageEvent) => { if (event.key === pendingKey) listener(); };
  window.addEventListener('storage', storage); window.addEventListener(eventName, listener);
  return () => { window.removeEventListener('storage', storage); window.removeEventListener(eventName, listener); };
}
