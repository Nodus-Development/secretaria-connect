# Sembrar y mantener ítems

Un **ítem** de tu sistema (un ticket, un expediente, una incidencia) se convierte en una
**tarea** del usuario. Tú siembras y refrescas; la tarea es suya.

Tres principios explican todo lo que sigue:

1. **La tarea es del usuario; el enlace es tuyo.** Refrescas lo que él no haya tocado. En
   cuanto lo toca, ese campo queda **adoptado** y no lo vuelves a pisar nunca.
2. **Lo único que cruza en los dos sentidos es la compleción**, y lo que la protege no es la
   adopción sino el desempate por `doneAt`.
3. **La tarea siempre sobrevive.** Nada de esta superficie borra trabajo del usuario.

## 1 · `sync`

```ts
const r = await secretaria.sync({
  externalId: 'a3f9…',                         // tu id estable
  title: 'TCK-42 · Revisar el contrato',
  done: false,
  externalKey: 'TCK-42',
  externalUrl: 'https://tu-sistema.example/tickets/a3f9',
});
```

`POST /api/connect/sync`. Requiere `connect:sync`. Crea la tarea la primera vez y la refresca
después; la clave es `(conexión, externalId)`, así que **es idempotente por construcción** y
no hay `Idempotency-Key` que gestionar. Tu `externalId` es único **por conexión**: el mismo
ticket empujado a dos usuarios son dos enlaces que no se ven.

### `ConnectItem`

| Campo            | Tipo                            | Notas                                                                  |
| ---------------- | ------------------------------- | ---------------------------------------------------------------------- |
| `externalId`     | `string` (≤ 200)                | Obligatorio. Tu identificador estable, no el visible                   |
| `title`          | `string`                        | Obligatorio                                                            |
| `done`           | `boolean`                       | Obligatorio. La traducción desde tus estados es **tuya**. Ver [`proyectar.md`](./proyectar.md) |
| `doneAt`         | `number` ms                     | Cuándo cambió de verdad **en tu sistema**. Ver el aviso de abajo       |
| `notes`          | `string`                        |                                                                        |
| `priority`       | `'high' \| 'medium' \| 'low'`   | Al crear, sin él: `medium`                                             |
| `deadline`       | `number` ms \| `null`           | `null` **borra** la fecha. Omitir es «no opino»                        |
| `deadlineType`   | `'exact' \| 'date'`             | Con `deadline`, por defecto `date`. Ver abajo                          |
| `target`         | `string`                        | Id **opaco** de tu entidad, no un nombre. `[A-Za-z0-9._:-]`, máx. 100 (§3) |
| `externalStatus` | `string` (≤ 100)                | Tu vocabulario, tal cual, para que el usuario lo lea                   |
| `externalKey`    | `string` (≤ 100)                | Tu identificador visible: `TCK-42`                                     |
| `externalUrl`    | `string` (≤ 2000)               | El enlace de vuelta a tu sistema                                       |

El cuerpo entero no puede pasar de **64 KB**. Un campo que no conocemos se rechaza con
`unknown_field` en vez de ignorarse en silencio.

`title` y `notes` **no tienen tope propio**: se guardan tal cual y el único límite es el del
cuerpo. Los demás campos de texto sí lo tienen, y pasarse es `invalid_field`, no un recorte
silencioso.

`deadlineType` dice cómo se lee la fecha: **`date`** es de día entero (vence cuando acaba ese
día) y **`exact`** lleva hora (vence en ese instante). Si mandas `deadline` sin `deadlineType`,
se asume `date`.

> **`doneAt` es el campo que todo el mundo olvida.** No es `Date.now()`: es cuándo pasó de
> verdad en tu sistema. Un push cuyo `doneAt` sea **anterior** al último cambio de estado que
> SecretarIA conoce se descarta y te lo decimos en `skippedFields`. Sin eso, un reintento
> tardío tuyo reabriría una tarea que el usuario ya había vuelto a cerrar. En un reintento,
> **reutiliza el `doneAt` original**: reaplicarlo es idempotente, porque el empate se aplica y
> sólo pierde lo estrictamente más viejo.

### `SyncResult`

```ts
{
  taskId: string;
  externalId: string;
  created: boolean;
  projectId: string | null;
  appliedFields: string[];   // lo que entró en ESTA llamada
  skippedFields: string[];   // lo que NO entró en ESTA llamada
  adoptedFields: string[];   // ESTADO COMPLETO: lo que ya no vuelve a entrar nunca
}
```

Los tres arrays hablan el mismo vocabulario, y es **cerrado**: `'title'`, `'notes'`,
`'deadline'`, `'priority'`, `'project'` y `'done'`. Nada más. (`deadlineType` viaja con
`deadline` y no aparece por separado; `doneAt` tampoco: lo que se reporta es `'done'`.)

