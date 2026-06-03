"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createInjectedCssAsNodes = createInjectedCssAsNodes;
exports.createInjectedInlineCssAsNodes = createInjectedInlineCssAsNodes;
exports.createInjectedScriptAsNodes = createInjectedScriptAsNodes;
exports.createInjectedFaviconAsNodes = createInjectedFaviconAsNodes;
exports.createInjectedExtraScriptTagsAsNodes = createInjectedExtraScriptTagsAsNodes;
exports.getBootstrapContents = getBootstrapContents;
exports.createInjectedFontsAsNodes = createInjectedFontsAsNodes;
const jsx_runtime_1 = require("react/jsx-runtime");
const html_1 = require("./html");
function createInjectedCssAsNodes(hrefs) {
    return {
        headNodes: hrefs.flatMap((href) => [
            (0, jsx_runtime_1.jsx)("link", { rel: "preload", href: href, as: "style" }, `css-preload-${href}`),
            (0, jsx_runtime_1.jsx)("link", { rel: "stylesheet", href: href }, `css-stylesheet-${href}`),
        ]),
    };
}
function createInjectedInlineCssAsNodes(inlineCss = []) {
    return {
        headNodes: inlineCss.map(({ source, hmrId }, index) => ((0, jsx_runtime_1.jsx)("style", { "data-expo-css-hmr": hmrId, dangerouslySetInnerHTML: { __html: source } }, hmrId ? `inline-css-${hmrId}` : `inline-css-${index}`))),
    };
}
function createInjectedScriptAsNodes(srcs) {
    return {
        headNodes: srcs.map((src) => ((0, jsx_runtime_1.jsx)("link", { rel: "preload", href: src, as: "script" }, `script-preload-${src}`))),
        bodyNodes: srcs.map((src) => (0, jsx_runtime_1.jsx)("script", { defer: true, src: src }, `script-src-${src}`)),
    };
}
/**
 * Returns a `<link rel="icon">` head node for the given favicon URL. Companion to
 * `createInjectedFaviconAsString` in `utils/html.ts`.
 */
function createInjectedFaviconAsNodes(href) {
    return {
        headNodes: [(0, jsx_runtime_1.jsx)("link", { rel: "icon", href: href }, `favicon-${href}`)],
    };
}
/**
 * Returns `<script>` head nodes for each {@link ExtraScriptTag}. Companion to
 * `createInjectedExtraScriptTagsAsString` in `utils/html.ts`.
 */
function createInjectedExtraScriptTagsAsNodes(tags) {
    return {
        headNodes: tags.map((tag, index) => tag.platform === 'web' ? ((0, jsx_runtime_1.jsx)("script", { src: tag.src }, `extra-script-${index}`)) : ((0, jsx_runtime_1.jsx)("script", { type: "type/expo", src: tag.src, "data-platform": tag.platform }, `extra-script-${index}`))),
    };
}
function getBootstrapContents({ hydrate = true, loadedData, }) {
    const parts = [];
    if (hydrate) {
        parts.push((0, html_1.getHydrationFlagScriptContents)());
    }
    if (loadedData) {
        parts.push((0, html_1.getLoaderDataScriptContents)(loadedData));
    }
    return parts.join('\n');
}
function createInjectedFontsAsNodes(descriptors) {
    return descriptors.map((descriptor) => {
        switch (descriptor.type) {
            case 'style':
                return ((0, jsx_runtime_1.jsx)("style", { id: descriptor.id, dangerouslySetInnerHTML: { __html: descriptor.css } }, `font-style-${descriptor.id}`));
            case 'link':
                return ((0, jsx_runtime_1.jsx)("link", { rel: descriptor.rel, href: descriptor.href, as: descriptor.as, crossOrigin: descriptor.crossOrigin }, `font-link-${descriptor.href}`));
            default:
                return null;
        }
    });
}
//# sourceMappingURL=react.js.map