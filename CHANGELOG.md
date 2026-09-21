# Changelog

Todas las versiones publicadas de `@nodus-development/secretaria-connect`.

El paquete sigue semver y arranca en `0.x`: mientras los únicos consumidores
seamos nosotros no se promete compatibilidad, y un cambio incompatible sube la
**minor** (que es lo que npm ya entiende: `^0.1.0` no salta a `0.2`).

El `1.0` tiene disparador y no fecha: sale cuando conecte el primer integrador
que no seamos nosotros. A partir de ahí, cualquier `1.x` habla con cualquier
`/api/connect` desplegado.

## 0.2.0

**BREAKING.** Cambia quién decide el proyecto destino de una tarea.

Hasta aquí el ítem podía traer `project` —un NOMBRE— y SecretarIA creaba ese
proyecto si no existía. En la práctica los integradores mandaban una constante,
así que el proyecto que el usuario elegía al conectar no recibía ni una tarea y
el trabajo le aterrizaba en un proyecto que él no había elegido. Ahora el
destino lo decide el usuario, entidad por entidad, y **no se crea ningún
proyecto desde fuera**.

- `ConnectItem.project` → **`ConnectItem.target`**: el id OPACO de tu entidad
  (`org_7f3a`), `[A-Za-z0-9._:-]`, máx. 100. Nunca un nombre visible.
- **`ConnectClient.createLinkSession(options)`** nuevo: devuelve una URL de un
  solo uso, válida 15 minutos, a la que **redirigir al usuario** para que elija
  proyecto. El `returnUrl` tiene que compartir origen con alguno de tus
  `redirect_uris` registrados.
- `ConnectionInfo.defaultProject` → **`ConnectionInfo.targets`**
  (`{target, linked}[]`). No trae el id ni el nombre del proyecto, a propósito.
- `SCOPES.PROJECTS` (`connect:projects`) **eliminado**. Pedirlo ahora falla.
- `ConnectErrorCode`: fuera `default_project_unavailable` (ya no existe: un
  destino que no se puede resolver degrada, no rompe), dentro
  `invalid_return_url`.

### Migrar desde 0.1.x

1. Quita `SCOPES.PROJECTS` de los scopes que pides. **Hay que reconectar**: los
   consentimientos viejos se revocan al desplegar el cambio.
2. Cambia `project: '<nombre fijo>'` por `target: '<id de tu entidad>'`.
3. Añade un botón que llame a `createLinkSession()` y redirija al usuario, uno
   por entidad que quieras enrutar.
4. Mientras una entidad no esté vinculada, sus tareas nacen **sin proyecto** y
   SecretarIA le pregunta al usuario a dónde van. Lo sabrás porque `project`
   sale en `skippedFields`.

## 0.1.1

Solo documentación: el código publicado es idéntico al de `0.1.0`.

- Guía del integrador completa en [`docs/`](./docs): alta, OAuth2, contrato de
  sembrado, webhooks, operación y **el deber de proyectar**.
- README con índice a la guía, el ejemplo de webhook con `express.raw` y la
  cabecera nombrada canónicamente (`SecretarIA-Signature`, no en minúsculas).
- Corregido el JSDoc de `ConnectItem.project`: omitirlo al **refrescar** no
  mueve la tarea al proyecto por defecto, sólo al **crear**.

## 0.1.0

Primera versión publicada.

- `createConnectClient`: `sync`, `syncMany`, `unlink`, `me` y `disconnect`,
  con refresco automático del access token (rotando el refresh).
- `verifyWebhook`: verifica la firma estilo Stripe (`t=…,v1=…`, tolerancia de
  300 s, varios `v1=`) y devuelve el evento ya tipado.
- `buildAuthorizeUrl` y `exchangeCode`: el baile OAuth2 + PKCE, con el
  `verifier` inyectable para runtimes sin aleatoriedad garantizada.
- Sin dependencias, ESM puro y todo sobre `crypto.subtle`: funciona igual en
  Node 18+, en un worker y en el runtime V8 de Convex sin `'use node'`.
