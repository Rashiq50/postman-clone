import type { ImportWarning, ImportWarningKind } from '@raven/contracts';
import v20 from './fixtures/collection-v2.0.json';
import v21 from './fixtures/collection-v2.1.json';
import {
  authParams,
  mapPostmanCollection,
  postmanUrlToText,
  type MappedImport,
  type MappedRequest,
} from './postman-collection.mapper';

const find = (result: MappedImport, name: string): MappedRequest => {
  const request = result.requests.find((row) => row.name === name);
  if (!request) throw new Error(`no request named "${name}" in the fixture`);
  return request;
};

const kinds = (warnings: ImportWarning[]): ImportWarningKind[] =>
  warnings.map((warning) => warning.kind);

const of = (
  warnings: ImportWarning[],
  kind: ImportWarningKind,
): ImportWarning[] => warnings.filter((warning) => warning.kind === kind);

describe('mapPostmanCollection (v2.1 fixture)', () => {
  let result: MappedImport;

  beforeEach(() => {
    result = mapPostmanCollection(v21);
  });

  describe('the collection itself', () => {
    it('takes its name and object-form description from info', () => {
      expect(result.collection.name).toBe('Raven Import Fixture');
      expect(result.collection.description).toBe(
        'A collection exercising every mapping rule.',
      );
    });

    it('maps collection-level auth', () => {
      expect(result.collection.auth).toEqual({
        type: 'bearer',
        token: '{{collectionToken}}',
      });
    });

    it('coerces non-string variable values and keeps the disabled flag', () => {
      expect(result.collection.variables).toEqual(
        expect.arrayContaining([
          { key: 'baseUrl', value: 'https://api.example.com', enabled: true },
          { key: 'retired', value: 'old', enabled: false },
          { key: 'port', value: '8080', enabled: true },
        ]),
      );
    });

    it('drops the collection-level script and warns', () => {
      expect(of(result.warnings, 'collection-script-dropped')).toHaveLength(2); // collection + folder
    });
  });

  describe('structure', () => {
    it('builds folders with real parent links and ascending depths', () => {
      const auth = result.folders.find((folder) => folder.name === 'Auth')!;
      const nested = result.folders.find((folder) => folder.name === 'Nested')!;

      expect(auth.parentFolderId).toBeNull();
      expect(auth.depth).toBe(0);
      expect(nested.parentFolderId).toBe(auth.id);
      expect(nested.depth).toBe(1);
      expect(nested.collectionId).toBe(result.collection.id);
    });

    it('numbers each fresh sibling set from the position gap', () => {
      // ⚠️ Computed, never queried — see the note on the mapper. These are
      // exactly what `appendPosition` would have returned per set.
      expect(find(result, 'Ping').position).toBe(1024);
      const roots = result.folders.filter((f) => f.parentFolderId === null);
      expect(roots.map((f) => f.position)).toEqual([2048, 3072, 4096]);
    });

    it('places a nested request under its own folder', () => {
      const nested = result.folders.find((folder) => folder.name === 'Nested')!;
      expect(find(result, 'Deep request').folderId).toBe(nested.id);
    });
  });

  describe('folder-level data', () => {
    it('drops folder auth with a warning and leaves its requests inheriting', () => {
      const dropped = of(result.warnings, 'folder-auth-dropped');
      expect(dropped).toHaveLength(1);
      expect(dropped[0].path).toBe('Raven Import Fixture / Auth');
      // Nothing was flattened onto the requests below it.
      expect(find(result, 'Deep request').auth.type).toBe('apiKey');
    });

    it('folds folder variables into the collection, first-seen winning', () => {
      expect(of(result.warnings, 'folder-variables-merged')).toHaveLength(1);

      const baseUrl = result.collection.variables.find(
        (variable) => variable.key === 'baseUrl',
      );
      // The collection's own value, not the folder's — see `foldVariables`.
      expect(baseUrl!.value).toBe('https://api.example.com');
      expect(
        result.collection.variables.find(
          (variable) => variable.key === 'scope',
        )!.value,
      ).toBe('auth');

      const conflict = of(result.warnings, 'variable-conflict');
      expect(conflict).toHaveLength(1);
      expect(conflict[0].message).toContain('baseUrl');
    });
  });

  describe('url and params', () => {
    it('takes the URL verbatim from `raw`', () => {
      expect(find(result, 'Ping').url).toBe(
        '{{baseUrl}}/ping?verbose=true&trace=off',
      );
    });

    it('carries only the disabled query rows into queryParams', () => {
      // ⚠️ The enabled ones are already in the URL text, and the send path
      // appends `queryParams` onto it — returning them here doubles them.
      expect(find(result, 'Ping').queryParams).toEqual([
        { key: 'trace', value: 'off', enabled: false },
      ]);
    });

    it('assembles a URL from parts when `raw` is absent, enabled rows only', () => {
      const request = find(result, 'Assembled URL');
      expect(request.url).toBe('https://api.example.com:8443/v1/things?page=2');
      expect(request.queryParams).toEqual([
        { key: 'hidden', value: 'yes', enabled: false },
      ]);
    });

    it('leaves :path variables literal and warns', () => {
      expect(find(result, 'Deep request').url).toBe('{{baseUrl}}/users/:id');
      expect(of(result.warnings, 'path-variables')).toHaveLength(1);
    });
  });

  it('maps headers with their disabled flags', () => {
    expect(find(result, 'Ping').headers).toEqual([
      { key: 'Accept', value: 'application/json', enabled: true },
      { key: 'X-Debug', value: '1', enabled: false },
    ]);
  });

  describe('methods', () => {
    it('keeps a known method', () => {
      expect(find(result, 'Deep request').method).toBe('DELETE');
    });

    it('coerces an unknown method to GET and warns', () => {
      const request = find(result, 'Untitled request');
      expect(request.method).toBe('GET');
      const warning = of(result.warnings, 'unsupported-method');
      expect(warning).toHaveLength(1);
      expect(warning[0].message).toContain('PROPFIND');
    });

    it('falls back to a placeholder name for an unnamed request', () => {
      expect(find(result, 'Untitled request').url).toBe('{{baseUrl}}/weird');
    });
  });

  describe('bodies', () => {
    it('maps raw+json and raw+xml by their declared language', () => {
      expect(find(result, 'Login').body).toEqual({
        mode: 'json',
        text: '{\n  "email": "a@b.c"\n}',
      });
      expect(find(result, 'XML body').body).toEqual({
        mode: 'xml',
        text: '<a>1</a>',
      });
    });

    it('maps a raw body with no language to `raw`', () => {
      expect(find(result, 'Plain raw body').body).toEqual({
        mode: 'raw',
        text: 'hello',
      });
    });

    it('maps urlencoded, keeping disabled rows', () => {
      expect(find(result, 'Urlencoded body').body).toEqual({
        mode: 'form-urlencoded',
        entries: [
          { key: 'a', value: '1', enabled: true },
          { key: 'b', value: '2', enabled: false },
        ],
      });
    });

    it('maps form-data, storing a file row as a path placeholder and warning', () => {
      expect(find(result, 'Form-data body').body).toEqual({
        mode: 'form-data',
        entries: [
          { key: 'caption', value: 'hi', enabled: true, type: 'text' },
          {
            key: 'avatar',
            value: '/Users/someone/avatar.png',
            enabled: true,
            type: 'file',
          },
        ],
      });
      // One for the form-data file row, one for the binary body below.
      expect(of(result.warnings, 'file-placeholder')).toHaveLength(2);
    });

    it('maps graphql, keeping variables as raw text', () => {
      expect(find(result, 'GraphQL body').body).toEqual({
        mode: 'graphql',
        query: 'query Q($id: ID!) { user(id: $id) { name } }',
        variables: '{"id": "1"}',
      });
    });

    it('maps a file body to `binary` with its path', () => {
      expect(find(result, 'Binary body').body).toEqual({
        mode: 'binary',
        src: '/Users/someone/data.bin',
      });
    });

    it('reads a disabled body as no body at all', () => {
      expect(find(result, 'Disabled body').body).toEqual({ mode: 'none' });
    });

    it('drops an unrecognised body mode and warns', () => {
      expect(find(result, 'Unknown body mode').body).toEqual({ mode: 'none' });
      const warning = of(result.warnings, 'unsupported-body');
      expect(warning).toHaveLength(1);
      expect(warning[0].message).toContain('protobuf');
    });
  });

  describe('auth', () => {
    it('reads an absent auth as inherit — Postman semantics', () => {
      expect(find(result, 'Ping').auth).toEqual({ type: 'inherit' });
    });

    it('reads an explicit noauth as none', () => {
      expect(find(result, 'Login').auth).toEqual({ type: 'none' });
    });

    it('maps apikey including its placement', () => {
      expect(find(result, 'Deep request').auth).toEqual({
        type: 'apiKey',
        key: 'X-Api-Key',
        value: '{{apiKey}}',
        in: 'query',
      });
    });

    it('stores a listed unsupported scheme with its params, and warns', () => {
      expect(find(result, 'Refresh').auth).toEqual({
        type: 'unsupported',
        scheme: 'oauth2',
        params: [
          { key: 'accessToken', value: 'abc123', enabled: true },
          { key: 'tokenType', value: 'bearer', enabled: true },
        ],
      });
    });

    it('drops a scheme it has never heard of down to none, and warns', () => {
      expect(find(result, 'Unknown auth scheme').auth).toEqual({
        type: 'none',
      });
      // The stored-but-unsendable one and the entirely unknown one.
      expect(of(result.warnings, 'unsupported-auth')).toHaveLength(2);
    });
  });

  describe('scripts', () => {
    it('joins exec lines, joins same-listener events, and rewrites pm→rv', () => {
      expect(find(result, 'Login').scripts).toEqual({
        preRequest: "rv.variables.set('a', 1)\n\nconsole.log('second')",
        postRequest:
          "rv.test('ok', function () {\n  rv.response.to.have.status(200)\n})",
      });
    });

    it('leaves both slots empty when there are no events', () => {
      expect(find(result, 'Ping').scripts).toEqual({
        preRequest: '',
        postRequest: '',
      });
    });
  });

  it('reports dropped examples once, with a total count', () => {
    // ⚠️ One aggregate warning: 300 examples must not become 300 warnings.
    const dropped = of(result.warnings, 'examples-dropped');
    expect(dropped).toHaveLength(1);
    expect(dropped[0].message).toContain('2 saved example responses');
  });

  it('names the ancestor chain in a warning path', () => {
    expect(of(result.warnings, 'path-variables')[0].path).toBe(
      'Raven Import Fixture / Auth / Nested / Deep request',
    );
  });
});

