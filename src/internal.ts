import { ConnectError } from './errors.js';
import type { StoredTokens } from './types.js';

/**
 * Piezas compartidas por el cliente y el baile de OAuth. No se exporta nada de
 * aquí en el índice del paquete: es cocina, no contrato.
 */

/** El dominio de las HTTP Actions de SecretarIA. */
export const DEFAULT_BASE_URL = 'https://system.secretar-ia.org';

/** Las rutas del proveedor OAuth2 cuelgan de `/api/auth`, no de la raíz. */
export const TOKEN_PATH = '/api/auth/oauth2/token';
export const AUTHORIZE_PATH = '/api/auth/oauth2/authorize';

export function normalizeBaseUrl(baseUrl?: string): string {
  const raw = baseUrl ?? DEFAULT_BASE_URL;
  return raw.endsWith('/') ? raw.slice(0, -1) : raw;
}

interface ErrorEnvelope {
  error?: { code?: unknown; message?: unknown };
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Traduce una respuesta de `/api/connect/*` a valor o a `ConnectError`.
 *
 * El éxito viene envuelto en `{data: …}` y el 204 no trae cuerpo; el fallo
 * viene en `{error:{code,message}}`. El `Retry-After` del 429 se sube al error
 * en segundos porque es lo único accionable que trae ese fallo.
 */
export async function readResponse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;

  const body = await readJson(response);

  if (response.ok) {
    const envelope = body as { data?: unknown } | undefined;
    if (envelope === undefined || !('data' in envelope)) {
      throw new ConnectError(
        response.status,
        'internal_error',
        'Respuesta sin envoltorio `data`: ¿seguro que `baseUrl` apunta a SecretarIA?',
      );
    }
    return envelope.data as T;
  }

  const envelope = body as ErrorEnvelope | undefined;
  const code = typeof envelope?.error?.code === 'string' ? envelope.error.code : 'http_error';
  const message =
    typeof envelope?.error?.message === 'string'
      ? envelope.error.message
      : `Respuesta ${response.status} sin cuerpo de error`;

  const retryAfter = readRetryAfter(response);
  throw new ConnectError(response.status, code, message, retryAfter);
}

function readRetryAfter(response: Response): number | undefined {
  const header = response.headers.get('Retry-After');
  if (header === null) return undefined;
  const seconds = Number.parseInt(header, 10);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

interface TokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  expires_in?: unknown;
  scope?: unknown;
  error?: unknown;
  error_description?: unknown;
}

/**
 * El endpoint de token del proveedor. Acepta las credenciales de cliente en el
 * cuerpo (`client_secret_post`) y exige `application/x-www-form-urlencoded`,
 * que además es lo que manda la RFC.
 *
 * Los fallos de aquí NO usan el sobre de `/api/connect`: son los de OAuth2
 * (`{error, error_description}`), y se traducen a `ConnectError` con ese mismo
 * `error` como código para que un `invalid_grant` se lea como lo que es.
 */
export async function requestTokens(
  baseUrl: string,
  params: Record<string, string>,
): Promise<StoredTokens> {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}${TOKEN_PATH}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams(params).toString(),
  });

  const body = (await readJson(response)) as TokenResponse | undefined;

  if (!response.ok) {
    const code = typeof body?.error === 'string' ? body.error : 'invalid_token';
    const message =
      typeof body?.error_description === 'string'
        ? body.error_description
        : `El endpoint de token respondió ${response.status}`;
    throw new ConnectError(response.status, code, message);
  }

  if (typeof body?.access_token !== 'string') {
    throw new ConnectError(response.status, 'invalid_token', 'Respuesta de token sin access_token');
  }
  if (typeof body.refresh_token !== 'string') {
    // Sin `offline_access` el proveedor no emite refresh token y la integración
    // se muere a la hora. Es el scope que se omite por no reconocerlo, así que
    // el fallo se nombra aquí en vez de aparecer como un 401 mañana.
    throw new ConnectError(
      response.status,
      'invalid_token',
      'Respuesta de token sin refresh_token: pide el scope `offline_access` al autorizar',
    );
  }

  const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : 3600;
  const scope = typeof body.scope === 'string' ? body.scope : '';

  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: Date.now() + expiresIn * 1000,
    scopes: scope.length === 0 ? [] : scope.split(' '),
  };
}
