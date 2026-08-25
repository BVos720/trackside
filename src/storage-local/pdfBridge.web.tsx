/**
 * Reading a PDF — web.
 *
 * No WebView needed: this *is* a browser, so `extractPdfRows` runs directly.
 * The component exists only so callers mount one thing on both platforms and
 * never branch on which file Metro resolved.
 *
 * The native sibling is where the interesting part is — see pdfBridge.tsx.
 */
import { useEffect } from 'react';

import { extractPdfRows, type PdfRow } from './pdfText';

export const PDF_BRIDGE_SUPPORTED = true;

export function PdfBridge({
  bytes,
  onRows,
  onError,
}: {
  bytes: Uint8Array;
  onRows: (rows: PdfRow[]) => void;
  onError: (message: string) => void;
}) {
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const rows = await extractPdfRows(bytes);
        if (!cancelled) onRows(rows);
      } catch (e) {
        if (!cancelled) {
          onError(
            `The PDF could not be read (${String(
              (e as Error)?.message ?? e,
            )}). Paste the text instead.`,
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // Same reasoning as the native sibling: the callbacks are inline arrows at
    // the call site and depending on them would re-parse on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bytes]);

  return null;
}
