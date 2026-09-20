# Operación

Qué pasa cuando algo va mal, quién se entera y cómo cambia esto con el tiempo. Nada de lo que
hay aquí es un contrato ni unos términos de servicio: es cómo funciona hoy la casa, escrito
para que no lo descubras un martes.

## 1 · El interruptor

Cada aplicación tiene un interruptor por nuestro lado. Si lo apagamos, sus tokens dejan de
servir: todas las llamadas a `/api/connect/*` responden `401 invalid_token`, sin distinguir la
causa.

Su límite, escrito en vez de escondido: **apagar así no impide que sigas obteniendo tokens**
por el endpoint de token. Los obtienes y no te sirven para nada. No es un corte en la puerta
de entrada, y no vamos a contarlo como si lo fuera — el token de app no tiene ninguna otra
superficie que abrir, así que alcanza.

Existe además un interruptor **global** de toda la superficie Connect. Si se apaga, se apaga
para todos y con el mismo `401`.

No lo apagamos sin motivo, y si lo hacemos con tu app, te escribimos (§3).

## 2 · Si tu endpoint falla

El detalle de reintentos está en [`webhooks.md` §5](./webhooks.md#5--reintentos). Lo que
importa aquí:

- Los eventos que no consigamos entregar **se pierden**. No hay cola infinita, no hay reenvío
  manual y no hay panel donde recuperarlos.
- **Un endpoint caído no revoca nada.** Tu integración sigue viva, tus usuarios siguen
  conectados, y el siguiente evento se intenta igual.
- Con **3 fallos consecutivos** —agotados sus cuatro intentos— escribimos a los `contacts` de
  tu app. Una entrega buena pone el contador a cero, y no repetimos el aviso en 24 horas.

Se interrumpe a quien puede arreglar algo: eso eres tú, no el usuario. **Al usuario no se le
avisa** de que tu webhook está caído, porque no hay nada que él pueda hacer.

Guardamos siete días de intentos de entrega. Si necesitas saber qué pasó con uno concreto,
pásanos su `deliveryId`.

## 3 · Si hay un incidente con tu app

Apagamos el interruptor, escribimos a `contacts` y cortamos los tokens vivos. En ese orden y
por ese canal.

Lo que **no** hacemos es avisar a los usuarios. Es el mismo criterio de siempre: se interrumpe
a quien puede arreglar algo. Conviene saber hasta dónde llega ese criterio, así que lo
decimos: el caso que deja descubierto es una exposición real de datos del usuario. Está
acotado, porque tu token no puede leer nada suyo — lo máximo que una app comprometida puede
haber visto es lo que ella misma sembró —, pero no está cubierto.

## 4 · Cómo cambia el contrato

- **`/api/connect` no retira nada.** Añade. Lo viejo deja de anunciarse en esta documentación
  y sigue respondiendo. No hay segmento de versión en la ruta y no lo va a haber.
- **El paquete lleva su propio semver y está en `0.x`**: mientras los únicos integradores
  seamos nosotros, un cambio incompatible sube la *minor*. El `1.0` sale cuando conecte el
  primer integrador que no seamos nosotros, y a partir de ahí cualquier `1.x` habla con
  cualquier `/api/connect` desplegado.
- El canal público es el [`CHANGELOG.md`](../CHANGELOG.md).
- Si alguna vez hubiera que retirar algo de verdad, te escribimos a `contacts` antes. Podemos
  permitírnoslo porque el alta es manual y sabemos exactamente quiénes sois.

## 5 · Cosas sin resolver, dichas como tales

- **No hay términos para desarrolladores.** Esto es documentación técnica, no un contrato.
  Redactar condiciones legales para dos pilotos de casa sería trabajo por delante del
  problema; el día que abramos el alta, cambia.
- **No hay entorno de pruebas.** Un cliente de desarrollo va contra el mismo servidor, con sus
  propias credenciales. Y como un cliente de desarrollo tampoco puede declarar webhook
  ([`alta.md` §4](./alta.md#4--reglas-de-la-url-del-webhook)), las dos frases juntas dicen algo
  que conviene leer antes de empezar: **el camino de vuelta sólo se puede probar con el cliente
  real y una URL pública**. Lo que sí puedes probar en local es la verificación de firma, con
  una entrega capturada y `verifyWebhook`.
- **El SDK no deja acotar la red.** No se puede inyectar un `fetch` ni pasar un `signal`, así
  que no hay forma de ponerle un timeout ni de falsear el transporte en tus tests: lo que puedes
  hacer es envolver tus llamadas en tu propio `Promise.race`. Es una carencia conocida, no una
  postura.
- **No hay rotación de secretos de firma.** Ver [`alta.md` §2](./alta.md#2--lo-que-te-llevas).
- **No hay tope de proyectos** creados por conexión. La única contención es que nos conocemos
  y que el usuario puede archivar. Ver [`sync.md` §3](./sync.md#3--el-proyecto-destino).

## 6 · Soporte

Issues en [este repositorio](https://github.com/Nodus-Development/secretaria-connect/issues)
para lo que sea del SDK; el canal por el que te dimos de alta para lo que sea de tu app.

Cuando escribas sobre una entrega concreta, el `deliveryId` nos ahorra media conversación.
