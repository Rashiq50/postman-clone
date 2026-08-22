import { IMPORT_MAX_ITEMS } from '@raven/contracts';
import v20 from '../fixtures/collection-v2.0.json';
import v21 from '../fixtures/collection-v2.1.json';
import environment from '../fixtures/environment.json';
import {
  countItems,
  postmanCollectionProblem,
  postmanEnvironmentProblem,
} from './postman-constraints';

describe('postmanCollectionProblem', () => {
  it('accepts both fixtures', () => {
    expect(postmanCollectionProblem(v21)).toBeNull();
    expect(postmanCollectionProblem(v20)).toBeNull();
  });

  it('accepts every spelling of the v2.0/v2.1 schema URL', () => {
    for (const schema of [
      'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      'https://schema.getpostman.com/json/collection/v2.0.0/collection.json',
      'http://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      'https://schema.postman.com/json/collection/v2.1.0/collection.json',
      'https://schema.getpostman.com/collection/v2.1.0',
    ]) {
      expect(
        postmanCollectionProblem({ info: { name: 'n', schema }, item: [] }),
      ).toBeNull();
    }
  });

  it('rejects a v1 collection by its schema, rather than importing nothing', () => {
    const problem = postmanCollectionProblem({
      info: {
        name: 'old',
        schema:
          'https://schema.getpostman.com/json/collection/v1.0.0/collection.json',
      },
      item: [],
    });
    expect(problem).toContain('v2.0 or v2.1');
  });

  it('names each missing piece specifically', () => {
    expect(postmanCollectionProblem('nope')).toContain('object');
    expect(postmanCollectionProblem({})).toContain('"info"');
    expect(postmanCollectionProblem({ info: {} })).toContain('info.schema');

    const schema =
      'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';
    expect(postmanCollectionProblem({ info: { schema } })).toContain(
      'info.name',
    );
    expect(
      postmanCollectionProblem({ info: { schema, name: '   ' } }),
    ).toContain('info.name');
    expect(postmanCollectionProblem({ info: { schema, name: 'n' } })).toContain(
      '"item"',
    );
  });

  it('rejects a document over the item cap', () => {
    const schema =
      'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';
    const item = Array.from({ length: IMPORT_MAX_ITEMS + 1 }, () => ({
      name: 'r',
      request: {},
    }));
    expect(
      postmanCollectionProblem({ info: { schema, name: 'big' }, item }),
    ).toContain(String(IMPORT_MAX_ITEMS));
  });
});

describe('countItems', () => {
  it('counts folders and requests recursively', () => {
    expect(
      countItems(
        [
          { request: {} },
          { item: [{ request: {} }, { item: [{ request: {} }] }] },
        ],
        100,
      ),
    ).toBe(5);
  });

  it('short-circuits past the limit rather than walking the whole tree', () => {
    // The exact number past the cap does not matter; refusing the work does.
    expect(countItems([{}, {}, {}, {}], 2)).toBeGreaterThan(2);
  });

  it('answers zero for a non-array', () => {
    expect(countItems(undefined, 10)).toBe(0);
  });
});

describe('postmanEnvironmentProblem', () => {
  it('accepts the fixture and a globals export', () => {
    expect(postmanEnvironmentProblem(environment)).toBeNull();
    expect(
      postmanEnvironmentProblem({
        values: [],
        _postman_variable_scope: 'globals',
      }),
    ).toBeNull();
  });

  it('requires a values array of keyed rows', () => {
    expect(postmanEnvironmentProblem('x')).toContain('object');
    expect(postmanEnvironmentProblem({})).toContain('"values"');
    expect(postmanEnvironmentProblem({ values: [{ value: 'v' }] })).toContain(
      '"key"',
    );
  });
});
