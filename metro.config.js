// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

/**
 * Bundle .pmtiles archives as native app assets.
 *
 * Metro only bundles extensions it knows about, and `pmtiles` is not in the
 * default list — without this the archive is silently absent from the build and
 * the map renders empty on device while working fine on web, which is a
 * miserable thing to debug.
 *
 * Required for spec §1.4: the basemap has to ship inside the app, because the
 * Nordschleife has no signal to download it with.
 */
/**
 * ...and `.pbf` for the label glyph ranges, for the same reason: without the
 * extension registered the files are absent from the build and the map renders
 * unnamed roads on device while looking correct on web.
 */
/**
 * ...and `.pdfjs` for the pdfjs library itself.
 *
 * pdfjs cannot run in React Native's JS context — it needs a DOM — but it runs
 * perfectly inside a WebView, which has one. So the library ships as an
 * *asset*, is read at runtime and inlined into the page the WebView loads
 * (see pdfBridge.tsx). That is what makes reading a PDF work on the phone.
 *
 * The extension is renamed from .mjs deliberately: Metro treats .mjs as
 * source and would try to parse a 1.2MB minified bundle as a module. A
 * registered asset extension it has no opinion about is the way past that.
 *
 * Copied out of node_modules by `npm run pdfjsassets`, which postinstall runs,
 * so a fresh clone does not need the files committed.
 */
config.resolver.assetExts.push('pmtiles', 'pbf', 'pdfjs');

module.exports = config;
