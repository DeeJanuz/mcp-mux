import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const artifactDir = process.env.MCPVIEWS_E2E_ARTIFACT_DIR
  ? path.resolve(process.env.MCPVIEWS_E2E_ARTIFACT_DIR)
  : path.resolve(__dirname, '..', 'artifacts');

mkdirSync(artifactDir, { recursive: true });

async function screenshot(name) {
  await browser.saveScreenshot(path.join(artifactDir, `${name}.png`));
}

async function waitForMainReady() {
  await $('#main-title').waitForDisplayed({ timeout: 30000 });
  await browser.waitUntil(async function () {
    return browser.execute(function () {
      var title = document.getElementById('main-title');
      var status = document.getElementById('connection-text');
      return !!(title && title.textContent && status);
    });
  }, {
    timeout: 30000,
    timeoutMsg: 'MCPViews main window did not finish rendering.',
  });
}

async function getHealth() {
  return browser.executeAsync(function (done) {
    if (!window.__TAURI__ || !window.__TAURI__.core || typeof window.__TAURI__.core.invoke !== 'function') {
      done({ error: 'Tauri IPC is not available.' });
      return;
    }
    window.__TAURI__.core.invoke('get_health')
      .then(function (result) { done(result); })
      .catch(function (error) { done({ error: String(error) }); });
  });
}

async function waitForAppsSurface(mainHandle) {
  await browser.waitUntil(async function () {
    var handles = await browser.getWindowHandles();
    if (handles.some(function (handle) { return handle !== mainHandle; })) return true;
    return browser.execute(function () {
      var dropdown = document.getElementById('apps-dropdown');
      return !!(dropdown && !dropdown.classList.contains('hidden'));
    });
  }, {
    timeout: 10000,
    timeoutMsg: 'Apps popup/dropdown did not open.',
  });
}

async function visibleRendererItems() {
  var items = await $$('.apps-renderer-item');
  var visible = [];
  for (var index = 0; index < items.length; index += 1) {
    if (await items[index].isDisplayed()) visible.push(items[index]);
  }
  return visible;
}

async function selectRendererIfPresent(mainHandle) {
  var handles = await browser.getWindowHandles();
  var popupHandle = handles.find(function (handle) { return handle !== mainHandle; });
  var menuSurface = 'dom-dropdown';
  if (popupHandle) {
    menuSurface = 'native-popup';
    await browser.switchToWindow(popupHandle);
    await $('#apps-popup').waitForDisplayed({ timeout: 10000 });
    await screenshot('apps-popup-open');
  } else {
    await screenshot('apps-dom-dropdown-open');
  }

  await browser.waitUntil(async function () {
    var items = await visibleRendererItems();
    if (items.length > 0) return true;
    var emptyText = await $('.apps-empty').getText().catch(function () { return ''; });
    return !!emptyText && !/Loading apps/i.test(emptyText);
  }, {
    timeout: 10000,
    timeoutMsg: 'Apps menu did not finish loading renderer entries or an empty state.',
  });

  var items = await visibleRendererItems();
  var requireRenderer = process.env.MCPVIEWS_E2E_REQUIRE_RENDERER === 'true';
  if (items.length === 0) {
    var emptyText = await $('.apps-empty').getText().catch(function () { return ''; });
    assert.match(emptyText, /No apps available|Failed to load apps|Loading apps/);
    if (requireRenderer) {
      throw new Error(`Expected at least one renderer in ${menuSurface}, but saw: ${emptyText}`);
    }
    return null;
  }

  var selectedLabel = (await items[0].getText()).trim();
  assert.ok(selectedLabel, 'Expected the first renderer item to have a visible label.');
  await items[0].click();

  await browser.waitUntil(async function () {
    var currentHandles = await browser.getWindowHandles();
    return currentHandles.includes(mainHandle) || currentHandles.length > 0;
  }, { timeout: 10000 });
  var currentHandles = await browser.getWindowHandles();
  await browser.switchToWindow(currentHandles.includes(mainHandle) ? mainHandle : currentHandles[0]);

  await browser.waitUntil(async function () {
    return browser.execute(function (label) {
      return Array.from(document.querySelectorAll('.tab-name')).some(function (tab) {
        return tab.textContent.trim() === label;
      });
    }, selectedLabel);
  }, {
    timeout: 15000,
    timeoutMsg: `Renderer selection did not open a tab named "${selectedLabel}".`,
  });
  await screenshot('renderer-launched');
  return selectedLabel;
}

describe('MCPViews Windows release smoke', function () {
  it('launches the native app and exercises Apps renderer launch when available', async function () {
    var mainHandle = await browser.getWindowHandle();

    await waitForMainReady();
    await screenshot('launch-ready');

    var health = await getHealth();
    assert.equal(health.status, 'ok', health.error || 'Expected get_health to report ok.');
    assert.ok(health.version, 'Expected get_health to include the app version.');

    await $('#apps-button').click();
    await waitForAppsSurface(mainHandle);
    await selectRendererIfPresent(mainHandle);
  });
});
