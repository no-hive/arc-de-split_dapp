import { test } from 'node:test';
import assert from 'node:assert/strict';
import { amountOf, draftItems } from '../src/lib/domain.ts';
test('prices use exact USDC units and reject ambiguous or unsupported input',()=>{
  assert.equal(amountOf('12.30'),12_300_000n);assert.equal(amountOf('0,01'),10_000n);assert.equal(amountOf('1000000'),1_000_000_000_000n);
  for(const input of ['0','-1','1e3','12usd','1.0000001','1.','Infinity','1000001'])assert.throws(()=>amountOf(input));
});
test('partial rows are rejected; blank rows are skipped; UTF-8 storage limits enforced',()=>{
  const row=(name:string,amount:string)=>({id:'id',name,amount});
  assert.equal(draftItems([row('',''),row(' Tea ','2')])[0].name,'Tea');
  assert.throws(()=>draftItems([row('Tea','')]));assert.throws(()=>draftItems([row('','2')]));
  assert.throws(()=>draftItems([row('🍝'.repeat(25),'1')]));
  assert.throws(()=>draftItems(Array.from({length:61},()=>row('Tea','1'))));
});
