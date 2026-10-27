import { createRequire } from 'node:module';
import path from 'node:path';

import { GlobalFonts } from '@napi-rs/canvas';

/**
 * The renderer must not depend on fonts installed in the container image: a slim
 * Node image ships none, and Skia then draws shapes but no text at all. The fonts
 * are bundled with the app instead (`dejavu-fonts-ttf`) and registered under the
 * brand family names below, which are first in the stacks used by the renderer.
 */
export const SANS = '"Visual CS Lab Sans", Inter, "Segoe UI", system-ui, -apple-system, sans-serif';
export const MONO =
  '"Visual CS Lab Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace';

function registerFamily(alias: string, files: string[]): void {
  let ttfDir: string;
  try {
    const require = createRequire(import.meta.url);
    ttfDir = path.join(path.dirname(require.resolve('dejavu-fonts-ttf/package.json')), 'ttf');
  } catch {
    // Package unavailable: fall back to whatever fonts the machine provides.
    return;
  }
  for (const file of files) {
    try {
      GlobalFonts.registerFromPath(path.join(ttfDir, file), alias);
    } catch {
      // A missing face only costs a fallback, never a crash.
    }
  }
}

registerFamily('Visual CS Lab Sans', ['DejaVuSans.ttf', 'DejaVuSans-Bold.ttf']);
registerFamily('Visual CS Lab Mono', ['DejaVuSansMono.ttf', 'DejaVuSansMono-Bold.ttf']);
