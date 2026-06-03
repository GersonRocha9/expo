/* eslint-env jest */
import fs from 'fs';
import path from 'path';

import { runExportSideEffects } from './export-side-effects';
import { createExpoServe, executeExpoAsync } from '../../utils/expo';
import { findProjectFiles, getHtml, getPageHtml, getRouterE2ERoot } from '../utils';

runExportSideEffects();

/**
 * Static export coverage, parametrized across the two renderer modes:
 * - `legacy`: the existing `renderToString` path.
 * - `streaming`: `renderToReadableStream` + `stream.allReady`, enabled by setting
 *   `unstable_useServerRendering: true` (`E2E_ROUTER_SERVER_RENDERING=true` in the fixture).
 *
 * Most assertions are identical across modes; per-mode differences (asset counts, font
 * registration, helmet behavior, metadata wiring) branch on `mode`.
 */
describe.each([
  {
    mode: 'legacy',
    outputName: 'dist-static-rendering',
    env: {},
  },
  {
    mode: 'streaming',
    outputName: 'dist-static-stream-rendering',
    env: { E2E_ROUTER_SERVER_RENDERING: 'true' },
  },
] as const)('exports static ($mode)', ({ mode, outputName, env }) => {
  const projectRoot = getRouterE2ERoot();
  const outputDir = path.join(projectRoot, outputName);

  beforeAll(async () => {
    await executeExpoAsync(
      projectRoot,
      ['export', '-p', 'web', '--source-maps', '--output-dir', outputName],
      {
        env: {
          NODE_ENV: 'production',
          EXPO_USE_STATIC: 'static',
          E2E_ROUTER_SRC: 'static-rendering',
          E2E_ROUTER_ASYNC: '',
          ...env,
        },
      }
    );
  });

  describe('server', () => {
    const server = createExpoServe({
      cwd: projectRoot,
      env: {
        NODE_ENV: 'production',
        TEST_SECRET_KEY: 'test-secret-key',
      },
    });

    beforeAll(async () => {
      // Start a server instance that we can test against then kill it.
      await server.startAsync([outputName]);
    });
    afterAll(async () => {
      await server.stopAsync();
    });

    it(`can serve up index html`, async () => {
      const html = getHtml(await server.fetchAsync('/').then((res) => res.text()));
      expect(html.querySelector('[data-testid="index-text"]')?.textContent).toEqual('Index');
    });

    it(`can serve up non-index html`, async () => {
      const html = getHtml(await server.fetchAsync('/styled').then((res) => res.text()));
      expect(html.querySelector('[data-testid="styled-text"]')?.textContent).toEqual('Hello World');
    });

    it.each([{ post: 'other' }, { post: 'welcome-to-the-universe' }])(
      `can serve up statically generated html for post: $post`,
      async ({ post }) => {
        const html = getHtml(await server.fetchAsync(`/${post}`).then((res) => res.text()));
        expect(html.querySelector('[data-testid="post-text"]')?.textContent).toEqual(
          `Post: ${post}`
        );
      }
    );

    it(`gets a 404`, async () => {
      expect(await server.fetchAsync('/missing-route').then((res) => res.status)).toBe(404);
    });
  });

  it('has expected files', async () => {
    const files = findProjectFiles(outputDir);

    // The wrapper should not be included as a route.
    expect(files).not.toContain('+html.html');
    expect(files).not.toContain('_layout.html');

    // Injected by framework
    expect(files).toContain('_sitemap.html');
    expect(files).toContain('+not-found.html');

    // Normal routes
    expect(files).toContain('about.html');
    expect(files).toContain('index.html');
    expect(files).toContain('styled.html');

    // generateStaticParams values
    expect(files).toContain('[post].html');
    expect(files).toContain('welcome-to-the-universe.html');
    expect(files).toContain('other.html');

    expect(files).toContain('_expo/.routes.json');
  });

  it('has source maps', async () => {
    const files = findProjectFiles(outputDir);

    const mapFiles = files.filter((file) => file?.endsWith('.map'));
    expect(mapFiles).toEqual([expect.stringMatching(/_expo\/static\/js\/web\/entry-.*\.map/)]);

    for (const file of mapFiles) {
      // Ensure the bundle does not contain a source map reference
      const sourceMap = JSON.parse(fs.readFileSync(path.join(outputDir, file!), 'utf8'));
      expect(sourceMap.version).toBe(3);
      expect(sourceMap.sources).toEqual(
        expect.arrayContaining([
          '__prelude__',
          // NOTE: No `/Users/evanbacon/`...
          // NOTE(@kitten): We can slot in our own runtime here
          expect.pathMatching(
            new RegExp(
              [
                '/node_modules/metro-runtime/src/polyfills/require.js',
                '/@expo/cli/build/metro-require/require.js',
              ].join('|')
            )
          ),

          // NOTE: relative to the server root for optimal source map support
          expect.pathMatching(/\/apps\/router-e2e\/__e2e__\/static-rendering\/app\/\[post\]\.tsx/),
        ])
      );
    }

    const jsFiles = files.filter((file) => file?.endsWith('.js'));

    for (const file of jsFiles) {
      // Ensure the bundle does not contain a source map reference
      const jsBundle = fs.readFileSync(path.join(outputDir, file!), 'utf8');
      expect(jsBundle).toMatch(
        /^\/\/\# sourceMappingURL=\/_expo\/static\/js\/web\/entry-.*\.map$/gm
      );
      const mapFile = jsBundle.match(
        /^\/\/\# sourceMappingURL=(\/_expo\/static\/js\/web\/entry-.*\.map)$/m
      )?.[1];

      expect(fs.existsSync(path.join(outputDir, mapFile!))).toBe(true);
    }
  });

  it('can use environment variables', async () => {
    const indexHtml = await getPageHtml(outputDir, 'index.html');

    const queryMeta = (name: string) =>
      indexHtml.querySelector(`html > head > meta[name="${name}"]`)?.attributes.content;

    // Injected in app/+html.tsx (server-rendered React, not helmet)
    expect(queryMeta('expo-e2e-public-env-var')).toEqual('foobar');
    // non-public env vars are injected during SSG
    expect(queryMeta('expo-e2e-private-env-var')).toEqual('not-public-value');

    if (mode === 'legacy') {
      // Injected in app/_layout.tsx via `<Head>` (react-helmet). Helmet collects tags into a
      // context during render and `getStaticContent` post-processes them into <head>, but
      // `getStreamingContent` has no equivalent — so these tags are absent under streaming.
      // Use `generateMetadata()` instead (covered below).
      // TODO(@hassankhan): Restore for streaming once helmet/streaming gap is closed.
      expect(queryMeta('expo-e2e-public-env-var-client')).toEqual('foobar');
      expect(queryMeta('expo-e2e-private-env-var-client')).toEqual('not-public-value');
    }

    indexHtml
      .querySelectorAll('script')
      .filter((script) => !!script.attributes.src)
      .forEach((script) => {
        const jsBundle = fs.readFileSync(path.join(outputDir, script.attributes.src ?? ''), 'utf8');

        // Ensure the bundle is valid
        expect(jsBundle).toMatch('__BUNDLE_START_TIME__');
        // Ensure the non-public env var is not included in the bundle
        expect(jsBundle).not.toMatch('not-public-value');
      });
  });

  it('static styles are injected', async () => {
    const indexHtml = await getPageHtml(outputDir, 'index.html');
    expect(indexHtml.querySelectorAll('html > head > style')?.length).toBe(
      // Legacy: expo-reset + react-native-stylesheet + expo-generated-fonts (3).
      // Streaming: expo-reset + react-native-stylesheet only (2). `<FontResources>` is
      // mounted in `bodyNodes`, so the generated-fonts style lives at end-of-body — matches
      // the SSR runtime placement.
      mode === 'legacy' ? 3 : 2
    );
    // The Expo style reset
    expect(indexHtml.querySelector('html > head > style#expo-reset')?.innerHTML).toEqual(
      expect.stringContaining(
        '#root,body,html{height:100%}body{overflow:hidden}#root{display:flex}'
      )
    );

    expect(
      indexHtml.querySelector('html > head > style#react-native-stylesheet')?.innerHTML
    ).toEqual(expect.stringContaining('[stylesheet-group="0"]{}'));

    if (mode === 'streaming') {
      // Generated fonts style is emitted at end of body (matches streamed SSR)
      expect(indexHtml.querySelector('html > body style#expo-generated-fonts')).not.toBeNull();
    }
  });

  it('statically extracts CSS', async () => {
    // Unfortunately, the CSS is injected in every page for now since we don't have bundle splitting.
    const indexHtml = await getPageHtml(outputDir, 'index.html');

    const links = indexHtml.querySelectorAll('html > head > link').filter((link) => {
      // Fonts are tested elsewhere
      return link.attributes.as !== 'font';
    });
    expect(links.length).toBe(
      // Global CSS (preload + stylesheet) + CSS module (preload + stylesheet) = 4.
      // Streaming adds React 19's automatic bootstrap-script preload
      // (`<link rel="preload" as="script">`), so +1.
      mode === 'legacy' ? 4 : 5
    );

    const linkStrings = links.map((l) => l.toString());

    expect(linkStrings).toEqual(
      expect.arrayContaining([
        // Global CSS (preload + stylesheet)
        expect.stringMatching(
          /<link rel="preload" href="\/_expo\/static\/css\/global-(?<md5>[0-9a-fA-F]{32})\.css" as="style"\/?>/
        ),
        expect.stringMatching(
          /<link rel="stylesheet" href="\/_expo\/static\/css\/global-(?<md5>[0-9a-fA-F]{32})\.css"\/?>/
        ),
        // Example test CSS module (preload + stylesheet)
        expect.stringMatching(
          /<link rel="preload" href="\/_expo\/static\/css\/test\.module-(?<md5>[0-9a-fA-F]{32})\.css" as="style"\/?>/
        ),
        expect.stringMatching(
          /<link rel="stylesheet" href="\/_expo\/static\/css\/test\.module-(?<md5>[0-9a-fA-F]{32})\.css"\/?>/
        ),
      ])
    );

    // Ensure the global CSS file is still generated
    const globalPreload = links.find((l) => /global-.*\.css/.test(l.attributes.href!));
    expect(globalPreload).toBeDefined();
    if (globalPreload) {
      expect(
        fs.readFileSync(path.join(outputDir, globalPreload.attributes.href ?? ''), 'utf-8')
      ).toMatchInlineSnapshot(`"div{background:#0ff}"`);
    }

    // CSS Module — index access stays the same since the React 19 script preload sorts before
    // the CSS preloads in streaming output: [script-preload, global-preload, module-preload, ...]
    expect(
      fs.readFileSync(path.join(outputDir, links[2]?.attributes.href ?? ''), 'utf-8')
    ).toMatchInlineSnapshot(`".HPV33q_text{color:#1e90ff}"`);

    const styledHtml = await getPageHtml(outputDir, 'styled.html');

    // Ensure the atomic CSS class is used
    expect(
      styledHtml.querySelector('html > body div[data-testid="styled-text"]')?.attributes.class
    ).toMatch('HPV33q_text');
  });

  it('statically extracts fonts', async () => {
    // <style id="expo-generated-fonts" type="text/css">@font-face{font-family:sweet;src:url(/assets/__e2e__/static-rendering/sweet.ttf?platform=web&hash=7c9263d3cffcda46ff7a4d9c00472c07);font-display:auto}</style><link rel="preload" href="/assets/__e2e__/static-rendering/sweet.ttf?platform=web&hash=7c9263d3cffcda46ff7a4d9c00472c07" as="font" crossorigin="" />
    // Unfortunately, the CSS is injected in every page for now since we don't have bundle splitting.
    const indexHtml = await getPageHtml(outputDir, 'index.html');

    const links = indexHtml.querySelectorAll('html > head > link[as="font"]');
    expect(links.length).toBe(
      // Streaming evaluates more of the tree (Suspense resolution / progressive flushes), so it
      // also picks up navigation chrome fonts (EvilIcons) that the legacy single-pass
      // `renderToString` path didn't register. After the `Map`-keyed dedup fix in
      // `ExpoFontLoader.web.ts`, each distinct font still appears exactly once.
      mode === 'legacy' ? 1 : 2
    );

    const sweet = links.find((l) =>
      /static-rendering\/sweet\.[a-zA-Z0-9]{32}\.ttf$/.test(l.attributes.href ?? '')
    );
    expect(sweet).toBeDefined();
    expect(sweet?.attributes.href).toBe(
      '/assets/__e2e__/static-rendering/sweet.7c9263d3cffcda46ff7a4d9c00472c07.ttf'
    );

    // Self-closing whitespace differs (`/ >` from string injection, `/>` from React) — both ok.
    expect(sweet?.toString()).toMatch(
      /<link rel="preload" href="\/assets\/__e2e__\/static-rendering\/sweet\.[a-zA-Z0-9]{32}\.ttf" as="font" crossorigin=""\s*\/?>/
    );

    expect(
      fs.readFileSync(path.join(outputDir, sweet?.attributes.href?.replace(/\?.*$/, '') ?? ''), 'utf-8')
    ).toBeDefined();

    // Ensure the font is used
    expect(indexHtml.querySelector('div[data-testid="index-text"]')?.attributes.style).toMatch(
      'font-family:sweet'
    );

    // TODO: This is broken with bundle splitting. Only fonts in the main layout are being statically extracted.
    // Fonts have proper splitting due to how they're loaded during static rendering, we should test
    // that certain fonts only show on the about page.
    // const aboutHtml = await getPageHtml(outputDir, 'about.html');

    // const aboutLinks = aboutHtml.querySelectorAll('html > head > link[as="font"]');
    // expect(aboutLinks.length).toBe(2);
    // expect(aboutLinks[1].attributes.href).toMatch(
    //   /react-native-vector-icons\/Fonts\/EvilIcons\.ttf/
    // );
  });

  it('supports usePathname in +html files', async () => {
    const page = await fs.promises.readFile(path.join(outputDir, 'index.html'), 'utf8');

    expect(page).toContain('<meta name="custom-value" content="value"/>');

    // Root element
    expect(page).toContain('<div id="root">');

    if (mode === 'legacy') {
      // Snapshot only in legacy mode: the streaming pipeline emits a differently-structured
      // document (React 19 bootstrap, async bundle script, helmet tags absent), so an HTML
      // snapshot there would mostly capture renderer mechanics rather than fixture behavior.
      const sanitized = page.replace(
        /<script src="\/_expo\/static\/js\/web\/.*" defer>/,
        '<script src="/_expo/static/js/web/[mock].js" defer>'
      );
      expect(sanitized).toMatchSnapshot();
    }

    expect(
      (await getPageHtml(outputDir, 'about.html')).querySelector(
        'html > head > meta[name="expo-e2e-pathname"]'
      )?.attributes.content
    ).toBe('/about');

    expect(
      (await getPageHtml(outputDir, 'index.html')).querySelector(
        'html > head > meta[name="expo-e2e-pathname"]'
      )?.attributes.content
    ).toBe('/');

    expect(
      (await getPageHtml(outputDir, 'welcome-to-the-universe.html')).querySelector(
        'html > head > meta[name="expo-e2e-pathname"]'
      )?.attributes.content
    ).toBe('/welcome-to-the-universe');
  });

  // `<Head>` (react-helmet) is unsupported in streaming mode (no post-render injection
  // equivalent in `getStreamingContent`). Use `generateMetadata()` instead (test below).
  // TODO(@hassankhan): Restore for streaming once helmet/streaming gap is closed.
  (mode === 'legacy' ? it : it.skip)('supports nested static head values', async () => {
    // <title>About | Website</title>
    // <meta name="description" content="About page" />
    const about = await getPageHtml(outputDir, 'about.html');

    expect(about.querySelector('html > body div[data-testid="content"]')?.innerText).toBe('About');
    expect(about.querySelector('html > head > title')?.innerText).toBe('About | Website');
    expect(about.querySelector('html > head > meta[name="description"]')?.attributes.content).toBe(
      'About page'
    );
    expect(
      // Nested from app/_layout.js
      about.querySelector('html > head > meta[name="expo-nested-layout"]')?.attributes.content
    ).toBe('TEST_VALUE');

    expect(
      // Other routes have the nested layout value
      (await getPageHtml(outputDir, 'welcome-to-the-universe.html')).querySelector(
        'html > head > meta[name="expo-nested-layout"]'
      )?.attributes.content
    ).toBe('TEST_VALUE');
  });

  // `generateMetadata()` is wired through `renderOpts.metadata.headNodes` only in the streaming
  // path today (`getStaticContent` doesn't accept a `metadata` option). Mirrors the SSR version
  // in `server-rendering.test.ts`.
  (mode === 'streaming' ? it : it.skip)(
    'injects `generateMetadata()` result into <head> at export time',
    async () => {
      const metadataHtml = await getPageHtml(outputDir, 'metadata.html');

      expect(metadataHtml.querySelector('[data-testid="metadata-text"]')?.innerText).toBe(
        'Metadata'
      );
      expect(metadataHtml.querySelector('html > head > title')?.innerText).toBe('Metadata Page');
      expect(
        metadataHtml.querySelector('html > head > meta[name="description"]')?.attributes.content
      ).toBe('Page with generateMetadata');
      expect(
        metadataHtml.querySelector('html > head > meta[name="keywords"]')?.attributes.content
      ).toBe('metadata, e2e');
    }
  );
});
