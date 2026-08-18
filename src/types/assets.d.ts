/**
 * Ambient declarations for non-code imports.
 *
 * `.pmtiles` is registered in metro.config.js as a bundled asset extension; the
 * `require` of one returns Metro's numeric asset handle, which is what
 * `Asset.fromModule` expects.
 *
 * `.css` is imported for side effects by the web-only map screen. Expo's web
 * target handles it; TypeScript needs telling it exists.
 */
declare module '*.pmtiles' {
  const asset: number;
  export default asset;
}

declare module '*.css';
