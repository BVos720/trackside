/**
 * Choosing a PDF — web.
 *
 * A hidden file input, which is the only way a browser will open a file dialog.
 * Metro resolves this ahead of `pickPdf.ts` for the web target, so the
 * timetable screen sees the same `{ name, bytes }` either way.
 */
export interface PickedPdf {
  readonly name: string;
  readonly bytes: Uint8Array;
}

/** Null when the user dismissed the dialog. */
export async function pickPdf(): Promise<PickedPdf | null> {
  const doc = (globalThis as { document?: Document }).document;
  if (!doc) return null;

  return new Promise<PickedPdf | null>((resolve) => {
    const input = doc.createElement('input');
    input.type = 'file';
    input.accept = 'application/pdf';

    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const buffer = await file.arrayBuffer();
      resolve({ name: file.name, bytes: new Uint8Array(buffer) });
    };

    /*
     * A cancelled dialog fires no event in most browsers, so nothing resolves
     * and the caller's "Reading…" state would hang forever. `cancel` covers the
     * browsers that do fire it; the rest simply leave the promise pending until
     * the user picks something, which is the same as not having started.
     */
    input.oncancel = () => resolve(null);

    input.click();
  });
}

export const PICKER_SUPPORTED = true;
