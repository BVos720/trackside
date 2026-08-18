import { describe, expect, it } from 'vitest';

import { clusterCallouts, type PlacedPoint } from './callouts';

const VIEW = {
  width: 400,
  height: 800,
  cardWidth: 124,
  cardHeight: 90,
};

const at = (id: string, x: number, y: number): PlacedPoint => ({ id, x, y });

describe('clusterCallouts', () => {
  it('keeps well-separated points as their own clusters', () => {
    const clusters = clusterCallouts(
      [at('a', 50, 100), at('b', 300, 600)],
      VIEW,
    );
    expect(clusters).toHaveLength(2);
    expect(clusters.every((c) => c.items.length === 1)).toBe(true);
  });

  it('stacks points whose cards would overlap', () => {
    // Three spots within a card's width of each other — the Brünnchen case.
    const clusters = clusterCallouts(
      [at('a', 200, 400), at('b', 210, 405), at('c', 195, 396)],
      VIEW,
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.items).toHaveLength(3);
  });

  it('anchors a single callout on its own point', () => {
    const clusters = clusterCallouts([at('only', 137, 421)], VIEW);
    expect(clusters[0]!.x).toBe(137);
    expect(clusters[0]!.y).toBe(421);
  });

  it('anchors a stack midway between its members', () => {
    // The card sits between the pins it covers; leader lines run out to each.
    const clusters = clusterCallouts([at('a', 100, 400), at('b', 180, 440)], VIEW);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.x).toBe(140);
    expect(clusters[0]!.y).toBe(420);
  });

  it('uses the extent centre, not the mean, so an outlier is not swamped', () => {
    // Four spots bunched left and one to the right: the mean sits inside the
    // bunch and the outlier's leader line would cross the whole card.
    const clusters = clusterCallouts(
      [
        at('a', 100, 400),
        at('b', 104, 400),
        at('c', 108, 400),
        at('d', 112, 400),
        at('e', 200, 400),
      ],
      VIEW,
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.x).toBe(150);
  });

  it('keeps every member so the count and the lines are truthful', () => {
    const points = [at('a', 200, 400), at('b', 210, 405), at('c', 220, 410)];
    const clusters = clusterCallouts(points, VIEW);
    expect(clusters[0]!.items.map((i) => i.id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('drops points outside the viewport', () => {
    const clusters = clusterCallouts(
      [at('on', 200, 400), at('far-right', 5000, 400), at('far-up', 200, -5000)],
      VIEW,
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.items[0]!.id).toBe('on');
  });

  it('keeps points just off the edge, so cards do not flicker at the border', () => {
    const clusters = clusterCallouts([at('edge', -20, 400)], VIEW);
    expect(clusters).toHaveLength(1);
  });

  it('ignores non-finite coordinates', () => {
    // map.project can hand back NaN for a point behind the camera in 3D.
    const clusters = clusterCallouts(
      [at('bad', Number.NaN, 400), at('worse', 200, Number.POSITIVE_INFINITY)],
      VIEW,
    );
    expect(clusters).toHaveLength(0);
  });

  it('seeds from the lowest point, which has the most room above it', () => {
    const clusters = clusterCallouts([at('high', 200, 300), at('low', 205, 340)], VIEW);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.items[0]!.id).toBe('low');
  });

  it('does not let a stack creep across the screen', () => {
    // Grouping tests against the seed, not the running midpoint. A chain of
    // points each just within range of the last must not drag one stack along
    // the whole row.
    const chain = [
      at('a', 60, 400),
      at('b', 170, 400),
      at('c', 280, 400),
      at('d', 390, 400),
    ];
    const clusters = clusterCallouts(chain, VIEW);
    expect(clusters.length).toBeGreaterThan(1);
  });

  it('is stable for the same input', () => {
    const points = [at('a', 200, 400), at('b', 60, 400), at('c', 340, 400)];
    const first = clusterCallouts(points, VIEW);
    const again = clusterCallouts([...points].reverse(), VIEW);
    expect(first.map((c) => c.items.map((i) => i.id))).toEqual(
      again.map((c) => c.items.map((i) => i.id)),
    );
  });

  it('caps the number of clusters without dropping stack members', () => {
    // The cap bounds how many cards are drawn. A point that belongs to an
    // existing stack still joins it, so the count stays truthful.
    const points = [
      at('a', 50, 700),
      at('b', 55, 705),
      at('c', 200, 400),
      at('d', 350, 100),
    ];
    const clusters = clusterCallouts(points, { ...VIEW, maxClusters: 1 });
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.items).toHaveLength(2);
  });

  it('separates points that clear the card box plus the gap', () => {
    const clusters = clusterCallouts(
      [at('a', 100, 400), at('b', 100 + VIEW.cardWidth + 10, 400)],
      { ...VIEW, gap: 4 },
    );
    expect(clusters).toHaveLength(2);
  });

  it('returns nothing for no points', () => {
    expect(clusterCallouts([], VIEW)).toEqual([]);
  });
});
