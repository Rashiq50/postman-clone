import {
  EnvironmentVariablesConstraint,
  KeyValueEntriesConstraint,
  RequestAuthConstraint,
  RequestBodyConstraint,
  RequestScriptsConstraint,
} from './json-constraints';

describe('RequestBodyConstraint', () => {
  const constraint = new RequestBodyConstraint();

  it.each([
    ['none', { mode: 'none' }],
    ['raw', { mode: 'raw', text: 'hello' }],
    ['json', { mode: 'json', text: '{}' }],
    ['empty text is still valid', { mode: 'raw', text: '' }],
    [
      'form-urlencoded',
      {
        mode: 'form-urlencoded',
        entries: [{ key: 'a', value: 'b', enabled: true }],
      },
    ],
    [
      'form-urlencoded with no entries',
      { mode: 'form-urlencoded', entries: [] },
    ],
  ])('accepts %s', (_label, value) => {
    expect(constraint.validate(value)).toBe(true);
  });

  it.each([
    ['an unknown mode', { mode: 'nonsense' }],
    ['a missing mode', {}],
    ['raw without text', { mode: 'raw' }],
    ['raw with a non-string text', { mode: 'raw', text: 42 }],
    ['form-urlencoded without entries', { mode: 'form-urlencoded' }],
    [
      'form-urlencoded with malformed entries',
      { mode: 'form-urlencoded', entries: [{ key: 'a' }] },
    ],
    ['null', null],
    ['an array', []],
    ['a string', 'none'],
  ])('rejects %s', (_label, value) => {
    expect(constraint.validate(value)).toBe(false);
  });

  it('produces one message naming the legal modes', () => {
    // One constraint, one message — the precedent the password rule set. A
    // @ValidateNested union would emit a pile of overlapping complaints.
    expect(constraint.defaultMessage()).toContain('form-urlencoded');
    expect(constraint.defaultMessage()).toContain('body');
  });
});

describe('RequestScriptsConstraint', () => {
  const constraint = new RequestScriptsConstraint();

  it.each([
    [
      'both slots empty, which is the column default',
      { preRequest: '', postRequest: '' },
    ],
    ['both slots populated', { preRequest: 'pre()', postRequest: 'post()' }],
  ])('accepts %s', (_label, value) => {
    expect(constraint.validate(value)).toBe(true);
  });

  it.each([
    ['a missing postRequest', { preRequest: '' }],
    ['a missing preRequest', { postRequest: '' }],
    ['an empty object', {}],
    ['a non-string slot', { preRequest: 1, postRequest: '' }],
    ['a null slot', { preRequest: null, postRequest: '' }],
    ['null', null],
    ['an array', []],
    ['a string', 'pre()'],
  ])('rejects %s', (_label, value) => {
    expect(constraint.validate(value)).toBe(false);
  });

  it('rejects an unknown key rather than dropping it', () => {
    // The load-bearing case. `forbidNonWhitelisted` cannot see inside a jsonb
    // value, so without the exact-keys check a typo'd slot name would validate,
    // save, and be silently discarded — the client would report success and the
    // script would be gone.
    expect(
      constraint.validate({ preRequest: '', postRequest: '', preReqest: 'x' }),
    ).toBe(false);
    expect(constraint.validate({ preReqest: 'x', postRequest: '' })).toBe(
      false,
    );
  });

  it('produces one message naming both slots', () => {
    expect(constraint.defaultMessage()).toContain('preRequest');
    expect(constraint.defaultMessage()).toContain('postRequest');
  });
});

describe('RequestAuthConstraint', () => {
  const constraint = new RequestAuthConstraint();

  it.each([
    ['inherit', { type: 'inherit' }],
    ['none', { type: 'none' }],
    ['bearer', { type: 'bearer', token: 't' }],
    ['basic', { type: 'basic', username: 'u', password: 'p' }],
    [
      'apiKey in header',
      { type: 'apiKey', key: 'k', value: 'v', in: 'header' },
    ],
    ['apiKey in query', { type: 'apiKey', key: 'k', value: 'v', in: 'query' }],
  ])('accepts %s', (_label, value) => {
    expect(constraint.validate(value)).toBe(true);
  });

  it.each([
    ['an unknown type', { type: 'oauth9' }],
    ['bearer without a token', { type: 'bearer' }],
    ['basic missing the password', { type: 'basic', username: 'u' }],
    [
      'apiKey with an invalid location',
      { type: 'apiKey', key: 'k', value: 'v', in: 'cookie' },
    ],
    ['null', null],
  ])('rejects %s', (_label, value) => {
    expect(constraint.validate(value)).toBe(false);
  });
});

describe('KeyValueEntriesConstraint', () => {
  const constraint = new KeyValueEntriesConstraint();

  it('accepts an empty list and well-formed rows', () => {
    expect(constraint.validate([])).toBe(true);
    expect(constraint.validate([{ key: 'a', value: '', enabled: false }])).toBe(
      true,
    );
  });

  it.each([
    ['a non-array', { key: 'a' }],
    ['a row missing enabled', [{ key: 'a', value: 'b' }]],
    ['a row with a non-string value', [{ key: 'a', value: 1, enabled: true }]],
    ['a null row', [null]],
  ])('rejects %s', (_label, value) => {
    expect(constraint.validate(value)).toBe(false);
  });
});

describe('EnvironmentVariablesConstraint', () => {
  const constraint = new EnvironmentVariablesConstraint();

  it('treats secret as optional', () => {
    expect(constraint.validate([{ key: 'k', value: 'v', enabled: true }])).toBe(
      true,
    );
    expect(
      constraint.validate([
        { key: 'k', value: 'v', enabled: true, secret: true },
      ]),
    ).toBe(true);
  });

  it('rejects a non-boolean secret', () => {
    expect(
      constraint.validate([
        { key: 'k', value: 'v', enabled: true, secret: 'yes' },
      ]),
    ).toBe(false);
  });
});
