import { parseDuration } from './duration';

describe('parseDuration', () => {
  it.each([
    ['500ms', 500],
    ['45s', 45_000],
    ['15m', 900_000],
    ['12h', 43_200_000],
    ['30d', 2_592_000_000],
  ])('parses %s', (value, expected) => {
    expect(parseDuration(value)).toBe(expected);
  });

  it('does not treat every unit as days', () => {
    // The bug this function replaces: `parseInt(value.replace('d', '')) * 86400000`
    // read "12h" as twelve days.
    expect(parseDuration('12h')).toBeLessThan(parseDuration('1d'));
    expect(parseDuration('30m')).toBeLessThan(parseDuration('1h'));
  });

  it.each(['', '7', 'd', '7 d', '7D', '-7d', '7.5d', '7w', 'abc'])(
    'throws on %p rather than returning NaN',
    (value) => {
      expect(() => parseDuration(value)).toThrow(/Invalid duration/);
    },
  );
});
