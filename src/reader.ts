export const PLUGIN_ID = 'comment-expand@lllateron';
export const PREF = 'extensions.zotero.commentExpand.expanded';
export const ROOT_ATTR = 'data-zotero-comment-expand';
export const CONTROLS_ID = 'zotero-comment-expand-controls';
export const STYLE_ID = 'zotero-comment-expand-style';

// Only comments in the sidebar. Quoted text, popups and editors elsewhere keep
// their native styles. Removing ROOT_ATTR restores Zotero's own expansion state.
export const CSS = `
html[${ROOT_ATTR}="true"] #annotationsView .annotation .preview .comment .expandable-editor .content {
  display: block;
  -webkit-line-clamp: unset;
  -webkit-box-orient: unset;
}
#${CONTROLS_ID} {
  display: flex; flex: 0 0 auto; align-items: center;
  -moz-window-dragging: no-drag;
}
/* Keep the comment toggle next to native search, rather than letting the
   toolbar's space-between distribution separate the two controls. */
#sidebarContainer .sidebar-toolbar > .end:has(> #${CONTROLS_ID}) {
  display: flex; align-items: center; gap: 3px;
}
#${CONTROLS_ID} button {
  display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: center;
  box-sizing: border-box; width: 28px; height: 28px; padding: 4px;
  border: 1px solid transparent; border-radius: 4px;
  color: inherit; background: transparent; font: inherit; cursor: pointer;
  -moz-window-dragging: no-drag;
}
#${CONTROLS_ID} button:hover { background: var(--fill-quinary, #ddd); }
#${CONTROLS_ID} button[aria-pressed="true"] { background: var(--fill-quaternary, #d5d5d5); }
#${CONTROLS_ID} button:focus-visible { outline: 2px solid var(--accent-blue, #0067c0); outline-offset: -2px; }
#${CONTROLS_ID} svg { width: 20px; height: 20px; pointer-events: none; }
`;

interface Prefs {
  getBoolPref(name: string, fallback: boolean): boolean;
  setBoolPref(name: string, value: boolean): void;
  addObserver(name: string, observer: object): void;
  removeObserver(name: string, observer: object): void;
}
interface Reader {
  tabID?: string;
  _isUninitialized?: boolean;
  _iframeWindow?: Window;
  _initPromise?: Promise<unknown>;
}
interface ReaderEvent { reader: Reader; doc: Document }
export interface ZoteroAPI {
  locale?: string;
  initializationPromise?: Promise<unknown>;
  Reader: {
    _readers?: Reader[];
    registerEventListener(name: string, listener: (event: ReaderEvent) => void, pluginID?: string): void;
    unregisterEventListener(name: string, listener: (event: ReaderEvent) => void): void;
  };
  Notifier: {
    registerObserver(observer: { notify(event: string, type: string, ids: unknown[]): void }, types: string[], name: string): unknown;
    unregisterObserver(id: unknown): void;
  };
  logError(error: unknown): void;
}
interface Session {
  reader: Reader; doc: Document; controls: HTMLDivElement; button: HTMLButtonElement;
  style: HTMLStyleElement; observer: MutationObserver; dispose: Array<() => void>;
  closed: boolean; queued: boolean;
}

export class ReaderController {
  private sessions = new Map<Reader, Session>();
  private readers = new Set<Reader>();
  private closedReaders = new WeakSet<Reader>();
  private running = false;
  private toolbarRegistered = false;
  private prefRegistered = false;
  private notifier: unknown;
  private generation = 0;

  constructor(private Z: ZoteroAPI, private prefs: Prefs,
    private cloneIntoReader: (value: MutationObserverInit, target: Window) => MutationObserverInit = value => value) {}

  private safely(work: () => void): void {
    try { work(); } catch (error) { this.Z.logError(error); }
  }

  private expanded(): boolean { return this.prefs.getBoolPref(PREF, false); }

  private prefObserver = { observe: () => {
    if (!this.running) return;
    for (const s of this.sessions.values()) this.safely(() => this.refresh(s));
  } };

  private onToolbar = ({ reader, doc }: ReaderEvent): void => {
    if (this.running) this.safely(() => this.attach(reader, doc));
  };

  start(): void {
    if (this.running) return;
    this.running = true;
    this.closedReaders = new WeakSet<Reader>();
    const generation = ++this.generation;
    try {
      this.Z.Reader.registerEventListener('renderToolbar', this.onToolbar, PLUGIN_ID);
      this.toolbarRegistered = true;
      this.prefs.addObserver(PREF, this.prefObserver);
      this.prefRegistered = true;
      this.notifier = this.Z.Notifier.registerObserver({ notify: (event, type, ids) => {
        if (type !== 'tab' || event !== 'close') return;
        for (const reader of [...this.readers]) {
          if (reader.tabID !== undefined && ids.includes(reader.tabID)) this.closeReader(reader);
        }
      } }, ['tab'], 'comment-expand-reader');
      for (const reader of this.Z.Reader._readers || []) {
        this.readers.add(reader);
        this.mountExisting(reader);
        if (reader._initPromise) {
          void Promise.resolve(reader._initPromise).then(() => {
            if (this.running && this.generation === generation) this.mountExisting(reader);
          }).catch(error => this.Z.logError(error));
        }
      }
    } catch (error) { this.stop(); throw error; }
  }

