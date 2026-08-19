/**
 * Event bundles on disk — native.
 *
 * The KV store is the app's working memory; these files are the copy that
 * outlives it. They live in the document directory, which on Android means the
 * app's own files area: visible to a file manager, included in device backups,
 * and untouched by clearing the cache.
 *
 * ── Why write files at all when SQLite already persists ───────────────────
 * Because the database is only readable by this app, on this install. A file
 * can be copied off the phone, survives a reinstall if backed up, can be handed
 * to someone else, and can be read in a text editor on the day the app itself
 * is the thing that is broken. That last one is the reason it is JSON and not
 * a binary format.
 *
 * ── Writes are whole-file and atomic-ish ──────────────────────────────────
 * Each save rewrites one bundle completely. Bundles are tens of kilobytes, and
 * a partial write of a merge would be worse than a rewrite: the failure mode
 * for a backup must never be a file that looks valid and is not.
 */
import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';

import type { EventBundle } from '../core/logic/eventBundle';
import { bundleFileName, readEventBundle } from '../core/logic/eventBundle';

/** Where bundles live, relative to the document directory. */
const FOLDER = 'events';

export interface StoredBundle {
  readonly fileName: string;
  readonly uri: string;
  readonly bundle: EventBundle;
}

/**
 * The outcome of asking the user for a file.
 *
 * Three cases, not two. Backing out of the picker and picking the wrong file
 * are different things, and collapsing them into `null` means either an error
 * on cancel or silence on a genuine mistake — both of which teach the user to
 * ignore the screen.
 */
export type PickedBundle =
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'ok'; readonly fileName: string; readonly uri: string; readonly bundle: EventBundle }
  | { readonly kind: 'error'; readonly message: string };

function eventsDirectory(): Directory {
  const dir = new Directory(Paths.document, FOLDER);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

/**
 * Write one event's bundle, replacing any previous version.
 *
 * Returns the path so the UI can show where it went — "saved" with no location
 * is not a claim anyone can check, and the whole point of files is that you can
 * go and find them.
 */
export async function saveEventBundle(bundle: EventBundle): Promise<string> {
  const dir = eventsDirectory();
  const file = new File(dir, bundleFileName(bundle.event));

  // Two spaces: these are meant to be readable by a person with a text editor,
  // and the size difference on a file this small is irrelevant.
  file.write(JSON.stringify(bundle, null, 2));
  return file.uri;
}

/** Every bundle currently on disk, newest name order aside. */
export async function listEventBundles(): Promise<StoredBundle[]> {
  const dir = eventsDirectory();
  const out: StoredBundle[] = [];

  for (const entry of dir.list()) {
    if (!(entry instanceof File)) continue;
    if (!entry.name.endsWith('.json')) continue;

    // A folder people can put files in will contain files we did not write.
    // One unreadable bundle must not hide the rest.
    try {
      const { bundle } = readEventBundle(await entry.text());
      if (bundle) out.push({ fileName: entry.name, uri: entry.uri, bundle });
    } catch {
      continue;
    }
  }
  return out;
}

/** Read one bundle by its URI, for importing a file chosen by the user. */
export async function readBundleFile(uri: string): Promise<StoredBundle | null> {
  try {
    const file = new File(uri);
    const { bundle } = readEventBundle(await file.text());
    if (!bundle) return null;
    return { fileName: file.name, uri: file.uri, bundle };
  } catch {
    return null;
  }
}

/**
 * Read a bundle the user picked from anywhere on the device.
 *
 * Separate from `listEventBundles`, which only sees the app's own folder. On
 * Android that folder is app-private storage — invisible to the system file
 * picker and wiped on uninstall — so a bundle that was copied off the phone and
 * is coming back has to arrive through here.
 *
 * ── Why the filter is every type, not application/json ────────────────────
 * Android passes the MIME type to the file provider, and providers routinely
 * report a .json file as application/octet-stream; filtering on the honest type
 * shows an empty picker with no explanation. So anything may be chosen and
 * `readEventBundle` decides — it refuses an unknown `format` and says what it
 * expected, which is a better error than a file the user cannot see.
 */
export async function importBundleFromPicker(): Promise<PickedBundle> {
  const result = await DocumentPicker.getDocumentAsync({
    type: '*/*',
    // As with the PDF picker: without this the URI can be revoked the moment
    // the picker closes, and the read fails looking like a corrupt file.
    copyToCacheDirectory: true,
    multiple: false,
  });

  if (result.canceled) return { kind: 'cancelled' };
  const asset = result.assets?.[0];
  if (!asset) return { kind: 'cancelled' };

  let text: string;
  try {
    text = await new File(asset.uri).text();
  } catch {
    return { kind: 'error', message: 'That file could not be read.' };
  }

  const { bundle, error } = readEventBundle(text);
  if (!bundle) {
    return {
      kind: 'error',
      message: `${asset.name ?? 'That file'} is not a Trackside event file. ${error ?? ''}`.trim(),
    };
  }
  return {
    kind: 'ok',
    fileName: asset.name ?? 'event.json',
    uri: asset.uri,
    bundle,
  };
}

export async function deleteEventBundle(uri: string): Promise<void> {
  try {
    new File(uri).delete();
  } catch {
    // Already gone is the outcome we wanted.
  }
}

/** Where the bundles are, for showing the user. */
export function eventsFolderUri(): string {
  return new Directory(Paths.document, FOLDER).uri;
}

export const FILES_SUPPORTED = true;
