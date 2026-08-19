import { POSITION_GAP, positionForIndex, reindexedPositions } from './ordering';

const at = (...positions: number[]) =>
  positions.map((position) => ({ position }));

describe('positionForIndex', () => {
  it('gives the first item the gap itself', () => {
    expect(positionForIndex([], 0)).toBe(POSITION_GAP);
    expect(positionForIndex([])).toBe(POSITION_GAP);
  });

  it('appends past the last sibling when no index is given', () => {
    expect(positionForIndex(at(1024, 2048))).toBe(3072);
  });

  it('appends when the index is at or past the end', () => {
    expect(positionForIndex(at(1024, 2048), 2)).toBe(3072);
    expect(positionForIndex(at(1024, 2048), 99)).toBe(3072);
  });

  it('splits the difference between two siblings', () => {
    expect(positionForIndex(at(1024, 2048), 1)).toBe(1536);
  });

  it('prepends below the first sibling, and a negative result is legal', () => {
    expect(positionForIndex(at(1024), 0)).toBe(0);
    expect(positionForIndex(at(0), 0)).toBe(-POSITION_GAP);
    expect(positionForIndex(at(-2048), 0)).toBe(-3072);
  });

  it('clamps a negative index to the front rather than throwing', () => {
    expect(positionForIndex(at(1024, 2048), -5)).toBe(0);
  });

  it('asks for a reindex only when no integer fits between the neighbours', () => {
    // A gap of 2 still has room for exactly one more insert.
    expect(positionForIndex(at(1024, 1026), 1)).toBe(1025);
    expect(positionForIndex(at(1024, 1025), 1)).toBe('reindex');
    expect(positionForIndex(at(1024, 1024), 1)).toBe('reindex');
  });

  it('survives exactly ten halvings between two positions one gap apart', () => {
    // The reason the gap is 1024 and not 1000: exhaustion is an exact number.
    let siblings = at(0, POSITION_GAP);
    for (let level = 0; level < 10; level += 1) {
      const next = positionForIndex(siblings, 1);
      expect(next).not.toBe('reindex');
      siblings = at(0, next as number);
    }
    expect(positionForIndex(siblings, 1)).toBe('reindex');
  });
});

describe('reindexedPositions', () => {
  it('renumbers a sibling set onto clean multiples of the gap', () => {
    expect(reindexedPositions(3)).toEqual([1024, 2048, 3072]);
    expect(reindexedPositions(0)).toEqual([]);
  });
});
