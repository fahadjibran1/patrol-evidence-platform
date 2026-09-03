import { createTimedSignal } from '../../web/src/lib/api-timeout';

describe('renderer local API timeout', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('allows successful completion and clears its timer', () => {
    const timed = createTimedSignal(undefined, 100);
    timed.cleanup();
    jest.advanceTimersByTime(101);
    expect(timed.signal.aborted).toBe(false);
  });

  it('aborts with an explicit timeout and reports its source', () => {
    const timed = createTimedSignal(undefined, 100);
    jest.advanceTimersByTime(100);
    expect(timed.signal.aborted).toBe(true);
    expect(timed.didTimeout()).toBe(true);
    timed.cleanup();
  });

  it('propagates caller cancellation without classifying it as a timeout', () => {
    const parent = new AbortController();
    const timed = createTimedSignal(parent.signal, 100);
    parent.abort();
    expect(timed.signal.aborted).toBe(true);
    expect(timed.didTimeout()).toBe(false);
    timed.cleanup();
    jest.advanceTimersByTime(100);
    expect(timed.didTimeout()).toBe(false);
  });
});
