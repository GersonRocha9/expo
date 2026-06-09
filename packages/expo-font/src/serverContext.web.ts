import type { ServerFontResourceDescriptor } from './Font.types';

type ServerFontEntry = { name: string; css: string; resourceId: string };

const ID = 'expo-generated-fonts';

type ServerStore = Map<string, ServerFontEntry>;
type Storage = {
  run<T>(store: ServerStore, callback: () => T): T;
  getStore(): ServerStore | undefined;
};

let storage: Storage | null = null;

function getStorage(): Storage {
  if (!storage) {
    if (typeof window !== 'undefined') {
      throw new Error('expo-font server context is server-only and cannot be used in the browser.');
    }
    const { AsyncLocalStorage } = require('node:async_hooks');
    storage = new AsyncLocalStorage();
  }
  return storage!;
}

function requireStore(): ServerStore {
  const store = getStorage().getStore();
  if (!store) {
    throw new Error(
      'expo-font server context accessed outside of withServerContext(). ' +
        'Wrap your server-side font usage in withServerContext(() => /* server code */).'
    );
  }
  return store;
}

/**
 * Run `callback` in a fresh server-side font context. Server-side font loads, reads, and resource
 * extraction all read from this scope's store — never from module-level state — so two overlapping
 * renders cannot leak fonts into each other.
 */
export function withServerContext<T>(callback: () => T): T {
  if (typeof window !== 'undefined') {
    return callback();
  }
  return getStorage().run(new Map(), callback);
}

// Key on the full CSS: it embeds the family name and every CSS-affecting option (`uri`,
// `font-display`, etc.), so two loads of the same family with different options produce
// different keys and both get emitted. Preloads dedupe separately by `resourceId`.
export function addServerFont(entry: ServerFontEntry): void {
  const store = requireStore();
  if (!store.has(entry.css)) {
    store.set(entry.css, entry);
  }
}

export function getServerResourceDescriptors(): ServerFontResourceDescriptor[] {
  const entries = [...requireStore().values()];
  if (!entries.length) {
    return [];
  }
  const css = entries.map(({ css }) => css).join('\n');
  // Preloads dedupe by resourceId — multiple @font-face entries sharing a URI only need one
  // <link rel="preload">.
  const links = [...new Set(entries.map(({ resourceId }) => resourceId))];
  return [
    {
      css,
      id: ID,
      type: 'style' as const,
    },
    ...links.map((resourceId) => ({
      as: 'font' as const,
      crossOrigin: '' as const,
      href: resourceId,
      rel: 'preload' as const,
      type: 'link' as const,
    })),
  ];
}

// Public-API surface: `Font.getLoadedFonts()` / `Font.isLoaded(name)` can be called from any
// server code (route handlers, hooks, scripts) — not just from within a render. Soft-return
// instead of throwing so an unscoped caller sees "nothing loaded" rather than crashing.
export function getLoadedServerFonts(): string[] {
  const store = getStorage().getStore();
  if (!store) {
    return [];
  }
  return [...store.values()].map(({ name }) => name);
}

export function isServerFontLoaded(name: string): boolean {
  const store = getStorage().getStore();
  if (!store) {
    return false;
  }
  for (const entry of store.values()) {
    if (entry.name === name) {
      return true;
    }
  }
  return false;
}
