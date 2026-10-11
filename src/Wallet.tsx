import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { getAddress, type Address, type EIP1193Provider } from 'viem';
import QRCode from 'qrcode';
import { chain, wcProjectId } from './lib/config';
import { errorMessage } from './lib/domain';
import type { TransactionRequest } from './lib/transactions';
import type { Hash } from 'viem';
import { connectedClient } from './lib/wallet-client';
type Provider = EIP1193Provider & { on?: (event:string, cb:(...args:any[])=>void)=>void; removeListener?: (event:string,cb:(...args:any[])=>void)=>void; disconnect?: ()=>Promise<void> };
type Choice = { id:string; name:string; provider:Provider };
type WalletContext = {account?:Address;chainId?:number;connecting:boolean;open:()=>void;disconnect:()=>void;ensure:()=>Promise<{account:Address;client:ReturnType<typeof connectedClient>}>;sendTransaction:(request:TransactionRequest)=>Promise<Hash>};
const Context = createContext<WalletContext | null>(null);
export const useWallet = () => { const value=useContext(Context);if(!value)throw new Error('Wallet context missing');return value; };
export function WalletProvider({children}:{children:ReactNode}) {
  const [choices,setChoices]=useState<Choice[]>([]),[account,setAccount]=useState<Address>(),[chainId,setChainId]=useState<number>();
  const [show,setShow]=useState(false),[connecting,setConnecting]=useState(false),[error,setError]=useState(''),[qr,setQr]=useState(''),[uri,setUri]=useState('');
  const provider=useRef<Provider | undefined>(undefined),detach=useRef<()=>void>(()=>{}),generation=useRef(0),attempt=useRef(false);
  const cancelPairing=useRef<(()=>void) | undefined>(undefined);
  const closeRef=useRef<HTMLButtonElement>(null),dialogRef=useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    const announce=(event:Event)=>{const detail=(event as CustomEvent).detail;if(!detail?.provider?.request||!detail?.info?.uuid)return;
      setChoices(previous=>previous.some(p=>p.provider===detail.provider)?previous:[...previous,{id:detail.info.rdns||detail.info.uuid,name:String(detail.info.name).slice(0,60),provider:detail.provider}]);};
    window.addEventListener('eip6963:announceProvider',announce);window.dispatchEvent(new Event('eip6963:requestProvider'));
    const fallback=setTimeout(()=>{const ethereum=(window as unknown as {ethereum?:Provider}).ethereum;if(ethereum)setChoices(p=>p.length?p:[{id:'browser',name:'Browser wallet',provider:ethereum}]);},500);
    return()=>{clearTimeout(fallback);window.removeEventListener('eip6963:announceProvider',announce);detach.current();};
  },[]);
  useEffect(()=>{if(show){dialogRef.current?.showModal();closeRef.current?.focus();}else dialogRef.current?.close();},[show]);
  useEffect(()=>{
    if(provider.current||attempt.current)return;let preferred='';try{preferred=localStorage.getItem('arc-de-split:wallet')||'';}catch{}
    const choice=choices.find(c=>c.id===preferred);if(!choice)return;let cancelled=false;
    void choice.provider.request({method:'eth_accounts'}).then(async accounts=>{
      const list=accounts as string[];if(cancelled||attempt.current||provider.current||!list[0])return;
      const id=await choice.provider.request({method:'eth_chainId'});if(cancelled||attempt.current||provider.current)return;
      attach(choice.provider);setAccount(getAddress(list[0]));setChainId(Number(id));
    }).catch(()=>{});return()=>{cancelled=true;};
  },[choices]);
  function attach(p:Provider){
    detach.current();provider.current=p;
    const accountsChanged=(accounts:string[])=>{generation.current++;setAccount(accounts[0]?getAddress(accounts[0]):undefined);};
    const chainChanged=(id:string)=>{generation.current++;setChainId(Number(id));};
    const disconnected=()=>{generation.current++;detach.current();provider.current=undefined;setAccount(undefined);setChainId(undefined);};
    p.on?.('accountsChanged',accountsChanged);p.on?.('chainChanged',chainChanged);p.on?.('disconnect',disconnected);
    detach.current=()=>{p.removeListener?.('accountsChanged',accountsChanged);p.removeListener?.('chainChanged',chainChanged);p.removeListener?.('disconnect',disconnected);};
  }
  async function connect(choice?:Choice){
    if(attempt.current)return;attempt.current=true;setConnecting(true);setError('');setQr('');setUri('');
    try{
      let p=choice?.provider;
      if(!p){
        const {EthereumProvider}=await import('@walletconnect/ethereum-provider');
        const remote=await EthereumProvider.init({projectId:wcProjectId,optionalChains:[chain.id],showQrModal:false,rpcMap:{[chain.id]:chain.rpcUrls.default.http[0]},metadata:{name:'Arc-de-Split',description:'Pay your own share in USDC.',url:window.location.origin,icons:[new URL('/logo.svg',window.location.origin).href]}});
        remote.on('display_uri',(value:string)=>{setUri(value);void QRCode.toDataURL(value,{width:280,margin:2,errorCorrectionLevel:'M'}).then(setQr);});
        let cancelled=false;
        const aborted=new Promise<never>((_,reject)=>{cancelPairing.current=()=>{cancelled=true;reject(new Error('Connection cancelled.'));void remote.disconnect().catch(()=>{});};});
        await Promise.race([remote.connect().then(()=>{if(cancelled)void remote.disconnect().catch(()=>{});}),aborted]);p=remote as unknown as Provider;
      }
      const accounts=await p.request({method:'eth_requestAccounts'}) as string[];
      if(!accounts[0])throw new Error('No wallet account was selected.');
      const id=await p.request({method:'eth_chainId'});
      attach(p);setAccount(getAddress(accounts[0]));setChainId(Number(id));setShow(false);setQr('');setUri('');
      try{localStorage.setItem('arc-de-split:wallet',choice?.id||'walletconnect');}catch{}
    }catch(e){setError(errorMessage(e));}finally{cancelPairing.current=undefined;attempt.current=false;setConnecting(false);}
  }
  function disconnect(){generation.current++;const p=provider.current;detach.current();provider.current=undefined;setAccount(undefined);setChainId(undefined);try{localStorage.removeItem('arc-de-split:wallet');}catch{}void p?.disconnect?.().catch(()=>{});}
  async function ensure(){
    const p=provider.current;if(!p){setShow(true);throw new Error('Connect a wallet to continue.');}
    if(Number(await p.request({method:'eth_chainId'}))!==chain.id){
      try{await p.request({method:'wallet_switchEthereumChain',params:[{chainId:`0x${chain.id.toString(16)}`}]});}
      catch(e){if((e as {code?:number}).code!==4902)throw e;
        await p.request({method:'wallet_addEthereumChain',params:[{chainId:`0x${chain.id.toString(16)}`,chainName:chain.name,nativeCurrency:chain.nativeCurrency,rpcUrls:[...chain.rpcUrls.default.http],blockExplorerUrls:[chain.blockExplorers.default.url]}]});
        await p.request({method:'wallet_switchEthereumChain',params:[{chainId:`0x${chain.id.toString(16)}`}]});}
    }
    const id=Number(await p.request({method:'eth_chainId'}));
    const accounts=await p.request({method:'eth_accounts'}) as string[];
    if(id!==chain.id||!accounts[0])throw new Error(`Select ${chain.name} and a wallet account to continue.`);
    const current=getAddress(accounts[0]);setAccount(current);setChainId(id);
    const epoch=generation.current;
    return {account:current,client:connectedClient(p,current,()=>provider.current===p&&generation.current===epoch)};
  }
  async function sendTransaction(request:TransactionRequest){const session=await ensure();return session.client.sendTransaction({...request,account:session.account,chain});}
  return <Context.Provider value={{account,chainId,connecting,open:()=>{setError('');setShow(true);window.dispatchEvent(new Event('eip6963:requestProvider'));},disconnect,ensure,sendTransaction}}>
    {children}
    <dialog ref={dialogRef} className="wallet-dialog" aria-labelledby="wallet-title" onCancel={e=>{if(connecting&&!qr)e.preventDefault();else{cancelPairing.current?.();setShow(false);}}} onClick={e=>{if(e.target===dialogRef.current&&!connecting)setShow(false);}}>
      <div className="dialog-top"><h2 id="wallet-title">Connect your wallet</h2><button ref={closeRef} className="icon-button" aria-label="Close wallet selection" disabled={connecting&&!qr} onClick={()=>{cancelPairing.current?.();setShow(false);}}>×</button></div>
      <p>Choose a wallet to continue.</p>
      {choices.map(c=><button key={c.id} className="wallet-option" disabled={connecting} onClick={()=>void connect(c)}><span>{c.name}</span><span aria-hidden="true">↗</span></button>)}
      {wcProjectId&&<button className="wallet-option" disabled={connecting} onClick={()=>void connect()}><span>WalletConnect</span><span>QR / Mobile</span></button>}
      {!choices.length&&!wcProjectId&&<p className="empty-message">Open this page in your wallet’s browser or install a browser wallet such as MetaMask or Rabby.</p>}
      {connecting&&<div className="status-line" role="status"><span className="spinner"/>Waiting for your wallet…</div>}
      {qr&&<div className="qr-pairing"><img src={qr} width="280" height="280" alt="Scan this QR code in your wallet to connect"/><p>Scan with your wallet’s WalletConnect scanner.</p><button className="link-button" onClick={()=>void navigator.clipboard.writeText(uri).catch(()=>setError('Could not copy. Scan the QR code instead.'))}>Copy connection link</button></div>}
      {error&&<p className="error" role="alert">{error}</p>}
    </dialog>
  </Context.Provider>;
}
