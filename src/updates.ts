// A long-lived tab does not navigate, so browser navigation checks alone are insufficient.
export function watchUpdates(registration: ServiceWorkerRegistration, offer: (registration?: ServiceWorkerRegistration) => void) {
  let stopped = false, checking = false, lastCheck = -Infinity;
  const workers = new Set<ServiceWorker>();
  const announce = () => {
    if (!stopped) offer(registration.waiting && navigator.serviceWorker.controller ? registration : undefined);
  };
  const observe = () => {
    const worker = registration.installing;
    if (worker && !workers.has(worker)) {
      workers.add(worker);
      worker.addEventListener('statechange', announce);
    }
    announce();
  };
  const check = () => {
    if (stopped || checking || document.visibilityState === 'hidden' || !navigator.onLine || registration.waiting || Date.now() - lastCheck < 15_000) return;
    lastCheck = Date.now(); checking = true;
    // Losing the network should never interrupt an offline practice session.
    void registration.update().catch(() => {}).finally(() => { checking = false; announce(); });
  };
  registration.addEventListener('updatefound', observe);
  navigator.serviceWorker.addEventListener('controllerchange', announce);
  document.addEventListener('visibilitychange', check);
  window.addEventListener('focus', check);
  window.addEventListener('online', check);
  const interval = window.setInterval(check, 60_000);
  observe(); check();
  return () => {
    stopped = true;
    window.clearInterval(interval);
    registration.removeEventListener('updatefound', observe);
    navigator.serviceWorker.removeEventListener('controllerchange', announce);
    document.removeEventListener('visibilitychange', check);
    window.removeEventListener('focus', check);
    window.removeEventListener('online', check);
    workers.forEach(worker => worker.removeEventListener('statechange', announce));
  };
}
