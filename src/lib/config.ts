import { createPublicClient, defineChain, http } from 'viem';
const env = import.meta.env || {};
export const mainnet = true;
export const registryAddress = '0x50066DD18166566C4CCc44903E2c72B858d4b29d' as const;
export const deploymentBlock = 25421676n;
export const chain = defineChain({
  id: 5042, name: 'Arc Mainnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [env.VITE_RPC_URL || `https://rpc.${mainnet ? 'mainnet' : 'testnet'}.arc.io`] } },
  blockExplorers: { default: { name: 'Arc Explorer', url: `https://explorer.${mainnet ? '' : 'testnet.'}arc.io` } },
  testnet: !mainnet,
});
export const usdc = '0x3600000000000000000000000000000000000000' as const;
export const wcProjectId = env.VITE_WALLETCONNECT_PROJECT_ID || '';
export const publicClient = createPublicClient({ chain, transport: http(undefined, { timeout: 15000, retryCount: 2 }) });
export const storagePrefix = `arc-de-split:${chain.id}:${registryAddress.toLowerCase()}`;
export const explorerTx = (hash: string) => `${chain.blockExplorers.default.url}/tx/${hash}`;
export const explorerAddress = (address: string) => `${chain.blockExplorers.default.url}/address/${address}`;
