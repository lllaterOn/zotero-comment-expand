import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONTROLS_ID,
  CSS,
  PLUGIN_ID,
  ROOT_ATTR,
  ReaderController,
  STYLE_ID,
} from '../src/reader';
import {
  createReaderDocument,
  createZotero,
  MemoryPrefs,
  readerFor,
  settleDOM,
  type TestReader,
} from './helpers';

test('one persisted preference drives every open reader and a new controller restores it', () => {
  const firstDOM = createReaderDocument();
  const secondDOM = createReaderDocument();
  const first = readerFor(firstDOM, { tabID: 'first' });
  const second = readerFor(secondDOM, { tabID: 'second' });
  const prefs = new MemoryPrefs();
  const harness = createZotero([first, second]);
  const controller = new ReaderController(harness.Z, prefs);

  controller.start();
  for (const doc of [firstDOM.window.document, secondDOM.window.document]) {
    assert.equal(doc.documentElement.hasAttribute(ROOT_ATTR), false, 'first install defaults to native display');
    assert.equal(doc.querySelector(`#${CONTROLS_ID} button`)?.getAttribute('aria-pressed'), 'false');
  }

  (firstDOM.window.document.querySelector(`#${CONTROLS_ID} button`) as HTMLButtonElement).click();
  assert.equal(prefs.value, true);
  for (const doc of [firstDOM.window.document, secondDOM.window.document]) {
    assert.equal(doc.documentElement.getAttribute(ROOT_ATTR), 'true');
    assert.equal(doc.querySelector(`#${CONTROLS_ID} button`)?.getAttribute('aria-pressed'), 'true');
  }

  controller.stop();
  assert.equal(prefs.value, true, 'shutdown must not erase the local preference');

  const restarted = new ReaderController(harness.Z, prefs);
  restarted.start();
  assert.equal(firstDOM.window.document.documentElement.getAttribute(ROOT_ATTR), 'true');
  assert.equal(secondDOM.window.document.documentElement.getAttribute(ROOT_ATTR), 'true');
  restarted.stop();
});

test('the expansion rule selects sidebar comments only (jsdom does not validate actual line clamping)', () => {
  const dom = createReaderDocument();
  const selector = `html[${ROOT_ATTR}="true"] #annotationsView .annotation .preview .comment .expandable-editor .content`;
  dom.window.document.documentElement.setAttribute(ROOT_ATTR, 'true');

  assert.deepEqual(
    [...dom.window.document.querySelectorAll(selector)].map(node => node.id),
    ['comment-text'],
    'quoted text and comments outside the annotation sidebar are outside the CSS selector',
  );
  assert.match(CSS, new RegExp(`${ROOT_ATTR.replaceAll('-', '\\-')}="true"`));
  assert.match(CSS, /\.comment \.expandable-editor \.content/);
  assert.match(CSS, /-webkit-line-clamp:\s*unset/);
  assert.doesNotMatch(CSS, /\.text \.expandable-editor \.content/);
});

test('controls coexist with Bilingual Outline regardless of insertion order and preserve native nodes', async () => {
  const existingBilingual = createReaderDocument('<div class="bo-controls"><button>outline</button></div>');
  const firstReader = readerFor(existingBilingual);
  const prefs = new MemoryPrefs();
  const firstHarness = createZotero([firstReader]);
  const firstController = new ReaderController(firstHarness.Z, prefs);
  firstController.start();

  const firstBar = existingBilingual.window.document.querySelector('.sidebar-toolbar')!;
  assert.deepEqual([...firstBar.children].map(node => node.id || node.className), [
    'native-control', 'bo-controls', 'end',
  ]);
  assert.deepEqual([...firstBar.querySelector('.end')!.children].map(node => node.id || node.className), [CONTROLS_ID, 'search-box']);
  assert.equal(firstBar.querySelectorAll('#native-control').length, 1);
  assert.equal(firstBar.querySelectorAll('.bo-controls').length, 1);
  firstController.stop();

  const pluginFirst = createReaderDocument();
  const secondReader = readerFor(pluginFirst);
  const secondHarness = createZotero([secondReader]);
  const secondController = new ReaderController(secondHarness.Z, prefs);
  secondController.start();
  const secondBar = pluginFirst.window.document.querySelector('.sidebar-toolbar')!;
  const bilingual = pluginFirst.window.document.createElement('div');
  bilingual.className = 'bo-controls';
  secondBar.insertBefore(bilingual, secondBar.querySelector(':scope > .end'));
  await settleDOM();

  assert.deepEqual([...secondBar.children].map(node => node.id || node.className), [
    'native-control', 'bo-controls', 'end',
  ]);
  assert.deepEqual([...secondBar.querySelector('.end')!.children].map(node => node.id || node.className), [CONTROLS_ID, 'search-box']);
  assert.equal(secondBar.querySelectorAll(`#${CONTROLS_ID}`).length, 1);
  assert.equal(pluginFirst.window.document.querySelectorAll(`#${STYLE_ID}`).length, 1);
  secondController.stop();
});

