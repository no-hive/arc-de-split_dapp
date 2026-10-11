import { useEffect, useRef, useState, type FormEvent } from 'react';
import { erc20Abi, zeroAddress } from 'viem';
import { useWallet } from './Wallet';
import { chain, explorerAddress, explorerTx, publicClient, registryAddress, usdc } from './lib/config';
import { registry, type Progress } from './lib/registry';
import PendingTransactions, { usePendingTransactions } from './PendingTransactions';
import { amountOf, draft, draftItems, errorMessage, money, shortAddress, type Bill } from './lib/domain';
import RestaurantHistory from './RestaurantHistory';
const go=(route:string)=>{location.hash=route;};
const getRoute=()=>location.hash.slice(1)||'/';
const paid=(payer:string)=>payer!==zeroAddress;
function Arrow({left=false}:{left?:boolean}){return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" style={left?{transform:'rotate(180deg)'}:undefined}><path d="M4 12h15m-6-6 6 6-6 6"/></svg>;}
function Heading({title,back='/',label}:{title:string;back?:string;label?:string}){return <div className="page-heading"><a className="back" href={`#${back}`}><Arrow left/><span>Back</span></a><div>{label&&<p className="eyebrow">{label}</p>}<h1>{title}</h1></div></div>;}
function Steps(){return <aside className="steps"><h2>What happens next</h2><ol>{[
  ['Create the bill','Add each item and its price, then get an order number.'],
  ['Share the order number','Give the same number to everyone at the table.'],
  ['Guests choose their items','Each guest enters the number, selects their items and pays in USDC.'],
  ['Deserved money is on Arc.',''],
].map(([title,text],i)=><li key={title}><span className="step-number">{i+1}</span><div><h3>{title}</h3>{text&&<p>{text}</p>}</div></li>)}</ol></aside>;}
export default function App(){
  const wallet=useWallet();
  const [route,setRoute]=useState(getRoute),[rows,setRows]=useState(()=>[draft(),draft()]),[codeInput,setCodeInput]=useState('');
  const [loadedBill,setBill]=useState<Bill>(),[error,setError]=useState(''),[selected,setSelected]=useState<number[]>([]),[copied,setCopied]=useState('');
  const [balance,setBalance]=useState<bigint>(),[balanceError,setBalanceError]=useState(false),[review,setReview]=useState(false),[notice,setNotice]=useState('');
  const reviewRef=useRef<HTMLDialogElement>(null),titleRef=useRef<HTMLElement>(null),selectAllRef=useRef<HTMLInputElement>(null);
  const [busy,setBusy]=useState(false),[progress,setProgress]=useState<Progress>(),[billLoading,setBillLoading]=useState(false),[billError,setBillError]=useState(''),[refreshTick,setRefreshTick]=useState(0);
  const [payment,setPayment]=useState<{code:number;indices:number[];total:bigint;account:string}>();
  const operation=useRef(false),routeRef=useRef(route);routeRef.current=route;
  const pending=usePendingTransactions();
  const hasPending=pending.some(p=>p.account.toLowerCase()===wallet.account?.toLowerCase());
  const match=route.match(/^\/(restaurant\/)?bill\/(\d{6})$/),code=match?Number(match[2]):undefined,venueView=Boolean(match?.[1]);
  const bill=loadedBill?.code===code?loadedBill:undefined;
  useEffect(()=>{const update=()=>setRoute(getRoute());window.addEventListener('hashchange',update);return()=>window.removeEventListener('hashchange',update);},[]);
  useEffect(()=>{setError('');setSelected([]);setCodeInput('');setCopied('');setNotice('');setReview(false);window.scrollTo({top:0});titleRef.current?.focus();document.title=route==='/about'?'About the Project — Arc-de-Split':'Arc-de-Split';},[route]);
  useEffect(()=>{
    if(code===undefined){setBill(undefined);setBillLoading(false);setBillError('');return;}
    let cancelled=false,timer:ReturnType<typeof setTimeout>;
    setBillLoading(true);setBillError('');
    async function refresh(){
      try{const next=await registry.readBill(code!);if(!cancelled){setBill(next);setBillError('');}}
      catch(e){if(!cancelled)setBillError(errorMessage(e));}
      finally{if(!cancelled){setBillLoading(false);timer=setTimeout(()=>{if(document.visibilityState==='visible')void refresh();else timer=setTimeout(()=>void refresh(),6000);},6000);}}
    }
    void refresh();return()=>{cancelled=true;clearTimeout(timer);};
  },[code,refreshTick]);
  useEffect(()=>{setReview(false);},[wallet.account]);
  useEffect(()=>{if(bill)setSelected(p=>p.filter(i=>bill.items[i]&&!paid(bill.items[i].payer)));},[bill]);
  useEffect(()=>{const count=bill?.items.filter(i=>!paid(i.payer)).length||0;if(selectAllRef.current)selectAllRef.current.indeterminate=selected.length>0&&selected.length<count;},[bill,selected]);
  useEffect(()=>{review?reviewRef.current?.showModal():reviewRef.current?.close();},[review]);
  useEffect(()=>{
    setBalance(undefined);setBalanceError(false);if(!wallet.account)return;let cancelled=false;
    async function refresh(){try{const value=await publicClient.readContract({address:usdc,abi:erc20Abi,functionName:'balanceOf',args:[wallet.account!]});if(!cancelled){setBalance(value);setBalanceError(false);}}catch{if(!cancelled)setBalanceError(true);}}
    void refresh();const timer=setInterval(()=>void refresh(),15000);return()=>{cancelled=true;clearInterval(timer);};
  },[wallet.account,refreshTick]);
  async function create(e:FormEvent){
    e.preventDefault();if(operation.current||hasPending)return;setError('');
    if(!wallet.account){wallet.open();return;}
    operation.current=true;setBusy(true);setNotice('');setProgress({message:'Preparing your bill…'});
    const expectedAccount=wallet.account;
    try{
      const items=draftItems(rows),session=await wallet.ensure();
      if(session.account.toLowerCase()!==expectedAccount.toLowerCase())throw new Error('Your wallet account changed. Review the restaurant wallet and try again.');
      const result=await registry.createBill(session,items,setProgress);
      setRows([draft(),draft()]);setProgress({message:`Bill ${result.code} created.`,hash:result.hash});
      if(routeRef.current==='/restaurant/create')go(`/restaurant/bill/${result.code}`);
      setRefreshTick(v=>v+1);
    }catch(e){setError(errorMessage(e));setProgress(p=>p?.hash?{...p,message:'Check your submitted transaction.'}:undefined);}
    finally{operation.current=false;setBusy(false);}
  }
  function find(e:FormEvent){e.preventDefault();setError('');if(!/^[1-9]\d{5}$/.test(codeInput)){setError('Enter the six-digit order number.');return;}go(`/bill/${codeInput}`);}
  function reviewPayment(){
    setError('');if(!wallet.account){wallet.open();return;}
    if(bill&&selected.length){setPayment({code:bill.code,indices:[...selected],total:selectedTotal,account:wallet.account});setReview(true);}
  }
  async function confirmPayment(){
    if(!payment||operation.current||hasPending)return;
    operation.current=true;setBusy(true);setReview(false);setError('');setNotice('');setProgress({message:'Preparing your payment…'});
    try{
      const session=await wallet.ensure();
      if(session.account.toLowerCase()!==payment.account.toLowerCase())throw new Error('Your wallet account changed. Review your payment again.');
      const result=await registry.payItems(session,payment.code,payment.indices,payment.total,setProgress);
      setSelected([]);setProgress({message:'Payment confirmed. Thank you.',hash:result.hash});
    }catch(e){setError(errorMessage(e));setProgress(p=>p?.hash?{...p,message:'Check your submitted transaction.'}:undefined);}
    finally{operation.current=false;setBusy(false);setRefreshTick(v=>v+1);}
  }
  async function copy(value:string,key:string){try{await navigator.clipboard.writeText(value);setCopied(key);setTimeout(()=>setCopied(''),2200);}catch{setError('Could not copy. Select and copy the number manually.');}}
  function newBill(){setRows([draft(),draft()]);go('/restaurant/create');}
  const draftTotal=rows.reduce((sum,row)=>{try{return sum+amountOf(row.amount);}catch{return sum;}},0n);
  let validDraft=false;try{draftItems(rows);validDraft=true;}catch{}
  const unpaidIndices=bill?.items.map((i,index)=>!paid(i.payer)?index:-1).filter(i=>i>=0)||[];
  const selectedTotal=bill?selected.reduce((sum,index)=>sum+(bill.items[index]&&!paid(bill.items[index].payer)?bill.items[index].amount:0n),0n):0n;
  const billClosed=bill&&bill.total===bill.paidTotal;
  return <div className="app-shell">
    <a className="skip-link" href="#page-content" onClick={e=>{e.preventDefault();titleRef.current?.focus();titleRef.current?.scrollIntoView();}}>Skip to content</a>
    <header className="topbar"><a className="brand" href="#/"><img src="/logo.svg" width="28" height="28" alt=""/><span>Arc-de-Split</span></a><nav aria-label="Main navigation"><a href="#/about" aria-current={route==='/about'?'page':undefined}>About the Project</a></nav><div className="header-wallet"><span className="network-label">{chain.name}</span>{wallet.account?<details className="account-menu"><summary className="button button-small button-outline">{shortAddress(wallet.account)}</summary><div className="account-popover"><p className="eyebrow">Your wallet</p><p className="address">{wallet.account}</p><div className="account-balance"><span>Balance on {chain.name}</span><strong>{balanceError?'Unavailable':balance===undefined?'…':`${money(balance)} USDC`}</strong></div>{wallet.chainId!==chain.id&&<button className="link-button" onClick={()=>void wallet.ensure().catch(e=>setError(errorMessage(e)))}>Switch to {chain.name}</button>}<a className="link-button" href={explorerAddress(wallet.account)} target="_blank" rel="noopener noreferrer">View in explorer ↗</a><button className="link-button" onClick={wallet.disconnect}>Disconnect</button></div></details>:<button className="button button-small button-outline" onClick={wallet.open} disabled={wallet.connecting}>Connect wallet</button>}</div></header>
    <main id="page-content" ref={titleRef} tabIndex={-1}>
      {error&&route!=='/guest'&&<p className="error global-error" role="alert">{error}</p>}
      {!busy&&<PendingTransactions items={pending} onConfirmed={(item,recoveredCode)=>{setNotice(item.kind==='approve'?'USDC approval confirmed. Review your items to continue.':'Transaction confirmed.');setProgress(undefined);setRefreshTick(v=>v+1);if(item.kind==='create'&&recoveredCode)go(`/restaurant/bill/${recoveredCode}`);}}/>}
      {progress&&<div className="transaction-status" role="status">{busy&&<span className="spinner"/>}<div><strong>{progress.message}</strong>{progress.hash&&<a href={explorerTx(progress.hash)} target="_blank" rel="noopener noreferrer">View transaction ↗</a>}</div>{!busy&&<button className="icon-button" aria-label="Dismiss transaction status" onClick={()=>setProgress(undefined)}>×</button>}</div>}
      {notice&&<div className="transaction-status" role="status"><span>✓</span><strong>{notice}</strong><button className="icon-button" aria-label="Dismiss confirmation" onClick={()=>setNotice('')}>×</button></div>}
      {route==='/'&&<section className="home"><div className="home-intro"><h1>Good Place.<br/>Even better with payments on Arc.</h1></div><div className="home-curve" aria-hidden="true"><img src="/split-line.svg" alt="" width="1200" height="180"/></div><div className="role-grid"><a className="role-card" href="#/restaurant"><span className="role-index">01 / VENUE</span><div><h2>I’m a restaurant</h2><p>Create a bill for your guests.</p></div><Arrow/></a><a className="role-card" href="#/guest"><span className="role-index">02 / GUEST</span><div><h2>I’m a guest</h2><p>Find your bill and pay your items.</p></div><Arrow/></a></div></section>}
      {route==='/restaurant'&&<><Heading title="What would you like to do?" label="For restaurants"/><div className="role-grid restaurant-choice"><a className="role-card" href="#/restaurant/create"><span className="role-index">01 / CREATE</span><div><h2>Create a bill</h2><p>Add items and get an order number.</p></div><Arrow/></a><a className="role-card" href="#/restaurant/history"><span className="role-index">02 / HISTORY</span><div><h2>Bill history</h2><p>View all bills for your wallet.</p></div><Arrow/></a></div></>}
      {route==='/restaurant/history'&&<><Heading title="Bill history" label="For restaurants" back="/restaurant"/><RestaurantHistory/></>}
      {route==='/restaurant/create'&&<><Heading title="Create a bill" label="For restaurants" back="/restaurant"/><div className="restaurant-layout"><form className="receipt create-form" onSubmit={e=>void create(e)}><fieldset className="bill-fields" disabled={busy||hasPending}><div className="panel-heading"><h2>Bill items</h2><span className="meta">USDC</span></div><div className="draft-list">{rows.map((row,index)=><div className="draft-row" key={row.id}><span className="row-number" aria-hidden="true">{String(index+1).padStart(2,'0')}</span><div className="draft-name"><label htmlFor={`name-${row.id}`}>Item name</label><input id={`name-${row.id}`} value={row.name} placeholder="e.g. Pasta" maxLength={96} onChange={e=>setRows(p=>p.map(r=>r.id===row.id?{...r,name:e.target.value}:r))}/></div><div className="draft-price"><label htmlFor={`price-${row.id}`}>Price</label><input id={`price-${row.id}`} value={row.amount} placeholder="0.00" inputMode="decimal" onChange={e=>setRows(p=>p.map(r=>r.id===row.id?{...r,amount:e.target.value}:r))}/></div><button className="icon-button remove-button" type="button" aria-label={`Remove item ${index+1}`} onClick={()=>setRows(p=>p.length===1?[draft()]:p.filter(r=>r.id!==row.id))}>×</button></div>)}</div><div className="add-row"><button className="link-button" type="button" disabled={rows.length>=60} onClick={()=>setRows(p=>[...p,draft()])}>+ Add another item</button><span className="meta">{rows.length} / 60</span></div><div className="total-line"><span>Total bill amount</span><strong>{money(draftTotal)} <small>USDC</small></strong></div>{wallet.account&&<p className="recipient-caption">Restaurant wallet <span className="mono">{shortAddress(wallet.account)}</span></p>}<button className="button full-width" type="submit" disabled={!validDraft||busy||hasPending}>{busy?'Creating bill…':hasPending?'Transaction pending':wallet.account?'Get order number':'Connect wallet to create'}</button></fieldset></form><Steps/></div></>}
      {route==='/guest'&&<><Heading title="Find your bill" label="For guests"/><section className="guest-entry"><form onSubmit={find} className="receipt"><p className="eyebrow">Your table starts here</p><h2>Enter the order number</h2><p>Ask your server for the six-digit number.</p><label htmlFor="order-code">Order number</label><input id="order-code" className="code-input" value={codeInput} inputMode="numeric" autoComplete="off" maxLength={6} placeholder="000000" aria-describedby={error?'find-error':undefined} onChange={e=>{setCodeInput(e.target.value.replace(/\D/g,''));setError('');}}/><button className="button full-width" disabled={codeInput.length!==6}>Open bill <Arrow/></button>{error&&<p id="find-error" className="error" role="alert">{error}</p>}</form></section></>}
      {match&&<><Heading title={venueView?'Your bill is ready':billClosed?'Bill fully paid':'Choose your items'} back={venueView?'/restaurant':'/guest'}/>{billError&&<p className="error" role="alert">{billError} <button className="link-button" onClick={()=>setRefreshTick(v=>v+1)}>Refresh bill</button></p>}{bill?<div className={venueView?'restaurant-layout':'guest-bill-layout'}><section className="receipt bill-receipt"><div className="bill-top"><div><p className="eyebrow">Order number</p><strong className="order-number">{bill.code}</strong></div>{venueView?<button className="button button-small button-outline" onClick={newBill}>Create another bill</button>:<span className="bill-state">{billClosed?'Paid':'In progress'}</span>}</div>{venueView&&<><p className="share-description">Share this number with everyone at the table.</p><div className="share-actions"><button className="link-button" onClick={()=>void copy(String(bill.code),'code')}>{copied==='code'?'Copied':'Copy number'}</button></div></>}
        {!venueView&&<div className="bill-toolbar"><label className="select-all"><input ref={selectAllRef} type="checkbox" checked={unpaidIndices.length>0&&selected.length===unpaidIndices.length} disabled={!unpaidIndices.length||busy} onChange={e=>setSelected(e.target.checked?unpaidIndices:[])}/><span>Select all available</span></label><span className="meta">{bill.items.length} items</span></div>}
        <ul className={venueView?'venue-items':'guest-items'}>{bill.items.map((item,index)=><li key={index} className={paid(item.payer)?'paid-item':''}>{venueView?<><span className="item-name">{item.name}</span><span className="item-price">{money(item.amount)} <small>USDC</small></span><span className="paid-mark" aria-label={paid(item.payer)?'Paid':'Unpaid'}>{paid(item.payer)?'✓':''}</span></>:<label className="guest-item"><input type="checkbox" checked={selected.includes(index)} disabled={paid(item.payer)||busy} onChange={e=>setSelected(p=>e.target.checked?[...p,index]:p.filter(i=>i!==index))}/><span className="item-description"><span className="item-name">{item.name}</span>{paid(item.payer)&&<span className="paid-caption">Paid</span>}</span><span className="item-price">{money(item.amount)} <small>USDC</small></span></label>}</li>)}</ul>
        {venueView?<div className="venue-totals"><div><span>Total bill amount</span><strong>{money(bill.total)} USDC</strong></div><div><span>Paid</span><strong>{money(bill.paidTotal)} USDC</strong></div><div><span>Remaining</span><strong>{money(bill.total-bill.paidTotal)} USDC</strong></div></div>:<div className="bill-footer"><div><span className="meta">You selected</span><strong className="selected-amount">{money(selectedTotal)} <small>USDC</small></strong></div><button className="button" onClick={reviewPayment} disabled={selectedTotal===0n||busy||hasPending||Boolean(billError)}>{busy?'Payment in progress…':hasPending?'Transaction pending':wallet.account?<>Review payment <Arrow/></>:'Connect wallet to pay'}</button></div>}
        {billClosed&&<p className="closed-message" role="status"><span aria-hidden="true">✓</span>All items paid. Thank you.</p>}
      </section>{venueView?<Steps/>:<aside className="payment-summary"><p className="eyebrow">At a glance</p><div className="remaining-total"><span>Remaining on this bill</span><strong>{money(bill.total-bill.paidTotal)} <small>USDC</small></strong></div><div className="summary-detail"><span>Total bill</span><strong>{money(bill.total)} USDC</strong></div><div className="summary-detail"><span>Already paid</span><strong>{money(bill.paidTotal)} USDC</strong></div><div className="recipient"><span className="meta">Restaurant wallet</span><a className="mono" href={explorerAddress(bill.merchant)} target="_blank" rel="noopener noreferrer">{shortAddress(bill.merchant)} ↗</a></div></aside>}</div>:billLoading?<div className="bill-loading" role="status"><span className="spinner"/>Loading bill from Arc…</div>:<div className="empty-state"><h2>Bill unavailable</h2><p>Check the number with your server, then try again.</p><a className="button button-outline" href="#/guest">Find another bill</a></div>}</>}
      {route==='/about'&&<div className="about-layout"><div className="about-content"><Heading title="About the Project"/><div className="about-copy">{[
        ['A simple way to pay','Arc-de-Split lets a venue issue a bill in USDC on Arc. When the cash runs out while traveling, USDC on Arc offers another way to pay at any venue that accepts it.'],
        ['Easy bill splitting','Any number of guests can split a bill. Each person chooses their items, with no math or awkward back-and-forth at the table.'],
        ['Less distraction',"A minimal app that stays out of the way and adds as little as possible to the waiter's workload."],
        ['Room to grow','Integration with POS systems could remove manual bill entry. With that in place, Arc-de-Split could grow from a backup option into a primary way to pay.'],
      ].map(([title,text])=><section key={title}><h2>{title}</h2><p>{text}</p></section>)}<p className="about-contract">CA: <a href={explorerAddress(registryAddress)} target="_blank" rel="noopener noreferrer">{registryAddress}</a></p></div></div><div className="about-image"><img src="/image_1.png" width="800" height="1000" alt="Project image placeholder"/></div></div>}
      {!['/','/restaurant','/restaurant/create','/restaurant/history','/guest','/about'].includes(route)&&!match&&<div className="empty-state"><h1>Page not found</h1><a className="button" href="#/">Back to home</a></div>}
    </main>
    <footer className="footer"><span>Arc-de-Split</span><span>2026, made by <a href="https://no-hive.gwei.domains/" target="_blank" rel="noopener noreferrer">no-hive</a></span></footer>
    <dialog ref={reviewRef} className="wallet-dialog" aria-labelledby="review-title" onCancel={()=>setReview(false)}><div className="dialog-top"><h2 id="review-title">Review payment</h2><button className="icon-button" aria-label="Close payment review" onClick={()=>setReview(false)}>×</button></div><p>{payment?.indices.length} {payment?.indices.length===1?'item':'items'} · Order {payment?.code}</p><strong className="selected-amount">{money(payment?.total||0n)} <small>USDC</small></strong>{bill&&<p>Restaurant: <span className="mono">{shortAddress(bill.merchant)}</span></p>}<p>Payment on Arc Mainnet. Your wallet may ask for USDC approval first, then payment. Network fees are additional.</p><button className="button full-width" disabled={busy||hasPending} onClick={()=>void confirmPayment()}>Pay {money(payment?.total||0n)} USDC</button></dialog>
  </div>;
}
