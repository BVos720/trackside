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
config.resolver.assetExts.push('pmtiles', 'pbf');

module.exports = config;
