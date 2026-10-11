import {useEffect,useRef,useState} from 'react';
import {useWallet} from './Wallet';
import {fetchBillsForAddress,type HistoryProgress} from './lib/history';
import {errorMessage,money,shortAddress,type Bill} from './lib/domain';

export default function RestaurantHistory(){
  const wallet=useWallet();
  const [bills,setBills]=useState<Bill[]>([]),[loaded,setLoaded]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const [progress,setProgress]=useState<HistoryProgress>();
  const controller=useRef<AbortController | undefined>(undefined);
  const request=useRef(0),mounted=useRef(true),account=useRef(wallet.account);
  account.current=wallet.account;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;request.current++;controller.current?.abort();};},[]);
  useEffect(()=>{controller.current?.abort();request.current++;setProgress(undefined);setBills([]);setLoaded(false);setLoading(false);setError('');},[wallet.account]);
  async function fetchAll(){
    if(!wallet.account){wallet.open();return;}
    if(loading)return;
    const address=wallet.account,id=++request.current;setLoading(true);setError('');setProgress(undefined);
    controller.current=new AbortController();
    try{const next=await fetchBillsForAddress(address,{signal:controller.current.signal,onProgress:p=>{if(mounted.current&&id===request.current)setProgress(p);}});if(mounted.current&&id===request.current&&address===account.current){setBills(next);setLoaded(true);}}
    catch(e){if(mounted.current&&id===request.current)setError(e instanceof DOMException&&e.name==='AbortError'?'Loading stopped. Click Get all bills to resume.':errorMessage(e));}
    finally{if(mounted.current&&id===request.current)setLoading(false);}
  }
  return <section className="receipt history-panel" aria-label="Restaurant bill history">
    <div className="history-top"><div><h2>Your bills</h2>{wallet.account?<p className="history-wallet">Wallet <span className="mono">{shortAddress(wallet.account)}</span></p>:<p className="history-wallet">Connect your restaurant wallet to view its bills.</p>}</div><button className="button" onClick={()=>void fetchAll()} disabled={loading}>{loading?<><span className="spinner light"/>Loading bills…</>:'Get all bills'}</button></div>
    {loading&&<p className="history-progress" role="status">{progress?progress.stage==='scan'?`Scanning Arc: ${progress.total?Number(progress.scanned*100n/progress.total):100}% · ${progress.found} bills found`:`Loading receipts: ${progress.scanned} / ${progress.total}`:'Connecting to Arc…'}<button className="link-button" onClick={()=>controller.current?.abort()}>Stop</button></p>}
    {error&&<p className="error" role="alert">{error}</p>}
    <div aria-live="polite" aria-busy={loading}>
      {!loaded&&!loading&&!error&&<p className="history-empty">No bills loaded.</p>}
      {loaded&&!bills.length&&<p className="history-empty">No bills found for this wallet.</p>}
      {bills.length>0&&<><p className="history-count meta">{bills.length} {bills.length===1?'bill':'bills'}</p><ul className="history-list">{bills.map(bill=><li key={bill.code}><a className="history-row" href={`#/restaurant/bill/${bill.code}`}><div><strong className="mono history-code">{bill.code}</strong><span className="history-date">{bill.creationBlock&&<>Block {bill.creationBlock.toLocaleString('en-US')} · </>}{bill.items.length} {bill.items.length===1?'item':'items'}</span></div><strong className="mono history-total">{money(bill.total)} <small>USDC</small></strong><span className="history-status">{bill.paidTotal===bill.total?'Paid':bill.paidTotal>0n?'Partly paid':'Unpaid'}</span><span className="history-arrow" aria-hidden="true">→</span></a></li>)}</ul></>}
    </div>
  </section>;
}
