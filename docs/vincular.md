# Vincular tus entidades con proyectos del usuario

SecretarIA **no crea proyectos** y tú **no eliges** dónde aterrizan las tareas. Lo que haces es
decir a qué entidad tuya pertenece cada ítem (`target`) y ofrecerle al usuario un botón para que
él decida a qué proyecto suyo va esa entidad.

Mientras no lo haya decidido, las tareas de esa entidad nacen **sin proyecto** y SecretarIA se lo
pregunta a él. No se pierde nada y no hay error.

## El viaje

```
 Tu interfaz                 Tu servidor              SecretarIA            El usuario
 ───────────                 ───────────              ──────────            ──────────
 [Vincular] ───────────────► createLinkSession()
                             { target, label,
                               returnUrl }
                                   │
                                   └──── POST /api/connect/link-session ──►
                             ◄──── { url, expiresAt } ───────────────────────
                                   │
 redirige al navegador ◄────────────┘
        │
        └──────────────────────────────────────────► /oauth/vincular?ls=…
                                                          elige proyecto ──► ✓
        ◄───────────────── returnUrl ──────────────────────────────────────
```

```ts
const { url } = await client.createLinkSession({
  target: 'org_7f3a',                 // el MISMO que mandas en ConnectItem.target
  label: 'Acme S.L.',                 // opcional; lo que el usuario reconoce
  returnUrl: 'https://tu-servidor.example/vuelta?org=7f3a',
});
// Redirige el NAVEGADOR del usuario a `url`. No la descargues tú.
```

## Cuatro reglas que se aprenden a golpes

1. **La URL es de un solo uso y caduca en 15 minutos.** Pídela cuando el usuario pulse el botón,
   no al pintar la pantalla, y no la guardes.
2. **Redirige al usuario, no la llames desde tu servidor.** Un `fetch` desde el backend gasta el
   billete y deja al usuario con un enlace muerto.
3. **`returnUrl` tiene que compartir ORIGEN con alguno de tus `redirect_uris` registrados.** La
   ruta y la query son tuyas, y ahí es donde te llevas tu propio estado. Si tu `redirect_uri`
   registrado es un endpoint de servidor, el `returnUrl` también tiene que colgar de ese origen:
   normalmente eso significa un rebote tuyo que acaba mandando al usuario a la pantalla que te
   interese. Si no casa, `422 invalid_return_url`.
4. **El `label` es texto tuyo en una pantalla ajena.** Se sanea y se recorta a 80 caracteres.
   Sin él, el usuario ve tu identificador crudo, que es opaco y feo a propósito.

## Qué sabes después

`me()` te dice qué entidades tuyas conoce SecretarIA y cuáles están vinculadas:

```ts
const info = await client.me();
// info.targets → [ { target: 'org_7f3a', linked: true }, { target: 'org_9c1b', linked: false } ]
```

**No te dice a qué proyecto.** Ni el id ni el nombre, y no es un olvido: saber si algo tiene
destino te sirve para pedir la vinculación; saber cuál es no te sirve para nada y es información
del usuario.

Una entidad aparece en esa lista en cuanto la nombras en un `sync`, aunque nadie la haya
vinculado. Así el usuario puede verla y elegirle proyecto sin que tú se lo pidas.

## Deshacer

El usuario cambia o quita el destino desde **Ajustes → Apps conectadas**, sin pasar por ti. Ni
cambiar ni desvincular mueve las tareas que ya están creadas: lo que cambia es dónde nacen las
siguientes.
