export const PRIORITY_ORIGINS = [
  'https://*.wiley.com/*', 'https://journals.ametsoc.org/*', 'https://*.copernicus.org/*',
  'https://*.nature.com/*', 'https://*.pnas.org/*', 'https://www.annualreviews.org/*'
];
export const CROSSREF_ORIGIN = 'https://api.crossref.org/*';
export async function syncScripts(inject = false): Promise<void> {
  const permissions = await chrome.permissions.getAll();
  const matches = (permissions.origins || []).filter(o => o !== CROSSREF_ORIGIN);
  const registered = await chrome.scripting.getRegisteredContentScripts();
  if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: registered.map(s => s.id) });
  if (!matches.length) return;
  await chrome.scripting.registerContentScripts([{ id: 'paper-metadata', js: ['content.js'], matches, runAt: 'document_idle', persistAcrossSessions: true }]);
  if (!inject) return;
  const tabs = await chrome.tabs.query({ url: matches });
  await Promise.allSettled(tabs.filter(t => t.id !== undefined).map(t => chrome.scripting.executeScript({ target: { tabId: t.id! }, files: ['content.js'] })));
}