  stop(): void {
    this.running = false;
    ++this.generation;
    if (this.toolbarRegistered) this.safely(() => this.Z.Reader.unregisterEventListener('renderToolbar', this.onToolbar));
    this.toolbarRegistered = false;
    if (this.prefRegistered) this.safely(() => this.prefs.removeObserver(PREF, this.prefObserver));
    this.prefRegistered = false;
    if (this.notifier !== undefined) this.safely(() => this.Z.Notifier.unregisterObserver(this.notifier));
    this.notifier = undefined;
    for (const s of [...this.sessions.values()]) this.detach(s);
    this.readers.clear();
  }

  private mountExisting(reader: Reader): void {
    if (!this.running || this.closedReaders.has(reader) || reader._isUninitialized) return;
    this.safely(() => {
      const doc = reader._iframeWindow?.document;
      if (doc?.body) this.attach(reader, doc);
    });
  }

  private attach(reader: Reader, doc: Document): void {
    if (this.closedReaders.has(reader) || !doc.defaultView || !doc.body || !doc.head) return;
    this.readers.add(reader);
    const previous = this.sessions.get(reader);
    if (previous?.doc === doc) { this.place(previous); return; }
    if (previous) this.detach(previous);
    const view = doc.defaultView;
    const controls = doc.createElement('div');
    controls.id = CONTROLS_ID;
    const button = doc.createElement('button');
    button.type = 'button';
    button.setAttribute('data-tabstop', '1');
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 20 20');
    svg.setAttribute('aria-hidden', 'true');
    const path = doc.createElementNS(svg.namespaceURI, 'path');
    // Comment bubble distinguishes this from Bilingual Outline's chevrons.
    for (const [name, value] of Object.entries({
      d: 'M3 3h14v11H8l-4 3v-3H3zM10 5v7M8 7l2-2 2 2M8 10l2 2 2-2',
      fill: 'none', stroke: 'currentColor', 'stroke-width': '1.3',
      'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    })) path.setAttribute(name, value);
    svg.append(path); button.append(svg); controls.append(button);
    const style = doc.createElement('style'); style.id = STYLE_ID; style.textContent = CSS;
    let session: Session;
    const observer = new (view as unknown as { MutationObserver: typeof MutationObserver }).MutationObserver(() => {
      if (session.closed || session.queued) return;
      session.queued = true;
      void Promise.resolve().then(() => {
        session.queued = false;
        if (!session.closed && this.running) this.safely(() => this.place(session));
      });
    });
    const click = () => this.safely(() => {
      this.prefs.setBoolPref(PREF, !this.expanded());
    });
    const unload = () => this.closeReader(reader);
    session = { reader, doc, controls, button, style, observer, closed: false, queued: false,
      dispose: [() => button.removeEventListener('click', click),
        () => view.removeEventListener('pagehide', unload), () => view.removeEventListener('unload', unload)] };
    this.sessions.set(reader, session);
    try {
      button.addEventListener('click', click);
      view.addEventListener('pagehide', unload);
      view.addEventListener('unload', unload);
      this.place(session);
      this.refresh(session);
      observer.observe(doc.documentElement, this.cloneIntoReader({ childList: true, subtree: true }, view));
    } catch (error) { this.detach(session); throw error; }
  }

  private place(s: Session): void {
    if (s.closed) return;
    if (!s.style.isConnected) s.doc.head.append(s.style);
    const end = s.doc.querySelector('#sidebarContainer .sidebar-toolbar > .end');
    if (end && (s.controls.parentElement !== end || end.firstElementChild !== s.controls)) {
      // Own only this node. Search stays beside it in the native right-hand
      // group, independent of other add-ons' insertion order or scrolling.
      end.prepend(s.controls);
    }
  }

  private refresh(s: Session): void {
    if (s.closed) return;
    const expanded = this.expanded();
    if (expanded) s.doc.documentElement.setAttribute(ROOT_ATTR, 'true');
    else s.doc.documentElement.removeAttribute(ROOT_ATTR);
    const zh = this.Z.locale?.startsWith('zh');
    const label = expanded
      ? (zh ? '恢复评论默认显示' : 'Restore default comment display')
      : (zh ? '展开全部评论' : 'Expand all comments');
    s.button.title = label;
    s.button.setAttribute('aria-label', label);
    s.button.setAttribute('aria-pressed', String(expanded));
  }

  private closeReader(reader: Reader): void {
    // Initialization can finish after a tab has closed. Its old promise must
    // never remount controls in the document that is being discarded.
    this.closedReaders.add(reader);
    this.readers.delete(reader);
    const session = this.sessions.get(reader);
    if (session) this.detach(session);
  }

  private detach(s: Session): void {
    if (s.closed) return;
    s.closed = true;
    s.observer.disconnect();
    for (const dispose of s.dispose) this.safely(dispose);
    this.safely(() => {
      s.doc.documentElement.removeAttribute(ROOT_ATTR);
      s.controls.remove(); s.style.remove();
    });
    this.sessions.delete(s.reader);
  }
}
