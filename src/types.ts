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
   * NOMBRE del proyecto destino, no id. Se crea si no existe, y se resuelve
   * solo entre los proyectos PROPIOS del usuario.
   * Si lo omites cae en el proyecto que el usuario eligio al conectar.
   * Exige el scope `connect:projects`; sin él, el campo se ignora y el ítem
   * cae en el destino por defecto (sale en `skippedFields`).
   */
  project?: string;

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
   * Dónde caen los ítems sin `project`. `null` = el usuario archivó ese
   * proyecto; tus ítems sin `project` van a dar 409.
   */
  defaultProject: { id: string; name: string } | null;
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
   * 409 — el ítem no trae `project` y el proyecto destino ya no está. Los
   * ítems que SÍ traen `project` del mismo lote entran igual.
   */
  | 'default_project_unavailable'
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
