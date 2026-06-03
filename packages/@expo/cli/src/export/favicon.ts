import type { ExpoConfig } from '@expo/config';
import { getConfig } from '@expo/config';
import { generateFaviconAsync, generateImageAsync } from '@expo/image-utils';
import fs from 'fs';
import path from 'path';

import { getUserDefinedFile } from './publicFolder';
import type { ExportAssetMap } from './saveAssets';
import { Log } from '../log';

const debug = require('debug')('expo:favicon') as typeof console.log;

/** @returns the file system path for a user-defined favicon.ico file in the public folder. */
export function getUserDefinedFaviconFile(projectRoot: string): string | null {
  return getUserDefinedFile(projectRoot, ['./favicon.ico']);
}

/**
 * Resolves the virtual favicon from the Expo config, persists it to `files` (or disk), and returns
 * the public URL it should be referenced by. Returns `null` if the user already has a favicon.ico
 * in the public folder, or if there's no `web.favicon` in the Expo config.
 *
 * Consumers are responsible for the actual injection — use `createInjectedFaviconAsString` /
 * `createInjectedFaviconAsNodes` from `@expo/router-server/build/utils/{html,react}` so the
 * markup stays co-located with the other injected asset helpers.
 */
export async function getVirtualFaviconHrefAsync(
  projectRoot: string,
  {
    baseUrl,
    outputDir,
    files,
    exp,
  }: { outputDir: string; baseUrl: string; files?: ExportAssetMap; exp?: ExpoConfig }
): Promise<string | null> {
  const existing = getUserDefinedFaviconFile(projectRoot);
  if (existing) {
    debug('Using user-defined favicon.ico file.');
    return null;
  }

  const data = await getFaviconFromExpoConfigAsync(projectRoot, { exp });
  if (!data) {
    return null;
  }

  const assetPath = path.join(outputDir, data.path);
  if (files) {
    debug('Storing asset for persisting: ' + assetPath);
    files.set(data.path, {
      contents: data.source,
      targetDomain: 'client',
    });
  } else {
    debug('Writing asset to disk: ' + assetPath);
    await fs.promises.writeFile(assetPath, data.source);
  }

  return `${baseUrl}/favicon.ico`;
}

export async function getFaviconFromExpoConfigAsync(
  projectRoot: string,
  { force = false, exp = getConfig(projectRoot).exp }: { force?: boolean; exp?: ExpoConfig } = {}
) {
  const src = exp.web?.favicon ?? null;
  if (!src) {
    return null;
  }

  const dims = [16, 32, 48];
  const cacheType = 'favicon';

  const size = dims[dims.length - 1]!;
  try {
    const { source } = await generateImageAsync(
      { projectRoot, cacheType },
      {
        resizeMode: 'contain',
        src,
        backgroundColor: 'transparent',
        width: size,
        height: size,
        name: `favicon-${size}.png`,
      }
    );

    const faviconBuffer = await generateFaviconAsync(source, dims);

    return { source: faviconBuffer, path: 'favicon.ico' };
  } catch (error: any) {
    // Check for ENOENT
    if (!force && error.code === 'ENOENT') {
      Log.warn(`Favicon source file in Expo config (web.favicon) does not exist: ${src}`);
      return null;
    }
    throw error;
  }
}
