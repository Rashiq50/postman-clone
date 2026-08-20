import type { RequestEntity } from '../entities/request.entity';
import { RequestResponseDto } from './request-response.dto';

const entity = (overrides: Partial<RequestEntity> = {}) =>
  ({
    id: 'req-1',
    collectionId: 'col-1',
    folderId: null,
    name: 'ping',
    method: 'GET',
    url: 'https://example.com',
    description: null,
    headers: [{ key: 'X-Trace', value: 'abc', enabled: true }],
    queryParams: [],
    body: { mode: 'json', text: '{"a":1}' },
    auth: { type: 'bearer', token: 'secret' },
    scripts: { preRequest: 'pre()', postRequest: 'post()' },
    position: 1024,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    ...overrides,
  }) as RequestEntity;

describe('RequestResponseDto', () => {
  it('serialises dates as ISO strings, not Date objects', () => {
    const dto = RequestResponseDto.from(entity());

    expect(dto.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(dto.updatedAt).toBe('2026-01-02T00:00:00.000Z');
  });

  it('carries jsonb columns through excludeExtraneousValues intact', () => {
    // `excludeExtraneousValues` drops undeclared *top-level* keys. The risk
    // worth pinning is that it might also prune inside an exposed object —
    // it does not, and the editor depends on that.
    const dto = RequestResponseDto.from(entity());

    expect(dto.headers).toEqual([
      { key: 'X-Trace', value: 'abc', enabled: true },
    ]);
    expect(dto.body).toEqual({ mode: 'json', text: '{"a":1}' });
    expect(dto.auth).toEqual({ type: 'bearer', token: 'secret' });
    expect(dto.scripts).toEqual({
      preRequest: 'pre()',
      postRequest: 'post()',
    });
  });

  it('preserves an unusual auth shape rather than normalising it', () => {
    const dto = RequestResponseDto.from(
      entity({
        auth: { type: 'apiKey', key: 'X-Key', value: 'v', in: 'query' },
      }),
    );

    expect(dto.auth).toEqual({
      type: 'apiKey',
      key: 'X-Key',
      value: 'v',
      in: 'query',
    });
  });

  it('drops any column that is not explicitly exposed', () => {
    // The reason entities never leave a controller directly: a column added
    // tomorrow is dropped by default rather than leaked by default.
    const dto = RequestResponseDto.from(
      entity({
        internalSecret: 'must not appear',
        collection: { id: 'col-1', workspaceId: 'ws-1' },
      } as unknown as Partial<RequestEntity>),
    );

    expect(dto).not.toHaveProperty('internalSecret');
    expect(dto).not.toHaveProperty('collection');
    expect(Object.keys(dto).sort()).toEqual(
      [
        'auth',
        'body',
        'collectionId',
        'createdAt',
        'description',
        'folderId',
        'headers',
        'id',
        'method',
        'name',
        'position',
        'queryParams',
        'scripts',
        'updatedAt',
        'url',
      ].sort(),
    );
  });

  it('maps a list without losing anything', () => {
    const dtos = RequestResponseDto.fromMany([
      entity({ id: 'a' }),
      entity({ id: 'b' }),
    ]);

    expect(dtos.map((d) => d.id)).toEqual(['a', 'b']);
  });
});
