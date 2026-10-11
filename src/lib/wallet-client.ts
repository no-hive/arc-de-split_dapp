import {createWalletClient,custom,type Address,type EIP1193Provider} from 'viem';
import {chain} from './config';
/** Revalidate the provider, account and network immediately before signing. */
export function connectedClient(provider:EIP1193Provider,account:Address,isCurrent:()=>boolean) {
  return createWalletClient({account,chain,transport:custom({request:async(args:any)=>{
    if(args.method==='eth_sendTransaction'||args.method==='wallet_sendCalls'){
      const [network,accounts]=await Promise.all([provider.request({method:'eth_chainId'}),provider.request({method:'eth_accounts'})]);
      if(!isCurrent()||Number(network)!==chain.id||(accounts as string[])[0]?.toLowerCase()!==account.toLowerCase())throw new Error('Your wallet account or network changed. Try again.');
    }
    return provider.request(args);
  }})});
}
