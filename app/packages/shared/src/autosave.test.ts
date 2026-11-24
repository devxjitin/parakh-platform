import { describe, expect, it } from 'vitest';
import { AutosaveQueue, type AutosaveStorage, type SendResult } from './autosave';

function memoryStorage(): AutosaveStorage & { value: string | null } {
  return {
    value: null,
    get() {
      return this.value;
    },
    set(v) {
      this.value = v;
    },
    remove() {
      this.value = null;
    },
  };
}

describe('AutosaveQueue', () => {
  it('sends one request at a time with rising sequence numbers', async () => {
    const log: string[] = [];
    let active = 0;
    let maxActive = 0;
    const q = new AutosaveQueue<string>({
      send: async (qid, value, seq) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 5));
        log.push(`${qid}:${value}:${seq}`);
        active--;
        return 'ok';
      },
    });
    q.set('a', 'one');
    const first = q.flush();
    q.set('a', 'two'); // edited while the first save is running
    q.set('b', 'x');
    expect(await q.flush()).toBe('saved');
    await first;
    expect(maxActive).toBe(1);
    expect(q.size).toBe(0);
    const aSeqs = log.filter((l) => l.startsWith('a:')).map((l) => Number(l.split(':')[2]));
    expect(log.some((l) => l.startsWith('a:two'))).toBe(true);
    expect(aSeqs).toEqual([...aSeqs].sort((x, y) => x - y));
  });

  it('keeps unsaved answers after a failure and sends the newest on retry', async () => {
    let fail = true;
    const sent: string[] = [];
    const q = new AutosaveQueue<string>({
      send: async (_q, value): Promise<SendResult> => {
        if (fail) return 'retry';
        sent.push(value);
        return 'ok';
      },
    });
    q.set('a', 'old');
    expect(await q.flush()).toBe('failed');
    q.set('a', 'new');
    fail = false;
    expect(await q.flush()).toBe('saved');
    expect(sent).toEqual(['new']);
  });

  it('survives a reload through storage and clears it when saved', async () => {
    const storage = memoryStorage();
    const down = new AutosaveQueue<string>({ send: async () => 'retry', storage });
    down.set('a', 'typed offline');
    down.set('b', 'also offline');
    await down.flush();
    expect(storage.value).not.toBeNull();

    const sent: string[] = [];
    const reloaded = new AutosaveQueue<string>({
      send: async (qid, value) => {
        sent.push(`${qid}=${value}`);
        return 'ok';
      },
      storage,
    });
    expect(reloaded.restore()).toEqual({ a: 'typed offline', b: 'also offline' });
    expect(await reloaded.flush()).toBe('saved');
    expect(sent.sort()).toEqual(['a=typed offline', 'b=also offline']);
    expect(storage.value).toBeNull();
  });

  it('keeps sequence numbers above anything restored, even if the clock restarts', async () => {
    const storage = memoryStorage();
    const a = new AutosaveQueue<string>({ send: async () => 'retry', storage, now: () => 1000 });
    a.set('q', 'v1');
    const seqs: number[] = [];
    const b = new AutosaveQueue<string>({
      send: async (_q, _v, seq) => {
        seqs.push(seq);
        return 'ok';
      },
      storage,
      now: () => 5,
    });
    b.restore();
    b.set('q', 'v2');
    expect(await b.flush()).toBe('saved');
    expect(seqs[0]).toBeGreaterThan(1000);
  });

  it('stops when the attempt has ended', async () => {
    const q = new AutosaveQueue<string>({ send: async () => 'ended' });
    q.set('a', 'x');
    expect(await q.flush()).toBe('ended');
  });

  it('reports failure after the retries run out and keeps the answer', async () => {
    const q = new AutosaveQueue<string>({ send: async () => 'retry' });
    q.set('a', 'x');
    expect(await q.flushWithRetries(3, 1)).toBe('failed');
    expect(q.size).toBe(1);
  });
});
