import { addServerFont, getServerResourceDescriptors, withServerContext } from '../serverContext';

const fontA = { name: 'A', css: '@font-face{font-family:"A"}', resourceId: 'a.ttf' };
const fontB = { name: 'B', css: '@font-face{font-family:"B"}', resourceId: 'b.ttf' };

it('throws when font registry is read or written outside a scope', () => {
  expect(() => addServerFont(fontA)).toThrow(/outside of withServerContext/);
  expect(() => getServerResourceDescriptors()).toThrow(/outside of withServerContext/);
});

it('deduplicates identical font entries within one scope', () => {
  const descriptors = withServerContext(() => {
    addServerFont(fontA);
    addServerFont(fontA);
    addServerFont(fontA);
    return getServerResourceDescriptors();
  });

  expect(descriptors).toHaveLength(2);
  expect(descriptors[0]).toMatchObject({ type: 'style', css: fontA.css });
  expect(descriptors[1]).toMatchObject({ type: 'link', href: fontA.resourceId });
});

it('keeps separate entries for the same family loaded with different CSS', () => {
  // E.g. `loadAsync('X', { uri: 'x.ttf', display: 'swap' })` and `{ display: 'block' }` generate
  // different @font-face rules; both must be emitted. Preloads still dedupe by resourceId.
  const swap = {
    name: 'X',
    css: '@font-face{font-family:"X";font-display:swap}',
    resourceId: 'x.ttf',
  };
  const block = {
    name: 'X',
    css: '@font-face{font-family:"X";font-display:block}',
    resourceId: 'x.ttf',
  };

  const descriptors = withServerContext(() => {
    addServerFont(swap);
    addServerFont(block);
    return getServerResourceDescriptors();
  });

  const styles = descriptors.filter((d) => d.type === 'style');
  const links = descriptors.filter((d) => d.type === 'link');
  expect(styles).toHaveLength(1);
  expect(styles[0]).toMatchObject({ css: `${swap.css}\n${block.css}` });
  expect(links).toHaveLength(1);
  expect(links[0]).toMatchObject({ href: 'x.ttf' });
});

it('isolates concurrent scopes via AsyncLocalStorage', async () => {
  const release: Record<'a' | 'b', () => void> = { a: () => {}, b: () => {} };
  const blocker = (key: 'a' | 'b') => new Promise<void>((resolve) => (release[key] = resolve));

  const scopeA = withServerContext(async () => {
    addServerFont(fontA);
    // Yield control to scope B before reading back — proves the store is preserved across awaits.
    await blocker('a');
    return getServerResourceDescriptors();
  });

  const scopeB = withServerContext(async () => {
    addServerFont(fontB);
    await blocker('b');
    return getServerResourceDescriptors();
  });

  // Interleave: release B first so it reads back before A writes any more.
  release.b();
  release.a();

  const [a, b] = await Promise.all([scopeA, scopeB]);

  expect(a.find((d) => d.type === 'link')).toMatchObject({ href: fontA.resourceId });
  expect(a.some((d) => d.type === 'link' && d.href === fontB.resourceId)).toBe(false);

  expect(b.find((d) => d.type === 'link')).toMatchObject({ href: fontB.resourceId });
  expect(b.some((d) => d.type === 'link' && d.href === fontA.resourceId)).toBe(false);
});

it('preserves the scope across awaits in the callback', async () => {
  const result = await withServerContext(async () => {
    addServerFont(fontA);
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    return getServerResourceDescriptors();
  });

  expect(result.find((d) => d.type === 'link')).toMatchObject({ href: fontA.resourceId });
});

it('returns an empty descriptor list for a scope that loaded nothing', () => {
  expect(withServerContext(() => getServerResourceDescriptors())).toEqual([]);
});

// KNOWN LIMITATION: `FontResources` in `@expo/router-server` reads the registry once during the
// initial shell traversal of `renderToReadableStream`. A component that suspends before calling
// `Font.loadAsync` (and loads it on retry) will register its font *after* the registry-reader
// has already rendered an empty list, and the font won't be emitted. The ALS scope still
// behaves correctly — late writes do land in the store — but the consumer's read pattern is
// fundamentally synchronous and pre-Suspense. A real fix needs either declarative font
// resources or a post-`allReady` finalization pass and is tracked separately.
it.skip('TODO: late-Suspense font registrations are not emitted by the shell-pass reader', () => {});
