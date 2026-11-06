/**
 * Research script for issue #3. Testnet only.
 *
 * Creates throwaway accounts, sends one payment through each attribution path
 * (memo, M address, C address, W address) and saves the raw Stellar RPC
 * `getEvents` responses as fixtures. Secret keys are generated in memory and
 * never written to disk or logs.
 *
 * Run: node scripts/research/p30-events.ts
 */
import {
  Address,
  Asset,
  BASE_FEE,
  Keypair,
  Memo,
  MuxedAccount,
  Networks,
  Operation,
  StrKey,
  TransactionBuilder,
  nativeToScVal,
  rpc,
} from '@stellar/stellar-sdk';
import { mkdirSync, writeFileSync } from 'node:fs';

/** CAP-84 payload: 32-byte contract ID followed by the 8-byte big-endian muxed ID. */
function packMuxedContract(contractId: Uint8Array, id: bigint): Uint8Array {
  const out = new Uint8Array(40);
  out.set(contractId, 0);
  new DataView(out.buffer).setBigUint64(32, id, false);
  return out;
}

const RPC_URL = 'https://soroban-testnet.stellar.org';
const PASSPHRASE = Networks.TESTNET;
const OUT = 'tests/fixtures/stellar';
const server = new rpc.Server(RPC_URL);

async function friendbot(pub: string): Promise<void> {
  const res = await fetch(`https://friendbot.stellar.org/?addr=${pub}`);
  if (!res.ok) throw new Error(`friendbot ${res.status}`);
}

async function submit(
  source: Keypair,
  build: (b: TransactionBuilder) => TransactionBuilder,
  memo?: Memo,
) {
  const account = await server.getAccount(source.publicKey());
  let builder = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: PASSPHRASE });
  if (memo) builder = builder.addMemo(memo);
  let tx = build(builder).setTimeout(60).build();
  const isSoroban = tx.operations.some((op) => op.type === 'invokeHostFunction');
  if (isSoroban) tx = await server.prepareTransaction(tx);
  tx.sign(source);
  const sent = await server.sendTransaction(tx);
  if (sent.status === 'ERROR') throw new Error(`send failed: ${JSON.stringify(sent.errorResult)}`);
  const final = await server.pollTransaction(sent.hash, { attempts: 30 });
  if (final.status !== 'SUCCESS') throw new Error(`tx ${sent.hash} ${final.status}`);
  return { hash: sent.hash, ledger: final.ledger };
}

/** Raw JSON-RPC getEvents over [startLedger, endLedger), paginated, keeping only events from `txHashes`. */
async function rawGetEvents(
  startLedger: number,
  endLedger: number,
  contractIds: string[],
  txHashes: Set<string>,
) {
  const kept: unknown[] = [];
  let cursor: string | undefined;
  let lastResult: Record<string, unknown> = {};
  for (let page = 0; page < 200; page++) {
    const params = cursor
      ? { filters: [{ type: 'contract', contractIds }], pagination: { limit: 200, cursor } }
      : {
          startLedger,
          endLedger,
          filters: [{ type: 'contract', contractIds }],
          pagination: { limit: 200 },
        };
    const res = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getEvents', params }),
    });
    const body = (await res.json()) as {
      result?: { events: { txHash: string }[]; cursor: string } & Record<string, unknown>;
      error?: unknown;
    };
    if (body.error || !body.result) throw new Error(`getEvents: ${JSON.stringify(body.error)}`);
    lastResult = body.result;
    kept.push(...body.result.events.filter((e) => txHashes.has(e.txHash)));
    if (body.result.events.length < 200) break;
    cursor = body.result.cursor;
  }
  const { events: _ignored, ...meta } = lastResult;
  return { ...meta, events: kept };
}

async function main() {
  const latest = await server.getLatestLedger();
  console.log('protocolVersion', latest.protocolVersion, 'ledger', latest.sequence);

  const sender = Keypair.random();
  const receiver = Keypair.random();
  await Promise.all([friendbot(sender.publicKey()), friendbot(receiver.publicKey())]);
  console.log('sender', sender.publicKey(), 'receiver', receiver.publicKey());

  const results: Record<string, { hash: string; ledger: number }> = {};

  // 1. Classic payment to G with memo ID.
  results.memo = await submit(
    sender,
    (b) =>
      b.addOperation(
        Operation.payment({
          destination: receiver.publicKey(),
          asset: Asset.native(),
          amount: '1.0000001',
        }),
      ),
    Memo.id('1001'),
  );

  // 1b. Classic payment to G with memo text.
  results.memoText = await submit(
    sender,
    (b) =>
      b.addOperation(
        Operation.payment({
          destination: receiver.publicKey(),
          asset: Asset.native(),
          amount: '1.5',
        }),
      ),
    Memo.text('INV-42'),
  );

  // 2. Classic payment to an M address.
  const receiverAccount = await server.getAccount(receiver.publicKey());
  const muxed = new MuxedAccount(receiverAccount, '2002').accountId();
  results.muxedAccount = await submit(sender, (b) =>
    b.addOperation(Operation.payment({ destination: muxed, asset: Asset.native(), amount: '2' })),
  );

  // 3. A receiving contract: the SAC of an asset issued by the receiver (a real, deployed contract).
  const receiverAsset = new Asset('WELYRCV', receiver.publicKey());
  await submit(receiver, (b) =>
    b.addOperation(Operation.createStellarAssetContract({ asset: receiverAsset })),
  );
  const receivingContract = receiverAsset.contractId(PASSPHRASE);
  const nativeSac = Asset.native().contractId(PASSPHRASE);

  const sacTransfer = (to: string, units: bigint) => (b: TransactionBuilder) =>
    b.addOperation(
      Operation.invokeContractFunction({
        contract: nativeSac,
        function: 'transfer',
        args: [
          new Address(sender.publicKey()).toScVal(),
          Address.fromString(to).toScVal(),
          nativeToScVal(units, { type: 'i128' }),
        ],
      }),
    );

  results.contract = await submit(sender, sacTransfer(receivingContract, 30_000_000n));

  // 4. W address: receiving contract + muxed ID 3003 (CAP-84).
  const w = StrKey.encodeMuxedContract(
    packMuxedContract(StrKey.decodeContract(receivingContract), 3003n),
  );
  console.log('W address', w);
  results.muxedContract = await submit(sender, sacTransfer(w, 40_000_000n));

  // 5. SAC transfer to an M address (Soroban path, CAP-67).
  results.sacToMuxedAccount = await submit(sender, sacTransfer(muxed, 50_000_000n));

  const ledgers = Object.values(results).map((r) => r.ledger);
  const hashes = new Set(Object.values(results).map((r) => r.hash));
  const events = await rawGetEvents(
    Math.min(...ledgers),
    Math.max(...ledgers) + 1,
    [nativeSac],
    hashes,
  );

  mkdirSync(OUT, { recursive: true });
  writeFileSync(
    `${OUT}/p30-testnet-events.json`,
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        network: 'testnet',
        protocolVersion: latest.protocolVersion,
        rpc: RPC_URL,
        accounts: {
          sender: sender.publicKey(),
          receiver: receiver.publicKey(),
          muxedAccount: muxed,
          receivingContract,
          muxedContract: w,
          nativeSac,
        },
        transactions: results,
        getEventsResult: events,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(JSON.stringify(results, null, 2));
  console.log('events', events.events.length, 'saved to', `${OUT}/p30-testnet-events.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
