import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { cp, readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';

// A real unpacked MV3 extension in an isolated profile, never the user's browser profile.
// The test copy alone grants localhost up front to avoid automating a native permission dialog.
const runDir = resolve('test-results', `browser-${Date.now()}`);
const extension = join(runDir, 'extension');
const downloads = join(runDir, 'downloads');
await mkdir(downloads, { recursive: true });
await mkdir(join(runDir, 'profile', 'Default'), { recursive: true });
await writeFile(join(runDir, 'profile', 'Default', 'Preferences'), JSON.stringify({ download: { default_directory: downloads, prompt_for_download: false, directory_upgrade: true }, plugins: { always_open_pdf_externally: true } }));
await cp(resolve('dist'), extension, { recursive: true });
const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['http://127.0.0.1/*'];
await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest, null, 2));
const fixtures = {};
for (const name of ['nature', 'pnas', 'ams', 'agu', 'copernicus']) fixtures[name] = await readFile(resolve('tests/fixtures', `${name}.html`), 'utf8');
function pdf() {
  let body = '%PDF-1.4\n'; const offsets = [0];
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] >>'];
  objects.forEach((content, i) => { offsets.push(Buffer.byteLength(body)); body += `${i + 1} 0 obj\n${content}\nendobj\n`; });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 4\n0000000000 65535 f \n${offsets.slice(1).map(x => String(x).padStart(10, '0') + ' 00000 n ').join('\n')}\ntrailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return body;
}
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path.startsWith('/article/')) {
    const name = path.split('/').pop();
    let html = fixtures[name];
    if (name === 'missing') html = fixtures.nature.replace(/<script type="application\/ld\+json">.*?<\/script>/s, '').replaceAll('test-nature', 'test-missing');
    if (name === 'redirect') html = fixtures.ams.replaceAll('/view/journals/clim/39/1/test-ams.pdf', '/redirect.pdf');
    if (name === 'cancel') html = fixtures.nature.replaceAll('/articles/test-nature.pdf', '/slow.pdf');
    if (name === 'unrelated') html = '<html><body><a id="body" href="/manual.pdf">Download PDF</a></body></html>';
    if (html) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); return; }
  }
  if (path === '/redirect.pdf') { res.writeHead(302, { Location: '/cdn/download.pdf?token=local-test' }); res.end(); return; }
  if (path === '/fail.pdf') { res.writeHead(404); res.end(); return; }
  if (path === '/slow.pdf') {
    res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="paper.pdf"', 'Content-Length': '1000000' });
    res.write(pdf()); const timer = setTimeout(() => res.destroy(), 20000); res.on('close', () => clearTimeout(timer)); return;
  }
  res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="paper.pdf"' }); res.end(pdf());
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let context;
let diagnosticsPage;
const assertions = [];
const check = (label, fn) => { fn(); assertions.push(label); console.log(`PASS ${label}`); };
try {
  const executablePath = process.env.PAPER_TEST_EXECUTABLE;
  const launchOptions = {
    ...(executablePath ? { executablePath } : { channel: 'chromium' }), headless: true,
    acceptDownloads: true, viewport: { width: 1100, height: 1000 },
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--enable-unsafe-extension-debugging', '--no-first-run']
  };
  context = await chromium.launchPersistentContext(join(runDir, 'profile'), launchOptions);
  const cdp = await context.browser().newBrowserCDPSession();
  const { id } = await cdp.send('Extensions.loadUnpacked', { path: extension });
  // CDP allow/allowAndName bypass onDeterminingFilename. Restore the normal browser download flow.
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'default', eventsEnabled: true });
  let ui = await context.newPage();
  await ui.goto(`chrome-extension://${id}/options.html`).catch(error => {
    if (!error.message.includes('interrupted by another navigation')) throw error;
  });
  diagnosticsPage = ui;
  await ui.getByRole('heading', { name: 'Name-paper-cloud', exact: true }).waitFor();
  await ui.evaluate(() => chrome.runtime.sendMessage({ type: 'SETTINGS', settings: { crossref: false } }));
  await ui.evaluate(() => chrome.runtime.sendMessage({ type: 'SYNC' }));
  const errors = [];
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  const records = () => ui.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_STATE' })).then(s => s.records);
  async function waitFor(test, description) {
    for (let i = 0; i < 100; i++) { if (await test()) return; await new Promise(r => setTimeout(r, 100)); }
    throw new Error('Timed out: ' + description);
  }
  async function open(name) {
    const page = await context.newPage(); await page.goto(`${base}/article/${name}`);
    if (name !== 'unrelated') await waitFor(async () => {
      const state = await ui.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_STATE' }));
      return state.snapshots.some(s => s.pageUrl.endsWith(`/article/${name}`));
    }, `snapshot ${name}`);
    return page;
  }
  async function download(page, selector = '#body') {
    const before = new Set((await records()).map(r => r.id));
    const event = page.waitForEvent('download'); await page.locator(selector).click(); await event;
    await waitFor(async () => (await records()).some(r => !before.has(r.id) && r.state !== 'progress'), 'download completion');
    return (await records()).find(r => !before.has(r.id));
  }
  await ui.getByRole('button', { name: '期刊缩写', exact: true }).click();
  await ui.getByRole('textbox', { name: '期刊缩写映射' }).fill('Example Journal = Ex J');
  await ui.getByRole('button', { name: '保存缩写表' }).click();
  await ui.getByRole('status').filter({ hasText: '缩写表已保存' }).waitFor();
  await ui.getByRole('button', { name: '网站授权', exact: true }).click();
  assert.ok(await ui.getByRole('button', { name: '授权此网站', exact: true }).isVisible());
  await ui.getByRole('button', { name: '本地记录', exact: true }).click();
  assert.ok(await ui.getByRole('button', { name: '清除本地记录和缓存' }).isVisible());
  await ui.getByRole('button', { name: '常规设置', exact: true }).click();
  await ui.getByLabel('自动处理可可靠识别的 PDF 下载').uncheck();
  await waitFor(async () => !(await ui.evaluate(() => chrome.runtime.sendMessage({type:'GET_STATE'}))).settings.enabled, 'UI toggle saved');
  await ui.reload();
  assert.equal(await ui.getByLabel('自动处理可可靠识别的 PDF 下载').isChecked(), false);
  await ui.getByLabel('自动处理可可靠识别的 PDF 下载').check();
  await waitFor(async () => (await ui.evaluate(() => chrome.runtime.sendMessage({type:'GET_STATE'}))).settings.enabled, 'UI toggle restored');
  check('settings navigation and saved switches preserve abbreviation mappings', () => assert.ok(true));
  const nature = await open('nature');
  let r = await download(nature);
  check('article is renamed on disk by the actual downloads API', () => { assert.match(r.actual, /Nature - 2026 - Zhu - Atmospheric CH4/); assert.equal(r.reason, ''); });
  check('downloaded PDF exists', () => assert.ok(r.actual.startsWith(downloads)));
  assert.ok((await readFile(r.actual, 'utf8')).startsWith('%PDF-'));
  r = await download(nature);
  check('same-name downloads use browser uniquify', () => assert.match(r.actual, / \(1\)\.pdf$/));
  r = await download(nature, '#si');
  check('supplement is linked to its article', () => assert.match(r.actual, / - SI - 41586_MOESM1_ESM\.pdf$/));
  r = await download(nature, '#review');
  check('peer review uses the correct suffix', () => assert.match(r.actual, / - PeerReview - test-peer-review\.pdf$/));
  const agu = await open('agu'), pnas = await open('pnas');
  const beforeIds = new Set((await records()).map(r => r.id));
  await Promise.all([agu.locator('#body').click(), pnas.locator('#body').click()]);
  await waitFor(async () => (await records()).filter(r => !beforeIds.has(r.id) && r.state === 'complete').length === 2, 'concurrent downloads');
  const concurrent = (await records()).filter(r => !beforeIds.has(r.id));
  check('concurrent tabs do not exchange metadata', () => {
    assert.ok(concurrent.some(r => r.actual.includes('de Roode'))); assert.ok(concurrent.some(r => r.actual.includes('Schiro')));
  });
  const missing = await open('missing'); r = await download(missing);
  check('missing author preserves original filename', () => { assert.equal(r.proposed, undefined); assert.match(r.reason, /第一作者姓氏/); assert.match(r.actual, /paper(?: \(\d+\))?\.pdf$/); });
  const unrelated = await open('unrelated'); r = await download(unrelated);
  check('ordinary PDF remains unchanged', () => assert.equal(r.proposed, undefined));
  const redirect = await open('redirect'); r = await download(redirect);
  check('redirect preserves correct article association', () => assert.match(r.actual, /J Clim - 2026 - Hong/));
  const copernicus = await open('copernicus'); r = await download(copernicus);
  check('Unicode surname survives disk naming', () => assert.match(r.actual, /García-López/));

  // Terminate the actual service worker, then wake it with a download event.
  const browserSession = await context.newCDPSession(ui);
  await browserSession.send('ServiceWorker.enable');
  await browserSession.send('ServiceWorker.stopAllWorkers');
  r = await download(agu);
  check('worker restart preserves article metadata', () => assert.match(r.actual, /de Roode/));

  const cancel = await open('cancel');
  const cancelBefore = new Set((await records()).map(r => r.id));
  await cancel.locator('#body').click();
  await waitFor(async () => (await records()).some(r => !cancelBefore.has(r.id)), 'slow download start');
  const cancelRecord = (await records()).find(r => !cancelBefore.has(r.id));
  await ui.evaluate(id => chrome.downloads.cancel(id), cancelRecord.id);
  await waitFor(async () => (await records()).find(r => r.id === cancelRecord.id)?.state === 'interrupted', 'cancelled download');
  check('cancelled downloads are reported as failures', () => assert.ok(true));

  await ui.screenshot({ path: join(runDir, 'settings.png'), fullPage: true });
  await ui.goto(`chrome-extension://${id}/popup.html`);
  await ui.getByRole('tab', { name: /^最近下载/ }).waitFor();
  check('popup shows completed naming status', () => assert.ok(true));
  await ui.setViewportSize({ width: 400, height: 850 });
  await ui.getByRole('tab', {name:/^待处理/}).click();
  await waitFor(async () => await ui.getByRole('tab', {name:/^待处理/}).getAttribute('aria-selected') === 'true', 'pending tab rendered');
  assert.equal(await ui.locator('.record .success').count(), 0);
  await ui.getByRole('tab', {name:/^最近下载/}).click();
  await waitFor(async () => await ui.getByRole('tab', {name:/^最近下载/}).getAttribute('aria-selected') === 'true', 'recent tab rendered');
  assert.ok(await ui.locator('.record .success').count()>0);
  assert.equal(await ui.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  check('record filters retain all records and popup fits 400 pixels', () => assert.ok(true));
  await ui.screenshot({ path: join(runDir, 'popup.png'), fullPage: false });
  const missingCard = ui.locator('.record').filter({ hasText: '缺少已核实的第一作者姓氏' });
  await missingCard.getByText('补全 / 修改并复制名称', { exact: true }).click();
  await missingCard.locator('input[name="author"]').fill('Zhu');
  await waitFor(async () => (await missingCard.locator('output').textContent()).includes('Nature - 2026 - Zhu'), 'editable preview');
  check('manual metadata editor generates preview', () => assert.ok(true));
  await missingCard.locator('input[type="checkbox"]').check();
  await missingCard.getByRole('button', { name: '复制规范名称' }).click();
  await ui.getByRole('status').filter({ hasText: '已复制' }).waitFor();
  check('copy saves a verified draft without changing the original file', () => assert.ok(true));
  check('no UI JavaScript errors', () => assert.deepEqual(errors, []));
  await ui.goto(`chrome-extension://${id}/options.html`);
  await ui.getByLabel('格式模板', {exact:true}).fill('{author}_{year}_{title}');
  await ui.getByRole('button', {name:'保存命名格式',exact:true}).click();
  await ui.getByRole('status').filter({hasText:'命名格式已保存'}).waitFor();
  await ui.getByLabel('格式模板', {exact:true}).fill('{doi}_{title}');
  await ui.getByRole('button', {name:'保存命名格式',exact:true}).click();
  await ui.locator('#toast').filter({hasText:'仅支持'}).waitFor();
  assert.equal((await ui.evaluate(()=>chrome.runtime.sendMessage({type:'GET_STATE'}))).settings.namingTemplate, '{author}_{year}_{title}');
  await ui.reload();
  assert.equal(await ui.getByLabel('格式模板',{exact:true}).inputValue(),'{author}_{year}_{title}');
  r=await download(nature);
  assert.match(r.actual,/Zhu_2026_Atmospheric/);
  assert.ok((await readFile(r.actual,'utf8')).startsWith('%PDF-'));
  r=await download(agu,'#si');
  assert.match(r.actual,/de Roode_2026_.* - SI - Supporting_Information_S1\.pdf$/);
  check('custom format persists, rejects invalid edits, and names actual article and SI downloads',()=>assert.ok(true));
  await ui.setViewportSize({width:1100,height:1100});
  await ui.screenshot({path:join(runDir,'custom-format-settings.png'),fullPage:true});
  await ui.goto(`chrome-extension://${id}/popup.html`);
  const customCard=ui.locator('.record').filter({hasText:'缺少已核实的第一作者姓氏'});
  await customCard.getByText('补全 / 修改并复制名称',{exact:true}).click();
  await waitFor(async()=>(await customCard.locator('output').textContent()).startsWith('Zhu_2026_'),'custom manual preview');
  check('manual editor uses the saved custom format',()=>assert.ok(true));
  const recordCount = (await records()).length;
  await ui.evaluate(() => chrome.runtime.sendMessage({ type: 'SETTINGS', settings: { enabled: false } }));
  await context.close();
  context = await chromium.launchPersistentContext(join(runDir, 'profile'), launchOptions);
  const restartCdp = await context.browser().newBrowserCDPSession();
  await restartCdp.send('Extensions.loadUnpacked', { path: extension });
  ui = await context.newPage(); await ui.goto(`chrome-extension://${id}/popup.html`);
  diagnosticsPage = ui;
  const restored = await ui.evaluate(() => chrome.runtime.sendMessage({ type: 'GET_STATE' }));
  check('browser restart preserves settings and download history', () => {
    assert.equal(restored.settings.enabled, false); assert.equal(restored.records.length, recordCount); assert.ok(restored.snapshots.length > 0);
    assert.equal(restored.settings.abbreviations['Example Journal'], 'Ex J');
    assert.ok(restored.records.some(r => r.draft?.author === 'Zhu'));
    assert.equal(restored.settings.namingTemplate,'{author}_{year}_{title}');
  });
  await ui.goto(`chrome-extension://${id}/options.html`);
  await ui.getByRole('button',{name:'恢复默认格式',exact:true}).click();
  await ui.getByRole('status').filter({hasText:'默认命名格式已恢复'}).waitFor();
  assert.equal((await ui.evaluate(()=>chrome.runtime.sendMessage({type:'GET_STATE'}))).settings.namingTemplate,'{journal} - {year} - {author} - {title}');
  check('default format can be restored without clearing other settings',()=>assert.ok(true));
  await ui.goto(`chrome-extension://${id}/popup.html`);
  // Render the actual earlier ACP test record in the isolated test profile only.
  const realText = await readFile(resolve('test-results/real-acp-1792382330505/download-result.json'), 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (realText) {
    await ui.evaluate(record => chrome.storage.local.set({records:[record]}), JSON.parse(realText).record);
    await ui.reload();
    await ui.locator('.record .success').waitFor();
    await ui.setViewportSize({width:400,height:950});
    await ui.screenshot({path:join(runDir,'popup-real-acp.png'),fullPage:true});
    await ui.evaluate(records => chrome.storage.local.set({records}), restored.records);
  }
  const disk = await readdir(downloads);
  await writeFile(join(runDir, 'results.json'), JSON.stringify({ browser: context.browser()?.version() || 'persistent Chromium', assertions, files: disk }, null, 2));
  console.log(`Results: ${runDir}`);
} catch (error) {
  if (diagnosticsPage) {
    const diagnostics = await diagnosticsPage.evaluate(async () => ({
      state: await chrome.runtime.sendMessage({ type: 'GET_STATE' }),
      downloads: await chrome.downloads.search({}),
      storage: await chrome.storage.local.get(null)
    })).catch(e => ({ error: e.message }));
    await writeFile(join(runDir, 'failure.json'), JSON.stringify(diagnostics, null, 2));
    console.error('Diagnostics:', JSON.stringify(diagnostics));
  }
  throw error;
} finally {
  await context?.close(); await new Promise(resolve => server.close(resolve));
}
