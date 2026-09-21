import { ConnectError } from './errors.js';
import { normalizeBaseUrl, readResponse, requestTokens } from './internal.js';
import type {
  ConnectItem,
  ConnectionInfo,
  LinkSession,
  LinkSessionOptions,
  StoredTokens,
  SyncItemError,
  SyncResult,
} from './types.js';

/**
 * El cliente de `/api/connect/*`.
 *
 * Deliberadamente tonto: ni temporizadores, ni `AbortController`, ni reintentos
 * por dentro. El reintento es del anfitrión (`ctx.scheduler.runAfter` en una
 * action de Convex, una cola en Express), porque el runtime V8 de Convex no
 * tiene con qué esperar y un core que reintentase por su cuenta allí no
 * funcionaría y tampoco avisaría.
 */

export interface ConnectClientOptions {
  /** Los que te dieron al dar de alta la app. */
  clientId: string;
  clientSecret: string;
  /** Por defecto, el backend de SecretarIA en producción. */
  baseUrl?: string;

  /**
   * El access token caduca en 1 h. El SDK lo refresca solo, y para eso necesita
   * leer y guardar los tokens de ESTA conexión.
   *
   * OJO: el refresh token ROTA en cada uso. Si `save` no persiste el nuevo, la
   * integración muere a la hora siguiente y el fallo parece de red.
   */
  tokens: {
    load(): Promise<StoredTokens | null>;
    save(next: StoredTokens): Promise<void>;
  };
}

/**
 * Un cliente está atado a UNA conexión, o sea a UN usuario de SecretarIA. No
 * existe un cliente «de la app» que pueda hablar por todos sus usuarios.
 */
export interface ConnectClient {
  /** `POST /api/connect/sync` — upsert por (conexión, externalId). */
  sync(item: ConnectItem): Promise<SyncResult>;

  /**
   * `POST /api/connect/sync-batch` — tope 50, ÉXITO PARCIAL.
   * El array de vuelta trae un resultado o un error POR ÍTEM, en el mismo
   * orden. No lances si uno falla: el resto sí entró.
   */
  syncMany(items: ConnectItem[]): Promise<Array<SyncResult | SyncItemError>>;

  /**
   * `POST /api/connect/unlink` — olvida el mapeo. LA TAREA SOBREVIVE.
   * No hay forma de borrar una tarea del usuario desde fuera, y es a propósito.
   * Es tu gesto de limpieza, así que NO deja lápida y NO emite evento: puedes
   * volver a hacer `sync` de ese `externalId` cuando quieras. La lápida solo la
   * pone el usuario.
   */
  unlink(externalId: string): Promise<void>;

  /**
   * `GET /api/connect/me` — scopes efectivos y estado de tus entidades.
   * Llámala al arrancar: es lo que te dice qué te falta por vincular.
   */
  me(): Promise<ConnectionInfo>;

  /**
   * `POST /api/connect/link-session` — el billete para que el usuario vincule
   * una de tus entidades con uno de sus proyectos.
   *
   * Devuelve una URL de SecretarIA a la que hay que **redirigir al usuario**
   * desde su navegador. Es de UN SOLO USO y caduca en 15 minutos, así que no la
   * guardes ni la pidas «por si acaso»: pídela cuando el usuario pulse el botón.
   *
   * El proyecto lo elige él, con su sesión y en nuestro dominio; tú nunca ves
   * cuál es. Al terminar vuelve a tu `returnUrl`, que tiene que compartir
   * origen con alguno de tus `redirect_uris` registrados.
   */
  createLinkSession(options: LinkSessionOptions): Promise<LinkSession>;

  /**
   * `DELETE /api/connect/me` — la app se autodesconecta.
   * No emite `connection.revoked` hacia ti: ya lo sabes.
   */
  disconnect(): Promise<void>;
}

/** Margen para no estrenar un token que caduca mientras vuela el request. */
const REFRESH_MARGIN_MS = 60_000;

export function createConnectClient(opts: ConnectClientOptions): ConnectClient {
  const baseUrl = normalizeBaseUrl(opts.baseUrl);

  async function accessToken(): Promise<string> {
    const current = await opts.tokens.load();
    if (current === null) {
      throw new ConnectError(
        401,
        'invalid_token',
        'No hay tokens guardados para esta conexión: el usuario tiene que autorizar la app',
      );
    }

    if (current.expiresAt - REFRESH_MARGIN_MS > Date.now()) return current.accessToken;

    const refreshed = await requestTokens(baseUrl, {
      grant_type: 'refresh_token',
      refresh_token: current.refreshToken,
      client_id: opts.clientId,
      client_secret: opts.clientSecret,
    });
    // El refresh rota: si esto no se persiste, el par viejo ya no vale y la
    // conexión queda muerta sin que nadie lo note hasta la hora siguiente.
    await opts.tokens.save(refreshed);
    return refreshed.accessToken;
  }

  async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await accessToken();
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return readResponse<T>(response);
  }

  return {
    sync(item) {
      return request<SyncResult>('POST', '/api/connect/sync', item);
    },
    syncMany(items) {
      return request<Array<SyncResult | SyncItemError>>('POST', '/api/connect/sync-batch', {
        items,
      });
    },
    unlink(externalId) {
      return request<void>('POST', '/api/connect/unlink', { externalId });
    },
    me() {
      return request<ConnectionInfo>('GET', '/api/connect/me');
    },
    createLinkSession(options) {
      return request<LinkSession>('POST', '/api/connect/link-session', options);
    },
    disconnect() {
      return request<void>('DELETE', '/api/connect/me');
    },
  };
}

/** Distingue un fallo por ítem de un resultado dentro de `syncMany`. */
export function isSyncItemError(entry: SyncResult | SyncItemError): entry is SyncItemError {
  return 'error' in entry;
}
