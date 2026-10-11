import { getAbiItem, type Address } from 'viem';
import { deploymentBlock, publicClient, registryAddress, storagePrefix } from './config';
import { registryAbi } from './registry-abi';
import { registryService, type RegistryClient } from './registry';
import type { Bill } from './domain';
type Entry = { code: number; block: string };
type Index = { through: string; entries: Entry[] };
export type HistoryProgress = { scanned: bigint; total: bigint; found: number; stage: 'scan' | 'bills' };
const created = getAbiItem({ abi: registryAbi, name: 'BillCreated' });

/** Cache only event locations; every bill and paid item is freshly read from Arc. */
export async function fetchBillsForAddress(address: Address, options: { signal?: AbortSignal; onProgress?: (progress: HistoryProgress) => void; client?: RegistryClient } = {}): Promise<Bill[]> {
  const client = options.client || publicClient;
  const service = registryService(client);
  await service.assertNetwork();
  const key = `${storagePrefix}:history-v1:${address.toLowerCase()}`;
  let index: Index = { through: String(deploymentBlock - 1n), entries: [] };
  try { const cached = JSON.parse(localStorage.getItem(key) || 'null'); if (cached && /^\d+$/.test(cached.through) && Array.isArray(cached.entries) && cached.entries.every((e: Entry) => Number.isInteger(e.code) && e.code >= 100000 && e.code <= 999999 && /^\d+$/.test(e.block))) index = cached; } catch { /* Optional cache. */ }
  const stop = () => { if (options.signal?.aborted) throw new DOMException('History loading cancelled.', 'AbortError'); };
  const latest = await client.getBlockNumber({ cacheTime: 0 });
  // Never skip historical ranges when a cached checkpoint is from a different chain state.
  if (BigInt(index.through) > latest || BigInt(index.through) < deploymentBlock - 1n) index = { through: String(deploymentBlock - 1n), entries: [] };
  let from = BigInt(index.through) + 1n;
  const start = from;
  let chunk = 10_000n;
  const entries = new Map(index.entries.map(e => [e.code, e]));
  while (from <= latest) {
    stop();
    const to = from + chunk - 1n < latest ? from + chunk - 1n : latest;
    try {
      const logs = await client.getLogs({ address: registryAddress, event: created, args: { merchant: address }, fromBlock: from, toBlock: to, strict: true });
      stop();
      for (const log of logs) if (log.blockNumber !== null) entries.set(log.args.code, { code: log.args.code, block: String(log.blockNumber) });
      index = { through: String(to), entries: [...entries.values()] };
      try { localStorage.setItem(key, JSON.stringify(index)); } catch { /* Reads still work without storage. */ }
      options.onProgress?.({ scanned: to - start + 1n, total: latest - start + 1n, found: entries.size, stage: 'scan' });
      from = to + 1n;
    } catch (error) {
      stop();
      // Providers limit eth_getLogs ranges differently. Retry the same range in smaller pieces.
      if (chunk <= 100n) throw error;
      chunk = chunk / 2n < 100n ? 100n : chunk / 2n;
    }
  }
  const list = [...entries.values()].sort((a, b) => b.code - a.code);
  const bills: Bill[] = [];
  for (let i = 0; i < list.length; i += 4) {
    stop();
    const batch = await Promise.all(list.slice(i, i + 4).map(async entry => ({ ...await service.readBill(entry.code, latest), creationBlock: BigInt(entry.block) })));
    if (batch.some(b => b.merchant.toLowerCase() !== address.toLowerCase())) throw new Error('History could not be verified. Please reload.');
    bills.push(...batch);
    options.onProgress?.({ scanned: BigInt(bills.length), total: BigInt(list.length), found: list.length, stage: 'bills' });
  }
  stop(); return bills;
}
