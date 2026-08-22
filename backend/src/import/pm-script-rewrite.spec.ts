import { rewritePmToRv } from './pm-script-rewrite';

describe('rewritePmToRv', () => {
  it('rewrites the common API forms', () => {
    expect(rewritePmToRv('pm.test("ok", function () {})')).toBe(
      'rv.test("ok", function () {})',
    );
    expect(rewritePmToRv('pm.environment.set("id", 1)')).toBe(
      'rv.environment.set("id", 1)',
    );
    expect(rewritePmToRv('pm.response.to.have.status(200)')).toBe(
      'rv.response.to.have.status(200)',
    );
  });

  it('rewrites at the very start of the script and after any operator', () => {
    expect(rewritePmToRv('pm.foo')).toBe('rv.foo');
    expect(rewritePmToRv('!pm.expect(1)')).toBe('!rv.expect(1)');
    expect(rewritePmToRv('(pm.a)')).toBe('(rv.a)');
    expect(rewritePmToRv('a && pm.b')).toBe('a && rv.b');
  });

  it('rewrites every occurrence on a line, including adjacent ones', () => {
    // The captured leading character is what makes overlapping matches
    // impossible, so a single pass gets both.
    expect(rewritePmToRv('pm.a + pm.b')).toBe('rv.a + rv.b');
  });

  it('tolerates whitespace and newlines before the property access', () => {
    expect(rewritePmToRv('pm\n  .response\n  .json()')).toBe(
      'rv\n  .response\n  .json()',
    );
  });

  it('leaves anything that is not the pm token alone', () => {
    expect(rewritePmToRv('spm.foo')).toBe('spm.foo');
    expect(rewritePmToRv('x.pm.y')).toBe('x.pm.y');
    expect(rewritePmToRv('_pm.foo')).toBe('_pm.foo');
    expect(rewritePmToRv('$pm.foo')).toBe('$pm.foo');
    expect(rewritePmToRv('pm1.foo')).toBe('pm1.foo');
    // A property access is required: a bare variable named `pm` is not the API.
    expect(rewritePmToRv('const pm = 1')).toBe('const pm = 1');
    expect(rewritePmToRv('pm')).toBe('pm');
  });

  it('leaves the legacy `postman.*` API untouched', () => {
    expect(rewritePmToRv('postman.setEnvironmentVariable("a", 1)')).toBe(
      'postman.setEnvironmentVariable("a", 1)',
    );
  });

  it('rewrites inside strings and comments — the documented collateral', () => {
    // ⚠️ Pinned deliberately. This is the cost of not shipping a JS tokenizer
    // for a field that is stored and never executed; see the module comment.
    // If this test starts failing, someone added a tokenizer — which is a
    // decision to make on purpose, not a bug fix.
    expect(rewritePmToRv('console.log("pm.environment")')).toBe(
      'console.log("rv.environment")',
    );
    expect(rewritePmToRv('// call pm.test first')).toBe(
      '// call rv.test first',
    );
  });

  it('handles a multiline script end to end', () => {
    const source = [
      'const body = pm.response.json();',
      'pm.test("has id", function () {',
      '  pm.expect(body.id).to.be.a("string");',
      '});',
    ].join('\n');

    expect(rewritePmToRv(source)).toBe(
      [
        'const body = rv.response.json();',
        'rv.test("has id", function () {',
        '  rv.expect(body.id).to.be.a("string");',
        '});',
      ].join('\n'),
    );
  });

  it('returns the empty string unchanged', () => {
    expect(rewritePmToRv('')).toBe('');
  });
});
