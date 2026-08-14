/**
 * Inlines the production build into one self-contained HTML fragment, so the
 * game can be handed to someone as a single file with no server and no
 * external requests.
 *
 *   npm run build && npm run bundle
 *
 * Emits body-level content only (title, style, root, module script) — no
 * <html>/<head>/<body> wrapper — so it can be dropped straight into a host page.
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ASSETS = 'dist/assets';
const OUT = 'dist/winter-emblem.html';

const files = readdirSync(ASSETS);
const cssFile = files.find((name) => name.endsWith('.css'));
const jsFile = files.find((name) => name.endsWith('.js'));

if (!cssFile || !jsFile) {
  throw new Error(`Expected a .css and .js file in ${ASSETS}; run "npm run build" first`);
}

const css = readFileSync(join(ASSETS, cssFile), 'utf8');
// A literal </script> inside a JS string would close the tag early.
const js = readFileSync(join(ASSETS, jsFile), 'utf8').replaceAll('</script', '<\\/script');

writeFileSync(
  OUT,
  `<title>Winter Emblem</title>
<style>
${css}
</style>
<div id="root"></div>
<script type="module">
${js}
</script>
`,
);

console.log(`Wrote ${OUT}`);
