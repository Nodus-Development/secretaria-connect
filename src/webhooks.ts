import { WebhookVerificationError } from './errors.js';
import type { ConnectEvent } from './types.js';

/**
 * Verificación de las entregas que SecretarIA te hace.
 *
 * Todo sobre `crypto.subtle`, que existe igual en Node 18+, en un worker y en
 * el runtime V8 de Convex: así una action de Convex puede verificar sin
 * `'use node'` y sin traer una librería de HMAC.
 */

/** Ventana de replay, en segundos. La misma que usa Stripe. */
const TOLERANCE_SECONDS = 300;

const EVENT_TYPES = ['task.completed', 'task.reopened', 'link.removed', 'connection.revoked'];
const LINK_REMOVED_REASONS = ['unlinked', 'task_deleted'];

/**
 * Verifica la firma de una entrega y devuelve el evento ya tipado. Lanza
 * `WebhookVerificationError` si no cuadra.
 *
 * `rawBody` es el CUERPO SIN PARSEAR. Si tu framework ya te lo dio como objeto,
 * la firma no va a cuadrar nunca y el error no te lo va a decir: en Express eso
 * es `express.raw({ type: 'application/json' })` en ESTA ruta.
 *
 * La cabecera es `SecretarIA-Signature` y viene con la forma `t=…,v1=…`. Se
 * aceptan VARIOS `v1=`: hoy solo se firma con uno, pero si algún día el secreto
 * rota, un SDK que solo mirase el primero obligaría a todos los integradores a
 * actualizar a la vez.
 *
 * DEDUPLICAR NO ES DEL SDK. La entrega es at-least-once y SIN ORDEN GARANTIZADO,
 * `deliveryId` es la clave, y quien tiene base de datos para recordarla eres tú.
 */
export async function verifyWebhook(
  rawBody: string | Uint8Array,
  signatureHeader: string,
  secret: string,
): Promise<ConnectEvent> {
  const body = typeof rawBody === 'string' ? rawBody : new TextDecoder().decode(rawBody);
  const { timestamp, signatures } = parseSignatureHeader(signatureHeader);

  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - timestamp);
  if (ageSeconds > TOLERANCE_SECONDS) {
    throw new WebhookVerificationError('La marca de tiempo de la firma está fuera de tolerancia');
  }

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const signed = encoder.encode(`${timestamp}.${body}`);

  let valid = false;
  for (const signature of signatures) {
    const bytes = hexToBytes(signature);
    if (bytes === null) continue;
    // `crypto.subtle.verify` compara en tiempo constante por dentro: no hay
    // ninguna comparación de cadenas que escribir aquí, ni debe haberla.
    if (await crypto.subtle.verify('HMAC', key, bytes, signed)) valid = true;
  }
  if (!valid) throw new WebhookVerificationError('La firma no es válida');

  return parseEvent(body);
}

function parseSignatureHeader(header: string): { timestamp: number; signatures: string[] } {
  let timestamp: number | null = null;
  const signatures: string[] = [];

  for (const part of header.split(',')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name === 't' && timestamp === null) {
      const parsed = Number.parseInt(value, 10);
      if (Number.isFinite(parsed)) timestamp = parsed;
    } else if (name === 'v1') {
      signatures.push(value);
    }
  }

  if (timestamp === null || signatures.length === 0) {
    throw new WebhookVerificationError('Cabecera de firma mal formada');
  }
  return { timestamp, signatures };
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (hex.length === 0 || hex.length % 2 !== 0) return null;
  // Respaldado por un `ArrayBuffer` explícito: `crypto.subtle` no acepta un
  // `SharedArrayBuffer` y el tipo por defecto de `Uint8Array` admite los dos.
  const bytes = new Uint8Array(new ArrayBuffer(hex.length / 2));
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) return null;
    bytes[i] = byte;
  }
  return bytes;
}

interface Envelope {
  id?: unknown;
  type?: unknown;
  created?: unknown;
  data?: {
    connection_id?: unknown;
    external_id?: unknown;
    done?: unknown;
    reason?: unknown;
  };
}

/**
 * Del sobre al evento. El cuerpo viaja al estilo de Stripe —identificador y
 * tipo fuera, carga dentro— y en `snake_case`; lo que se expone aquí es el
 * evento plano del contrato. El `id` del sobre es el MISMO en los cuatro
 * intentos de una entrega: es la clave con la que deduplicas.
 */
function parseEvent(body: string): ConnectEvent {
  let parsed: Envelope;
  try {
    parsed = JSON.parse(body) as Envelope;
  } catch {
    throw new WebhookVerificationError('El cuerpo de la entrega no es JSON');
  }

  const type = parsed.type;
  const deliveryId = parsed.id;
  const occurredAt = parsed.created;
  const data = parsed.data ?? {};
  const connectionId = data.connection_id;

  if (typeof type !== 'string' || !EVENT_TYPES.includes(type)) {
    throw new WebhookVerificationError('Tipo de evento desconocido');
  }
  if (typeof deliveryId !== 'string' || typeof occurredAt !== 'number') {
    throw new WebhookVerificationError('Sobre de entrega incompleto');
  }
  if (typeof connectionId !== 'string') {
    throw new WebhookVerificationError('Entrega sin `connection_id`');
  }

  if (type === 'connection.revoked') {
    return { type, deliveryId, connectionId, occurredAt };
  }

  const externalId = data.external_id;
  if (typeof externalId !== 'string') {
    throw new WebhookVerificationError('Entrega sin `external_id`');
  }

  if (type === 'link.removed') {
    const reason = data.reason;
    if (typeof reason !== 'string' || !LINK_REMOVED_REASONS.includes(reason)) {
      throw new WebhookVerificationError('`link.removed` sin motivo reconocible');
    }
    return {
      type,
      deliveryId,
      connectionId,
      externalId,
      reason: reason as 'unlinked' | 'task_deleted',
      occurredAt,
    };
  }

  if (typeof data.done !== 'boolean') {
    throw new WebhookVerificationError('Entrega de tarea sin `done`');
  }
  return type === 'task.completed'
    ? { type, deliveryId, connectionId, externalId, done: true, occurredAt }
    : { type: 'task.reopened', deliveryId, connectionId, externalId, done: false, occurredAt };
}
