/**
 * Finding the columns in a page of positioned text.
 *
 * The machine half of the co-work in TASKS-pdf-mapping.md: this proposes a
 * grid and says **nothing** about what any column means. Which band is the car
 * number and which is the team is the human's call, because that is the part
 * that differs between every series and the part a person answers at a glance.
 *
 * ── Why this is possible at all ───────────────────────────────────────────
 * A table in a PDF is not marked up as a table. What makes it one is that the
 * same x positions recur down the page: every row starts its team at 96pt,
 * every row starts its drivers at 300pt. Individual rows vary — a long team
 * name pushes nothing, because each cell is positioned independently — so the
 * signal is in the *agreement across rows*, not in any single one.
 *
 * ── Honest failure ────────────────────────────────────────────────────────
 * Documents that are not tables must come back as "no columns", not as a grid
 * over prose. Every caller has to handle that anyway — a pasted list has no
 * positions at all — so an empty answer is a supported state rather than an
 * error, and it keeps the §0.2 rule that the app does not invent structure it
 * cannot see.
 */

/** Minimal shape of a positioned run. Mirrors `PdfToken` in storage-local. */
export interface PositionedToken {
  readonly x: number;
  readonly width: number;
  readonly text: string;
}

/** Minimal shape of a row. Mirrors `PdfRow` in storage-local. */
export interface PositionedRow {
  readonly tokens: readonly PositionedToken[];
}

/** A vertical band the page keeps putting text in. */
export interface Column {
  /** Left edge in PDF points. */
  readonly left: number;
  /** Right edge in PDF points. */
  readonly right: number;
  /** How many rows put a token in this band — the evidence for it. */
  readonly rows: number;
}

export interface ColumnOptions {
  /**
   * How far apart two token starts can be and still count as the same column.
   *
   * In points. Generous enough to absorb the sub-point drift between rows that
   * a PDF writer produces, tight enough not to merge two real columns — the
   * narrowest gap in the five sample documents is around 12pt.
   */
  readonly tolerance?: number;
  /**
   * The share of rows that must agree before a band is a column.
   *
   * A table's columns appear in nearly every row. A one-off indent appears
   * once. This is the line between them, and it is deliberately high: a
   * spurious column costs the user a tap to correct, but a *missing* one
   * silently merges two fields, which they may not notice at all.
   */
  readonly minShare?: number;
}

const DEFAULTS = { tolerance: 6, minShare: 0.5 } as const;

/**
 * Cluster token left-edges into columns.
 *
 * One pass, sorted, greedy: walk the x positions in order and start a new
 * cluster whenever the next one is more than `tolerance` from the current
 * cluster's *last* member. Chaining by neighbour rather than by cluster mean
 * matters — a column whose text drifts a point per row stays one column
 * instead of splitting once the drift exceeds the tolerance from where it
 * started.
 */
export function findColumns(
  rows: readonly PositionedRow[],
  options: ColumnOptions = {},
): Column[] {
  const tolerance = options.tolerance ?? DEFAULTS.tolerance;
  const minShare = options.minShare ?? DEFAULTS.minShare;

  const usable = rows.filter((r) => r.tokens.length > 0);
  if (usable.length === 0) return [];

  /** Every token start, tagged with the row it came from. */
  const starts: { x: number; row: number }[] = [];
  usable.forEach((row, i) => {
    for (const t of row.tokens) starts.push({ x: t.x, row: i });
  });
  starts.sort((a, b) => a.x - b.x);

  const clusters: { xs: number[]; rows: Set<number> }[] = [];
  let last: number | null = null;

  for (const s of starts) {
    if (last === null || s.x - last > tolerance) {
      clusters.push({ xs: [s.x], rows: new Set([s.row]) });
    } else {
      const current = clusters[clusters.length - 1]!;
      current.xs.push(s.x);
      current.rows.add(s.row);
    }
    last = s.x;
  }

  /*
   * A column is a cluster enough rows agree on.
   *
   * Counted by distinct rows, not by tokens: a single row with eight tokens
   * in one band is one row's opinion, and treating it as eight would let one
   * stray line invent a column for the whole document.
   */
  const threshold = Math.max(2, Math.ceil(usable.length * minShare));

  const kept = clusters
    .filter((c) => c.rows.size >= threshold)
    .map((c) => ({
      left: Math.min(...c.xs),
      right: Math.max(...c.xs),
      rows: c.rows.size,
    }));

  if (kept.length < 2) {
    // One band is not a table, it is a paragraph. Say so by returning nothing
    // rather than offering a single column that means "the whole line".
    return [];
  }

  // Each column runs to where the next one starts: a cell's text extends
  // rightwards from its own left edge, and its own tokens' extent understates
  // that badly for a short value in a wide column.
  return kept.map((c, i) => ({
    left: c.left,
    right: i + 1 < kept.length ? kept[i + 1]!.left : Number.POSITIVE_INFINITY,
    rows: c.rows,
  }));
}

/**
 * Slice one row into its columns.
 *
 * A token belongs to the last column whose left edge it is at or past. Tokens
 * before the first column — a stray mark in the margin — go to the first
 * column rather than being dropped, because losing text silently is the one
 * outcome this whole design exists to avoid.
 */
export function splitRowByColumns(
  row: PositionedRow,
  columns: readonly Column[],
): string[] {
  if (columns.length === 0) return [];

  const cells: string[][] = columns.map(() => []);

  for (const token of row.tokens) {
    let index = 0;
    for (let i = 0; i < columns.length; i++) {
      if (token.x >= columns[i]!.left - 0.5) index = i;
      else break;
    }
    cells[index]!.push(token.text);
  }

  return cells.map((parts) =>
    parts
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

/**
 * Rows sliced into a grid, for the mapping screen to draw.
 *
 * Rows whose every cell is empty are dropped — a page break leaves them behind
 * and they are not part of the table.
 */
export function toGrid(
  rows: readonly PositionedRow[],
  columns: readonly Column[],
): string[][] {
  return rows
    .map((r) => splitRowByColumns(r, columns))
    .filter((cells) => cells.some((c) => c !== ''));
}
