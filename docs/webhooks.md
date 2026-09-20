# Webhooks: el camino de vuelta

Como el token de app no lee nada, el webhook **es el único camino de vuelta que existe**. Si
no declaraste URL en el [alta](./alta.md), tu integración funciona sólo de ida.

Un único endpoint por **aplicación**, no por usuario: el `connectionId` del cuerpo te dice de
quién es cada entrega.

## 1 · El handler

```ts
import express from 'express';
import { verifyWebhook, WebhookVerificationError } from '@nodus-development/secretaria-connect';

app.post(
  '/webhooks/secretaria',
  // `raw`, NO `json`. La firma es sobre el cuerpo SIN PARSEAR: si tu
  // `express.json()` global se lo come antes, la firma no cuadra nunca y el
  // error no te dice por qué. Es la primera hora perdida de todo integrador.
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    let evento;
    try {
      evento = await verifyWebhook(
        req.body,
        req.header('SecretarIA-Signature')!,
        process.env.SECRETARIA_WEBHOOK_SECRET!,
      );
    } catch (err) {
      if (err instanceof WebhookVerificationError) return res.status(400).end();
      throw err;
    }

    // Encola PRIMERO y responde después. Un 200 antes de haber guardado nada
    // pierde el evento si el proceso muere: para nosotros ya está entregado.
    try {
      await encolar(evento);          // la misma transacción que deduplica (§3)
    } catch {
      return res.status(500).end();   // que nos lo reintenten
    }
    res.status(200).end();
  },
);
```

«Responde rápido» no es «responde primero»: lo que tiene que ser rápido es **persistir** el
evento, y el trabajo de verdad va después, fuera del handler. Si contestas `200` antes de
haber guardado nada, para nosotros está entregado y no hay reintento que te salve.

`verifyWebhook` es **asíncrona** (`crypto.subtle`), acepta `string` o `Uint8Array`, verifica
la firma y te devuelve el evento ya tipado. Si algo no cuadra lanza
`WebhookVerificationError` y nunca te da un evento a medias.

## 2 · Los cuatro eventos

```ts
type ConnectEvent = {
  deliveryId: string;     // la clave de deduplicación
  connectionId: string;   // de qué usuario tuyo es esto
  occurredAt: number;     // epoch en ms
} & (
  | { type: 'task.completed';   externalId: string; done: true }
  | { type: 'task.reopened';    externalId: string; done: false }
  | { type: 'link.removed';     externalId: string; reason: 'unlinked' | 'task_deleted' }
  | { type: 'connection.revoked' }
);
```

| Evento               | Cuándo                                                        | Qué hacer                                                        |
| -------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------- |
| `task.completed`     | El usuario completó la tarea                                  | Cierra tu ítem                                                    |
| `task.reopened`      | La volvió a abrir                                             | Reábrelo                                                          |
| `link.removed`       | Se rompió el enlace                                           | Mira `reason` (§2.1)                                              |
| `connection.revoked` | **El usuario** te revocó desde sus ajustes                     | Borra su fila. **Una** entrega, no una por tarea, y llega antes de que los tokens mueran |

El `externalId` que recibes es el que **tú** mandaste, así que no tienes que guardar ningún
identificador de mapeo nuestro.

Si eres **tú** quien llama a `disconnect()`, no recibes `connection.revoked`: ya lo sabes.

El evento se emite en la **misma operación** que borra los tokens, así que «antes» es cuestión
de milisegundos: tus peticiones en vuelo pueden llegar a fallar con `401`. No es un problema —
ese `401` y el evento cuentan lo mismo—, pero no esperes una ventana de cortesía.