`appliedFields` y `skippedFields` son el delta de esta llamada. `adoptedFields` es el **estado
entero**, no el incremento: viene completo en cada respuesta, así que puedes pintar «este
campo ya no se sincroniza» sin acumular memoria propia.

`skippedFields` dice **qué** no entró, no por qué. Las tres causas se distinguen así:

| El campo saltado…                        | Causa                                        |
| ---------------------------------------- | --------------------------------------------- |
| está también en `adoptedFields`          | el usuario lo tocó y ya es suyo (§2)         |
| es `'project'` y no está en `adoptedFields` | esa entidad no está vinculada todavía (§3) |
| es `'done'`                              | tu `doneAt` era más viejo que el último cambio |

Léelo. Una integración que no mira `skippedFields` cree que su título entró y miente en
silencio.

## 2 · Adopción: cuando el usuario toca un campo

Campos adoptables: `title`, `notes`, `deadline`, `priority`, `project`.

Si el usuario edita uno de ellos en su tarea —a mano, desde su asistente o desde su propia API
personal—, ese campo queda adoptado **para siempre** y tus siguientes `sync` lo respetan. Sale
en `skippedFields` de esa llamada y en `adoptedFields` de todas.

No es un fallo tuyo y no hay forma de revertirlo desde fuera: es el contrato. El usuario
mandó.

## 3 · El proyecto destino lo elige el usuario

**Tú no eliges el proyecto y no puedes crear ninguno.** Lo que mandas es a qué **entidad tuya**
pertenece el ítem, y el usuario decide, una entidad cada vez, a qué proyecto suyo va:

```ts
await client.sync({ externalId: 'TCK-42', title: '…', done: false, target: 'org_7f3a' });
```

- `target` es un id **opaco tuyo**: `[A-Za-z0-9._:-]`, máximo 100. No es un nombre para leer, y
  el servidor lo rechaza con `422` si lo parece («Soporte Nodus» tiene un espacio).
- Si esa entidad está **vinculada**, la tarea nace en el proyecto que el usuario eligió.
- Si **no** lo está —o si omites el campo—, la tarea nace **sin proyecto** y SecretarIA le
  pregunta al usuario a dónde va. No es un error: la respuesta es `200` y `project` sale en
  `skippedFields`. **Ésa es tu señal** para pedir una vinculación ([`vincular.md`](./vincular.md)).
- Al **refrescar**, omitir `target` significa «no opino»: la tarea no se mueve.
- Si el usuario ya movió esa tarea a mano, el campo queda adoptado y tú dejas de re-enrutarla
  para siempre (§2). Vincular después arrastra las que él no haya tocado, y sólo ésas.
- Si vincula una entidad a un proyecto que luego archiva, sus tareas vuelven a caer sin
  proyecto. Tampoco es un error: degradar, no bloquear.

**Mandas `target` y lees `project`.** La asimetría es deliberada: `project` es el nombre del
campo de la **tarea** que se ha visto afectado, y es el que aparece en `appliedFields`,
`skippedFields` y `adoptedFields`.

> **Viniendo de `0.1.x`**: existía un campo `project` con el **nombre** del proyecto, y
> SecretarIA lo creaba si no existía. Se retiró porque acabó decidiendo el tercero dónde
> aterrizaba el trabajo del usuario: el proyecto que él elegía al conectar no recibía ni una
> tarea. Con él se fueron el scope `connect:projects` y el error
> `default_project_unavailable`.

## 4 · Lotes

```ts
import { isSyncItemError } from '@nodus-development/secretaria-connect';

for (let i = 0; i < items.length; i += 50) {
  const results = await secretaria.syncMany(items.slice(i, i + 50));
  for (const r of results) {
    if (isSyncItemError(r)) { /* r.externalId, r.error.code */ continue; }
    /* r.taskId, r.adoptedFields… */
  }
}
```

`POST /api/connect/sync-batch`. **Tope 50 ítems**; pasarse es `422 batch_too_large`. Las
respuestas vienen **en el mismo orden** que mandaste, y el éxito es **parcial**: un ítem puede
fallar dentro de un lote que por lo demás entró.

La cuota cuesta **un ítem por ítem**, y se cobra entera **antes** de aplicar nada. O sea que un
lote que no quepa en tu cuota falla **completo** con `429` —no se parte, no entran los
primeros— y `SyncItemError` nunca lleva `rate_limited`. Reintenta el lote entero cuando pase el
`Retry-After`.

## 5 · Desenlazar

```ts
await secretaria.unlink('a3f9…');   // 204 siempre
```

Tu app olvida el mapeo. **La tarea del usuario sobrevive intacta**: el contrato no tiene forma
de borrar su trabajo desde fuera, y eso es una propiedad, no una carencia. Un `externalId` que
no existe responde `204` igual, para que no puedas sondear qué enlaces hay.

