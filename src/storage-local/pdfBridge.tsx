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
 * ── Why the WebView is required lazily ────────────────────────────────────
 * `react-native-webview` is a *native* module: the JS half arrives with a
 * Metro reload, the native half only with a rebuilt binary. A plain top-level
 * import therefore takes the **whole app** down on any dev build older than
 * the day it was added — `TurboModuleRegistry.getEnforcing('RNCWebViewModule')
 * could not be found`, thrown while the module graph loads, long before any
 * PDF is picked. Which is exactly what happened the first time this shipped.
 *
 * A feature that cannot run should disable itself, not prevent the app from
 * starting. So the module is required inside a `try`, `PDF_BRIDGE_SUPPORTED`
 * reports what was found, and callers ask before offering the button. Pasting
 * has always worked and still does.
 *
 * ── Everything is inlined, nothing is fetched ─────────────────────────────
 * §1.4: the importer has to work with no signal. pdfjs and its worker ship as
 * bundled assets (see metro.config.js), are read off disk at mount, and are
 * inlined into the page as blob URLs minted inside it. There is no CDN, no
 * `file://` cross-reference for Android to refuse, and no network call anywhere
 * in the path — the page's own address is unreachable by construction.
 *
 * ── It reports failure rather than returning nothing ──────────────────────
 * A PDF that yields no rows and a PDF that failed to open look identical from
 * the outside, and the second must not be presented as "this document has no
 * entries in it". Anything unexpected comes back through `onError`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';

import { bytesToBase64 } from './pdfBase64';
import type { PdfRow } from './pdfText';

/**
 * The WebView, if this binary has one.
 *
 * `require` rather than `import` so the failure is catchable: an ES import is
 * hoisted and its throw cannot be contained, which is the whole reason this
 * once bricked the app on a stale dev build.
 */
type WebViewProps = {
  source: { html: string; baseUrl?: string };
  originWhitelist: string[];
  onMessage: (event: { nativeEvent: { data: string } }) => void;
  onShouldStartLoadWithRequest: () => boolean;
  javaScriptEnabled: boolean;
  onError: () => void;
};

let WebViewComponent: React.ComponentType<WebViewProps> | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('react-native-webview') as {
    WebView?: React.ComponentType<WebViewProps>;
  };
  WebViewComponent = mod.WebView ?? null;
} catch {
  // Native half missing — an older dev build. Reported, not thrown.
  WebViewComponent = null;
}

/**
 * Whether this build can read a PDF at all.
 *
 * False on a dev build predating `react-native-webview`. Callers must check it
 * before offering the option, so the user is told the feature needs a rebuild
 * rather than shown a button that explodes.
 */
export const PDF_BRIDGE_SUPPORTED = WebViewComponent !== null;

/**
 * The page that does the work.
 *
 * Written as a string rather than a bundled .html file because expo-asset
 * copies every asset to its own hashed path, so a page and its script cannot
 * find each other by relative URL. Inlining sidesteps that entirely.
 *
 * ── Both halves load as modules, from blob URLs ───────────────────────────
 * pdfjs 6 ships as ES modules. Pasting one inline was the first attempt and it
 * fails in two ways at once: an `export` declaration is only legal at a
 * module's top level, so inside the `try` below it is
 * `SyntaxError: Unexpected token 'export'`; and the module build never defines
 * the `pdfjsLib` global that a script-tag build would.
 *
 * Minting a blob URL and `import()`ing it treats the library as what it is.
 * The worker gets the same treatment for the same reason, and neither touches
 * the network — §1.4.
 */
/**
 * How long any one stage may take before the reader is declared stuck.
 *
 * Generous: this runs on a phone, the library is 450KB of JavaScript to parse,
 * and a long entry list is real work. The point is not to be strict, it is to
 * end at all — an interface that says "reading…" forever teaches people the
 * feature is broken, where one that says where it stopped can be fixed.
 */
const STAGE_TIMEOUT_MS = 25000;

function buildHtml(library: string, worker: string, base64: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"></head><body><script type="module">
const post = (payload) => window.ReactNativeWebView.postMessage(JSON.stringify(payload));
const asUrl = (source) =>
  URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));

/*
 * Say how far we got, at every step.
 *
 * This bridge has failed twice on hardware in a way that produced no error at
 * all — it simply never finished, and "reading…" stayed on screen forever. A
 * silent stall is the worst shape of failure there is, because every possible
 * cause looks identical from outside.
 *
 * So each stage announces itself before the thing that might not return. If it
 * stops, the last stage received names the step that hung, which turns "the PDF
 * thing doesn't work" into one line that says where.
 */
