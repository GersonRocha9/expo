import type { ServerFontResourceDescriptor } from './Font.types';
type ServerFontEntry = {
    name: string;
    css: string;
    resourceId: string;
};
/**
 * Run `callback` in a fresh server-side font context. Server-side font loads, reads, and resource
 * extraction all read from this scope's store — never from module-level state — so two overlapping
 * renders cannot leak fonts into each other.
 */
export declare function withServerContext<T>(callback: () => T): T;
export declare function addServerFont(entry: ServerFontEntry): void;
export declare function getServerResourceDescriptors(): ServerFontResourceDescriptor[];
export declare function getLoadedServerFonts(): string[];
export declare function isServerFontLoaded(name: string): boolean;
export {};
//# sourceMappingURL=serverContext.web.d.ts.map