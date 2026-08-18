import { describe, expect, it } from 'vitest';
import {
  classify,
  cleanTitle,
  isDayHeading,
  parseTimetableLines,
} from './timetableText';

/**
 * Verbatim extracts from three real 2026 Spa timetables.
 *
 * Copied from what pdfjs actually produces, stray fragments included — the `st`
 * in the ELMS block is a superscript "1ˢᵗ floor" the extractor splits off, and
 * the lone `-` in the Spa Classic block is a dash that lost its row. Cleaning
 * these up for the tests would be testing a document that does not exist.
 */
const WEC = [
  'WEDNESDAY, MAY 6',
  'Sunrise: 06:04 / Sunset: 21:03',
  '08:30 13:00 FIA WEC ADMINISTRATIVE CHECKS Admin Checks Office',
  '15:00 17:30 FIA WEC TRACK WALK Track 150\'',
  'THURSDAY, MAY 7',
  '09:20 09:50 Legends of Le Mans FREE PRACTICE 1 Track 30\'',
  '11:00 12:30 FIA WEC FREE PRACTICE 1 Track 90\'',
  '17:25 17:55 Legends of Le Mans QUALIFYING SESSION 1 Track 30\'',
  '18:15 19:15 FIA WEC PIT WALK Track 60\'',
  '08:15 FIA WEC FIA MEDICAL INSPECTION LAPS Track',
];

const ELMS = [
  'TUESDAY 18 AUGUST',
  'Sunrise: 06:30 / Sunset: 20:49',
  'ELMS MANDATORY SCRUTINEERING',
  '08:30 13:00 Scrutineering - Garages 1 & 2',
  'st',
  'Michelin Le Mans Cup ADMINISTRATIVE CHECKS',
  '09:00 17:00 F1 Pitbuilding - 1 floor - Room 130',
  'ALL SERIES TRACK WALK',
  '18:00 21:00 Track 180\'',
  'WEDNESDAY 19 AUGUST',
  'Michelin Le Mans Cup PROMOTER COLLECTIVE TEST',
  '09:00 09:55 Track 55\'',
];

const SPA_CLASSIC = [
  'JEUDI 21 MAI / THURSDAY 21st MAY',
  '10:00 - 19:00 SCRUTINEERING (ALL SERIES)',
  'VENDREDI 22 MAI / FRIDAY 22nd MAY',
  '09:00 - 09:30 00:30 SPA-CLASSIC CLUB - Session 1 Private Practice 00:10',
  '11:25 - 12:05 00:40 ENDURANCE RACING LEGENDS 1 - LMP & GT1 Qualifying 1 00:10',
  '12:55 13:40 00:45 GT3 REVIVAL Free Practice 00:10',
  '14:30 - 15:10 00:40 ENDURANCE RACING LEGENDS 2 - GT2 Qualifying 1 00:10',
];

describe('isDayHeading', () => {
  it('recognises headings in English, French and German', () => {
    expect(isDayHeading('WEDNESDAY, MAY 6')).toBe(true);
    expect(isDayHeading('TUESDAY 18 AUGUST')).toBe(true);
    expect(isDayHeading('JEUDI 21 MAI / THURSDAY 21st MAY')).toBe(true);
    expect(isDayHeading('SAMSTAG 12 OKTOBER')).toBe(true);
  });

  it('does not treat a session row as a heading', () => {
    expect(isDayHeading('09:20 09:50 Legends of Le Mans FREE PRACTICE 1 Track')).toBe(
      false,
    );
  });
});

describe('classify', () => {
  it('reads the session kinds these documents use', () => {
    expect(classify('FIA WEC FREE PRACTICE 1')).toBe('practice');
    expect(classify('QUALIFYING SESSION 1')).toBe('qualifying');
    expect(classify('6 HOURS OF SPA-FRANCORCHAMPS')).toBe('race');
    expect(classify('FIA WEC PIT WALK')).toBe('pitlaneWalk');
    expect(classify('ELMS MANDATORY SCRUTINEERING')).toBe('other');
  });

  it('does not mistake a pit walk for a race', () => {
    // "race pit walk" contains "race", and order in classify() is what stops
    // this being wrong.
    expect(classify('FIA WEC RACE PIT WALK')).toBe('pitlaneWalk');
  });
});

describe('cleanTitle', () => {
  it('strips times, durations and extractor noise', () => {
    expect(cleanTitle("11:00 12:30 FIA WEC FREE PRACTICE 1 Track 90'")).toBe(
      'FIA WEC FREE PRACTICE 1 Track',
    );
  });

  it('strips the stray superscript fragment pdfjs leaves behind', () => {
    expect(cleanTitle('09:00 17:00 F1 Pitbuilding - 1 floor - Room 130 st')).not.toMatch(
      /\bst\b/,
    );
  });
});

