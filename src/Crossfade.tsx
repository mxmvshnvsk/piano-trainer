import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export function Crossfade({ identity, className, children }: { identity: string; className: string; children: ReactNode }) {
  const previous = useRef({ identity, children });
  const [outgoing, setOutgoing] = useState<{ identity: string; children: ReactNode }>();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useLayoutEffect(() => {
    if (previous.current.identity !== identity) {
      setOutgoing(previous.current);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setOutgoing(undefined), 220);
    }
    previous.current = { identity, children };
  }, [identity, children]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return <div className={className}>
    <div key={identity} className={`task-layer ${outgoing ? 'task-enter' : ''}`}>{children}</div>
    {outgoing && <div key={`old-${outgoing.identity}`} className="task-layer task-exit" aria-hidden="true" inert>{outgoing.children}</div>}
  </div>;
}
