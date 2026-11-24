import { describe, expect, it } from 'vitest';
import { readRoute, routeHash, type Mode, type Panel } from '../src/routes';

describe('bookmarkable practice routes', () => {
  it('restores each mode and its panel after refresh or browser Back', () => {
    for (const mode of ['practice', 'flow', 'rhythm'] as Mode[]) {
      for (const panel of [null, 'settings', 'difficult'] as Panel[]) {
        expect(readRoute(routeHash(mode, panel))).toEqual({ mode, panel });
      }
    }
  });
  it('closes a panel into its originating mode', () => {
    for (const hash of ['#/flow/settings', '#/rhythm/difficult', '#/settings']) {
      const route = readRoute(hash);
      expect(readRoute(routeHash(route.mode))).toEqual({ mode: route.mode, panel: null });
    }
  });
  it('uses the main trainer for an empty or unknown URL', () => {
    for (const hash of ['', '#', '#/', '#/unknown', '#/flowsettings', '#/flow/unknown']) {
      expect(readRoute(hash)).toEqual({ mode: 'practice', panel: null });
    }
    expect(readRoute('#/flow/')).toEqual({ mode: 'flow', panel: null });
  });
});
