import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeFunctionData, erc20Abi, type EIP1193Provider } from 'viem';
import { connectedClient } from '../src/lib/wallet-client.ts';
import { prepareUsdcTransfer } from '../src/lib/transactions.ts';
import { chain,usdc } from '../src/lib/config.ts';
const account='0x1111111111111111111111111111111111111111',recipient='0x2222222222222222222222222222222222222222',hash=`0x${'a'.repeat(64)}`;
test('prepared USDC transfer is exact and preparation makes no wallet request',()=>{
  const tx=prepareUsdcTransfer(recipient,'12.50');assert.equal(tx.to,usdc);assert.equal(tx.value,0n);
  const decoded=decodeFunctionData({abi:erc20Abi,data:tx.data!});assert.equal(decoded.functionName,'transfer');assert.deepEqual(decoded.args,[recipient,12_500_000n]);
  assert.throws(()=>prepareUsdcTransfer('invalid','1'));assert.throws(()=>prepareUsdcTransfer('0x0000000000000000000000000000000000000000','1'));
});
test('wallet forwards a transaction and blocks changed network, account or disconnected provider',async()=>{
  let network=chain.id,active=account,current=true;const sent:any[]=[];
  const provider={request:async({method,params}:any)=>{
    if(method==='eth_chainId')return `0x${network.toString(16)}`;
    if(method==='eth_accounts')return [active];
    if(method==='eth_sendTransaction'){sent.push(params[0]);return hash;}
    throw new Error(`Unexpected ${method}`);
  }} as EIP1193Provider;
  const client=connectedClient(provider,account,()=>current);
  const send=()=>client.sendTransaction({account,chain,to:recipient,value:1n,gas:21000n});
  assert.equal(await send(),hash);assert.equal(sent.length,1);assert.equal(sent[0].to,recipient);assert.equal(sent[0].value,'0x1');
  network=1;await assert.rejects(send);network=chain.id;active=recipient;await assert.rejects(send);active=account;current=false;await assert.rejects(send);assert.equal(sent.length,1);
});