Es limpieza tuya, así que **no deja lápida y no emite ningún evento**: no esperes un
`link.removed` por haber llamado a `unlink`, y puedes volver a sembrar ese mismo `externalId`
cuando quieras — se creará una tarea nueva. La lápida es sólo del usuario (§6.1).

## 6 · Errores

| Código                        | Status | Qué significa                                                                    |
| ----------------------------- | ------ | --------------------------------------------------------------------------------- |
| `invalid_token`               | 401    | Token inexistente, caducado, conexión revocada o app apagada. En `/api/connect/*` es **un solo código**: no distinguimos la causa |
| `connection_incomplete`       | 409    | Hay token pero el usuario no terminó de conectar. Mándale a reconectar           |
| `insufficient_scope`          | 403    | Te falta `connect:sync`                                                          |
| `link_removed_by_user`        | 409    | **El usuario desenlazó esta tarea a propósito** (§6.1)                           |
| `invalid_field`               | 422    | Un campo con forma incorrecta; el mensaje dice cuál                              |
| `unknown_field`               | 422    | Mandaste un campo que no existe                                                  |
| `missing_field`               | 422    | Falta uno obligatorio                                                            |
| `invalid_json`                | 422    | El cuerpo no es JSON                                                             |
| `body_too_large`              | 422    | Más de 64 KB                                                                     |
| `batch_too_large`             | 422    | Más de 50 ítems                                                                  |
| `rate_limited`                | 429    | Cuota agotada. Trae `Retry-After` en segundos                                    |
| `internal_error`              | 500    | Nuestro. Reintenta                                                               |

En el SDK llegan como `ConnectError`, con `code`, `status` y `retryAfter?`. El tipo
`ConnectErrorCode` es una unión **abierta**: pueden aparecer códigos nuevos sin romperte la
compilación, así que tu `switch` necesita un `default`.

Dos códigos que fabrica el propio SDK y no verás en ninguna respuesta nuestra:

- **`http_error`** — una respuesta de error sin nuestro sobre. Normalmente un intermediario:
  un proxy, un balanceador, una página de error.
- **`internal_error`** con un mensaje que menciona `baseUrl` — una respuesta correcta que no
  trae envoltorio `data`. Casi siempre es que `baseUrl` no apunta a donde crees.

Y los del endpoint de token (`invalid_grant`, `invalid_request`…) no pasan por esta tabla: ver
[`oauth.md`](./oauth.md#errores-del-endpoint-de-token).

El sobre de error es siempre `{ "error": { "code": …, "message": … } }`, y el de éxito
`{ "data": … }`.

### 6.1 · El 409 que no es un error tuyo

`link_removed_by_user` es una **decisión del usuario que el contrato te está comunicando**.
Tiene código propio precisamente para no depender de que alguien lea esta página.

- **`link_removed_by_user`**: el usuario desenlazó esa tarea. Hay lápida: no se crea nada, no
  se reintenta nunca, y sólo él puede levantarla desde su tarea. Marca el ítem por tu lado y
  deja de empujarlo.
Reintentarlo es gastar cuota para que te vuelvan a decir lo mismo.

## 7 · Cuotas

| Bucket        | Por minuto            | Por día |
| ------------- | --------------------- | ------- |
| Por conexión  | 120 (ráfaga de 60)    | 10.000  |
| Por app       | 1.200 (ráfaga de 600) | 100.000 |

Se cobra **por ítem**, después de autenticar y antes de escribir. El bucket por conexión es
personal: con una integración que abanique el mismo ítem a varios usuarios, cada uno paga el
suyo.

`429` siempre trae `Retry-After` en segundos, y en el SDK lo tienes en `error.retryAfter`.
**Respétalo tal cual**: si lo agotado es el cubo diario puede ser de horas, y recortarlo por tu
cuenta sólo consigue que te lo vuelvan a decir.

## 8 · Lo que no existe, dicho a propósito

- **No hay lecturas** (esta sección es la §8 a la que apunta [`alta.md`](./alta.md)). Ni listar
  tareas, ni leer una, ni refrescar la que tú mismo sembraste.
  El token de app abre `/api/connect/*` y nada más; la API personal del usuario (`/api/v1`,
  con sus claves `sk_live_`) **no** está a su alcance.
- **No hay exportar**: nada convierte una tarea de SecretarIA en un ítem tuyo.
- **No hay borrar**: `unlink` olvida el mapeo, no la tarea.
- **No hay CORS**: estas rutas no responden preflight y no emiten `Access-Control-*`. Un token
  de app en JavaScript de navegador es un token filtrado. Llámalas desde tu servidor.

El diseño se sostiene sin lecturas porque la respuesta de `sync` ya te dice todo lo que
necesitabas saber: `adoptedFields` es el estado completo.
