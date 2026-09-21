/**
 * El contrato de SecretarIA Connect, escrito una sola vez.
 *
 * Los nombres y las unidades son LOS DEL DTO de la API pública a propósito:
 * quien lea la guía del integrador y luego esto no debe encontrarse dos
 * vocabularios para la misma cosa.
 */

// ───────────────────────────────────────────────────────────────────────────
// 1 · Lo que el integrador empuja
// ───────────────────────────────────────────────────────────────────────────

/**
 * Un ítem del sistema de origen (un ticket, un expediente) tal y como viaja
 * hacia SecretarIA.
 *
 * DEBER DE PROYECTAR: el ítem tiene que llegar ya proyectado como lo vería su
 * destinatario. SecretarIA no conoce el modelo de permisos de tu sistema y no
 * puede filtrar por ti: lo que mandes es lo que el usuario va a leer en su
 * tarea.
 */
export interface ConnectItem {
  /**
   * Opaco para SecretarIA. El espacio de nombres es la conexión, no la app:
   * dos instalaciones de la misma app nunca colisionan.
   */
  externalId: string;

  title: string;

  /** El único campo que viaja en los dos sentidos. `false` REABRE la tarea. */
  done: boolean;

  /**
   * ms epoch: cuándo cambió `done` EN ORIGEN.
   *
   * Opcional, y es el campo que se olvida. Sin él tu push no desempata: gana
   * por orden de llegada, y la garantía de entrega es at-least-once SIN ORDEN,
   * así que un reintento tardio puede reabrir algo que ya habias cerrado.
   *
   * Calcúlalo UNA VEZ, en el instante del cambio, y reutiliza ese valor en
   * todos los reintentos de ese push. Lo que nunca es correcto es recalcularlo
   * dentro del reintento, porque un push viejo ganaría por parecer reciente.
   * El SDK no puede ponerlo por ti: en el runtime V8 de Convex `Date.now()`
   * está congelado.
   */
  doneAt?: number;

  notes?: string;

  /** Tres literales. Si tu sistema tiene cuatro, el mapeo es tuyo. */
  priority?: 'high' | 'medium' | 'low';

  /** ms epoch. `null` borra la fecha. */
  deadline?: number | null;
  deadlineType?: 'exact' | 'date';

  /**
   * A qué ENTIDAD tuya pertenece este ítem: la organización, el buzón, la sede,
   * lo que tu producto reparta. Es un id OPACO tuyo (`org_7f3a`), nunca un
   * nombre visible, y solo admite `[A-Za-z0-9._:-]` (máx. 100).
   *
   * SecretarIA NO crea proyectos y no interpreta este valor: lo busca entre las
   * vinculaciones que el USUARIO aprobó. Si esa entidad está vinculada, la
   * tarea nace en su proyecto; si no lo está —o si omites el campo—, la tarea
   * nace SIN proyecto y SecretarIA le pregunta al usuario a dónde va.
   *
   * Cuando no está vinculada lo sabrás porque `project` sale en
   * `skippedFields`: esa es tu señal para llamar a `createLinkSession()` y
   * mandar al usuario a vincularla.
   *
   * Al REFRESCAR, omitirlo significa "no opino": la tarea no se mueve.
   */
  target?: string;

  /**
   * Opaco: SecretarIA lo guarda y lo pinta, jamás lo interpreta. Aquí es donde
   * sobrevive tu vocabulario ('cancelled', 'completed_internal').
   */
  externalStatus?: string;

  /** Lo que el usuario ve como procedencia: «TCK-42» y el enlace para volver. */
  externalKey?: string;
  externalUrl?: string;
}

/**
 * La respuesta de un `sync`. `skippedFields` es la parte que hay que leer: es
 * donde te enteras de que tu título NO entró porque el usuario lo habia
 * reescrito, en vez de creer que sí y no volver a mirarlo nunca.
 */
export interface SyncResult {
  taskId: string;
  externalId: string;
  created: boolean;
  projectId: string | null;
  appliedFields: string[];
  /**
   * DELTA de esta llamada: descartados por adopción del usuario, por falta de
   * scope, o por `doneAt` más viejo que el último cambio de estado que
   * SecretarIA conoce.
   */
  skippedFields: string[];
  /**
   * ESTADO: los campos que el usuario ha hecho suyos y que ya no vas a poder
   * pisar nunca más. Viene entero en cada respuesta, así que no tienes que
   * acumularlo tú para saber que esta desincronizado.
   */
  adoptedFields: string[];
}

// ───────────────────────────────────────────────────────────────────────────
// 2 · La conexión
// ───────────────────────────────────────────────────────────────────────────

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  /** ms epoch */
  expiresAt: number;
  scopes: string[];
}

/**
 * Lo que devuelve `me()`. NO trae ni un dato del usuario, y no es un olvido: el
 * token de app no puede leer nada suyo. Si necesitas saber con quien hablas,
 * eso lo sabe tu lado de la conexión, no este.
 */
