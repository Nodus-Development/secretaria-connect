# Conectar a un usuario

OAuth2 con código de autorización y **PKCE `S256`**, vocabulario estándar y sin nada
inventado: cualquier cliente OAuth genérico funciona. Este SDK te ahorra el reto PKCE, el
canje y el refresco.

- Base: `https://system.secretar-ia.org`
- Autorización: `GET /api/auth/oauth2/authorize`
- Canje y refresco: `POST /api/auth/oauth2/token` (`application/x-www-form-urlencoded`,
  credenciales de cliente en el cuerpo)

## 1 · El botón

```ts
import { buildAuthorizeUrl, SCOPES } from '@nodus-development/secretaria-connect';

const { url, verifier } = await buildAuthorizeUrl({
  clientId: process.env.SECRETARIA_CLIENT_ID!,
  redirectUri: 'https://tu-sistema.example/integraciones/secretaria/callback',
  scopes: [SCOPES.SYNC, SCOPES.PROJECTS, SCOPES.OFFLINE],
  // Aleatorio, de un solo uso y guardado por tu lado: NO el id de tu usuario,
  // que no es secreto y cualquiera puede escribir.
  state: nonce,
});

// El `verifier` y el `state` tienen que sobrevivir al viaje de ida y vuelta:
// sesión, cookie firmada, tabla… donde quieras, menos en la URL.
await guardarPendiente({ nonce, verifier, userId: idDeTuUsuario });
res.redirect(url);
```

`buildAuthorizeUrl` es **asíncrona**: el reto `S256` sale de `crypto.subtle.digest`.

