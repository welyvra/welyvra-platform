import { xdr, scValToNative } from '@stellar/stellar-sdk';
import { readFileSync } from 'node:fs';
const f = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const byHash = Object.fromEntries(Object.entries(f.transactions).map(([k, v]) => [v.hash, k]));
console.log('meta', JSON.stringify({ ...f.getEventsResult, events: undefined }));
for (const e of f.getEventsResult.events) {
  const topics = e.topic.map((t) => {
    const v = scValToNative(xdr.ScVal.fromXDR(t, 'base64'));
    return typeof v === 'bigint' ? v.toString() : v;
  });
  const dv = xdr.ScVal.fromXDR(e.value, 'base64');
  const data = scValToNative(dv);
  console.log(
    byHash[e.txHash],
    '| id',
    e.id,
    '| type',
    e.type,
    '| inSuccessfulContractCall',
    e.inSuccessfulContractCall,
    '| opIndex',
    e.operationIndex,
    'txIndex',
    e.transactionIndex,
  );
  console.log(
    '   topics',
    JSON.stringify(topics),
    '| data',
    JSON.stringify(data, (k, v) => (typeof v === 'bigint' ? v.toString() + 'n' : v)),
  );
}
console.log('keys of one event:', Object.keys(f.getEventsResult.events[0]).join(','));