test('toolbar reconstruction and repeated render events restore exactly one button', async () => {
  const dom = createReaderDocument();
  const reader = readerFor(dom);
  const prefs = new MemoryPrefs();
  const harness = createZotero();
  const controller = new ReaderController(harness.Z, prefs);
  controller.start();
  harness.emitToolbar(reader, dom.window.document);
  harness.emitToolbar(reader, dom.window.document);
  assert.equal(dom.window.document.querySelectorAll(`#${CONTROLS_ID}`).length, 1);
  assert.equal(dom.window.document.querySelectorAll(`#${STYLE_ID}`).length, 1);

  const container = dom.window.document.querySelector('#sidebarContainer')!;
  container.innerHTML = '<div class="sidebar-toolbar"><button id="new-native">new</button><div class="end"><div class="search-box"><input id="searchInput"></div></div></div>';
  await settleDOM();
  const rebuilt = container.querySelector('.sidebar-toolbar')!;
  assert.deepEqual([...rebuilt.children].map(node => node.id || node.className), [
    'new-native', 'end',
  ]);
  assert.equal(rebuilt.querySelector('.end')!.firstElementChild?.id, CONTROLS_ID);
  assert.equal(dom.window.document.querySelectorAll(`#${CONTROLS_ID}`).length, 1);
  controller.stop();
});

test('search view reconstruction restores adjacency without replacing the native input', async () => {
  const dom = createReaderDocument();
  const reader = readerFor(dom);
  const controller = new ReaderController(createZotero([reader]).Z, new MemoryPrefs());
  controller.start();
  const end = dom.window.document.querySelector('.end')!;
  end.innerHTML = '<div class="search-box"><input id="searchInput" value="native search"></div>';
  const input = end.querySelector('input')!;
  let inputs = 0;
  input.addEventListener('input', () => { inputs++; });
  await settleDOM();
  assert.deepEqual([...end.children].map(node => node.id || node.className), [CONTROLS_ID, 'search-box']);
  assert.equal(end.querySelector('input'), input);
  assert.equal(input.value, 'native search');
  input.dispatchEvent(new dom.window.Event('input'));
  assert.equal(inputs, 1, 'native search listeners are preserved');
  controller.stop();
  assert.equal(end.children.length, 1);
  assert.equal(end.querySelector('input'), input, 'unload removes only the plugin control');
});

test('startup mounts initialized readers and waits for readers still initializing', async () => {
  const readyDOM = createReaderDocument();
  const pendingDOM = createReaderDocument();
  let finishInitialization!: () => void;
  const pendingPromise = new Promise<void>(resolve => { finishInitialization = resolve; });
  const ready = readerFor(readyDOM, { tabID: 'ready' });
  const pending = readerFor(pendingDOM, {
    tabID: 'pending',
    _isUninitialized: true,
    _initPromise: pendingPromise,
  });
  const harness = createZotero([ready, pending]);
  const controller = new ReaderController(harness.Z, new MemoryPrefs());
  controller.start();

  assert.ok(readyDOM.window.document.querySelector(`#${CONTROLS_ID}`));
  assert.equal(pendingDOM.window.document.querySelector(`#${CONTROLS_ID}`), null);
  pending._isUninitialized = false;
  finishInitialization();
  await settleDOM();
  assert.ok(pendingDOM.window.document.querySelector(`#${CONTROLS_ID}`));
  controller.stop();
});

test('a reader closed during initialization is not remounted by its delayed init callback', async () => {
  const dom = createReaderDocument();
  let finishInitialization!: () => void;
  const initPromise = new Promise<void>(resolve => { finishInitialization = resolve; });
  const reader = readerFor(dom, {
    tabID: 'pending-close',
    _isUninitialized: true,
    _initPromise: initPromise,
  });
  const harness = createZotero([reader]);
  const controller = new ReaderController(harness.Z, new MemoryPrefs());
  controller.start();

  harness.emitToolbar(reader, dom.window.document);
  assert.ok(dom.window.document.querySelector(`#${CONTROLS_ID}`), 'toolbar event can arrive before initPromise resolves');
  harness.notify('close', 'tab', ['pending-close']);
  assert.equal(dom.window.document.querySelector(`#${CONTROLS_ID}`), null);

  reader._isUninitialized = false;
  finishInitialization();
  await settleDOM();
  assert.equal(
    dom.window.document.querySelector(`#${CONTROLS_ID}`),
    null,
    'the stale init callback must not revive a closed reader session',
  );
  controller.stop();
});