describe('parseTimetableLines — WEC (one-line rows)', () => {
  const r = parseTimetableLines(WEC);

  it('reads every complete row', () => {
    // The 08:15 medical-inspection row has no end time and is correctly not a
    // session — omitting it is right, inventing an end time would not be.
    expect(r.sessions).toHaveLength(6);
  });

  it('carries the day heading down onto its rows', () => {
    expect(r.sessions[0]!.day).toBe('WEDNESDAY, MAY 6');
    const fp1 = r.sessions.find((s) => s.title.includes('FIA WEC FREE PRACTICE'));
    expect(fp1!.day).toBe('THURSDAY, MAY 7');
  });

  it('reads times and duration', () => {
    const fp = r.sessions.find((s) => s.title.startsWith('FIA WEC FREE PRACTICE'))!;
    expect(fp.start).toBe('11:00');
    expect(fp.end).toBe('12:30');
    expect(fp.durationMinutes).toBe(90);
  });

  it('ignores the sunrise/sunset line even though it holds two times', () => {
    expect(r.sessions.some((s) => /sunrise/i.test(s.title))).toBe(false);
  });

  it('separates track activity from paperwork', () => {
    const admin = r.sessions.find((s) => s.title.includes('ADMINISTRATIVE'))!;
    const practice = r.sessions.find((s) => s.title.includes('FREE PRACTICE'))!;
    expect(admin.onTrack).toBe(false);
    expect(practice.onTrack).toBe(true);
  });
});

describe('parseTimetableLines — ELMS (name on the previous line)', () => {
  const r = parseTimetableLines(ELMS);

  it('recovers names from the line above', () => {
    const walk = r.sessions.find((s) => s.title.includes('TRACK WALK'));
    expect(walk, 'track walk not found').toBeDefined();
    expect(walk!.start).toBe('18:00');
    expect(walk!.end).toBe('21:00');
  });

  it('does not lose the scrutineering row to its bare location text', () => {
    const scr = r.sessions.find((s) => /SCRUTINEERING/i.test(s.title));
    expect(scr).toBeDefined();
    expect(scr!.onTrack).toBe(false);
  });

  it('still attaches the right day', () => {
    const test = r.sessions.find((s) => /COLLECTIVE TEST/i.test(s.title));
    expect(test!.day).toBe('WEDNESDAY 19 AUGUST');
  });
});

describe('parseTimetableLines — Spa Classic (dash separator, bilingual)', () => {
  const r = parseTimetableLines(SPA_CLASSIC);

  it('reads dash-separated times', () => {
    const s = r.sessions.find((x) => x.title.includes('SPA-CLASSIC CLUB'))!;
    expect(s.start).toBe('09:00');
    expect(s.end).toBe('09:30');
  });

  it('handles a row that omits the dash', () => {
    const s = r.sessions.find((x) => x.title.includes('GT3 REVIVAL'))!;
    expect(s.start).toBe('12:55');
    expect(s.end).toBe('13:40');
    expect(s.durationMinutes).toBe(45);
  });

  it('keeps hyphenated category names intact', () => {
    // The dash cleanup must not eat the hyphen inside "SPA-CLASSIC" or
    // "ENDURANCE RACING LEGENDS 1 - LMP & GT1".
    const s = r.sessions.find((x) => x.title.includes('SPA-CLASSIC CLUB'))!;
    expect(s.title).toContain('SPA-CLASSIC');
  });

  it('classifies from the session column', () => {
    const q = r.sessions.find((x) => x.title.includes('ENDURANCE RACING LEGENDS 1'))!;
    expect(q.kind).toBe('qualifying');
  });

  it('attaches the bilingual day heading', () => {
    const s = r.sessions.find((x) => x.title.includes('GT3 REVIVAL'))!;
    expect(s.day).toBe('VENDREDI 22 MAI / FRIDAY 22nd MAY');
  });
});

describe('parseTimetableLines — general', () => {
  it('returns nothing for a document with no times', () => {
    const r = parseTimetableLines(['CIRCUIT DE SPA FRANCORCHAMPS', 'V9 - 01/05/26']);
    expect(r.sessions).toHaveLength(0);
  });

  it('skips a row whose times are impossible rather than repairing it', () => {
    const r = parseTimetableLines(['25:00 26:00 NONSENSE SESSION']);
    expect(r.sessions).toHaveLength(0);
    expect(r.skipped).toHaveLength(1);
  });

  it('treats a wrapped end time as running past midnight', () => {
    const r = parseTimetableLines(['22:00 02:00 NIGHT PRACTICE Track']);
    expect(r.sessions[0]!.durationMinutes).toBe(240);
  });
});
