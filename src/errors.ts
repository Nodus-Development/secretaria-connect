import type { ConnectErrorCode } from './types.js';

/**
 * Lo que lanza cualquier llamada del cliente que no acabe en 2xx.
 *
 * El `code` es el del sobre de error de SecretarIA (`{error:{code,message}}`),
 * no una invención del SDK: si mañana el servidor añade un código, llega aquí
 * tal cual en vez de perderse en un `Error` genérico.
 */
export class ConnectError extends Error {
  readonly code: ConnectErrorCode;
  readonly status: number;
  /** Segundos. Presente en `rate_limited`, leído de la cabecera `Retry-After`. */
  readonly retryAfter?: number;

  constructor(status: number, code: ConnectErrorCode, message: string, retryAfter?: number) {
    super(message);
    this.name = 'ConnectError';
    this.status = status;
    this.code = code;
    if (retryAfter !== undefined) this.retryAfter = retryAfter;
  }
}

/**
 * Lo que lanza `verifyWebhook` cuando la entrega no es de quien dice ser: firma
 * que no cuadra, marca de tiempo fuera de tolerancia o cuerpo que no es un
 * evento del catálogo.
 *
 * Es una clase aparte de `ConnectError` a propósito: no viene de una respuesta
 * HTTP tuya, viene de algo que ha llamado a TU puerta. Respóndele 400 y no le
 * des más pistas.
 */
export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookVerificationError';
  }
}
