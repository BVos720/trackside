/**
 * Reading a PDF on the phone — native.
 *
 * ── The thing that makes this possible ────────────────────────────────────
 * `pdfText.ts` says pdfjs cannot run here because it needs a DOM and a worker
 * bundle Metro will not produce. Both are true of React Native's JS context
 * and neither is true inside a **WebView**, which is a browser: it has a DOM,
 * it has `Blob` and `URL.createObjectURL`, and pdfjs runs in it exactly as it
 * does on web — the same library already in this project, producing the same
 * positioned rows the five fixtures in core/logic/entry-lists were captured
 * through.
 *
 * So this is a component rather than a function. Extraction needs something
 * mounted, and pretending otherwise behind an `async` façade would mean a
 * hidden global WebView and a queue, which is more machinery and less honest.
 *
 * ── Everything is inlined, nothing is fetched ─────────────────────────────
 * §1.4: the importer has to work with no signal. pdfjs and its worker ship as
 * bundled assets (see metro.config.js), are read off disk at mount, and are
 * inlined into the page — the worker as a blob URL minted inside the page
 * itself. There is no CDN, no `file://` cross-reference for Android to refuse,
 * and no network call anywhere in the path.
 *
 * ── It reports failure rather than returning nothing ──────────────────────
 * A PDF that yields no rows and a PDF that failed to open look identical from
 * the outside, and the second must not be presented as "this document has no
 * entries in it". Anything unexpected comes back through `onError`, and the
 * caller falls back to pasting — which still works and always has.
 */
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';

import { bytesToBase64 } from './pdfBase64';
import type { PdfRow } from './pdfText';

/**
 * The page that does the work.
 *
 * Written as a string rather than a bundled .html file because expo-asset
 * copies every asset to its own hashed path, so a page and its script cannot
 * find each other by relative URL. Inlining sidesteps that entirely.
 */
function buildHtml(library: string, worker: string, base64: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"></head><body><script type="module">
const post = (payload) => window.ReactNativeWebView.postMessage(JSON.stringify(payload));

try {
  ${library}

  // The worker as a blob minted in here. pdfjs 6 refuses to run without a
  // workerSrc, and there is no URL on the device it could be served from.
  const blob = new Blob([${JSON.stringify(worker)}], { type: 'text/javascript' });
  pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(blob);

  const raw = atob(${JSON.stringify(base64)});
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

  const ROW_TOLERANCE = 2;
  const doc = await pdfjsLib.getDocument({
    data: bytes,
    useSystemFonts: true,
    disableFontFace: true,
  }).promise;

  const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const rows = new Map();
    for (const item of content.items) {
      if (!('str' in item) || item.str.trim() === '') continue;
      const y = Math.round(item.transform[5] / ROW_TOLERANCE) * ROW_TOLERANCE;
      const token = {
        x: item.transform[4],
        width: typeof item.width === 'number' ? item.width : 0,
        text: item.str,
      };
      const bucket = rows.get(y);
      if (bucket) bucket.push(token); else rows.set(y, [token]);
    }
    for (const [y, tokens] of [...rows.entries()].sort((a, b) => b[0] - a[0])) {
      out.push({ page: p, y, tokens: tokens.sort((a, b) => a.x - b.x) });
    }
  }

  post({ ok: true, rows: out });
} catch (e) {
  post({ ok: false, error: String((e && e.message) || e) });
}
</script></body></html>`;
}

export const PDF_BRIDGE_SUPPORTED = true;

/**
 * Mount with bytes; it calls back once with rows or with an error.
 *
 * Renders nothing visible. The WebView must still be in the tree — a
 * zero-sized one is not laid out on Android and its scripts never run — so it
 * is one point square and behind everything.
 */
export function PdfBridge({
  bytes,
  onRows,
  onError,
}: {
  bytes: Uint8Array;
  onRows: (rows: PdfRow[]) => void;
  onError: (message: string) => void;
}) {
  const [html, setHtml] = useState<string | null>(null);

  const base64 = useMemo(() => {
    try {
      return bytesToBase64(bytes);
    } catch {
      return null;
    }
  }, [bytes]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (base64 === null) {
        onError('That file was too large to read on this device.');
        return;
      }
      try {
        const [lib, worker] = await Promise.all([
          readAsset(require('../../assets/pdfjs/pdf.min.pdfjs')),
          readAsset(require('../../assets/pdfjs/pdf.worker.min.pdfjs')),
        ]);
        if (!cancelled) setHtml(buildHtml(lib, worker, base64));
      } catch (e) {
        if (!cancelled) {
          onError(
            `The PDF reader could not be loaded (${String(
              (e as Error)?.message ?? e,
            )}). Paste the text instead.`,
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // `onRows`/`onError` deliberately absent: they are usually inline arrows,
    // and depending on them would re-read 1.7MB of assets on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base64]);

  const onMessage = (event: WebViewMessageEvent) => {
    try {
      const payload: unknown = JSON.parse(event.nativeEvent.data);
      const result = payload as { ok?: boolean; rows?: PdfRow[]; error?: string };
      if (result.ok && Array.isArray(result.rows)) onRows(result.rows);
      else onError(result.error ?? 'The PDF could not be read.');
    } catch {
      onError('The PDF reader sent something unreadable.');
    }
  };

  if (html === null) return null;

  return (
    <View style={{ width: 1, height: 1, opacity: 0, position: 'absolute' }}>
      <WebView
        source={{ html }}
        originWhitelist={['*']}
        onMessage={onMessage}
        // Nothing here loads a URL, so navigation is refused outright rather
        // than trusted: the page is a script this file wrote, and a PDF that
        // could talk it into fetching something would be an exfiltration path
        // for a document that is often the user's own private planning.
        onShouldStartLoadWithRequest={() => false}
        javaScriptEnabled
        onError={() => onError('The PDF reader failed to start.')}
      />
    </View>
  );
}

/** Bundled asset to string. */
async function readAsset(moduleId: number): Promise<string> {
  const asset = Asset.fromModule(moduleId);
  await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  return new File(uri).text();
}