`SCOPES` son los tres literales del [alta](./alta.md#5--scopes): `SCOPES.SYNC`
(`connect:sync`), `SCOPES.PROJECTS` (`connect:projects`) y `SCOPES.OFFLINE`
(`offline_access`).

> **`offline_access` no es ceremonia.** Es el scope que hace que el proveedor emita refresh
> token. Sin él recibes un access token de una hora y nada más, y la integración se muere sola
> esa misma tarde con un `401` que parece un problema de red.

El `state` es tuyo y sólo tuyo: nosotros te lo devolvemos tal cual. Que sea **aleatorio y de un
solo uso** es lo que importa; un identificador de usuario no sirve, porque no es secreto y
cualquiera puede escribirlo en la URL. Guárdalo con el `verifier`, y en el callback
consúmelo: es tu única defensa contra que alguien te enchufe una conexión ajena.

### Si corres dentro de un runtime restringido

`buildAuthorizeUrl` acepta `verifier?: string`. Está ahí para los entornos donde la
aleatoriedad de `crypto.getRandomValues` no está garantizada (el runtime V8 de Convex, por
ejemplo, siembra `Math.random()` y congela `Date.now()`, y no documenta el resto). Si es tu
caso, genera el verifier fuera y pásalo. Si no, no lo toques.

## 2 · El callback

```ts
import { exchangeCode } from '@nodus-development/secretaria-connect';

// El usuario puede decir que no: vuelves con `error`, sin `code`.
if (req.query.error) {
  // `access_denied` = canceló. También puedes ver `invalid_scope` o
  // `invalid_request` si la petición estaba mal formada.
  return res.redirect('/integraciones/secretaria?cancelado=1');
}

// Consume el `state`: si no existe o ya se usó, no sigas.
const pendiente = await consumirPendiente(String(req.query.state));
if (!pendiente) return res.status(403).end();

const tokens = await exchangeCode({
  clientId: process.env.SECRETARIA_CLIENT_ID!,
  clientSecret: process.env.SECRETARIA_CLIENT_SECRET!,
  code: String(req.query.code),
  verifier: pendiente.verifier,
  redirectUri: 'https://tu-sistema.example/integraciones/secretaria/callback',
});

// tokens: { accessToken, refreshToken, expiresAt, scopes, connectionId }
```

`expiresAt` es epoch en **milisegundos**, ya calculado. `connectionId` identifica la conexión
de ese usuario con tu app; es lo que viaja en cada webhook, así que guárdalo indexado. Lo
resuelve el propio SDK con una llamada interna a `GET /api/connect/me`, porque el endpoint de
token devuelve el JSON estándar de OAuth2 y ahí no cabe.

El código de autorización es de **un solo uso**. Canjearlo dos veces falla sin destruir nada.

### La tabla que tienes que crear

El SDK no persiste nada, y no puede: no conoce tu base de datos. Una fila por usuario tuyo que
conecte.

```sql
CREATE TABLE secretaria_connection (
  user_id       text PRIMARY KEY,
  connection_id text NOT NULL UNIQUE,  -- es lo ÚNICO que trae el webhook
  access_token  text NOT NULL,
  refresh_token text NOT NULL,   -- ROTA en cada refresco. Se reescribe.
  expires_at    bigint NOT NULL,       -- epoch en ms, tal cual viene
  scopes        text[] NOT NULL
);
```

`connection_id` es **estable**: revocar y volver a conectar revive la misma conexión con el
mismo identificador, así que el `UNIQUE` aguanta y tu enrutado de webhooks no se rompe. Y un
`connection_id` pertenece a **un** usuario tuyo: si conectan dos, son dos conexiones.

## 3 · El cliente, y el refresco que ocurre solo

```ts
import { createConnectClient } from '@nodus-development/secretaria-connect';

export function clientFor(userId: string) {
  return createConnectClient({
    clientId: process.env.SECRETARIA_CLIENT_ID!,
    clientSecret: process.env.SECRETARIA_CLIENT_SECRET!,
    tokens: {
      load: () => leerFila(userId),          // null si no ha conectado
      save: (next) => escribirFila(userId, next),
    },
  });
}
```

Un cliente está atado a **una conexión**, o sea a **un usuario**. No existe un cliente «de la
app» que hable por todos sus usuarios: si un ítem lo tiene que empujar Ana, el cliente es el
de Ana o no se empuja.

Vidas y rotación:

| Token   | Vida   | Rota                                                     |
| ------- | ------ | -------------------------------------------------------- |
| Access  | 1 hora | —                                                        |
| Refresh | 1 año  | **sí**, en cada refresco: el anterior deja de servir     |

El cliente refresca solo cuando al access token le queda menos de un minuto, y entonces llama
a `tokens.save`. **Si `save` no escribe, pierdes el refresh token rotado** y mañana toda la
integración da `401` sin que nadie haya tocado nada. Es, con diferencia, el fallo más caro de
esta página.

Si `load` devuelve `null`, el cliente lanza `ConnectError` con código `invalid_token` y status
401: ese usuario no ha autorizado tu app todavía.

### Serializa el refresco por usuario

**No hay ventana de gracia.** Un refresh token ya rotado no vale «un ratito más»: reutilizarlo
invalida **toda la familia** de refresh tokens de esa conexión, y el usuario tiene que volver a
conectar. Es la defensa estándar contra el robo de tokens, y te afecta aunque nadie te robe
nada: si dos peticiones tuyas del mismo usuario refrescan a la vez, una gana y la otra reutiliza.

Si tu servidor puede empujar en paralelo para el mismo usuario —y casi todos pueden—, **pon un
cerrojo por usuario alrededor del refresco**: un advisory lock de Postgres, una fila con
`SELECT … FOR UPDATE`, lo que uses. El SDK no puede hacerlo por ti: no sabe cuántos procesos
tuyos hay.

### Errores del endpoint de token

Llegan como `ConnectError` con el código OAuth2 tal cual, **no** como `invalid_token`:

| `code`                   | Qué pasó                                                                  |
| ------------------------ | -------------------------------------------------------------------------- |
| `invalid_grant`          | El código de autorización no vale: caducado, ya usado o de otro cliente    |
| `invalid_request`        | Incluye el caso importante: **refresh token revocado o ya rotado**          |
| `invalid_client`         | `client_id` o `client_secret` mal                                          |
| `invalid_scope`          | Pediste un scope que tu app no tiene declarado                             |
| `unsupported_grant_type` | No debería pasarte usando el SDK                                           |

Cualquiera de ellos significa lo mismo de puertas afuera: **manda a ese usuario a reconectar**.
Reintentar no arregla ninguno.

## 4 · Qué pasa en la pantalla del usuario

El consentimiento es **web**. El usuario ve tu tarjeta —nombre, logo, dominio—, los permisos
que pides, y dos decisiones suyas:

- **El proyecto destino**: dónde aterrizan los ítems que no nombren proyecto.
- **`connect:projects`**, si lo pediste: puede desmarcarlo y conectar igual.

Por eso la autoridad efectiva de un token es la **intersección** de lo que el token lleva y lo
que la conexión concede, recalculada en cada petición. Si el usuario estrecha el
consentimiento desde sus ajustes, surte efecto en tu siguiente llamada sin que ningún token
tenga que caducar. Consulta lo que tienes de verdad con `me()`:

```ts
const info = await secretaria.me();
// { connectionId, scopes, defaultProject: { id, name } | null }
```

`me()` **no devuelve ni un dato del usuario**: ni nombre, ni correo, ni nada suyo. Devuelve lo
que necesitas para razonar sobre tus propios permisos. Consume 1 de cuota como cualquier otra
llamada, así que no lo pongas delante de cada `sync`: pregúntalo al conectar, y otra vez cuando
un error te diga que algo cambió.

## 5 · Desconectar

```ts
await secretaria.disconnect();
```

Tu app renuncia a la conexión. Es de buena educación cuando tu usuario desinstala la
integración por tu lado, y no te da ningún poder nuevo: **las tareas del usuario siguen donde
están**. El usuario puede revocarte desde sus ajustes en cualquier momento, y entonces recibes
`connection.revoked` ([`webhooks.md`](./webhooks.md)).

Reconectar más tarde **revive la misma conexión** y los enlaces se reencuentran solos: no
pierdes el mapeo por haber desconectado.