describe('mapPostmanCollection (v2.0 fixture)', () => {
  let result: MappedImport;

  beforeEach(() => {
    result = mapPostmanCollection(v20);
  });

  it('accepts a bare-string url', () => {
    expect(find(result, 'String URL').url).toBe(
      'https://legacy.example.com/things?page=1',
    );
  });

  it('parses a raw `\\n`-delimited header block', () => {
    expect(find(result, 'String URL').headers).toEqual([
      { key: 'Accept', value: 'application/json', enabled: true },
      { key: 'X-Trace', value: 'on', enabled: true },
    ]);
  });

  it('reads object-form auth params as well as array-form', () => {
    expect(find(result, 'String URL').auth).toEqual({
      type: 'bearer',
      token: 'legacy-token',
    });
    expect(find(result, 'Object auth params').auth).toEqual({
      type: 'basic',
      username: 'u',
      password: 'p',
    });
  });

  it('reads a plain-string description', () => {
    expect(result.collection.description).toBe('A plain-string description.');
  });

  it('defaults a collection with no auth to none, never inherit', () => {
    expect(result.collection.auth).toEqual({ type: 'none' });
  });
});

describe('mapPostmanCollection (totality)', () => {
  // ⚠️ The mapper is reached only after the DTO constraint, but it must still
  // be total: it walks a stranger's file, and a throw here would fail a whole
  // import over one malformed node.
  it('never throws on junk', () => {
    for (const junk of [
      undefined,
      null,
      42,
      'a string',
      [],
      {},
      { info: null, item: null },
      { info: { name: 42 }, item: [null, 7, 'x', {}] },
      { item: [{ item: [{ item: [{}] }] }] },
      { item: [{ request: { url: { host: 3, path: {} } } }] },
      { item: [{ request: { header: 12, body: { mode: 5 } } }] },
      { item: [{ event: [{ listen: 'test', script: { exec: [1, null] } }] }] },
    ]) {
      expect(() => mapPostmanCollection(junk)).not.toThrow();
    }
  });

  it('falls back to a name when info.name is unusable', () => {
    expect(mapPostmanCollection({}).collection.name).toBe(
      'Imported collection',
    );
  });

  it('names an unnamed folder', () => {
    const result = mapPostmanCollection({ item: [{ item: [] }] });
    expect(result.folders[0].name).toBe('Untitled folder');
  });

  it('emits no warnings for an empty collection', () => {
    expect(kinds(mapPostmanCollection({ item: [] }).warnings)).toEqual([]);
  });
});

