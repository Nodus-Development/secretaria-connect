# @nodus-development/secretaria-connect

SDK de **SecretarIA Connect**: tu aplicación siembra tareas en la cuenta de un
usuario de [SecretarIA](https://secretar-ia.org) y se entera, por webhook, de
cuándo las cierra o las reabre.

- Sin dependencias, ESM puro, todo sobre `crypto.subtle`.
- Funciona igual en Node 18+, en un worker y en el runtime V8 de Convex (sin
  `'use node'`).
- `0.x`: la superficie puede cambiar mientras los únicos integradores seamos
  nosotros. Ver [`CHANGELOG.md`](./CHANGELOG.md).

> El alta de aplicaciones es **manual**: escríbenos y te damos `client_id`,
> `client_secret` y el secreto de webhook (`whsec_…`). Empieza por
> [`docs/alta.md`](./docs/alta.md).

## La guía del integrador

| Documento                                | Qué contesta                                                        |
| ---------------------------------------- | -------------------------------------------------------------------- |
| [`docs/alta.md`](./docs/alta.md)         | Cómo damos de alta tu app, qué nos das y qué te llevas               |
| [`docs/oauth.md`](./docs/oauth.md)       | Conectar a un usuario: PKCE, scopes, refresco rotatorio              |
| [`docs/sync.md`](./docs/sync.md)         | El contrato de sembrado: campos, adopción, errores, cuotas           |
| [`docs/vincular.md`](./docs/vincular.md) | **Dónde aterrizan las tareas.** Lo decide el usuario, no tú          |
| [`docs/webhooks.md`](./docs/webhooks.md) | Los cuatro eventos, la firma, las garantías, la deduplicación        |
| [`docs/proyectar.md`](./docs/proyectar.md) | **El deber de proyectar.** Léelo antes de escribir tu mapeo        |
| [`docs/operacion.md`](./docs/operacion.md) | Qué pasa si algo falla, a quién avisamos, cómo cambia el contrato   |

## Instalación

```sh
npm install @nodus-development/secretaria-connect
```

## Empujar un ítem

Un cliente está atado a **una conexión**, o sea a **un usuario**. No existe un
cliente «de la app» que hable por todos.

```ts
import { createConnectClient } from '@nodus-development/secretaria-connect';

const secretaria = createConnectClient({
  clientId: process.env.SECRETARIA_CLIENT_ID!,
  clientSecret: process.env.SECRETARIA_CLIENT_SECRET!,
  // El refresh token ROTA en cada uso: si `save` no lo persiste, la
  // integración muere a la hora siguiente y el fallo parece de red.
  tokens: {
    load: () => leerTokensDeTuBase(conexionId),
    save: (next) => guardarTokensEnTuBase(conexionId, next),
  },
});

const r = await secretaria.sync({
  externalId: 'a3f9…',                  // tu id estable
  title: 'TCK-42 · Revisar el contrato',
  done: false,
  externalKey: 'TCK-42',
  externalUrl: 'https://tu-sistema.example/tickets/a3f9',
});

// Lo que NO entró. Si no lo miras, crees que tu título entró y no fue así:
// el usuario lo reescribió y ese campo ya es suyo para siempre.
if (r.skippedFields.includes('title')) { /* … */ }

// El estado completo de lo que el usuario ya ha adoptado. Viene entero en cada
// respuesta, así que no tienes que acumular memoria propia.
if (r.adoptedFields.length) { guardarAdoptados(r.adoptedFields); }
```

**El deber de proyectar es tuyo**: lo que mandes es lo que el usuario va a leer
en su tarea. SecretarIA no conoce el modelo de permisos de tu sistema y no puede
filtrar por ti. → [`docs/proyectar.md`](./docs/proyectar.md)

## Recibir el cierre

```ts
import express from 'express';
import { verifyWebhook } from '@nodus-development/secretaria-connect';

app.post(
  '/webhooks/secretaria',
  // `raw`, NO `json`: la firma es sobre el cuerpo SIN PARSEAR. Si tu
  // `express.json()` global se lo come antes, la firma no cuadra nunca y el
  // error no te dice por qué.
  express.raw({ type: 'application/json' }),
  async (req, res) => {
    const evento = await verifyWebhook(
      req.body,
      req.header('SecretarIA-Signature')!,
      process.env.SECRETARIA_WEBHOOK_SECRET!,
    );

    // Persiste ANTES de responder: un 200 sin haber guardado nada pierde el
    // evento, porque para SecretarIA ya está entregado.
    await encolar(evento);   // dedupe por `evento.deliveryId`
    res.status(200).end();
  },
);
```

La entrega es **at-least-once y sin orden garantizado**. Deduplicar es tuyo:
la clave es `evento.deliveryId` y quien tiene base de datos para recordarla
eres tú. → [`docs/webhooks.md`](./docs/webhooks.md)

## Conectar a un usuario (OAuth2 + PKCE)

```ts
import { buildAuthorizeUrl, exchangeCode, SCOPES } from '@nodus-development/secretaria-connect';

const { url, verifier } = await buildAuthorizeUrl({
  clientId,
  redirectUri,
  // Sin `offline_access` no hay refresh token y la integración muere a la hora.
  scopes: [SCOPES.SYNC, SCOPES.OFFLINE],
  // Aleatorio y de un solo uso. NO el id de tu usuario: no es secreto.
  state: nonce,
});
// Guarda `verifier` y `nonce` por tu lado: los pide el callback.

const tokens = await exchangeCode({ clientId, clientSecret, code, verifier, redirectUri });
// { accessToken, refreshToken, expiresAt, scopes, connectionId }
```

→ [`docs/oauth.md`](./docs/oauth.md)

## Dónde aterrizan las tareas

No lo decides tú. Tu ítem dice a qué **entidad tuya** pertenece y el usuario elige a qué proyecto
suyo va esa entidad, desde una pantalla nuestra:

```ts
await client.sync({ externalId: 'TCK-42', title: '…', done: false, target: 'org_7f3a' });

// Y un botón en tu interfaz para que el usuario le ponga destino:
const { url } = await client.createLinkSession({
  target: 'org_7f3a',
  label: 'Acme S.L.',
  returnUrl: 'https://tu-servidor.example/vuelta?org=7f3a',
});
// Redirige el navegador del usuario a `url`. Un solo uso, 15 minutos.
```

Mientras no la vincule, esas tareas nacen **sin proyecto** y SecretarIA se lo pregunta a él. Lo
sabes porque `project` sale en `skippedFields`. → [`docs/vincular.md`](./docs/vincular.md)

## Lo que este SDK **no** hace

- **No lee nada del usuario.** El token de app abre `/api/connect/*` y nada
  más: no hay listados, no hay refetch y `me()` no devuelve datos personales.
  Tampoco alcanza a la API personal del usuario (`/api/v1`).
- **No reintenta.** No hay temporizadores ni `AbortController` dentro: el
  reintento es del anfitrión (`ctx.scheduler.runAfter` en Convex, una cola en
  Express).
- **No deduplica** las entregas, ni borra tareas del usuario: `unlink()` olvida
  el mapeo y la tarea sobrevive.

Y tres cosas que tampoco existen del lado del servidor, para que no las busques:
**no hay `task.updated`** (no te llega contenido, sólo cierres y reaperturas),
**no hay endpoint de refetch**, y **no hay operación de exportar** una tarea de
SecretarIA a tu sistema.

## Licencia

MIT — ver [`LICENSE`](./LICENSE).
