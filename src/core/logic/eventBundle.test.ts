import { describe, expect, it } from 'vitest';

import { newEvent, newPlanStop } from '../domain/event';
import { asId, newId, type CircuitId, type SpotId, type UserId } from '../domain/ids';
import { AccessClassification, newSpot } from '../domain/spot';
import {
  BUNDLE_FORMAT,
  buildEventBundle,
  bundleFileName,
  describeBundle,
  readEventBundle,
} from './eventBundle';

const CIRCUIT = asId<CircuitId>('01920000-0000-7000-8000-000000000001');
const USER = asId<UserId>('01920000-0000-7000-8000-0000000000ff');

const anEvent = (name = 'NLS10') =>
  newEvent({ circuitId: CIRCUIT, name, createdBy: USER });

const aSpot = (name: string) =>
  newSpot({
    circuitId: CIRCUIT,
    name,
    position: { latitude: 50.35, longitude: 6.95, elevation: null },
    createdBy: USER,
    accessClassification: AccessClassification.PublicLand,
  });

describe('buildEventBundle', () => {
  it('carries the event, its spots and its sessions', () => {
    const event = anEvent();
    const spots = [aSpot('Brünnchen')];
    const bundle = buildEventBundle({ event, spots, sessions: [], days: [] });

    expect(bundle.format).toBe(BUNDLE_FORMAT);
    expect(bundle.event.id).toBe(event.id);
    expect(bundle.spots).toHaveLength(1);
  });

  it('round-trips through JSON without losing anything', () => {
    // The whole point of a backup: what comes back must be what went in.
    const event = {
      ...anEvent('Spa Six Hours'),
      startDate: '2026-10-09',
      endDate: '2026-10-11',
      stops: [newPlanStop({ spotId: newId<SpotId>(), arriveAt: '13:45' })],
    };
    const bundle = buildEventBundle({
      event,
      spots: [aSpot('Eau Rouge')],
      sessions: [],
      days: [{ id: 'd1', date: '2026-10-10', label: 'SATURDAY' }],
    });

    const { bundle: back, error } = readEventBundle(JSON.stringify(bundle));
    expect(error).toBeNull();
    expect(back).toEqual(bundle);
    expect(back!.event.stops[0]!.arriveAt).toBe('13:45');
  });
});

describe('bundleFileName', () => {
  it('is readable and ends in the event id', () => {
    const event = anEvent('NLS 10');
    const name = bundleFileName(event);
    expect(name).toBe(`nls-10-${event.id.slice(-8)}.json`);
  });

  it('strips accents rather than dropping the letters', () => {
    // "Nürburgring 24h" must not become "nrburgring".
    const name = bundleFileName(anEvent('Nürburgring 24h'));
    expect(name.startsWith('nurburgring-24h-')).toBe(true);
  });

  it('survives a name made entirely of punctuation', () => {
    const event = anEvent('///');
    expect(bundleFileName(event)).toBe(`event-${event.id.slice(-8)}.json`);
  });

  it('keeps two events with the same name apart', () => {
    // Both called "Test day", created in the same millisecond: a UUID v7's
    // leading characters are a timestamp, so only the random tail separates
    // them.
    const a = anEvent('Test day');
    const b = anEvent('Test day');
    expect(bundleFileName(a)).not.toBe(bundleFileName(b));
  });

  it('does not produce a name a filesystem would refuse', () => {
    const name = bundleFileName(anEvent('24h: Spa / Francorchamps *2026*'));
    expect(name).not.toMatch(/[/\\:*?"<>|]/);
  });
});

describe('readEventBundle', () => {
  it('refuses a file that is not JSON', () => {
    const { bundle, error } = readEventBundle('not json at all');
    expect(bundle).toBeNull();
    expect(error).toContain('JSON');
  });

  it('refuses an unknown format rather than guessing', () => {
    // Guessing from shape is how an importer silently mangles old data.
    const { bundle, error } = readEventBundle(
      JSON.stringify({ format: 'trackside.event.v99', event: { id: 'x' } }),
    );
    expect(bundle).toBeNull();
    expect(error).toContain('Unknown format');
  });

  it('refuses a bundle with no event', () => {
    const { bundle, error } = readEventBundle(
      JSON.stringify({ format: BUNDLE_FORMAT }),
    );
    expect(bundle).toBeNull();
    expect(error).toContain('No event');
  });

  it('accepts a bundle saved before sessions existed', () => {
    // Missing arrays are defaulted: an event with no spots is a real thing to
    // have saved, and so is one written by an older build.
    const { bundle, error } = readEventBundle(
      JSON.stringify({
        format: BUNDLE_FORMAT,
        event: anEvent(),
      }),
    );
    expect(error).toBeNull();
    expect(bundle!.spots).toEqual([]);
    expect(bundle!.sessions).toEqual([]);
    expect(bundle!.days).toEqual([]);
  });

  it('does not throw on a null document', () => {
    expect(readEventBundle('null').bundle).toBeNull();
  });
});

describe('describeBundle', () => {
  it('summarises what is in the file', () => {
    const bundle = buildEventBundle({
      event: { ...anEvent(), stops: [newPlanStop({ spotId: newId<SpotId>() })] },
      spots: [aSpot('a'), aSpot('b')],
      sessions: [],
      days: [],
    });
    expect(describeBundle(bundle)).toBe('2 spots · 0 sessions · 1 planned');
  });

  it('gets the singular right', () => {
    const bundle = buildEventBundle({
      event: anEvent(),
      spots: [aSpot('only')],
      sessions: [],
      days: [],
    });
    expect(describeBundle(bundle)).toContain('1 spot ·');
  });
});
