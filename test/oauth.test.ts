import { afterEach, describe, expect, test, vi } from 'vitest';
import { buildAuthorizeUrl, exchangeCode, SCOPES } from '../src/oauth.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('buildAuthorizeUrl', () => {
  test('arma la query del authorize con PKCE S256', async () => {
    const { url, verifier } = await buildAuthorizeUrl({
      clientId: 'cliente-de-prueba',
      redirectUri: 'https://ejemplo.invalid/callback',
      scopes: [SCOPES.SYNC, SCOPES.OFFLINE],
      state: 'estado-1',
      baseUrl: 'https://backend.invalid',
    });

    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://backend.invalid/api/auth/oauth2/authorize');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('scope')).toBe('connect:sync offline_access');
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    expect(parsed.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  test('el reto es el SHA-256 del verifier de la RFC 7636', async () => {
    // Vector del apéndice B de la RFC 7636.
    const { url } = await buildAuthorizeUrl({
      clientId: 'c',
      redirectUri: 'https://ejemplo.invalid/callback',
      scopes: [SCOPES.SYNC],
      state: 's',
      verifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
    });

    expect(new URL(url).searchParams.get('code_challenge')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  test('acepta un verifier inyectado y lo devuelve tal cual', async () => {
    const { verifier } = await buildAuthorizeUrl({
      clientId: 'c',
      redirectUri: 'https://ejemplo.invalid/callback',
      scopes: [SCOPES.SYNC],
      state: 's',
      verifier: 'verificador-traido-de-fuera',
    });

    expect(verifier).toBe('verificador-traido-de-fuera');
  });
});

describe('exchangeCode', () => {
  test('canjea el código y completa el connectionId con me()', async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith('/api/auth/oauth2/token')) {
        return new Response(
          JSON.stringify({
            access_token: 'at-1',
            refresh_token: 'rt-1',
            expires_in: 3600,
            scope: 'connect:sync offline_access',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({ data: { connectionId: 'con-1', scopes: [], defaultProject: null } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const tokens = await exchangeCode({
      clientId: 'cliente-de-prueba',
      clientSecret: 'secreto-de-prueba',
      code: 'codigo-1',
      verifier: 'verificador-1',
      redirectUri: 'https://ejemplo.invalid/callback',
      baseUrl: 'https://backend.invalid',
    });

    expect(tokens).toMatchObject({
      accessToken: 'at-1',
      refreshToken: 'rt-1',
      connectionId: 'con-1',
      scopes: ['connect:sync', 'offline_access'],
    });

    const init = fetchMock.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/x-www-form-urlencoded',
    );
    const enviado = new URLSearchParams(init.body as string);
    expect(enviado.get('grant_type')).toBe('authorization_code');
    expect(enviado.get('code_verifier')).toBe('verificador-1');
    expect(enviado.get('client_secret')).toBe('secreto-de-prueba');
  });

  test('un código quemado llega con el error de OAuth como código', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, _init?: RequestInit) =>
        new Response(
          JSON.stringify({ error: 'invalid_grant', error_description: 'invalid code' }),
          { status: 401, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );

    await expect(
      exchangeCode({
        clientId: 'c',
        clientSecret: 's',
        code: 'quemado',
        verifier: 'v',
        redirectUri: 'https://ejemplo.invalid/callback',
      }),
    ).rejects.toMatchObject({ code: 'invalid_grant', status: 401 });
  });
});
