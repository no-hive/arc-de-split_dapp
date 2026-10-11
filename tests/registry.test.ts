import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { encodeAbiParameters, encodeEventTopics, zeroAddress, type TransactionReceipt } from 'viem';
import { registryService, selectedAmount, type RegistryClient, type Session } from '../src/lib/registry.ts';
import { registryAbi } from '../src/lib/registry-abi.ts';
import { chain, registryAddress, usdc, deploymentBlock } from '../src/lib/config.ts';
import { parsePending, pendingSnapshot } from '../src/lib/pending.ts';
import { fetchBillsForAddress } from '../src/lib/history.ts';
const merchant='0x1111111111111111111111111111111111111111',guest='0x2222222222222222222222222222222222222222';
const hash=`0x${'a'.repeat(64)}` as const;
let store: Map<string,string>;
beforeEach(()=>{store=new Map();Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(k:string)=>store.get(k)||null,setItem:(k:string,v:string)=>store.set(k,v)}});});
function fixture(options:{allowance?:bigint;race?:boolean;status?:'success'|'reverted';timeout?:boolean;replacement?:boolean}={}){
  const calls:any[]=[];const simulations:any[]=[];
  const bill={merchant,totalAmount:14_500_000n,paidAmount:0n,items:[{name:'Pasta',price:12_500_000n,paidBy:zeroAddress as string},{name:'Tea',price:2_000_000n,paidBy:zeroAddress as string}]};
  const client={
    getChainId:async()=>chain.id,
    readContract:async(args:any)=>args.functionName==='getBill'?bill:args.functionName==='allowance'?options.allowance||0n:100_000_000n,
    simulateContract:async(args:any)=>{simulations.push(args);return{result:100000,request:args};},
    waitForTransactionReceipt:async(args:any)=>{
      if(options.timeout)throw new Error('Receipt timed out');
      const fn=calls.at(-1).functionName;
      if(fn==='approve'&&options.race)bill.items[0].paidBy=merchant;
      const logs=fn==='createBill'?[{address:registryAddress,topics:encodeEventTopics({abi:registryAbi,eventName:'BillCreated',args:{merchant,code:100007}}),data:'0x'}]:fn==='payItems'?[{address:registryAddress,topics:encodeEventTopics({abi:registryAbi,eventName:'ItemsPaid',args:{code:100007,payer:guest}}),data:encodeAbiParameters([{type:'uint256[]'},{type:'uint256'}],[[0n],12_500_000n])}]:[];
      const receipt={status:options.status||'success',transactionHash:hash,logs} as TransactionReceipt;
      if(options.replacement)args.onReplaced({reason:'cancelled',transactionReceipt:receipt});
      return receipt;
    }
  } as unknown as RegistryClient;
  const session={account:guest,client:{writeContract:async(args:any)=>{calls.push(args);return hash;}}} as unknown as Session;
  return {client,session,calls,simulations,bill,service:registryService(client)};
}
test('creation obtains actual order code from receipt, never the simulated code',async()=>{
  const f=fixture();f.session.account=merchant;
  const result=await f.service.createBill(f.session,[{name:'Pasta',amount:12_500_000n}],()=>{});
  assert.equal(result.code,100007);assert.equal(f.calls[0].address,registryAddress);
  assert.deepEqual(f.calls[0].args,[['Pasta'],[12_500_000n]]);
});
test('payment approves exactly the selected USDC amount and calls payItems on registry',async()=>{
  const f=fixture();await f.service.payItems(f.session,100007,[0],12_500_000n,()=>{});
  assert.deepEqual(f.calls.map(c=>c.functionName),['approve','payItems']);
  assert.equal(f.calls[0].address,usdc);assert.deepEqual(f.calls[0].args,[registryAddress,12_500_000n]);
  assert.equal(f.calls[1].address,registryAddress);assert.deepEqual(f.calls[1].args,[100007,[0n]]);
});
test('sufficient allowance avoids a redundant approval',async()=>{
  const f=fixture({allowance:12_500_000n});await f.service.payItems(f.session,100007,[0],12_500_000n,()=>{});
  assert.deepEqual(f.calls.map(c=>c.functionName),['payItems']);
});
test('stale selections, duplicate indices and mismatched review total cannot be sent',async()=>{
  const f=fixture();await assert.rejects(f.service.payItems(f.session,100007,[0,0],25_000_000n,()=>{}));
  await assert.rejects(f.service.payItems(f.session,100007,[0],1n,()=>{}));
  f.bill.items[0].paidBy=merchant;
  await assert.rejects(f.service.payItems(f.session,100007,[0],12_500_000n,()=>{}));assert.equal(f.calls.length,0);
});
test('another guest paying during approval stops the subsequent payment',async()=>{
  const f=fixture({race:true});await assert.rejects(f.service.payItems(f.session,100007,[0],12_500_000n,()=>{}),/already been paid/);
  assert.deepEqual(f.calls.map(c=>c.functionName),['approve']);
});
test('reverted and cancelled transactions never report payment success',async()=>{
  for(const options of [{status:'reverted' as const},{replacement:true}]){
    const f=fixture({...options,allowance:12_500_000n});
    await assert.rejects(f.service.payItems(f.session,100007,[0],12_500_000n,()=>{}));
  }
});
test('receipt timeout preserves hash for recovery instead of assuming a failed transaction',async()=>{
  const f=fixture({timeout:true,allowance:12_500_000n});
  await assert.rejects(f.service.payItems(f.session,100007,[0],12_500_000n,()=>{}));
  assert(parsePending(pendingSnapshot()).some(p=>p.hash===hash&&p.kind==='pay'));
});
test('an RPC pointing at the wrong chain prevents signing',async()=>{
  const f=fixture();f.client.getChainId=async()=>1;
  await assert.rejects(f.service.createBill(f.session,[{name:'Tea',amount:1n}],()=>{}),/not Arc Mainnet/);assert.equal(f.calls.length,0);
});
test('history retries bounded log ranges, indexes merchant events, and reads fresh paid state on reload',async()=>{
  const f=fixture();let logCalls=0,latest=deploymentBlock+300n;
  f.client.getBlockNumber=async()=>latest;
  f.client.getLogs=async(args:any)=>{
    logCalls++;assert.equal(args.address,registryAddress);assert.equal(args.args.merchant,merchant);
    if(args.toBlock-args.fromBlock>100n)throw new Error('block range limit');
    return args.fromBlock===deploymentBlock?[{blockNumber:deploymentBlock,args:{code:100007,merchant}}] as any:[];
  };
  const bills=await fetchBillsForAddress(merchant,{client:f.client});assert.equal(bills.length,1);assert.equal(bills[0].paidTotal,0n);
  const firstCalls=logCalls;f.bill.paidAmount=12_500_000n;f.bill.items[0].paidBy=guest;
  const updated=await fetchBillsForAddress(merchant,{client:f.client});assert.equal(updated[0].paidTotal,12_500_000n);assert.equal(logCalls,firstCalls);
});
test('history cancellation does not return partial results as the complete history',async()=>{
  const f=fixture();f.client.getBlockNumber=async()=>deploymentBlock;
  const controller=new AbortController();controller.abort();
  await assert.rejects(fetchBillsForAddress(merchant,{client:f.client,signal:controller.signal}),{name:'AbortError'});
});