Y un aviso para que no persigas fantasmas: si alguna vez apagamos tu aplicación desde nuestro
lado ([`operacion.md` §1](./operacion.md#1--el-interruptor)), **no se emite ningún evento**. Lo
verás como `401 invalid_token` en todos tus usuarios a la vez, indistinguible de una revocación
individual. La diferencia te la decimos por correo, no por webhook: si todos tus usuarios caen
de golpe, mira tu bandeja antes de mandar a nadie a reconectar.

### 2.1 · `link.removed` y sus dos motivos

- **`unlinked`** — el usuario desenlazó a propósito. Hay **lápida**: si vuelves a hacer `sync`
  con ese `externalId` recibes `409 link_removed_by_user` y no se crea nada. Marca tu ítem y
  ahórrate las llamadas.
- **`task_deleted`** — el usuario borró la tarea. Aquí **no** hay lápida: tu siguiente `sync`
  siembra una nueva. Y si el borrado fue un despiste y lo deshace, el enlace se restaura y tu
  `sync` simplemente actualiza.

## 3 · Garantías

**At-least-once y sin orden garantizado.** Las dos mitades importan:

- Vas a ver entregas repetidas. **Deduplicar es tuyo**, y la clave es `deliveryId`. El SDK no
  puede hacerlo por ti porque no tiene dónde recordarlo; preferimos decirlo a disimularlo.
- **No uses `occurredAt` para detectar duplicados** ni para ordenar la cola: es cuándo pasó, no
  cuándo llegó, y dos entregas distintas pueden compartirlo.

Eso no quiere decir que no sirva para nada. Si te llegan `task.completed` y `task.reopened` del
**mismo `externalId`** en orden invertido, `occurredAt` es exactamente lo que te dice cuál es la
última: guárdalo por ítem y descarta la transición cuyo `occurredAt` sea anterior al que ya
aplicaste. Es el mismo desempate que `doneAt` hace en el sentido de ida.

Una tabla de dos columnas basta:

```sql
CREATE TABLE secretaria_delivery (
  delivery_id text PRIMARY KEY,
  seen_at     timestamptz DEFAULT now()
);
```

**No te devolvemos el eco de lo que tú acabas de contarnos.** Si tu `sync` cierra una tarea,
no recibes el `task.completed` de ese cambio; si el mismo ítem vive en varias conexiones, las
otras sí se enteran. Una sola ronda, sin tormenta.

## 4 · La firma

```
SecretarIA-Signature: t=1758326400,v1=<hex>
```

- Se firma `` `${t}.${rawBody}` `` con HMAC-SHA-256 y tu `whsec_…`.
- `t` es epoch en **segundos** y va dentro de lo firmado, así que puedes decidir si el mensaje
  vale **antes** de parsear el JSON.
- Tolerancia: **300 segundos**. Fuera de ventana, `WebhookVerificationError`.
- La cabecera admite **varios `v1=`**, para que el día que rotemos secretos no tengas que
  actualizar a la vez. Hoy no rotan ([`alta.md` §2](./alta.md#2--lo-que-te-llevas)).
- La comparación la hace `crypto.subtle.verify`, en tiempo constante.
- El secreto se usa **entero, con su prefijo `whsec_` incluido**. No lo recortes.

Otras cabeceras de la entrega, por si te ayudan a enrutar o depurar:

| Cabecera              | Valor                                                    |
| --------------------- | -------------------------------------------------------- |
| `SecretarIA-Event`    | El mismo `type` que viaja en el cuerpo                   |
| `SecretarIA-Delivery` | El mismo `deliveryId` que viaja en el cuerpo             |
| `User-Agent`          | `SecretarIA-Webhook`                                     |

El identificador de entrega va **también dentro del cuerpo**, y a propósito: `verifyWebhook`
sólo recibe cuerpo y firma, así que si viviera únicamente en la cabecera no podrías
deduplicar con lo que el SDK te devuelve.

### El cuerpo crudo

Lo que firmamos es exactamente esto, en snake_case:

```json
{
  "id": "…",
  "type": "task.completed",
  "created": 1758326400000,
  "data": { "connection_id": "…", "external_id": "TCK-42", "done": true }
}
```

El SDK lo traduce al `ConnectEvent` plano de §2. Si verificas a mano, verifica contra este
cuerpo, no contra el tipo.

## 5 · Reintentos

- **4 intentos**: el inmediato y luego **+1 min, +5 min, +30 min**.
- **Timeout de 10 s**. Persiste y responde dentro de ese margen; el trabajo, después.
- Se reintenta **todo lo que no sea 2xx**, más los errores de red y los timeouts.
- Si agotamos los intentos y llevas **3 fallos consecutivos**, escribimos a los `contacts` de
  tu app. Una entrega buena pone el contador a cero, y no volvemos a escribirte en 24 horas.

**No hay reenvío manual ni panel de entregas.** Guardamos siete días de intentos por nuestro
lado para poder ayudarte: si algo no te llegó, pásanos el `deliveryId`.

Un endpoint caído **no revoca tu integración**: los eventos perdidos se pierden y el siguiente
llega igual. Y si tu URL no vale, la señal es el correo, no un corte.

## 6 · Lo que no existe

- **No existe `task.updated`.** No te llega contenido: el handler es «cierra, reabre, u
  olvida». Es bueno — no hay conflictos de contenido que resolver, porque no hay contenido.
- **No hay refetch.** El cuerpo es autosuficiente, y tendría que serlo aunque quisieras otra
  cosa: el token de app no puede leer nada del usuario.
- **No hay handshake de alta** del endpoint ni suscripción por evento: la URL se declara en el
  alta y recibes los cuatro.
