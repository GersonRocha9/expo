import type { ServerFontResourceDescriptor } from 'expo-font';
import { type ReactNode } from 'react';
import { type ExtraScriptTag } from './html';
type CreateNodeResult = {
    headNodes?: ReactNode[];
    bodyNodes?: ReactNode[];
};
export declare function createInjectedCssAsNodes(hrefs: string[]): CreateNodeResult;
export declare function createInjectedInlineCssAsNodes(inlineCss?: {
    source: string;
    hmrId?: string;
}[]): CreateNodeResult;
export declare function createInjectedScriptAsNodes(srcs: string[]): CreateNodeResult;
/**
 * Returns a `<link rel="icon">` head node for the given favicon URL. Companion to
 * `createInjectedFaviconAsString` in `utils/html.ts`.
 */
export declare function createInjectedFaviconAsNodes(href: string): CreateNodeResult;
/**
 * Returns `<script>` head nodes for each {@link ExtraScriptTag}. Companion to
 * `createInjectedExtraScriptTagsAsString` in `utils/html.ts`.
 */
export declare function createInjectedExtraScriptTagsAsNodes(tags: ExtraScriptTag[]): CreateNodeResult;
export declare function getBootstrapContents({ hydrate, loadedData, }: {
    hydrate: boolean;
    loadedData: Record<string, unknown> | null;
}): string;
export declare function createInjectedFontsAsNodes(descriptors: ServerFontResourceDescriptor[]): ReactNode[];
export {};
//# sourceMappingURL=react.d.ts.map