test('tab close also cancels delayed mounting before the first toolbar event', async () => {
  const dom = createReaderDocument();
  let finishInitialization!: () => void;
  const initPromise = new Promise<void>(resolve => { finishInitialization = resolve; });
  const reader = readerFor(dom, {
    tabID: 'pending-never-attached',
    _isUninitialized: true,
    _initPromise: initPromise,
  });
  const harness = createZotero([reader]);
  const controller = new ReaderController(harness.Z, new MemoryPrefs());
  controller.start();

  harness.notify('close', 'tab', ['pending-never-attached']);
  reader._isUninitialized = false;
  finishInitialization();
  await settleDOM();
  assert.equal(dom.window.document.querySelector(`#${CONTROLS_ID}`), null);
  controller.stop();
});

test('tab close, page unload and stop clean up without delayed reattachment', async () => {
  const closedDOM = createReaderDocument();
  const unloadedDOM = createReaderDocument();
  const closed = readerFor(closedDOM, { tabID: 'closed' });
  const unloaded = readerFor(unloadedDOM, { tabID: 'unloaded' });
  const harness = createZotero([closed, unloaded]);
  const prefs = new MemoryPrefs();
  prefs.value = true;
  const controller = new ReaderController(harness.Z, prefs);
  controller.start();

  harness.notify('close', 'tab', ['closed']);
  unloadedDOM.window.dispatchEvent(new unloadedDOM.window.Event('pagehide'));
  for (const doc of [closedDOM.window.document, unloadedDOM.window.document]) {
    doc.querySelector('.sidebar-toolbar')?.append(doc.createElement('span'));
  }
  await settleDOM();

  for (const doc of [closedDOM.window.document, unloadedDOM.window.document]) {
    assert.equal(doc.querySelector(`#${CONTROLS_ID}`), null);
    assert.equal(doc.querySelector(`#${STYLE_ID}`), null);
    assert.equal(doc.documentElement.hasAttribute(ROOT_ATTR), false);
  }

  controller.stop();
  assert.deepEqual(harness.unregisteredReaderEvents, ['renderToolbar']);
  assert.deepEqual(harness.unregisterNotifierCalls, [37]);
  assert.equal(prefs.removeCalls, 1);
});

test('a failed preference write is logged and does not present an expanded state', () => {
  const dom = createReaderDocument();
  const prefs = new MemoryPrefs();
  prefs.failWrites = true;
  const harness = createZotero();
  const controller = new ReaderController(harness.Z, prefs);
  controller.start();
  const reader: TestReader = readerFor(dom);
  harness.emitToolbar(reader, dom.window.document);

  (dom.window.document.querySelector(`#${CONTROLS_ID} button`) as HTMLButtonElement).click();
  assert.equal(prefs.value, undefined);
  assert.equal(dom.window.document.documentElement.hasAttribute(ROOT_ATTR), false);
  assert.equal(dom.window.document.querySelector(`#${CONTROLS_ID} button`)?.getAttribute('aria-pressed'), 'false');
  assert.equal(harness.errors.length, 1);
  assert.match(String(harness.errors[0]), /preference write failed/);
  controller.stop();
});

test('start failure rolls registrations back and allows a later clean start', () => {
  const prefs = new MemoryPrefs();
  prefs.failObserverRegistration = true;
  const harness = createZotero();
  const controller = new ReaderController(harness.Z, prefs);

  assert.throws(() => controller.start(), /preference observer failed/);
  assert.deepEqual(harness.unregisteredReaderEvents, ['renderToolbar']);
  assert.equal(harness.readerListeners.size, 0);

  prefs.failObserverRegistration = false;
  controller.start();
  assert.equal(harness.readerListeners.get('renderToolbar') instanceof Function, true);
  assert.deepEqual(harness.registeredPluginIDs, [PLUGIN_ID, PLUGIN_ID]);
  controller.stop();
  assert.equal(harness.unregisteredReaderEvents.length, 2);
});
