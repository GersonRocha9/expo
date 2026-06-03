import type { ExpoConfig } from '@expo/config';
import { getConfig } from '@expo/config';
import { generateFaviconAsync, generateImageAsync } from '@expo/image-utils';
import fs from 'fs';
import path from 'path';
import React, { type ReactNode } from 'react';

import { getUserDefinedFile } from './publicFolder';
import type { ExportAssetMap } from './saveAssets';
import { Log } from '../log';

const debug = require('debug')('expo:favicon') as typeof console.log;

/** @returns the file system path for a user-defined favicon.ico file in the public folder. */
export function getUserDefinedFaviconFile(projectRoot: string): string | null {
  return getUserDefinedFile(projectRoot, ['./favicon.ico']);
}

/**
 * Generates the virtual favicon and persists it to `files` (or disk). Returns `true` when a
 * favicon was prepared and `false` when there is nothing to inject (user-defined file present, or
 * no `web.favicon` in the Expo config).
 */
async function persistVirtualFaviconAsync(
  projectRoot: string,
  {
    outputDir,
    files,
    exp,
  }: { outputDir: string; files?: ExportAssetMap; exp?: ExpoConfig }
): Promise<boolean> {
  const existing = getUserDefinedFaviconFile(projectRoot);
  if (existing) {
    debug('Using user-defined favicon.ico file.');
    return false;
  }

  const data = await getFaviconFromExpoConfigAsync(projectRoot, { exp });
  if (!data) {
    return false;
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
  return true;
}

export async function getVirtualFaviconAssetsAsync(
  projectRoot: string,
  {
    baseUrl,
    outputDir,
    files,
    exp,
  }: { outputDir: string; baseUrl: string; files?: ExportAssetMap; exp?: ExpoConfig }
): Promise<((html: string) => string) | null> {
  const prepared = await persistVirtualFaviconAsync(projectRoot, { outputDir, files, exp });
  if (!prepared) {
    return null;
  }

  return function injectFaviconTag(html: string): string {
    if (!html.includes('</head>')) {
      return html;
    }
    return html.replace('</head>', `<link rel="icon" href="${baseUrl}/favicon.ico" /></head>`);
  };
}

/**
 * Counterpart to {@link getVirtualFaviconAssetsAsync} that returns React nodes suitable for
 * insertion into a streaming SSR document's `<head>` (via `renderOpts.metadata.headNodes`).
 */
export async function getVirtualFaviconHeadNodesAsync(
  projectRoot: string,
  {
    baseUrl,
    outputDir,
    files,
    exp,
  }: { outputDir: string; baseUrl: string; files?: ExportAssetMap; exp?: ExpoConfig }
): Promise<ReactNode[] | null> {
  const prepared = await persistVirtualFaviconAsync(projectRoot, { outputDir, files, exp });
  if (!prepared) {
    return null;
  }

  return [
    React.createElement('link', { key: 'favicon', rel: 'icon', href: `${baseUrl}/favicon.ico` }),
  ];
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
