# El deber de proyectar

> **El ítem que mandas a una conexión sólo puede contener lo que esa persona ve en tu
> sistema.**

Es la única obligación del contrato que SecretarIA **no puede comprobar**, y por eso está
escrita aquí en vez de validada en el servidor: no conocemos tu modelo de permisos. Si tu
sistema tiene roles, visibilidad por organización, campos internos o comentarios privados,
quien sabe qué puede ver cada destinatario eres tú y sólo tú.

Una tarea sembrada por tu app aparece en la cuenta **personal** del usuario, con el título que
tú escribiste, y él la lee sin más contexto. Lo que pongas ahí está publicado.

## Por qué no basta con «mandar el ticket»

Este es el fallo real, no uno inventado para la documentación. Lo encontramos escribiendo
nuestro propio piloto.

El sistema de tickets de origen tiene cuatro estados: `open`, `completed`,
`completed_internal` y `cancelled`. El tercero significa «hecho por dentro, pero todavía sin
desplegar», y es **invisible para el cliente**: él ve ese ticket como `open`. El producto
defiende esa asimetría con un módulo de funciones puras y un test que prohíbe saltárselo.

El mapeo obvio se la salta en tres líneas:

```ts
// MAL
return {
  externalId: t.id,
  title: `TCK-${t.number} · ${t.title}`,
  done: t.status !== 'open',      // ① marca como hecho lo que el cliente ve abierto
  externalStatus: t.status,       // ② le filtra el literal `completed_internal`
};
```

Si el destinatario es un compañero interno, no pasa nada. Si algún día es un **cliente**, esas
dos líneas le cuentan algo que el producto entero se esfuerza en no contarle, y encima le
marcan como cerrada una tarea cuyo ticket él sigue viendo abierto.

La versión correcta pasa la fila por la misma proyección que ya usa tu interfaz, **antes** de
construir el ítem:

```ts
// BIEN
const visible = projectTicketRow(t, viewer);   // la herramienta ya existía

return {
  externalId: t.id,
  title: `TCK-${t.number} · ${visible.title}`,
  done: visible.status !== 'open',
  externalStatus: visible.status,
};
```

La regla práctica: **no construyas el ítem desde la fila de tu base de datos, constrúyelo
desde lo que tu propia interfaz le enseñaría a esa persona.** Si ya tienes una función que
proyecta para pintar una pantalla, esa es la función.

## `TCK-42` a secas es un título perfectamente válido

No estás obligado a mandar el asunto del cliente, ni las notas, ni nada descriptivo. Un
identificador y una URL de vuelta bastan para que la integración funcione: el usuario hace
clic y lee el detalle **en tu sistema**, donde tus permisos siguen aplicándose.

Es la mitigación oficial de un problema que el contrato no puede resolver por ti, y conviene
entender por qué existe:

- Las tareas viven en la cuenta **personal** del usuario.
- **Sobreviven a la revocación**: si mañana se va de tu organización y revoca tu app, se lleva
  el histórico de títulos que le sembraste.
- `unlink()` borra el enlace, **no** la tarea. Ninguna operación tuya puede hacer desaparecer
  trabajo suyo — que es exactamente el poder que decidimos no darte.

Si ese arrastre te preocupa, la palanca la tienes tú, y es esta página: manda menos.

## Traducir estados es decisión de producto, no un detalle

El contrato expone `done: boolean` y un `externalStatus` **opaco** a propósito. No hay tríada
canónica, no hay mapeo automático y no vamos a adivinar qué significan tus estados.

Del piloto, como ejemplo y no como norma. **La columna de la izquierda es el estado ya
proyectado para el destinatario**, no la fila cruda: si proyectas primero, este mapeo es
correcto para cualquiera; si lo aplicas a `t.status` a secas, vuelves a filtrar
`completed_internal` a quien no debe verlo.

| Estado **proyectado**                            | Al sembrar                                          |
| ------------------------------------------------ | ---------------------------------------------------- |
| `open`                                           | `done: false`                                       |
| `completed` · `completed_internal` · `cancelled` | `done: true`, con `externalStatus` cargando el matiz |

`cancelled` cuenta como hecha porque deja de ser trabajo de nadie: dejarla abierta sería
basura en la lista de alguien que no la generó, y `externalStatus` conserva la diferencia para
quien abra la tarea.

Y a la vuelta, la decisión simétrica: al recibir `task.completed`, el piloto **no** pone
`completed` sino `completed_internal`, porque «el usuario dice que ya está» y «desplegado» no
son lo mismo. Esa elección le compra una garantía que no había pedido —un cierre disparado
desde fuera no puede notificar a un cliente— y es el tipo de decisión que sólo tú puedes
tomar.

Piensa los cuatro casos antes de escribir el mapeo: qué cierra, qué reabre, qué se queda
fuera, y quién lo va a leer.
