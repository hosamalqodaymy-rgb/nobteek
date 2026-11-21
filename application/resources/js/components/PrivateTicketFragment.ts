// Capture the bearer capability before Inertia initializes or serializes history.
let initialSecret: string | null = null;
const listeners = new Set<(secret: string) => void>();

function capture(initial = false) {
  if (window.location.pathname !== '/ticket') return;
  const fragment = window.location.hash.slice(1);
  if (!initial && (!fragment || fragment === 'main')) return;
  const secret = /^[a-f0-9]{64}$/.test(fragment) ? fragment : '';
  window.history.replaceState(window.history.state, '', window.location.pathname);
  if (listeners.size) { for (const listener of listeners) listener(secret); }
  else initialSecret = secret;
}

export function initializePrivateTicketFragment() {
  capture(true);
  // Register before Inertia's history listener; same-page saved links are safe too.
  window.addEventListener('popstate', () => capture(), { capture: true });
  window.addEventListener('hashchange', () => capture(), { capture: true });
}

export function takePrivateTicketFragment(): string {
  const secret = initialSecret ?? ''; initialSecret = null; return secret;
}

export function subscribePrivateTicketFragment(listener: (secret: string) => void) {
  listeners.add(listener); return () => { listeners.delete(listener); };
}
