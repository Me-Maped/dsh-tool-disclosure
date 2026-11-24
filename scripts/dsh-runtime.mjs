/** Resolve shared DSH APIs from the running installation; never install dependencies. */
import { createRequire } from 'node:module';
import { resolve, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { realpathSync } from 'node:fs';
const localRequire = createRequire(import.meta.url);
let manifest;
if (process.env.DSH_INSTALL_DIR) {
  if (!isAbsolute(process.env.DSH_INSTALL_DIR)) throw new Error('DSH_INSTALL_DIR must be absolute');
  manifest = resolve(process.env.DSH_INSTALL_DIR, 'package.json');
} else {
  // Managed shell variables are not guaranteed in Host or CLI validation processes.
  // Anchor the fallback to the actual launching script, never a global-prefix guess.
  const anchors = [localRequire];
  if (process.argv[1]) {
    try { anchors.push(createRequire(pathToFileURL(realpathSync(process.argv[1])))); } catch { /* no file entry */ }
  }
  for (const anchor of anchors) {
    try { manifest = anchor.resolve('@deepseek-ai/dsh/package.json'); break; } catch { /* next verified anchor */ }
  }
  if (!manifest) throw new Error('Cannot locate the running DSH package from DSH_INSTALL_DIR or the real CLI entrypoint');
}
export const dshRequire = createRequire(pathToFileURL(manifest));
export const dshManifest = dshRequire(manifest);
if (dshManifest.name !== '@deepseek-ai/dsh' || dshManifest.version !== '0.2.2-rc.5') {
  throw new Error('Revalidate tool disclosure against this DSH version before activating it');
}
export async function importDsh(specifier) {
  return import(pathToFileURL(dshRequire.resolve(specifier)).href);
}
