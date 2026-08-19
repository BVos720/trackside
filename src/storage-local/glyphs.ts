/**
 * Making the bundled glyphs reachable by MapLibre — native.
 *
 * MapLibre wants a URL *template* (`.../{fontstack}/{range}.pbf`) and expands
 * it as labels come into view. Metro gives bundled assets opaque, hashed URIs
 * with no shared directory, so there is no template that can point at them
 * directly.
 *
 * So on first run the ranges are copied out of the bundle into one folder under
 * the document directory, and the style points there. Two files, 200 KB, once
 * per install.
 *
 * ── Why not just leave them remote ────────────────────────────────────────
 * Because the Eifel has no signal, and a map that draws every road and names
 * none of them is close to useless for deciding where to stand. Every other
 * part of this app already works offline; labels were the exception.
 */
import { Asset } from 'expo-asset';
import { Directory, File, Paths } from 'expo-file-system';

/**
 * Stacks and ranges bundled, and the modules Metro resolved them to.
 *
 * The keys must match the directory names `npm run glyphs` writes, and the set
 * must cover every stack `normaliseFontStacks` can produce — a stack that is
 * requested but not copied is a label that silently does not draw.
 *
 * `require` at module scope so Metro sees static paths — a computed path would
 * resolve at runtime and silently ship nothing, which is the same failure the
 * .pmtiles archives had to be protected from.
 */
const BUNDLE: Record<string, Record<string, number>> = {
  NotoSansRegular: {
    '0-255': require('../../assets/glyphs/NotoSansRegular/0-255.pbf'),
    '256-511': require('../../assets/glyphs/NotoSansRegular/256-511.pbf'),
  },
  NotoSansMedium: {
    '0-255': require('../../assets/glyphs/NotoSansMedium/0-255.pbf'),
    '256-511': require('../../assets/glyphs/NotoSansMedium/256-511.pbf'),
  },
  NotoSansItalic: {
    '0-255': require('../../assets/glyphs/NotoSansItalic/0-255.pbf'),
    '256-511': require('../../assets/glyphs/NotoSansItalic/256-511.pbf'),
  },
};

let prepared: Promise<string | null> | null = null;

/**
 * Copy the glyphs into place and return the URL template.
 *
 * Null when it fails, which the caller treats as "fall back to the network" —
 * a map with remote labels beats a map with none, and this must never be the
 * reason the basemap does not load.
 *
 * Memoised: the map screen asks on every style rebuild, and 3D toggling alone
 * would otherwise recopy the files repeatedly.
 */
export function prepareGlyphs(): Promise<string | null> {
  prepared ??= (async () => {
    try {
      for (const [stack, ranges] of Object.entries(BUNDLE)) {
        const dir = new Directory(Paths.document, 'glyphs', stack);
        if (!dir.exists) dir.create({ intermediates: true });

        for (const [range, moduleId] of Object.entries(ranges)) {
          const target = new File(dir, `${range}.pbf`);
          if (target.exists) continue;

          const asset = Asset.fromModule(moduleId);
          await asset.downloadAsync();
          if (!asset.localUri) return null;

          // Copy rather than point at the asset directly: the cache location
          // is Metro's to manage and is not guaranteed to survive a reload.
          await new File(asset.localUri).copy(target);
        }
      }

      const base = new Directory(Paths.document, 'glyphs').uri.replace(/\/$/, '');
      return `${base}/{fontstack}/{range}.pbf`;
    } catch {
      return null;
    }
  })();

  return prepared;
}


