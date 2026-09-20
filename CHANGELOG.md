# Changelog

Todas las versiones publicadas de `@nodus-development/secretaria-connect`.

El paquete sigue semver y arranca en `0.x`: mientras los únicos consumidores
seamos nosotros no se promete compatibilidad, y un cambio incompatible sube la
**minor** (que es lo que npm ya entiende: `^0.1.0` no salta a `0.2`).

El `1.0` tiene disparador y no fecha: sale cuando conecte el primer integrador
que no seamos nosotros. A partir de ahí, cualquier `1.x` habla con cualquier
`/api/connect` desplegado.

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
