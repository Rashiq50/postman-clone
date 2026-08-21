import {
  openPlaceholderAt,
  tokenize,
  type EnvironmentVariable,
} from '@postman-clone/contracts';
import {
  buildVariables,
  interpolateRequest,
  type SendableRequest,
} from './interpolate';

const variable = (
  key: string,
  value: string,
  extra: Partial<EnvironmentVariable> = {},
): EnvironmentVariable => ({ key, value, enabled: true, ...extra });

const baseRequest = (
  overrides: Partial<SendableRequest> = {},
): SendableRequest => ({
  url: '',
  headers: [],
  queryParams: [],
  body: { mode: 'none' },
  auth: { type: 'none' },
  ...overrides,
});

describe('buildVariables', () => {
  it('drops disabled rows before merging, so a disabled row never shadows an enabled one below it', () => {
    // The bug this pins: "my variable stopped working when I unticked the
    // other one". A filter applied after the merge would leave `host` absent.
    const vars = buildVariables([
      { name: 'global', variables: [variable('host', 'lower.example')] },
      {
        name: 'environment',
        variables: [variable('host', 'upper.example', { enabled: false })],
      },
    ]);

    expect(vars.get('host')?.value).toBe('lower.example');
  });

  it('lets a later scope win', () => {
    const vars = buildVariables([
      { name: 'global', variables: [variable('host', 'a')] },
      { name: 'environment', variables: [variable('host', 'b')] },
    ]);

    expect(vars.get('host')?.value).toBe('b');
  });

  it('takes the last duplicate key within one scope, matching the editor rows', () => {
    const vars = buildVariables([
      {
        name: 'environment',
        variables: [variable('host', 'first'), variable('host', 'second')],
      },
    ]);

    expect(vars.get('host')?.value).toBe('second');
  });

  it('treats an empty string as a value, not an absence', () => {
    const vars = buildVariables([
      { name: 'environment', variables: [variable('suffix', '')] },
    ]);

    expect(vars.has('suffix')).toBe(true);
    expect(vars.get('suffix')?.value).toBe('');
  });

  it('carries the secret flag through, defaulting it to false', () => {
    const vars = buildVariables([
      {
        name: 'environment',
        variables: [
          variable('token', 'sh', { secret: true }),
          variable('host', 'example.test'),
        ],
      },
    ]);

    expect(vars.get('token')?.secret).toBe(true);
    expect(vars.get('host')?.secret).toBe(false);
  });
});

