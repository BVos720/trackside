/**
 * The one part of the WebView bridge that can be tested off-device.
 *
 * The failure it guards is a threshold: a PDF small enough works, a PDF large
 * enough throws a `RangeError`, and both arrive at the user as "the PDF could
 * not be read". That gets blamed on the document rather than the code, which
 * is why the large case is asserted here rather than trusted.
 */
import { describe, expect, it } from 'vitest';

import { base64FromDataUrl, base64ToBytes, bytesToBase64 } from './pdfBase64';

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

describe('base64ToBytes', () => {
  it('round-trips with bytesToBase64', () => {
    const original = new Uint8Array([0, 1, 127, 128, 255, 42, 200]);
    expect([...base64ToBytes(bytesToBase64(original))]).toEqual([...original]);
  });

  it('survives bytes that are not valid text', () => {
    // A JPEG is not a string. Anything that round-trips through a text
    // encoding has to carry 0x00 and 0xFF unchanged or the file is corrupt.
    const jpegish = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
    expect([...base64ToBytes(bytesToBase64(jpegish))]).toEqual([...jpegish]);
  });

  it('handles an empty input', () => {
    expect(base64ToBytes('').byteLength).toBe(0);
  });

  it('round-trips a payload larger than the chunk size', () => {
    // bytesToBase64 chunks at 0x8000; this crosses that boundary.
    const big = new Uint8Array(0x8000 + 1234);
    for (let i = 0; i < big.length; i++) big[i] = i % 256;
    expect([...base64ToBytes(bytesToBase64(big))]).toEqual([...big]);
  });
});

describe('base64FromDataUrl', () => {
  it('strips the prefix a FileReader produces', () => {
    expect(base64FromDataUrl('data:image/jpeg;base64,/9j/4AAQ')).toBe('/9j/4AAQ');
  });

  it('refuses a data URL that is not base64', () => {
    // Percent-encoded text decoded as base64 would produce plausible rubbish
    // and write a corrupt file. Refusing is the safe direction.
    expect(base64FromDataUrl('data:text/plain,hello')).toBeNull();
    expect(base64FromDataUrl('not a data url')).toBeNull();
  });
});
