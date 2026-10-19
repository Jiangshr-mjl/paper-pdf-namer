import { extract } from './core/extract';
// Permission resynchronization may inject into an already observed document.
const marker = '__paperNamerContentInstalled';
const scope = globalThis as typeof globalThis & Record<string, unknown>;
if (!scope[marker]) {
  scope[marker] = true;
  let previous = '';
  let pending: ReturnType<typeof setTimeout>;
  function send() {
    const snapshot = extract(document, location.href);
    if (!snapshot) return;
    const fingerprint = JSON.stringify({ ...snapshot, capturedAt: 0 });
    if (fingerprint === previous) return;
    previous = fingerprint;
    chrome.runtime.sendMessage({ type: 'SNAPSHOT', snapshot }).catch(() => { previous = ''; });
  }
  const schedule = () => { clearTimeout(pending); pending = setTimeout(send, 300); };
  send();
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['content', 'href'] });
  // Refresh before navigation, including right-click/download-link workflows.
  document.addEventListener('pointerdown', send, true);
  document.addEventListener('contextmenu', send, true);
  window.addEventListener('popstate', schedule);
}
