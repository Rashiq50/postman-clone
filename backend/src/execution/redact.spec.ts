import { REDACTION, redactSecrets } from './redact';

describe('redactSecrets', () => {
  it('masks every occurrence of a secret value', () => {
    expect(
      redactSecrets('https://x.test/?a=s3cr3t&b=s3cr3t', ['s3cr3t']),
    ).toBe(`https://x.test/?a=${REDACTION}&b=${REDACTION}`);
  });

  it('leaves a string with no secrets in it alone', () => {
    expect(redactSecrets('https://x.test/', ['s3cr3t'])).toBe(
      'https://x.test/',
    );
  });

  it('masks the longer secret first, so a shorter substring cannot chop it', () => {
    // `ab` is a substring of `abcd`. Shortest-first would leave `••••cd`.
    expect(redactSecrets('abcd', ['ab', 'abcd'])).toBe(REDACTION);
  });

  it('skips empty values, which would otherwise match everywhere', () => {
    expect(redactSecrets('abc', [''])).toBe('abc');
  });

  it('handles no secrets at all', () => {
    expect(redactSecrets('abc', new Set<string>())).toBe('abc');
  });

  it('does not treat a secret as a regular expression', () => {
    expect(redactSecrets('a.c and abc', ['a.c'])).toBe(`${REDACTION} and abc`);
  });
});
