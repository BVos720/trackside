import { describe, expect, it } from 'vitest';

import {
  blankSessionRow,
  describeSessionReview,
  isSessionReady,
  readySessionRows,
  rowFromSession,
  rowFromUnreadLine,
  sessionProblem,
  sessionRowsFrom,
  toReadySession,
  type SessionRow,
} from './timetableReview';
import type { TextSession } from './timetableText';

const session = (over: Partial<TextSession> = {}): TextSession => ({
  day: 'SATURDAY 23 MAY',
  title: 'FIA WEC FREE PRACTICE 1 Track',
  start: '11:00',
  end: '12:30',
  durationMinutes: 90,
  kind: 'practice',
  onTrack: true,
  source: '11:00 12:30 FIA WEC FREE PRACTICE 1 Track',
  ...over,
});

const row = (over: Partial<SessionRow> = {}): SessionRow => ({
  ...rowFromSession(session(), 'k'),
  ...over,
});

describe('rowFromSession', () => {
  it('ticks track sessions', () => {
    expect(rowFromSession(session(), 'a')).toMatchObject({
      key: 'a',
      day: 'SATURDAY 23 MAY',
      start: '11:00',
      end: '12:30',
      include: true,
    });
  });

  it('leaves paperwork unticked but in the list', () => {
    const admin = rowFromSession(session({ title: 'ADMINISTRATIVE CHECKS', onTrack: false }), 'a');
    expect(admin.include).toBe(false);
    expect(admin.onTrack).toBe(false);
  });

  it('shows a start-only session as having no end', () => {
    // The mapper returns end === start for these. Showing 11:00–11:00 would
    // present a zero-length session nobody wrote.
    expect(rowFromSession(session({ end: '11:00' }), 'a').end).toBe('');
  });

  it('turns no day into an empty field', () => {
    expect(rowFromSession(session({ day: null }), 'a').day).toBe('');
  });
});

describe('rowFromUnreadLine', () => {
  it('fills in what the line does give, and leaves it unticked', () => {
    const r = rowFromUnreadLine('09:00 09:00 SAFETY CAR TEST', 'a');
    expect(r).toMatchObject({
      start: '09:00',
      end: '09:00',
      title: 'SAFETY CAR TEST',
      include: false,
      source: '09:00 09:00 SAFETY CAR TEST',
    });
  });

  it('refuses to pre-fill an impossible time', () => {
    expect(rowFromUnreadLine('25:00 26:00 NIGHT', 'a').start).toBe('');
  });

  it('is visible in the track-only view', () => {
    // An unread line is exactly the row that needs somebody to look at it.
    expect(rowFromUnreadLine('x', 'a').onTrack).toBe(true);
  });
});

describe('blankSessionRow', () => {
  it('is empty, ticked, and takes the day it is added under', () => {
    expect(blankSessionRow('a', 'SUNDAY 24 MAY')).toMatchObject({
      day: 'SUNDAY 24 MAY',
      title: '',
      start: '',
      include: true,
    });
  });
});

describe('sessionRowsFrom', () => {
  it('lists sessions first and unread lines after, each with its own key', () => {
    let n = 0;
    const rows = sessionRowsFrom([session(), session()], ['25:00 bad'], () => `k${n++}`);
    expect(rows.map((r) => r.key)).toEqual(['k0', 'k1', 'k2']);
    expect(rows[2]!.source).toBe('25:00 bad');
  });
});

describe('sessionProblem / isSessionReady', () => {
  it('is happy with a complete row', () => {
    expect(sessionProblem(row())).toBeNull();
    expect(isSessionReady(row())).toBe(true);
  });

  it('accepts a row with no end', () => {
    expect(sessionProblem(row({ end: '' }))).toBeNull();
  });

  it('asks for a start time', () => {
    expect(sessionProblem(row({ start: '' }))).toMatch(/start time/);
    expect(sessionProblem(row({ start: '9' }))).toMatch(/start time/);
  });

  it('says so when the end is not a time', () => {
    expect(sessionProblem(row({ end: 'late' }))).toMatch(/end time/);
  });

  it('asks for a name', () => {
    expect(sessionProblem(row({ title: '   ' }))).toMatch(/name/);
  });

  it('never counts an unticked row', () => {
    expect(isSessionReady(row({ include: false }))).toBe(false);
  });
});

describe('toReadySession', () => {
  it('normalises the times people type', () => {
    expect(toReadySession(row({ start: '9.05', end: '9:45' }))).toMatchObject({
      start: '09:05',
      end: '09:45',
    });
  });

  it('gives a session with no end its start as the end', () => {
    expect(toReadySession(row({ end: '' })).end).toBe('11:00');
  });

  it('classifies again from the corrected name', () => {
    // Correcting what a session is called corrects what kind it is.
    expect(toReadySession(row({ title: 'FIA WEC RACE' })).kind).toBe('race');
  });

  it('writes no day as null, not as an empty string', () => {
    expect(toReadySession(row({ day: '  ' })).day).toBeNull();
  });
});

describe('readySessionRows / describeSessionReview', () => {
  const rows = [row(), row({ key: 'b', start: '' }), row({ key: 'c', include: false })];

  it('writes only ticked, complete rows', () => {
    expect(readySessionRows(rows).map((r) => r.key)).toEqual(['k']);
  });

  it('names the ticked rows that are being held back', () => {
    // A ticked row that Add silently skipped would look like the feature
    // losing a session.
    expect(describeSessionReview(rows)).toBe('1 session, 1 ticked row needs fixing first.');
    expect(describeSessionReview([row()])).toBe('1 session.');
  });
});
