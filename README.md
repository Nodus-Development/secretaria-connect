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
> `client_secret` y el secreto de webhook (`whsec_…`). La guía completa del
> integrador llega en la próxima versión.

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

await secretaria.sync({
  externalId: 'TCK-42',
  title: 'Revisar el contrato de Acme',
  done: false,
  externalKey: 'TCK-42',
  externalUrl: 'https://tu-sistema.example/tickets/42',
});
```

**El deber de proyectar es tuyo**: lo que mandes es lo que el usuario va a leer
en su tarea. SecretarIA no conoce el modelo de permisos de tu sistema y no puede
filtrar por ti.

## Recibir el cierre

```ts
import { verifyWebhook } from '@nodus-development/secretaria-connect';

// `rawBody` es el cuerpo SIN PARSEAR. Si tu framework ya te lo dio como objeto,
// la firma no va a cuadrar nunca y el error no te lo va a decir.
const evento = await verifyWebhook(
  rawBody,
  request.headers['secretaria-signature'],
  process.env.SECRETARIA_WEBHOOK_SECRET!,
);

if (evento.type === 'task.completed') {
  await cerrarEnTuSistema(evento.externalId);
}
```

La entrega es **at-least-once y sin orden garantizado**. Deduplicar es tuyo:
la clave es `evento.deliveryId` y quien tiene base de datos para recordarla
eres tú.

## Conectar a un usuario (OAuth2 + PKCE)

```ts
import { buildAuthorizeUrl, exchangeCode, SCOPES } from '@nodus-development/secretaria-connect';

const { url, verifier } = await buildAuthorizeUrl({
  clientId,
  redirectUri,
  // Sin `offline_access` no hay refresh token y la integración muere a la hora.
  scopes: [SCOPES.SYNC, SCOPES.OFFLINE],
  state,
});
// Guarda `verifier` en sesión: lo pide el callback.

const tokens = await exchangeCode({ clientId, clientSecret, code, verifier, redirectUri });
```

## Lo que este SDK **no** hace

- **No lee nada del usuario.** El token de app abre `/api/connect/*` y nada
  más: no hay listados, no hay refetch y `me()` no devuelve datos personales.
- **No reintenta.** No hay temporizadores ni `AbortController` dentro: el
  reintento es del anfitrión (`ctx.scheduler.runAfter` en Convex, una cola en
  Express).
- **No deduplica** las entregas, ni borra tareas del usuario: `unlink()` olvida
  el mapeo y la tarea sobrevive.

## Licencia

MIT — ver [`LICENSE`](./LICENSE).
