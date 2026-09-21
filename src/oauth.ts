import { AUTHORIZE_PATH, normalizeBaseUrl, readResponse, requestTokens } from './internal.js';
import type { ConnectionInfo, StoredTokens } from './types.js';

/**
 * El flujo de conexión: OAuth2 Authorization Code + PKCE. **No es OIDC**: el
 * proveedor no anuncia `openid` y no hay `id_token` que mirar. La identidad del
 * usuario no viaja al integrador, ni aquí ni en ninguna otra llamada.
 */

export const SCOPES = {
  /** Empujar ítems y desenlazar. El que todo el mundo pide. */
  SYNC: 'connect:sync',
  /**
   * SIN ESTE NO HAY REFRESH TOKEN y la integración muere a la hora. Es el que
   * se omite por no reconocerlo.
   */
  OFFLINE: 'offline_access',
} as const;

export interface AuthorizeUrlOptions {
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string;
  baseUrl?: string;
  /**
   * El `code_verifier` de PKCE. Se deja inyectable porque la documentación de
   * Convex no dice si `crypto.getRandomValues` es aleatorio de verdad dentro de
   * su runtime V8 (sí dice que `Math.random()` va sembrado y `Date.now()`
   * congelado): quien haga el baile dentro de una query o una mutation lo trae
   * de fuera. En Node, en un worker o en una action, omítelo.
   */
  verifier?: string;
}

/**
 * Construye la URL de `/oauth2/authorize` y devuelve el `verifier` que hay que
 * guardar en sesión: lo pide el callback.
 *
 * Es asíncrona porque el reto `S256` sale de `crypto.subtle.digest`, igual que
 * `verifyWebhook`.
 */
export async function buildAuthorizeUrl(
  opts: AuthorizeUrlOptions,
): Promise<{ url: string; verifier: string }> {
  const verifier = opts.verifier ?? randomVerifier();
  const challenge = await codeChallenge(verifier);

  const query = new URLSearchParams({
    response_type: 'code',
    client_id: opts.clientId,
    redirect_uri: opts.redirectUri,
    scope: opts.scopes.join(' '),
    state: opts.state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });

  return {
    url: `${normalizeBaseUrl(opts.baseUrl)}${AUTHORIZE_PATH}?${query.toString()}`,
    verifier,
  };
}

export interface ExchangeCodeOptions {
  clientId: string;
  clientSecret: string;
  code: string;
  verifier: string;
  redirectUri: string;
  baseUrl?: string;
}

/**
 * Canjea el `code` del callback. Devuelve los tokens ya listos para `save` **y
 * el `connectionId`**, para que dar de alta la conexión sea un viaje y no dos.
 *
 * El `connectionId` no viene en la respuesta del endpoint de token —que es el
 * JSON estándar de OAuth2— así que se pide con un `GET /api/connect/me` con el
 * token recién emitido. Dos llamadas por dentro, una sola por fuera.
 */
export async function exchangeCode(
  opts: ExchangeCodeOptions,
): Promise<StoredTokens & { connectionId: string }> {
  const baseUrl = normalizeBaseUrl(opts.baseUrl);

  const tokens = await requestTokens(baseUrl, {
    grant_type: 'authorization_code',
    code: opts.code,
    code_verifier: opts.verifier,
    redirect_uri: opts.redirectUri,
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
  });

  const response = await fetch(`${baseUrl}/api/connect/me`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${tokens.accessToken}`, Accept: 'application/json' },
  });
  const info = await readResponse<ConnectionInfo>(response);

  return { ...tokens, connectionId: info.connectionId };
}

/** 32 bytes en base64url: el tamaño que recomienda la RFC 7636. */
function randomVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

/**
 * base64url a mano y no `btoa`: el alfabeto es el de la RFC 4648 §5 y sin
 * relleno, y así el paquete no depende de un global que no todos los runtimes
 * garantizan.
 */
const BASE64_URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function base64Url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] as number;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += BASE64_URL_ALPHABET[a >> 2];
    out += BASE64_URL_ALPHABET[((a & 3) << 4) | ((b ?? 0) >> 4)];
    if (b === undefined) break;
    out += BASE64_URL_ALPHABET[((b & 15) << 2) | ((c ?? 0) >> 6)];
    if (c === undefined) break;
    out += BASE64_URL_ALPHABET[c & 63];
  }
  return out;
}
