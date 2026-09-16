import { ReaderController, type ZoteroAPI } from './reader';

let controller: ReaderController | undefined;

export async function startup(Z: ZoteroAPI, services: { prefs: ConstructorParameters<typeof ReaderController>[1] }): Promise<void> {
  if (controller) return;
  await Z.initializationPromise;
  const next = new ReaderController(Z, services.prefs,
    (value, target) => (globalThis as any).Components.utils.cloneInto(value, target));
  controller = next;
  try { next.start(); } catch (error) { controller = undefined; throw error; }
}

export function shutdown(): void {
  const current = controller; controller = undefined; current?.stop();
}