describe('interpolateRequest', () => {
  const vars = buildVariables([
    {
      name: 'environment',
      variables: [
        variable('baseUrl', 'https://api.example.test'),
        variable('token', 's3cr3t', { secret: true }),
        variable('nested', '{{baseUrl}}'),
        variable('empty', ''),
      ],
    },
  ]);

  it('substitutes in the url', () => {
    const { resolved } = interpolateRequest(
      baseRequest({ url: '{{baseUrl}}/users' }),
      vars,
    );

    expect(resolved.url).toBe('https://api.example.test/users');
  });

  it('trims the name inside the braces', () => {
    const { resolved } = interpolateRequest(
      baseRequest({ url: '{{  baseUrl  }}/x' }),
      vars,
    );

    expect(resolved.url).toBe('https://api.example.test/x');
  });

  it('looks names up case-sensitively', () => {
    const { resolved, warnings } = interpolateRequest(
      baseRequest({ url: '{{BASEURL}}/x' }),
      vars,
    );

    expect(resolved.url).toBe('{{BASEURL}}/x');
    expect(warnings[0].kind).toBe('unresolved-variable');
  });

  it('never rescans a substituted value', () => {
    // `nested` resolves to the literal text `{{baseUrl}}`. Emitting it as-is
    // is what closes recursion and expansion bombs.
    const { resolved, warnings } = interpolateRequest(
      baseRequest({ url: '{{nested}}/users' }),
      vars,
    );

    expect(resolved.url).toBe('{{baseUrl}}/users');
    expect(warnings).toHaveLength(0);
  });

  it('leaves an unresolved placeholder in place rather than substituting empty', () => {
    const { resolved, warnings } = interpolateRequest(
      baseRequest({ url: '{{missing}}/users' }),
      vars,
    );

    expect(resolved.url).toBe('{{missing}}/users');
    expect(warnings).toEqual([
      {
        kind: 'unresolved-variable',
        message: 'Variable "missing" is not defined (in url)',
      },
    ]);
  });

  it('substitutes a defined-but-empty variable', () => {
    const { resolved, warnings } = interpolateRequest(
      baseRequest({ url: 'https://x.test/{{empty}}a' }),
      vars,
    );

    expect(resolved.url).toBe('https://x.test/a');
    expect(warnings).toHaveLength(0);
  });

  it('leaves an unterminated {{ untouched', () => {
    const { resolved, warnings } = interpolateRequest(
      baseRequest({ url: 'https://x.test/{{oops' }),
      vars,
    );

    expect(resolved.url).toBe('https://x.test/{{oops');
    expect(warnings).toHaveLength(0);
  });

  it('deduplicates warnings by name and site', () => {
    const { warnings } = interpolateRequest(
      baseRequest({ url: '{{missing}}/{{missing}}' }),
      vars,
    );

    expect(warnings).toHaveLength(1);
  });

  it('warns separately per site', () => {
    const { warnings } = interpolateRequest(
      baseRequest({
        url: '{{missing}}',
        headers: [{ key: 'X-Api-Key', value: '{{missing}}', enabled: true }],
      }),
      vars,
    );

    expect(warnings.map((w) => w.message)).toEqual([
      'Variable "missing" is not defined (in url)',
      'Variable "missing" is not defined (in header "X-Api-Key")',
    ]);
  });

  it('keeps enabled rows only, in headers and query params', () => {
    const { resolved } = interpolateRequest(
      baseRequest({
        headers: [
          { key: 'A', value: '1', enabled: true },
          { key: 'B', value: '2', enabled: false },
        ],
        queryParams: [
          { key: 'page', value: '1', enabled: true },
          { key: 'debug', value: 'true', enabled: false },
        ],
      }),
      vars,
    );

    expect(resolved.headers).toEqual([{ key: 'A', value: '1', enabled: true }]);
    expect(resolved.queryParams).toEqual([
      { key: 'page', value: '1', enabled: true },
    ]);
  });

  it('interpolates the key as well as the value', () => {
    const { resolved } = interpolateRequest(
      baseRequest({
        headers: [{ key: 'X-{{empty}}Key', value: '{{token}}', enabled: true }],
      }),
      vars,
    );

    expect(resolved.headers).toEqual([
      { key: 'X-Key', value: 's3cr3t', enabled: true },
    ]);
  });

  it('interpolates a raw or json body whole', () => {
    const { resolved } = interpolateRequest(
      baseRequest({ body: { mode: 'json', text: '{"at":"{{baseUrl}}"}' } }),
      vars,
    );

    expect(resolved.body).toEqual({
      mode: 'json',
      text: '{"at":"https://api.example.test"}',
    });
  });

  it('interpolates form-urlencoded entries, enabled only', () => {
    const { resolved } = interpolateRequest(
      baseRequest({
        body: {
          mode: 'form-urlencoded',
          entries: [
            { key: 'k', value: '{{token}}', enabled: true },
            { key: 'skip', value: 'x', enabled: false },
          ],
        },
      }),
      vars,
    );

    expect(resolved.body).toEqual({
      mode: 'form-urlencoded',
      entries: [{ key: 'k', value: 's3cr3t', enabled: true }],
    });
  });

  it('leaves a none body alone', () => {
    const { resolved } = interpolateRequest(
      baseRequest({ body: { mode: 'none' } }),
      vars,
    );

    expect(resolved.body).toEqual({ mode: 'none' });
  });

  it('interpolates every auth string field', () => {
    expect(
      interpolateRequest(
        baseRequest({ auth: { type: 'bearer', token: '{{token}}' } }),
        vars,
      ).resolved.auth,
    ).toEqual({ type: 'bearer', token: 's3cr3t' });

    expect(
      interpolateRequest(
        baseRequest({
          auth: { type: 'basic', username: 'u', password: '{{token}}' },
        }),
        vars,
      ).resolved.auth,
    ).toEqual({ type: 'basic', username: 'u', password: 's3cr3t' });

    expect(
      interpolateRequest(
        baseRequest({
          auth: {
            type: 'apiKey',
            key: 'X-Key',
            value: '{{token}}',
            in: 'query',
          },
        }),
        vars,
      ).resolved.auth,
    ).toEqual({ type: 'apiKey', key: 'X-Key', value: 's3cr3t', in: 'query' });
  });

  it('resolves inherit to none without warning', () => {
    // Every new request defaults to `inherit`, so a warning here would fire on
    // essentially everything and train users to ignore the warnings strip.
    const { resolved, warnings } = interpolateRequest(
      baseRequest({ auth: { type: 'inherit' } }),
      vars,
    );

    expect(resolved.auth).toEqual({ type: 'none' });
    expect(warnings).toHaveLength(0);
  });

  it('collects substituted secret values and nothing else', () => {
    const { secretValues } = interpolateRequest(
      baseRequest({
        url: '{{baseUrl}}/x',
        headers: [{ key: 'Authorization', value: '{{token}}', enabled: true }],
      }),
      vars,
    );

    expect([...secretValues]).toEqual(['s3cr3t']);
  });

  it('does not collect a secret whose value was never substituted', () => {
    const { secretValues } = interpolateRequest(
      baseRequest({ url: '{{baseUrl}}/x' }),
      vars,
    );

    expect(secretValues.size).toBe(0);
  });
});

