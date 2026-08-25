/**
 * The one part of the WebView bridge that can be tested off-device.
 *
 * The failure it guards is a threshold: a PDF small enough works, a PDF large
 * enough throws a `RangeError`, and both arrive at the user as "the PDF could
 * not be read". That gets blamed on the document rather than the code, which
 * is why the large case is asserted here rather than trusted.
 */
import { describe, expect, it } from 'vitest';

import { bytesToBase64 } from './pdfBase64';

const decode = (b64: string): Uint8Array => {
  const raw = globalThis.atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
};

describe('bytesToBase64', () => {
  it('round-trips a small buffer', () => {
    const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);
    expect(decode(bytesToBase64(bytes))).toEqual(bytes);
  });

  it('encodes an empty buffer as an empty string', () => {
    expect(bytesToBase64(new Uint8Array([]))).toBe('');
  });

  it('round-trips a buffer larger than one chunk', () => {
    // 0x8000 is the chunk size, so this crosses three boundaries — the case a
    // single `fromCharCode(...bytes)` call would throw on.
    const bytes = new Uint8Array(0x8000 * 3 + 17);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;

    const round = decode(bytesToBase64(bytes));
    expect(round.length).toBe(bytes.length);
    expect(round).toEqual(bytes);
  });

  it('survives a buffer the size of a real entry list', () => {
    // The NLS list is ~430KB. A naive implementation throws well before this.
    const bytes = new Uint8Array(450_000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7) % 256;

    expect(() => bytesToBase64(bytes)).not.toThrow();
    expect(decode(bytesToBase64(bytes)).length).toBe(bytes.length);
  });

  it('lands exactly on a chunk boundary without dropping or repeating', () => {
    // Off-by-one in the loop shows up here and nowhere else.
    const bytes = new Uint8Array(0x8000 * 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
    expect(decode(bytesToBase64(bytes))).toEqual(bytes);
  });
});
