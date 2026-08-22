import environment from './fixtures/environment.json';
import { mapPostmanEnvironment } from './postman-environment.mapper';

describe('mapPostmanEnvironment', () => {
  it('maps a real export', () => {
    const result = mapPostmanEnvironment(environment);

    expect(result.environment.name).toBe('Staging');
    expect(result.environment.variables).toEqual([
      {
        key: 'baseUrl',
        value: 'https://staging.example.com',
        enabled: true,
      },
      { key: 'apiKey', value: 'sk-live-123', enabled: true, secret: true },
      { key: 'retired', value: 'x', enabled: false },
      // Postman writes numbers; our column is a string.
      { key: 'port', value: '8080', enabled: true },
      // `value` is genuinely optional in an export.
      { key: 'novalue', value: '', enabled: true },
    ]);
    expect(result.warnings).toEqual([]);
  });

  it('omits `secret` rather than writing false, matching the editor', () => {
    const [first] = mapPostmanEnvironment(environment).environment.variables;
    expect('secret' in first).toBe(false);
  });

  it('treats an absent `enabled` as on', () => {
    const result = mapPostmanEnvironment({ values: [{ key: 'a' }] });
    expect(result.environment.variables[0].enabled).toBe(true);
  });

  it('drops a row with no key', () => {
    const result = mapPostmanEnvironment({
      values: [{ key: '', value: 'x' }, { key: 'keep' }],
    });
    expect(result.environment.variables.map((v) => v.key)).toEqual(['keep']);
  });

  it('imports a globals export as an environment, and says so', () => {
    const result = mapPostmanEnvironment({
      values: [{ key: 'a', value: '1' }],
      _postman_variable_scope: 'globals',
    });

    expect(result.environment.name).toBe('Postman globals');
    expect(result.warnings.map((warning) => warning.kind)).toEqual([
      'globals-as-environment',
    ]);
  });

  it('keeps an explicit name on a globals export', () => {
    const result = mapPostmanEnvironment({
      name: 'My globals',
      values: [],
      _postman_variable_scope: 'globals',
    });
    expect(result.environment.name).toBe('My globals');
  });

  it('falls back to a name when there is none', () => {
    expect(mapPostmanEnvironment({ values: [] }).environment.name).toBe(
      'Imported environment',
    );
  });

  it('never throws on junk', () => {
    for (const junk of [
      undefined,
      null,
      3,
      'x',
      [],
      { values: 'no' },
      { values: [null, 4] },
    ]) {
      expect(() => mapPostmanEnvironment(junk)).not.toThrow();
    }
  });
});
