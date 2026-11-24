import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watchUpdates } from '../src/updates';

describe('updates in a long-lived tab', () => {
  let page: EventTarget & { visibilityState: string };
  let serviceWorker: EventTarget & { controller: object | null };
  let registration: EventTarget & { waiting: object | null; installing: EventTarget | null; update: ReturnType<typeof vi.fn> };
  const offer = vi.fn();
  let stop: (() => void) | undefined;
  beforeEach(() => {
    vi.useFakeTimers(); offer.mockClear();
    page = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    serviceWorker = Object.assign(new EventTarget(), { controller: {} });
    registration = Object.assign(new EventTarget(), { waiting: null, installing: null, update: vi.fn().mockResolvedValue(undefined) });
    vi.stubGlobal('document', page);
    vi.stubGlobal('navigator', { onLine: true, serviceWorker });
    vi.stubGlobal('window', Object.assign(new EventTarget(), { setInterval, clearInterval }));
    stop = watchUpdates(registration as unknown as ServiceWorkerRegistration, offer);
  });
  afterEach(() => { stop?.(); vi.useRealTimers(); vi.unstubAllGlobals(); });
  it('checks periodically without navigation and when returning to the tab', async () => {
    expect(registration.update).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(registration.update).toHaveBeenCalledTimes(2);
    page.visibilityState = 'hidden';
    await vi.advanceTimersByTimeAsync(60_000);
    expect(registration.update).toHaveBeenCalledTimes(2);
    page.visibilityState = 'visible'; page.dispatchEvent(new Event('visibilitychange'));
    expect(registration.update).toHaveBeenCalledTimes(3);
    window.dispatchEvent(new Event('focus'));
    expect(registration.update).toHaveBeenCalledTimes(3);
  });
  it('offers an installed update without activating it automatically', async () => {
    registration.installing = new EventTarget();
    registration.dispatchEvent(new Event('updatefound'));
    registration.waiting = {};
    registration.installing.dispatchEvent(new Event('statechange'));
    expect(offer).toHaveBeenLastCalledWith(registration);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(registration.update).toHaveBeenCalledTimes(1);
    registration.waiting = null;
    serviceWorker.dispatchEvent(new Event('controllerchange'));
    expect(offer).toHaveBeenLastCalledWith(undefined);
  });
  it('ignores transient network errors and recovers on reconnection', async () => {
    await vi.advanceTimersByTimeAsync(0);
    registration.update.mockRejectedValueOnce(new Error('offline'));
    await vi.advanceTimersByTimeAsync(60_000);
    vi.stubGlobal('navigator', { onLine: false, serviceWorker });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(registration.update).toHaveBeenCalledTimes(2);
    vi.stubGlobal('navigator', { onLine: true, serviceWorker });
    window.dispatchEvent(new Event('online'));
    expect(registration.update).toHaveBeenCalledTimes(3);
  });
  it('cleans up timers and worker listeners', async () => {
    registration.installing = new EventTarget(); registration.dispatchEvent(new Event('updatefound'));
    stop?.(); await vi.advanceTimersByTimeAsync(0); offer.mockClear();
    registration.waiting = {}; registration.installing.dispatchEvent(new Event('statechange'));
    await vi.advanceTimersByTimeAsync(120_000); window.dispatchEvent(new Event('focus'));
    expect(registration.update).toHaveBeenCalledTimes(1);
    expect(offer).not.toHaveBeenCalled();
  });
  it('finds an update already waiting when reopening the app', () => {
    stop?.(); registration.waiting = {};
    stop = watchUpdates(registration as unknown as ServiceWorkerRegistration, offer);
    expect(offer).toHaveBeenLastCalledWith(registration);
  });
  it('does not mistake the first installation for an update', () => {
    serviceWorker.controller = null;
    registration.installing = new EventTarget(); registration.dispatchEvent(new Event('updatefound'));
    registration.waiting = {}; registration.installing.dispatchEvent(new Event('statechange'));
    expect(offer).toHaveBeenLastCalledWith(undefined);
  });
});
