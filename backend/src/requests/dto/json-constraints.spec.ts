import {
  CollectionAuthConstraint,
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
    ['xml', { mode: 'xml', text: '<a/>' }],
    ['graphql', { mode: 'graphql', query: '{ me }', variables: '{}' }],
    [
      // ⚠️ `variables` is raw *text*, not parsed here: an in-progress edit is
      // routinely not valid JSON, and the send path is where that warns.
      'graphql with unparseable variables text',
      { mode: 'graphql', query: '{ me }', variables: '{oops' },
    ],
    [
      'graphql with empty strings',
      { mode: 'graphql', query: '', variables: '' },
    ],
    [
      'form-data with a text and a file row',
      {
        mode: 'form-data',
        entries: [
          { key: 'a', value: 'b', enabled: true, type: 'text' },
          { key: 'f', value: '/tmp/x.png', enabled: false, type: 'file' },
        ],
      },
    ],
    ['form-data with no entries', { mode: 'form-data', entries: [] }],
    ['binary', { mode: 'binary', src: '/tmp/x.bin' }],
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
    ['xml without text', { mode: 'xml' }],
    ['graphql missing variables', { mode: 'graphql', query: '{ me }' }],
    [
      'graphql with an object for variables',
      { mode: 'graphql', query: '{ me }', variables: { id: 1 } },
    ],
    ['binary without src', { mode: 'binary' }],
    [
      'form-data with a row missing its type',
      { mode: 'form-data', entries: [{ key: 'a', value: 'b', enabled: true }] },
    ],
    [
      'form-data with an unknown row type',
      {
        mode: 'form-data',
        entries: [{ key: 'a', value: 'b', enabled: true, type: 'blob' }],
      },
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
    [
      'an imported unsupported scheme',
      {
        type: 'unsupported',
        scheme: 'oauth2',
        params: [{ key: 'accessToken', value: 'x', enabled: true }],
      },
    ],
    [
      'an imported unsupported scheme with no params',
      { type: 'unsupported', scheme: 'awsv4', params: [] },
    ],
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
    [
      // The scheme list is closed on purpose: `unsupported` is a storage slot
      // for schemes we know about, not a hole for an arbitrary string.
      'unsupported with a scheme outside the list',
      { type: 'unsupported', scheme: 'quantum', params: [] },
    ],
    ['unsupported with no params', { type: 'unsupported', scheme: 'oauth2' }],
    [
      'unsupported with malformed params',
      { type: 'unsupported', scheme: 'oauth2', params: [{ key: 'a' }] },
    ],
    ['null', null],
  ])('rejects %s', (_label, value) => {
    expect(constraint.validate(value)).toBe(false);
  });
});

describe('CollectionAuthConstraint', () => {
  const constraint = new CollectionAuthConstraint();

  it('accepts everything a request may carry except inherit', () => {
    expect(constraint.validate({ type: 'none' })).toBe(true);
    expect(constraint.validate({ type: 'bearer', token: 't' })).toBe(true);
    expect(
      constraint.validate({
        type: 'unsupported',
        scheme: 'digest',
        params: [],
      }),
    ).toBe(true);
  });

  it('rejects inherit — a collection has no parent to inherit from', () => {
    expect(constraint.validate({ type: 'inherit' })).toBe(false);
  });

  it('rejects whatever the request constraint rejects, with no second switch', () => {
    expect(constraint.validate({ type: 'bearer' })).toBe(false);
    expect(constraint.validate(null)).toBe(false);
  });

  it('produces one message that does not offer inherit', () => {
    expect(constraint.defaultMessage()).not.toContain('inherit');
    expect(constraint.defaultMessage()).toContain('bearer');
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
