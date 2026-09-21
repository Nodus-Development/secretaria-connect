# Alta de una aplicación

El alta de aplicaciones en SecretarIA Connect es **manual**. No hay autoservicio, no hay
formulario y no existe ninguna ruta HTTP que registre clientes: las damos de alta nosotros
desde código de servidor, una a una.

No es una fase temporal a la espera de tener portal. Es el modelo de gobierno: como la lista
de aplicaciones es exactamente la que hemos aprobado, casi todo lo demás —revisión del nombre
y el logo, confianza en el `redirect_uri`, poder avisarte si algo se rompe— se resuelve
eligiendo a quién dejamos entrar en lugar de construyendo maquinaria para contener a quien ya
entró.

Para pedir el alta, escríbenos o abre una issue en
[este repositorio](https://github.com/Nodus-Development/secretaria-connect/issues).

## 1 · Lo que nos tienes que dar

| Dato                | Obligatorio | Para qué                                                                    |
| ------------------- | ----------- | --------------------------------------------------------------------------- |
| Nombre de la app    | sí          | Es lo que el usuario lee en la pantalla de consentimiento y en sus ajustes  |
| `logo_uri`          | no          | El icono de esa misma tarjeta                                               |
| `client_uri`        | no          | Enlace decorativo a tu web. **No** es identidad: es texto libre             |
| `redirect_uri`      | sí          | Adónde vuelve el `code`. Uno o varios                                       |
| URL del webhook     | no          | Sin ella no hay entregas: la integración funciona sólo de ida               |
| `contacts`          | **sí**      | Correos tuyos. Es por donde te avisamos, y por donde va el secreto de firma |
| Scopes que pides    | sí          | Ver §5                                                                      |
| ¿Es de desarrollo?  | sí          | Sólo un cliente marcado como de desarrollo puede registrar loopback (§3)    |

Los `contacts` son obligatorios de verdad. Si tu endpoint de webhook empieza a fallar, ese
correo es el único sitio al que podemos escribir; una app sin contacto es una app a la que no
se puede avisar de nada.

## 2 · Lo que te llevas

- `client_id` — público, viaja en la URL de autorización.
- `client_secret` — secreto. Se usa en el canje del código y en el refresco.
- `whsec_…` — el secreto con el que firmamos tus webhooks.

**El secreto de firma se entrega una sola vez**, a la dirección de `contacts`, y **no rota**.
Si se compromete, la respuesta es dar de alta la aplicación otra vez — lo que tumba la
integración de todos sus usuarios. Es una acción humana y deliberada, no un automatismo, y
por eso el secreto vive donde tú lo guardes y no en ninguna pantalla nuestra.

## 3 · Reglas del `redirect_uri`

| Regla                    | Detalle                                                                           |
| ------------------------ | --------------------------------------------------------------------------------- |
| Coincidencia **exacta**  | Cadena contra cadena. No hay comodines de ninguna clase                           |
| `https://` obligatorio   | Única excepción: host loopback en clientes de desarrollo                          |
| Esquemas custom **no**   | `miapp://callback` se rechaza. El consentimiento es web; la app nativa no participa |
| Sin fragmento            | Nada de `#…`. Tampoco `javascript:`, `data:` ni `vbscript:`                       |
| Varias URIs              | Se pueden registrar varias, y la petición tiene que nombrar explícitamente una    |

> **La trampa del loopback.** El puerto flexible de la RFC 8252 sólo se aplica a **IP
> literal**. `http://127.0.0.1:1234/cb` casa con cualquier puerto; `http://localhost:1234/cb`
> exige **ese** puerto exacto. Si registras un cliente de desarrollo, registra la IP, no el
> nombre — o pasarás una tarde buscando un `invalid_request` que no es tuyo.

No hay entorno de pruebas separado: el cliente de desarrollo va contra el mismo servidor, con
sus propios `client_id` y secreto de firma.

## 4 · Reglas de la URL del webhook

Se valida al registrar la aplicación y **no se vuelve a validar antes de cada envío**:

- `https://` obligatorio.
- Sin IP literal privada, sin `localhost`, sin hosts internos de la infraestructura.

Dos límites que preferimos escribir a esconder. El primero: la comprobación es **léxica sobre
el host literal**, porque el runtime donde corremos no resuelve DNS, así que un dominio que
apunte a una IP privada pasa el filtro — la defensa real es que el alta la aprueba una
persona. El segundo: si endurecemos las reglas más adelante, las apps ya registradas se
quedan con la URL que tenían.

Un cliente de desarrollo **no puede** declarar webhook, porque el loopback está prohibido
aquí y no hacemos excepciones. Sin URL registrada no hay entregas, y eso es todo: el resto de
la integración funciona igual, sólo que en un sentido.

## 5 · Scopes

Los scopes que puede pedir tu aplicación se fijan **en el alta**, no en tu código. Pedir en
la URL de autorización algo que no esté en esa lista se rechaza con `invalid_scope`.

| Scope              | Obligatorio | Qué habilita                                                          |
| ------------------ | ----------- | --------------------------------------------------------------------- |
| `connect:sync`     | sí          | Toda la superficie de escritura: `sync`, `sync-batch`, `unlink`       |
| `offline_access`   | sí          | Que el proveedor emita refresh token. Sin esto morirías a la hora     |

Los `redirect_uris` que registres gobiernan **dos** cosas: a dónde vuelve el `authorize` y qué
`returnUrl` acepta `createLinkSession()` — se compara el **origen**, no la URL entera. Si vas a
mandar al usuario a vincular entidades, registra el origen desde el que quieras recibirlo de
vuelta (ver [`vincular.md`](./vincular.md)).

No existe ningún scope de lectura, y no es un olvido: ver [`sync.md` §8](./sync.md#8--lo-que-no-existe-dicho-a-propósito).

## 6 · Lo que el alta no te da

- **No hay sello de «app verificada».** Con el alta cerrada, «verificada» y «existe» serían el
  mismo conjunto, y un sello que llevan todas las apps no informa de nada. El día que el alta
  deje de ser manual, el sello pasa a ser obligatorio antes de abrirla.
- **No hay panel de desarrollador**, ni de entregas, ni de métricas. Si necesitas depurar una
  entrega concreta, pásanos su identificador de entrega: los guardamos siete días.
- **No hay rotación de secretos** por tu cuenta.

## 7 · Lo que ve el usuario

Una tarjeta con el nombre de tu app, su logo y un **dominio**. Ese dominio no sale de un campo
que tú escribas libremente: en la pantalla de consentimiento se deriva del `redirect_uri` de
la petición, que es el único campo del alta que no se puede falsear gratis —es adonde va a
parar el `code`, así que mentir en él es perder el flujo—. En los ajustes del usuario, donde
ya hay sesión y se lee la fila registrada, se usa el host de `client_uri` y, si no lo diste,
el del primer `redirect_uri`.

Por eso conviene que tu `redirect_uri` viva en el dominio con el que tus usuarios te
reconocen.
