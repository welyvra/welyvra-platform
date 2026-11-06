import type { EventPage, EventQuery, EventSource, RawRpcEvent } from '@welyvra/stellar';
import { RetentionGapError } from '@welyvra/stellar';

/**
 * In-memory EventSource over recorded events. Emulates stellar-rpc paging: results are
 * ordered by event id, `cursor` is the id of the last returned event, and positions older
 * than `oldestLedger` are rejected like the real RPC does.
 */
export class RecordedEventSource implements EventSource {
  calls = 0;
  private readonly events: RawRpcEvent[];
  constructor(
    events: RawRpcEvent[],
    public oldestLedger = 1,
    public latestLedger = Math.max(0, ...events.map((e) => e.ledger)),
  ) {
    this.events = [...events].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  push(...events: RawRpcEvent[]) {
    this.events.push(...events);
    this.events.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    this.latestLedger = Math.max(this.latestLedger, ...events.map((e) => e.ledger));
  }
  async getEvents(q: EventQuery): Promise<EventPage> {
    this.calls++;
    let candidates: RawRpcEvent[];
    if ('cursor' in q) {
      const cursorLedger = Number(BigInt(q.cursor.split('-')[0]!) >> 32n);
      if (cursorLedger < this.oldestLedger)
        throw new RetentionGapError('cursor is older than retention', this.oldestLedger);
      candidates = this.events.filter((e) => e.id > q.cursor);
    } else {
      if (q.startLedger < this.oldestLedger) {
        throw new RetentionGapError(
          `startLedger must be between the oldest ledger: ${this.oldestLedger} and the latest ledger: ${this.latestLedger}`,
          this.oldestLedger,
        );
      }
      candidates = this.events.filter((e) => e.ledger >= q.startLedger);
    }
    const page = candidates.filter((e) => q.contractIds.includes(e.contractId)).slice(0, q.limit);
    const last = page.at(-1);
    return {
      events: page,
      cursor: last ? last.id : endCursor(this.latestLedger),
      latestLedger: this.latestLedger,
      oldestLedger: this.oldestLedger,
    };
  }
}

/** Cursor pointing after everything in `ledger` (same format stellar-rpc returns). */
export function endCursor(ledger: number): string {
  return `${((BigInt(ledger) << 32n) | 0xffffffffn).toString().padStart(19, '0')}-4294967295`;
}
