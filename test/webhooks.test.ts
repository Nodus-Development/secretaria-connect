import { describe, expect, test } from 'vitest';
import { verifyWebhook } from '../src/webhooks.js';
import { WebhookVerificationError } from '../src/errors.js';

const SECRET = 'whsec_de_mentira_para_el_test';

/**
 * Firma igual que el backend: HMAC-SHA256 hex sobre `"{t}.{rawBody}"`, con el
 * `t` en segundos. Si esto y `convex/connect/dispatch.ts` dejan de coincidir,
 * el test de paridad del backend lo canta antes de desplegar.
 */
async function firmar(secret: string, timestamp: number, rawBody: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${rawBody}`));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function sobre(data: Record<string, unknown>, type: string, id = 'entrega-1'): string {
  return JSON.stringify({ id, type, created: 1_770_000_000_000, data });
}

async function entrega(body: string, secret = SECRET, at = Math.floor(Date.now() / 1000)) {
  return { body, header: `t=${at},v1=${await firmar(secret, at, body)}` };
}

describe('verifyWebhook', () => {
  test('devuelve el evento plano a partir del sobre', async () => {
    const body = sobre({ connection_id: 'con-1', external_id: 'TCK-42', done: true }, 'task.completed');
    const { header } = await entrega(body);

    const event = await verifyWebhook(body, header, SECRET);

    expect(event).toEqual({
      type: 'task.completed',
      deliveryId: 'entrega-1',
      connectionId: 'con-1',
      externalId: 'TCK-42',
      done: true,
      occurredAt: 1_770_000_000_000,
    });
  });

  test('task.reopened llega con done false', async () => {
    const body = sobre({ connection_id: 'con-1', external_id: 'TCK-42', done: false }, 'task.reopened');
    const { header } = await entrega(body);

    const event = await verifyWebhook(body, header, SECRET);

    expect(event).toMatchObject({ type: 'task.reopened', done: false });
  });

  test('link.removed conserva el motivo', async () => {
    const body = sobre(
      { connection_id: 'con-1', external_id: 'TCK-42', reason: 'task_deleted' },
      'link.removed',
    );
    const { header } = await entrega(body);

    const event = await verifyWebhook(body, header, SECRET);

    expect(event).toMatchObject({ type: 'link.removed', reason: 'task_deleted' });
  });

  test('connection.revoked no trae externalId', async () => {
    const body = sobre({ connection_id: 'con-1' }, 'connection.revoked');
    const { header } = await entrega(body);

    const event = await verifyWebhook(body, header, SECRET);

    expect(event).toEqual({
      type: 'connection.revoked',
      deliveryId: 'entrega-1',
      connectionId: 'con-1',
      occurredAt: 1_770_000_000_000,
    });
  });

  test('acepta el cuerpo como bytes', async () => {
    const body = sobre({ connection_id: 'con-1', external_id: 'TCK-42', done: true }, 'task.completed');
    const { header } = await entrega(body);

    const event = await verifyWebhook(new TextEncoder().encode(body), header, SECRET);

    expect(event).toMatchObject({ externalId: 'TCK-42' });
  });

  test('acepta varios v1 y le basta con que uno cuadre', async () => {
    const body = sobre({ connection_id: 'con-1', external_id: 'TCK-42', done: true }, 'task.completed');
    const at = Math.floor(Date.now() / 1000);
    const buena = await firmar(SECRET, at, body);
    const header = `t=${at},v1=${'0'.repeat(64)},v1=${buena}`;

    await expect(verifyWebhook(body, header, SECRET)).resolves.toMatchObject({
      type: 'task.completed',
    });
  });

  test('rechaza una firma de otro secreto', async () => {
    const body = sobre({ connection_id: 'con-1', external_id: 'TCK-42', done: true }, 'task.completed');
    const { header } = await entrega(body, 'whsec_otro');

    await expect(verifyWebhook(body, header, SECRET)).rejects.toBeInstanceOf(
      WebhookVerificationError,
    );
  });

  test('rechaza un cuerpo manipulado tras firmar', async () => {
    const body = sobre({ connection_id: 'con-1', external_id: 'TCK-42', done: true }, 'task.completed');
    const { header } = await entrega(body);
    const manipulado = body.replace('TCK-42', 'TCK-99');

    await expect(verifyWebhook(manipulado, header, SECRET)).rejects.toBeInstanceOf(
      WebhookVerificationError,
    );
  });

  test('rechaza una entrega vieja aunque la firma cuadre', async () => {
    const body = sobre({ connection_id: 'con-1', external_id: 'TCK-42', done: true }, 'task.completed');
    const viejo = Math.floor(Date.now() / 1000) - 3600;
    const { header } = await entrega(body, SECRET, viejo);

    await expect(verifyWebhook(body, header, SECRET)).rejects.toThrow(/tolerancia/);
  });

  test('rechaza una cabecera sin v1', async () => {
    const body = sobre({ connection_id: 'con-1' }, 'connection.revoked');

    await expect(verifyWebhook(body, 't=123', SECRET)).rejects.toThrow(/mal formada/);
  });

  test('rechaza un tipo de evento que no existe', async () => {
    const body = sobre({ connection_id: 'con-1', external_id: 'TCK-42' }, 'task.updated');
    const { header } = await entrega(body);

    await expect(verifyWebhook(body, header, SECRET)).rejects.toThrow(/desconocido/);
  });
});
