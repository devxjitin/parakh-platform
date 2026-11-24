/**
 * The exam page's answer-saving queue, kept free of React and the DOM so it can be tested.
 *
 * - One save is in flight at a time, and entries are sent oldest-first, so a slow earlier request
 *   can never land after a newer one.
 * - Every entry carries a sequence number that only goes up (also across page reloads), and the
 *   server ignores a write older than what it already holds.
 * - Pending entries are mirrored to storage, so a crash, refresh or dead battery loses nothing.
 */
export type SendResult = 'ok' | 'retry' | 'ended' | 'fatal';
export type FlushResult = 'saved' | 'failed' | 'ended' | 'fatal';

export interface AutosaveStorage {
  get(): string | null;
  set(value: string): void;
  remove(): void;
}

interface Entry<T> {
  value: T;
  seq: number;
}

export interface AutosaveOptions<T> {
  send: (questionId: string, value: T, seq: number) => Promise<SendResult>;
  storage?: AutosaveStorage;
  now?: () => number;
  onChange?: () => void;
}

export class AutosaveQueue<T> {
  private pending = new Map<string, Entry<T>>();
  private running: Promise<FlushResult> | null = null;
  private lastSeq = 0;
  private readonly now: () => number;

  constructor(private readonly opts: AutosaveOptions<T>) {
    this.now = opts.now ?? Date.now;
  }

  get size(): number {
    return this.pending.size;
  }

  /** Reads entries saved by an earlier page load. Returns the restored values. */
  restore(): Record<string, T> {
    const out: Record<string, T> = {};
    try {
      const raw = this.opts.storage?.get();
      if (!raw) return out;
      const parsed = JSON.parse(raw) as [string, Entry<T>][];
      for (const [qid, entry] of parsed) {
        this.pending.set(qid, entry);
        this.lastSeq = Math.max(this.lastSeq, entry.seq);
        out[qid] = entry.value;
      }
    } catch {
      // Unreadable storage: start clean.
    }
    return out;
  }

  /** Records the latest complete answer for a question. */
  set(questionId: string, value: T): void {
    this.lastSeq = Math.max(this.lastSeq + 1, this.now());
    this.pending.set(questionId, { value, seq: this.lastSeq });
    this.persist();
  }

  /** Sends everything pending. Calls made while a save is running join it. */
  flush(): Promise<FlushResult> {
    if (!this.running) {
      this.running = this.drain().finally(() => {
        this.running = null;
      });
    }
    return this.running;
  }

  /** Flush, retrying a few times. Only "saved" means nothing is left unsaved. */
  async flushWithRetries(tries = 3, delayMs = 1000): Promise<FlushResult> {
    let result: FlushResult = 'saved';
    for (let i = 0; i < tries; i++) {
      result = await this.flush();
      if (result !== 'failed') return result;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
    return result;
  }

  private async drain(): Promise<FlushResult> {
    while (this.pending.size > 0) {
      const [qid, entry] = this.pending.entries().next().value as [string, Entry<T>];
      const res = await this.opts.send(qid, entry.value, entry.seq);
      if (res === 'retry') return 'failed';
      if (res === 'ended' || res === 'fatal') return res;
      // Only drop the entry if nobody replaced it while it was being sent.
      if (this.pending.get(qid)?.seq === entry.seq) this.pending.delete(qid);
      this.persist();
      this.opts.onChange?.();
    }
    return 'saved';
  }

  private persist(): void {
    try {
      if (this.pending.size === 0) this.opts.storage?.remove();
      else this.opts.storage?.set(JSON.stringify([...this.pending.entries()]));
    } catch {
      // Storage full or blocked: saving to the server still works.
    }
  }
}
