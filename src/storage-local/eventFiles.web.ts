/**
 * Event bundles — web.
 *
 * A browser has no writable app folder, so there is nothing to auto-save into.
 * Rather than pretend, the web build exports on demand: `saveEventBundle`
 * triggers a download, and importing goes through a file input.
 *
 * ── Saying so, rather than silently doing nothing ─────────────────────────
 * `FILES_SUPPORTED` is false here so the UI can describe what it actually does
 * — "Download a copy" instead of "Saved automatically to your phone". A backup
 * feature that quietly does not run is worse than one that is honestly absent,
 * because you only find out on the day you needed it.
 */
import type { EventBundle } from '../core/logic/eventBundle';
import { bundleFileName, readEventBundle } from '../core/logic/eventBundle';

export interface StoredBundle {
  readonly fileName: string;
  readonly uri: string;
  readonly bundle: EventBundle;
}

/** Offers the bundle as a download. Returns the filename it suggested. */
export async function saveEventBundle(bundle: EventBundle): Promise<string> {
  const doc = (globalThis as { document?: Document }).document;
  const name = bundleFileName(bundle.event);
  if (!doc) return name;

  const blob = new Blob([JSON.stringify(bundle, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);

  const link = doc.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  // Revoked on the next tick: revoking immediately races the download starting.
  setTimeout(() => URL.revokeObjectURL(url), 0);

  return name;
}

/** Nothing is stored, so there is nothing to list. */
export async function listEventBundles(): Promise<StoredBundle[]> {
  return [];
}

export async function readBundleFile(): Promise<StoredBundle | null> {
  return null;
}

export async function deleteEventBundle(): Promise<void> {
  // Nothing to delete: the browser owns whatever it downloaded.
}

export function eventsFolderUri(): string {
  return '';
}

/** Read a bundle the user picked with a file input. */
export async function importBundleFromPicker(): Promise<StoredBundle | null> {
  const doc = (globalThis as { document?: Document }).document;
  if (!doc) return null;

  return new Promise((resolve) => {
    const input = doc.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const { bundle } = readEventBundle(await file.text());
      resolve(bundle ? { fileName: file.name, uri: '', bundle } : null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export const FILES_SUPPORTED = false;
