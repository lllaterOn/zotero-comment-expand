import { JSDOM } from 'jsdom';

import type { ZoteroAPI } from '../src/reader';

export interface TestReader {
  tabID?: string;
  _isUninitialized?: boolean;
  _iframeWindow?: Window;
  _initPromise?: Promise<unknown>;
}

export class MemoryPrefs {
  value: boolean | undefined;
  observer: { observe(): void } | undefined;
  failWrites = false;
  failObserverRegistration = false;
  addCalls = 0;
  removeCalls = 0;

  getBoolPref(_name: string, fallback: boolean): boolean {
    return this.value ?? fallback;
  }

  setBoolPref(_name: string, value: boolean): void {
    if (this.failWrites) throw new Error('preference write failed');
    this.value = value;
    this.observer?.observe();
  }

  addObserver(_name: string, observer: object): void {
    this.addCalls += 1;
    if (this.failObserverRegistration) throw new Error('preference observer failed');
    this.observer = observer as { observe(): void };
  }

  removeObserver(_name: string, observer: object): void {
    this.removeCalls += 1;
    if (this.observer === observer) this.observer = undefined;
  }
}

export interface ZoteroHarness {
  Z: ZoteroAPI;
  errors: unknown[];
  readerListeners: Map<string, (event: { reader: TestReader; doc: Document }) => void>;
  registeredPluginIDs: Array<string | undefined>;
  unregisteredReaderEvents: string[];
  notifier: { notify(event: string, type: string, ids: unknown[]): void } | undefined;
  unregisterNotifierCalls: unknown[];
  emitToolbar(reader: TestReader, doc: Document): void;
  notify(event: string, type: string, ids: unknown[]): void;
}

export function createZotero(readers: TestReader[] = [], locale = 'zh-CN'): ZoteroHarness {
  const errors: unknown[] = [];
  const readerListeners = new Map<string, (event: { reader: TestReader; doc: Document }) => void>();
  const registeredPluginIDs: Array<string | undefined> = [];
  const unregisteredReaderEvents: string[] = [];
  let notifier: ZoteroHarness['notifier'];
  const unregisterNotifierCalls: unknown[] = [];

  const Z = {
    locale,
    initializationPromise: Promise.resolve(),
    Reader: {
      _readers: readers,
      registerEventListener(name: string, listener: (event: { reader: TestReader; doc: Document }) => void, pluginID?: string): void {
        readerListeners.set(name, listener);
        registeredPluginIDs.push(pluginID);
      },
      unregisterEventListener(name: string, listener: (event: { reader: TestReader; doc: Document }) => void): void {
        unregisteredReaderEvents.push(name);
        if (readerListeners.get(name) === listener) readerListeners.delete(name);
      },
    },
    Notifier: {
      registerObserver(value: ZoteroHarness['notifier']): number {
        notifier = value;
        return 37;
      },
      unregisterObserver(id: unknown): void {
        unregisterNotifierCalls.push(id);
        notifier = undefined;
      },
    },
    logError(error: unknown): void { errors.push(error); },
  } as unknown as ZoteroAPI;

  return {
    Z,
    errors,
    readerListeners,
    registeredPluginIDs,
    unregisteredReaderEvents,
    get notifier() { return notifier; },
    unregisterNotifierCalls,
    emitToolbar(reader, doc) {
      const listener = readerListeners.get('renderToolbar');
      if (!listener) throw new Error('renderToolbar listener is not registered');
      listener({ reader, doc });
    },
    notify(event, type, ids) { notifier?.notify(event, type, ids); },
  };
}

export function createReaderDocument(extraToolbar = ''): JSDOM {
  return new JSDOM(`<!doctype html><html><head></head><body>
    <div id="sidebarContainer"><div class="sidebar-toolbar">
      <button id="native-control">native</button>${extraToolbar}<div class="end"><div class="search-box"><input id="searchInput"></div></div>
    </div></div>
    <div id="annotationsView">
      <div class="annotation"><div class="preview">
        <div class="text"><div class="expandable-editor"><div class="content" id="quoted-text">quote</div></div></div>
        <div class="comment"><div class="expandable-editor"><div class="content" id="comment-text">comment</div></div></div>
      </div></div>
    </div>
    <div class="comment"><div class="expandable-editor"><div class="content" id="outside-comment">outside</div></div></div>
  </body></html>`, { url: 'https://reader.invalid/' });
}

export function readerFor(dom: JSDOM, fields: Omit<TestReader, '_iframeWindow'> = {}): TestReader {
  return { ...fields, _iframeWindow: dom.window as unknown as Window };
}

export async function settleDOM(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  await Promise.resolve();
}