export interface ConnectionInfo {
  connectionId: string;
  /** Intersección token ∩ conexión: lo que REALMENTE puedes hacer ahora mismo. */
  scopes: string[];
  /**
   * Tus entidades que SecretarIA conoce (las que has nombrado en algún `sync`)
   * y si el usuario las ha vinculado ya con un proyecto.
   *
   * No trae el id ni el nombre del proyecto, y no es un olvido: saber si algo
   * tiene destino te sirve para pedir la vinculación; saber CUÁL es no te sirve
   * para nada y es información del usuario.
   */
  targets: Array<{ target: string; linked: boolean }>;
}

/** Lo que pides para mandar al usuario a vincular una de tus entidades. */
export interface LinkSessionOptions {
  /** El mismo id opaco que mandas en `ConnectItem.target`. */
  target: string;
  /**
   * Nombre legible de esa entidad, para que el usuario sepa qué está
   * vinculando («Acme S.L.»). Opcional; SecretarIA lo sanea y lo recorta a 80.
   * Sin él, la pantalla enseña el `target` crudo.
   */
  label?: string;
  /**
   * A dónde vuelve el usuario al terminar. Tiene que compartir ORIGEN con
   * alguno de tus `redirect_uris` registrados —la ruta y la query son tuyas, y
   * ahí es donde te llevas tu propio estado—. Si no, `invalid_return_url`.
   */
  returnUrl: string;
}

/**
 * El billete. Es de UN SOLO USO y caduca en 15 minutos: hay que **redirigir al
 * usuario** a `url` (no descargarla desde tu servidor, que la gastaría).
 */
export interface LinkSession {
  url: string;
  /** ms epoch. */
  expiresAt: number;
}

// ───────────────────────────────────────────────────────────────────────────
// 3 · Los modos de fallo
// ───────────────────────────────────────────────────────────────────────────

/**
 * Los codigos que tienen significado de negocio. La unión está ABIERTA a
 * propósito: el servidor también responde códigos de validación
 * (`invalid_field`, `missing_field`, `batch_too_large`) y un `internal_error`,
 * y un SDK que no supiera nombrarlos no podría pasártelos.
 */
export type ConnectErrorCode =
  /**
   * 409 — hay token pero el usuario no terminó de conectar. No reintentes:
   * mándale a reconectar.
   */
  | 'connection_incomplete'
  /**
   * 422 — el `returnUrl` de `createLinkSession()` no comparte origen con
   * ninguno de tus `redirect_uris` registrados (o usa un esquema prohibido).
   */
  | 'invalid_return_url'
  /** 403 — típicamente por no haber pedido `connect:sync`. */
  | 'insufficient_scope'
  /**
   * 409 — EL USUARIO desenlazó este ítem a propósito. No reintentes y no
   * vuelvas a mandarlo: no hay tarea que actualizar y no se va a crear otra.
   * Solo el usuario puede levantarlo, desde su tarea.
   */
  | 'link_removed_by_user'
  | 'invalid_token'
  | 'rate_limited'
  | (string & {});

/** La forma que toma un fallo DENTRO de un lote, en vez de lanzarse. */
export interface SyncItemError {
  externalId: string;
  error: { code: ConnectErrorCode; message: string };
}

// ───────────────────────────────────────────────────────────────────────────
// 4 · Lo que llega de vuelta
// ───────────────────────────────────────────────────────────────────────────

/**
 * Cuatro eventos y no más. NO existe `task.updated`: SecretarIA no te cuenta lo
 * que el usuario escribe en su tarea, solo si la cerró o la reabrió.
 */
export type ConnectEvent =
  | {
      type: 'task.completed';
      deliveryId: string;
      connectionId: string;
      externalId: string;
      done: true;
      occurredAt: number;
    }
  | {
      type: 'task.reopened';
      deliveryId: string;
      connectionId: string;
      externalId: string;
      done: false;
      occurredAt: number;
    }
  /**
   * `unlinked`: EL USUARIO desenlazó. Deja de mandar ese `externalId` — si lo
   * mandas te va a responder 409 `link_removed_by_user`, así que el contrato te
   * lo hace cumplir en vez de pedírtelo por escrito.
   * `task_deleted`: el usuario borró la tarea. Ahí no hay lápida: si vuelves a
   * hacer `sync`, se crea.
   */
  | {
      type: 'link.removed';
      deliveryId: string;
      connectionId: string;
      externalId: string;
      reason: 'unlinked' | 'task_deleted';
      occurredAt: number;
    }
  /**
   * Una sola entrega por conexión revocada, no una por tarea. Llega ANTES de
   * que los tokens dejen de valer.
   */
  | {
      type: 'connection.revoked';
      deliveryId: string;
      connectionId: string;
      occurredAt: number;
    };

export type ConnectEventType = ConnectEvent['type'];
