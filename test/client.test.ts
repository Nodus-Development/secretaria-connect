import { afterEach, describe, expect, test, vi } from 'vitest';
import { createConnectClient, isSyncItemError } from '../src/client.js';
import { ConnectError } from '../src/errors.js';
import type { ConnectItem, StoredTokens } from '../src/types.js';

const ITEM: ConnectItem = { externalId: 'TCK-42', title: 'Revisar TCK-42', done: false };

function tokensVivos(overrides: Partial<StoredTokens> = {}): StoredTokens {
  return {
    accessToken: 'at-vivo',
    refreshToken: 'rt-vivo',
    expiresAt: Date.now() + 3_600_000,
    scopes: ['connect:sync', 'offline_access'],
    ...overrides,
  };
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function cliente(fetchMock: ReturnType<typeof vi.fn>, tokens = tokensVivos()) {
  vi.stubGlobal('fetch', fetchMock);
  const guardados: StoredTokens[] = [];
  const client = createConnectClient({
    clientId: 'cliente-de-prueba',
    clientSecret: 'secreto-de-prueba',
    baseUrl: 'https://ejemplo.invalid',
    tokens: {
      load: async () => tokens,
      save: async (next) => {
        guardados.push(next);
      },
    },
  });
  return { client, guardados };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createConnectClient', () => {
  test('sync desenvuelve el `data` y manda el token', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse(200, {
        data: {
          taskId: 'tarea-1',
          externalId: 'TCK-42',
          created: true,
          projectId: 'proyecto-1',
          appliedFields: ['title'],
          skippedFields: [],
          adoptedFields: [],
        },
      }),
    );
    const { client } = cliente(fetchMock);

    const result = await client.sync(ITEM);

    expect(result.taskId).toBe('tarea-1');
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(url).toBe('https://ejemplo.invalid/api/connect/sync');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer at-vivo');
    expect(JSON.parse(init.body as string)).toEqual(ITEM);
  });

  test('syncMany no lanza por un ítem: devuelve el error en su sitio', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse(200, {
        data: [
          {
            taskId: 'tarea-1',
            externalId: 'TCK-1',
            created: true,
            projectId: null,
            appliedFields: [],
            skippedFields: [],
            adoptedFields: [],
          },
          {
            externalId: 'TCK-2',
            error: { code: 'link_removed_by_user', message: 'El usuario lo desenlazó' },
          },
        ],
      }),
    );
    const { client } = cliente(fetchMock);

    const results = await client.syncMany([ITEM, { ...ITEM, externalId: 'TCK-2' }]);

    expect(results).toHaveLength(2);
    expect(isSyncItemError(results[0]!)).toBe(false);
    expect(isSyncItemError(results[1]!)).toBe(true);
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({
      items: [ITEM, { ...ITEM, externalId: 'TCK-2' }],
    });
  });

  test('unlink y disconnect entienden el 204 sin cuerpo', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status: 204 }));
    const { client } = cliente(fetchMock);

    await expect(client.unlink('TCK-42')).resolves.toBeUndefined();
    await expect(client.disconnect()).resolves.toBeUndefined();

    expect(fetchMock.mock.calls[1]![1]!.method).toBe('DELETE');
  });

  test('un fallo de negocio llega como ConnectError con su código', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse(409, {
        error: { code: 'default_project_unavailable', message: 'El proyecto destino ya no está' },
      }),
    );
    const { client } = cliente(fetchMock);

    const error = await client.sync(ITEM).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe('default_project_unavailable');
    expect((error as ConnectError).status).toBe(409);
  });

  test('el 429 sube el Retry-After en segundos', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse(429, { error: { code: 'rate_limited', message: 'Demasiadas peticiones' } }, {
        'Retry-After': '42',
      }),
    );
    const { client } = cliente(fetchMock);

    const error = (await client.sync(ITEM).catch((err: unknown) => err)) as ConnectError;

    expect(error.code).toBe('rate_limited');
    expect(error.retryAfter).toBe(42);
  });

  test('refresca el token caducado y persiste el par nuevo', async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith('/api/auth/oauth2/token')) {
        return jsonResponse(200, {
          access_token: 'at-nuevo',
          refresh_token: 'rt-nuevo',
          expires_in: 3600,
          scope: 'connect:sync offline_access',
        });
      }
      return jsonResponse(200, { data: { connectionId: 'con-1', scopes: [], defaultProject: null } });
    });
    const { client, guardados } = cliente(
      fetchMock,
      tokensVivos({ accessToken: 'at-viejo', expiresAt: Date.now() - 1000 }),
    );

    await client.me();

    expect(guardados).toHaveLength(1);
    expect(guardados[0]!.refreshToken).toBe('rt-nuevo');
    const llamadaMe = fetchMock.mock.calls[1]!;
    expect((llamadaMe[1]!.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer at-nuevo',
    );
  });

  test('sin refresh_token en la respuesta, el fallo nombra offline_access', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse(200, { access_token: 'at-nuevo', expires_in: 3600, scope: 'connect:sync' }),
    );
    const { client } = cliente(
      fetchMock,
      tokensVivos({ expiresAt: Date.now() - 1000 }),
    );

    await expect(client.sync(ITEM)).rejects.toThrow(/offline_access/);
  });

  test('sin tokens guardados no se llama a nadie', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = createConnectClient({
      clientId: 'c',
      clientSecret: 's',
      tokens: { load: async () => null, save: async () => undefined },
    });

    await expect(client.me()).rejects.toThrow(/autorizar/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('createLinkSession', () => {
  test('manda target, label y returnUrl, y devuelve el billete', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse(200, {
        data: { url: 'https://app.secretar-ia.org/oauth/vincular?ls=lt_abc', expiresAt: 123 },
      }),
    );
    const { client } = cliente(fetchMock);

    const sesion = await client.createLinkSession({
      target: 'org_7f3a',
      label: 'Acme S.L.',
      returnUrl: 'https://app.nodus.example/vuelta?org=7f3a',
    });

    expect(sesion.url).toContain('/oauth/vincular?ls=');
    expect(sesion.expiresAt).toBe(123);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://ejemplo.invalid/api/connect/link-session');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      target: 'org_7f3a',
      label: 'Acme S.L.',
      returnUrl: 'https://app.nodus.example/vuelta?org=7f3a',
    });
  });

  test('un returnUrl de otro origen llega como ConnectError tipado', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse(422, {
        error: {
          code: 'invalid_return_url',
          message: 'Field returnUrl must match the origin of a registered redirect URI',
        },
      }),
    );
    const { client } = cliente(fetchMock);

    await expect(
      client.createLinkSession({ target: 'org_7f3a', returnUrl: 'https://otro.example/robo' }),
    ).rejects.toMatchObject({ code: 'invalid_return_url', status: 422 });
  });
});

describe('el contrato de destino', () => {
  test('el ítem viaja con `target` opaco y sin nombre de proyecto', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse(200, {
        data: {
          taskId: 't1',
          externalId: 'TCK-42',
          created: true,
          projectId: null,
          appliedFields: ['title'],
          skippedFields: ['project'],
          adoptedFields: [],
        },
      }),
    );
    const { client } = cliente(fetchMock);

    const resultado = await client.sync({ ...ITEM, target: 'org_7f3a' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string).target).toBe('org_7f3a');
    // La señal de «esta entidad no está vinculada»: el integrador la lee en
    // `project`, que es el campo de la TAREA que se ha visto afectado.
    expect(resultado.skippedFields).toContain('project');
    expect(resultado.projectId).toBeNull();
  });
});