/**
 * The editor's highlighter and autocomplete are built on `tokenize` and
 * `openPlaceholderAt`, which live in contracts beside the regex this file's
 * substituter uses. They are tested **here**, next to `interpolateRequest`,
 * because the property that matters is not that either one works alone but
 * that they agree: a chip must be drawn around exactly the span the send path
 * would replace. The frontend has no test runner, so this is the only place
 * that check can live.
 */
describe('tokenize', () => {
  it('reconstructs its input exactly', () => {
    // The editor repaints the contenteditable from these tokens on every
    // keystroke and then restores the caret by character offset. If joining
    // the tokens did not give the input back verbatim, the caret would drift.
    for (const input of [
      '',
      'https://api.example.com/users',
      '{{baseUrl}}/users/{{id}}',
      '{{a}}{{b}}',
      'no placeholders at all',
      '{{}}',
      '{{ spaced }}',
      'trailing {{open',
      '}}leading',
    ]) {
      expect(
        tokenize(input)
          .map((token) => token.text)
          .join(''),
      ).toBe(input);
    }
  });

  it('reports offsets that bracket the placeholder', () => {
    const tokens = tokenize('a{{x}}b');

    expect(tokens).toEqual([
      { kind: 'text', text: 'a', start: 0, end: 1 },
      { kind: 'var', text: '{{x}}', name: 'x', start: 1, end: 6 },
      { kind: 'text', text: 'b', start: 6, end: 7 },
    ]);
  });

  it('trims the name exactly as the substituter does', () => {
    // `{{ baseUrl }}` resolves when sent, so the chip must not read as
    // undefined. This is the assertion that keeps those two in step.
    const [token] = tokenize('{{ baseUrl }}');
    expect(token).toMatchObject({ kind: 'var', name: 'baseUrl' });

    const vars = buildVariables([
      { name: 'environment', variables: [variable('baseUrl', 'https://x')] },
    ]);
    expect(
      interpolateRequest(baseRequest({ url: '{{ baseUrl }}/y' }), vars).resolved
        .url,
    ).toBe('https://x/y');
  });

  it('does not nest: only the inner placeholder matches', () => {
    expect(tokenize('{{a{{b}}c}}').filter((t) => t.kind === 'var')).toEqual([
      { kind: 'var', text: '{{b}}', name: 'b', start: 3, end: 8 },
    ]);
  });

  it('leaves an unterminated placeholder as plain text', () => {
    expect(tokenize('{{open')).toEqual([
      { kind: 'text', text: '{{open', start: 0, end: 6 },
    ]);
  });

  it('emits no empty text tokens between adjacent placeholders', () => {
    expect(tokenize('{{a}}{{b}}').every((token) => token.text !== '')).toBe(
      true,
    );
  });
});

describe('openPlaceholderAt', () => {
  it('finds the placeholder the caret is still typing', () => {
    expect(openPlaceholderAt('https://{{ba', 12)).toEqual({
      start: 8,
      query: 'ba',
    });
  });

  it('opens on the bare braces, before anything is typed', () => {
    expect(openPlaceholderAt('{{', 2)).toEqual({ start: 0, query: '' });
  });

  it('answers null once the placeholder is closed', () => {
    expect(openPlaceholderAt('{{base}}', 8)).toBeNull();
  });

  it('reads from the caret, not the end of the string', () => {
    // The caret sits inside the first placeholder; the second is irrelevant.
    expect(openPlaceholderAt('{{ba}} and {{other}}', 4)).toEqual({
      start: 0,
      query: 'ba',
    });
  });

  it('closes on a stray brace, exactly where the match would break', () => {
    expect(openPlaceholderAt('{{ba{', 5)).toBeNull();
  });

  it('answers null when there is no open placeholder', () => {
    expect(openPlaceholderAt('https://api.example.com', 10)).toBeNull();
  });
});