describe('postmanUrlToText', () => {
  it('prefers raw, because it is what the author typed', () => {
    expect(postmanUrlToText({ raw: '{{base}}/x', host: ['ignored'] })).toBe(
      '{{base}}/x',
    );
  });

  it('never percent-encodes or parses — {{vars}} survive intact', () => {
    expect(
      postmanUrlToText({
        protocol: 'https',
        host: ['{{host}}'],
        path: ['a', '{{id}}'],
        query: [{ key: 'q', value: '{{term}}' }],
      }),
    ).toBe('https://{{host}}/a/{{id}}?q={{term}}');
  });

  it('handles a valueless query key and a hash', () => {
    expect(
      postmanUrlToText({ host: ['h'], query: [{ key: 'flag' }], hash: 'top' }),
    ).toBe('h?flag#top');
  });

  it('answers empty for anything unusable', () => {
    expect(postmanUrlToText(undefined)).toBe('');
    expect(postmanUrlToText(7)).toBe('');
  });
});

describe('authParams', () => {
  it('normalises the v2.1 array form and the v2.0 object form alike', () => {
    expect([...authParams([{ key: 'token', value: 't' }])]).toEqual([
      ['token', 't'],
    ]);
    expect([...authParams({ token: 't' })]).toEqual([['token', 't']]);
  });

  it('skips rows with no usable key and coerces values', () => {
    expect([
      ...authParams([{ value: 'orphan' }, { key: 'n', value: 5 }]),
    ]).toEqual([['n', '5']]);
  });

  it('answers empty for anything else', () => {
    expect(authParams(undefined).size).toBe(0);
    expect(authParams('x').size).toBe(0);
  });
});
