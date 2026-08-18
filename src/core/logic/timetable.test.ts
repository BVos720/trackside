import { describe, expect, it } from 'vitest';
import { buildPrompt, extractJson, parseSessions } from './timetable';

/**
 * These tests are the substance of §5.3's "never trust the extraction
 * silently". A model is not a parser, and the failures below are all things
 * language models actually do — fenced output, invented kinds, "14:75",
 * finishing before starting. Each must be caught rather than corrected.
 */
const wrap = (sessions: unknown) => JSON.stringify({ sessions });

describe('extractJson', () => {
  it('unwraps a fenced code block', () => {
    const out = extractJson('Here you go:\n```json\n{"sessions":[]}\n```\nHope that helps');
    expect(JSON.parse(out)).toEqual({ sessions: [] });
  });

  it('finds the object inside surrounding prose', () => {
    const out = extractJson('Sure! {"sessions":[]} — let me know.');
    expect(JSON.parse(out)).toEqual({ sessions: [] });
  });
});

describe('parseSessions', () => {
  it('accepts a well-formed session', () => {
    const r = parseSessions(
      wrap([
        { session: 'NLS Race', class: 'SP9', start: '12:00', end: '16:00', kind: 'race' },
      ]),
    );
    expect(r.rejected).toHaveLength(0);
    expect(r.sessions).toHaveLength(1);
    expect(r.sessions[0]).toMatchObject({
      seriesName: 'NLS Race',
      className: 'SP9',
      kind: 'race',
      start: '12:00',
      end: '16:00',
      durationMinutes: 240,
    });
  });

  it('normalises time separators and pads hours', () => {
    const r = parseSessions(
      wrap([{ session: 'FP', start: '9.05', end: '10h35', kind: 'practice' }]),
    );
    expect(r.sessions[0]!.start).toBe('09:05');
    expect(r.sessions[0]!.end).toBe('10:35');
  });

  it('maps the kind spellings models actually emit', () => {
    for (const [given, expected] of [
      ['Free Practice', 'practice'],
      ['QUALI', 'qualifying'],
      ['Rennen', 'race'],
      ['pit walk', 'pitlaneWalk'],
    ] as const) {
      const r = parseSessions(
        wrap([{ session: 'x', start: '10:00', end: '11:00', kind: given }]),
      );
      expect(r.sessions[0]?.kind, given).toBe(expected);
    }
  });

  it('rejects an impossible time rather than clamping it', () => {
    // "14:75" means the row was misread. Rounding to 15:15 would hide that and
    // the user would plan a day around a time nobody published.
    const r = parseSessions(
      wrap([{ session: 'Race', start: '14:75', end: '16:00', kind: 'race' }]),
    );
    expect(r.sessions).toHaveLength(0);
    expect(r.rejected[0]!.reason).toMatch(/HH:MM/);
  });

  it('rejects an unrecognised kind rather than defaulting it', () => {
    const r = parseSessions(
      wrap([{ session: 'Race', start: '10:00', end: '11:00', kind: 'lunch' }]),
    );
    expect(r.sessions).toHaveLength(0);
    expect(r.rejected[0]!.reason).toMatch(/Unrecognised/);
  });

  it('rejects a session with no name', () => {
    const r = parseSessions(
      wrap([{ session: '  ', start: '10:00', end: '11:00', kind: 'race' }]),
    );
    expect(r.sessions).toHaveLength(0);
  });

  it('rejects zero-length sessions', () => {
    const r = parseSessions(
      wrap([{ session: 'x', start: '10:00', end: '10:00', kind: 'race' }]),
    );
    expect(r.rejected[0]!.reason).toMatch(/same time/);
  });

  it('treats a wrapped end time as running past midnight', () => {
    // Normal at endurance events — the Nürburgring 24h does exactly this.
    const r = parseSessions(
      wrap([{ session: '24h', start: '15:30', end: '02:00', kind: 'race' }]),
    );
    expect(r.sessions).toHaveLength(1);
    expect(r.sessions[0]!.durationMinutes).toBe(630);
  });

  it('keeps good rows and reports the bad ones alongside', () => {
    const r = parseSessions(
      wrap([
        { session: 'Good', start: '09:00', end: '10:00', kind: 'practice' },
        { session: 'Bad', start: 'morning', end: '10:00', kind: 'practice' },
      ]),
    );
    expect(r.sessions).toHaveLength(1);
    expect(r.rejected).toHaveLength(1);
  });

  it('returns a reason instead of throwing on non-JSON', () => {
    const r = parseSessions('I could not read that timetable, sorry.');
    expect(r.sessions).toHaveLength(0);
    expect(r.rejected[0]!.reason).toMatch(/usable JSON/);
  });

  it('returns a reason when the sessions array is missing', () => {
    const r = parseSessions('{"result":"none"}');
    expect(r.rejected[0]!.reason).toMatch(/sessions/);
  });

  it('treats an empty class as absent rather than empty string', () => {
    const r = parseSessions(
      wrap([{ session: 'x', class: '  ', start: '10:00', end: '11:00', kind: 'race' }]),
    );
    expect(r.sessions[0]!.className).toBeNull();
  });
});

describe('buildPrompt', () => {
  it('includes the schedule and constrains the output shape', () => {
    const p = buildPrompt('10:00 Race');
    expect(p).toContain('10:00 Race');
    expect(p).toContain('"sessions"');
    expect(p).toContain('pitlaneWalk');
    // Guarding against invention is the whole point (§5.3).
    expect(p).toMatch(/Do not invent/i);
  });
});