const stage = (name) => post({ stage: name });

stage('booted');

/*
 * Two ways to load an ES module from a string, because engines disagree.
 *
 * A blob URL is the tidy one and is what Chromium wants — it is how this came
 * to work on Android. WebKit has never treated dynamic 'import()' of a
 * 'blob:' URL the same way, which makes it the first suspect for why this
 * has never worked on an iPhone while working on the emulator.
 *
 * So if the blob import throws, the same source is offered as a 'data:' URL
 * instead. Percent-encoded rather than base64: 'btoa' refuses anything
 * outside Latin-1, and 450KB of minified JavaScript is not a safe bet to be
 * clean. A different mechanism is worth one attempt; if both fail the stage
 * report says which, and neither can affect the platform where the first
 * already works.
 */
const importModule = async (source) => {
  try {
    return await import(asUrl(source));
  } catch (blobError) {
    stage('blob-import-failed');
    try {
      return await import('data:text/javascript,' + encodeURIComponent(source));
    } catch (dataError) {
      throw new Error(
        'blob: ' + String(blobError && blobError.message || blobError) +
        ' | data: ' + String(dataError && dataError.message || dataError),
      );
    }
  }
};

try {
  const pdfjsLib = await importModule(${JSON.stringify(library)});
  stage('library-loaded');

  pdfjsLib.GlobalWorkerOptions.workerSrc = asUrl(${JSON.stringify(worker)});
  stage('worker-set');

  const raw = atob(${JSON.stringify(base64)});
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

  const ROW_TOLERANCE = 2;
  stage('decoded');
  const doc = await pdfjsLib.getDocument({
    data: bytes,
    useSystemFonts: true,
    disableFontFace: true,
  }).promise;
  stage('document-opened');

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
      if (WebViewComponent === null) {
        onError(
          'Reading PDFs needs a newer build of the app. Paste the text instead.',
        );
        return;
      }
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

  /**
   * The last stage the page reported, and the deadline for the next one.
   *
   * Refs rather than state: these are written from a WebView callback and read
   * from a timer, and neither wants a re-render — the WebView is one pixel and
   * invisible, so there is nothing to redraw.
   */
  const lastStage = useRef<string>('not started');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const armTimeout = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      /*
       * Give up, and say where it stopped.
       *
       * Every stage resets this, so the deadline is per-step rather than for
       * the whole job — a big entry list can legitimately take a while to lay
       * out, and a single overall timeout would either cut that off or wait far
       * too long for a step that was never going to return.
       */
      onError(
        `The PDF reader stopped responding after "${lastStage.current}". ` +
          'Paste the text instead.',
      );
    }, STAGE_TIMEOUT_MS);
  }, [onError]);

  useEffect(() => {
    armTimeout();
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, [armTimeout]);

  const onMessage = (event: { nativeEvent: { data: string } }) => {
    try {
      const payload: unknown = JSON.parse(event.nativeEvent.data);
      const result = payload as {
        ok?: boolean;
        rows?: PdfRow[];
        error?: string;
        stage?: string;
      };

      // A progress report, not a result: note it and keep waiting.
      if (typeof result.stage === 'string') {
        lastStage.current = result.stage;
        armTimeout();
        return;
      }

      if (timer.current !== null) clearTimeout(timer.current);
      if (result.ok && Array.isArray(result.rows)) onRows(result.rows);
      else onError(result.error ?? 'The PDF could not be read.');
    } catch {
      if (timer.current !== null) clearTimeout(timer.current);
      onError('The PDF reader sent something unreadable.');
    }
  };

  if (html === null || WebViewComponent === null) return null;
  const WebView = WebViewComponent;

  return (
    <View style={{ width: 1, height: 1, opacity: 0, position: 'absolute' }}>
      <WebView
        /*
         * A real origin, and the reason the worker runs at all.
         *
         * Without a baseUrl the document is `about:blank`, whose origin is
         * `null` — and a blob URL minted in a null-origin page cannot be used
         * to construct a Worker. Chromium says so plainly ("Refused to
         * cross-origin redirects of the top-level worker script") and pdfjs
         * falls back to its "fake worker", which then cannot load its own
         * script either. The import stalls with no error, which is the worst
         * shape of failure there is.
         *
         * With an origin, the blob is same-origin and the real worker starts.
         * Nothing is ever fetched from this address — see
         * `onShouldStartLoadWithRequest` below, which refuses every
         * navigation. It exists only so the page has an origin to be.
         */
        source={{ html, baseUrl: 'https://trackside.invalid/' }}
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
