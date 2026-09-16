import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

import { shutdown, startup } from '../src/main';
import { createZotero, MemoryPrefs } from './helpers';

function deferred(): { promise: Promise<void>; resolve(): void; reject(error: unknown): void } {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('runtime startup waits for Zotero initialization and shutdown is idempotent', async () => {
  shutdown();
  const initialization = deferred();
  const prefs = new MemoryPrefs();
  const harness = createZotero();
  harness.Z.initializationPromise = initialization.promise;
  (globalThis as { Components?: unknown }).Components = {
    utils: { cloneInto: (value: unknown) => value },
  };

  const starting = startup(harness.Z, { prefs });
  assert.equal(harness.readerListeners.size, 0);
  initialization.resolve();
  await starting;
  assert.equal(harness.readerListeners.size, 1);

  await startup(harness.Z, { prefs });
  assert.equal(prefs.addCalls, 1, 'a completed startup is not registered twice');
  shutdown();
  shutdown();
  assert.equal(harness.readerListeners.size, 0);
  delete (globalThis as { Components?: unknown }).Components;
});

test('runtime startup failure resets the singleton so retry can succeed', async () => {
  shutdown();
  const prefs = new MemoryPrefs();
  prefs.failObserverRegistration = true;
  const harness = createZotero();
  (globalThis as { Components?: unknown }).Components = {
    utils: { cloneInto: (value: unknown) => value },
  };

  await assert.rejects(startup(harness.Z, { prefs }), /preference observer failed/);
  assert.equal(harness.readerListeners.size, 0);
  prefs.failObserverRegistration = false;
  await startup(harness.Z, { prefs });
  assert.equal(harness.readerListeners.size, 1);
  shutdown();
  delete (globalThis as { Components?: unknown }).Components;
});

interface BootstrapRuntime {
  startup(): Promise<void>;
  shutdown(): void;
}

function loadBootstrap(runtime: BootstrapRuntime): {
  context: Record<string, unknown>;
  startup(args: { rootURI: string }): Promise<void>;
  shutdown(): Promise<void>;
  getLoads(): number;
} {
  const source = readFileSync(new URL('../addon/bootstrap.js', import.meta.url), 'utf8');
  let loads = 0;
  const context: Record<string, unknown> = {
    Zotero: {},
    Services: {
      scriptloader: {
        loadSubScriptWithOptions(_url: string, options: { target: Record<string, unknown> }): void {
          loads += 1;
          options.target.CommentExpandRuntime = runtime;
        },
      },
    },
  };
  vm.runInNewContext(source, context, { filename: 'addon/bootstrap.js' });
  return {
    context,
    startup: context.startup as (args: { rootURI: string }) => Promise<void>,
    shutdown: context.shutdown as () => Promise<void>,
    getLoads: () => loads,
  };
}

test('bootstrap coalesces concurrent startup calls and shutdown waits for startup', async () => {
  const gate = deferred();
  let startupCalls = 0;
  let shutdownCalls = 0;
  const bootstrap = loadBootstrap({
    async startup() { startupCalls += 1; await gate.promise; },
    shutdown() { shutdownCalls += 1; },
  });

  const first = bootstrap.startup({ rootURI: 'test://comment-expand/' });
  const second = bootstrap.startup({ rootURI: 'test://comment-expand/' });
  const stopping = bootstrap.shutdown();
  assert.equal(bootstrap.getLoads(), 1);
  assert.equal(startupCalls, 1);
  assert.equal(shutdownCalls, 0, 'shutdown waits for the pending runtime startup');

  gate.resolve();
  await Promise.all([first, second, stopping]);
  assert.equal(shutdownCalls, 1);
  assert.equal(bootstrap.context.CommentExpandRuntime, undefined);
});

test('bootstrap cleans a failed runtime and can load it again', async () => {
  let attempts = 0;
  let shutdownCalls = 0;
  const bootstrap = loadBootstrap({
    async startup() {
      attempts += 1;
      if (attempts === 1) throw new Error('runtime failed');
    },
    shutdown() { shutdownCalls += 1; },
  });

  await assert.rejects(bootstrap.startup({ rootURI: 'test://comment-expand/' }), /runtime failed/);
  assert.equal(shutdownCalls, 1);
  assert.equal(bootstrap.context.CommentExpandRuntime, undefined);

  await bootstrap.startup({ rootURI: 'test://comment-expand/' });
  assert.equal(attempts, 2);
  assert.equal(bootstrap.getLoads(), 2);
  await bootstrap.shutdown();
  assert.equal(shutdownCalls, 2);
});
