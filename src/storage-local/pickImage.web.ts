/**
 * Choosing a photo — web.
 *
 * A file input, and no resize. The native sibling downscales because phone
 * storage is finite and the originals are enormous; the browser preview holds
 * blobs in memory for one session (see mediaStore.web.ts) and they are gone on
 * reload, so there is nothing to save by shrinking them.
 */
export interface PickedImage {
  readonly blob: Blob;
  readonly contentType: string;
  readonly previewUri: string;
}

export const IMAGE_PICKER_SUPPORTED = true;

/** Null when the user backed out of the dialog. */
export async function pickImage(): Promise<PickedImage | null> {
  const doc = (globalThis as { document?: Document }).document;
  if (!doc) return null;

  return new Promise((resolve) => {
    const input = doc.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      resolve({
        blob: file,
        contentType: file.type || 'image/jpeg',
        previewUri: URL.createObjectURL(file),
      });
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}
