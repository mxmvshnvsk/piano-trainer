export type Mode = 'practice' | 'flow' | 'rhythm';
export type Panel = 'settings' | 'difficult' | null;
export type Route = { mode: Mode; panel: Panel };

// Hash routes survive refreshes on GitHub Pages and use native browser history.
export function routeHash(mode: Mode, panel: Panel = null): string {
  const parts = [mode === 'practice' ? '' : mode, panel].filter(Boolean);
  return `#/${parts.join('/')}`;
}

export function readRoute(hash: string): Route {
  const path = hash.replace(/^#/, '').replace(/\/$/, '');
  const match = /^\/(?:(flow|rhythm)(?:\/(settings|difficult))?|(settings|difficult))?$/.exec(path);
  if (!match) return { mode: 'practice', panel: null };
  return { mode: (match[1] || 'practice') as Mode, panel: (match[2] || match[3] || null) as Panel };
}
