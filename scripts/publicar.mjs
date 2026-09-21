#!/usr/bin/env node
/**
 * Gestor de publicación del paquete. `npm start`.
 *
 * Existe porque publicar en npm es IRREVERSIBLE —una versión publicada no se
 * puede reemplazar, sólo despublicar durante 72 h y nunca reutilizar su
 * número— y porque las cuatro comprobaciones que evitan un desastre son
 * siempre las mismas y siempre se olvida alguna: que el árbol esté limpio, que
 * la versión no esté ya publicada, que el CHANGELOG hable de ella y que lo que
 * va dentro del tarball sea lo que crees.
 *
 * No publica nada por su cuenta: diagnostica, comprueba y, si todo está en
 * orden, pide que escribas la versión a mano antes de hacer el único gesto que
 * no se puede deshacer.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const ROJO = '\x1b[31m';
const VERDE = '\x1b[32m';
const AMBAR = '\x1b[33m';
const GRIS = '\x1b[90m';
const NEGRITA = '\x1b[1m';
const FIN = '\x1b[0m';

/** Ejecuta y devuelve la salida. `null` si falla: aquí fallar es un dato. */
function intentar(comando, args, opciones = {}) {
  try {
    return execFileSync(comando, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      ...opciones,
    }).trim();
  } catch {
    return null;
  }
}

/** Ejecuta enseñando la salida. Lanza si falla. */
function correr(comando, args) {
  execFileSync(comando, args, { stdio: 'inherit' });
}

async function main() {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const version = pkg.version;
  const nombre = pkg.name;
  const tag = `v${version}`;

  console.log(`\n${NEGRITA}${nombre}${FIN} ${GRIS}·${FIN} publicar ${NEGRITA}${version}${FIN}\n`);

  // ── Diagnóstico ──────────────────────────────────────────────────────────
  const rama = intentar('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  const sucio = intentar('git', ['status', '--porcelain']);
  const sinEmpujar = intentar('git', ['rev-list', '--count', '@{u}..HEAD']);
  const tagLocal = intentar('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`]) !== null;
  const tagRemoto = (intentar('git', ['ls-remote', '--tags', 'origin', tag]) ?? '') !== '';

  const publicadas = intentar('npm', ['view', nombre, 'versions', '--json']);
  // Sin red no se puede saber, y eso NO es lo mismo que «no está publicada»:
  // se dice y se bloquea la publicación, en vez de adivinar.
  const listaPublicadas = publicadas ? JSON.parse(publicadas) : null;
  const yaPublicada = listaPublicadas?.includes(version) ?? null;
  const ultima = intentar('npm', ['view', nombre, 'version']);

  const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  const changelogAlDia = changelog.includes(`## ${version}`);

  const quien = intentar('npm', ['whoami']);

  const comprobaciones = [
    [rama === 'main', `rama ${rama}`, 'se publica desde main'],
    [!sucio, 'árbol limpio', 'hay cambios sin commitear: el tag no coincidiría con lo publicado'],
    [
      sinEmpujar === '0',
      'sincronizado con origin',
      `${sinEmpujar} commit(s) sin empujar: el CI publicaría otra cosa`,
    ],
    [changelogAlDia, `CHANGELOG habla de ${version}`, `falta la sección «## ${version}»`],
    [
      yaPublicada === false,
      `${version} libre en npm (última: ${ultima ?? '?'})`,
      yaPublicada === null
        ? 'no se ha podido consultar npm (¿sin red?)'
        : `${version} YA está publicada: una versión no se reutiliza, sube el número`,
    ],
    [!tagRemoto, `tag ${tag} libre en origin`, `el tag ${tag} ya existe en origin`],
  ];

  console.log(`${NEGRITA}Estado${FIN}`);
  let bloqueado = false;
  for (const [ok, bien, mal] of comprobaciones) {
    if (ok) {
      console.log(`  ${VERDE}✓${FIN} ${bien}`);
    } else {
      bloqueado = true;
      console.log(`  ${ROJO}✗${FIN} ${mal}`);
    }
  }
  console.log(
    quien
      ? `  ${VERDE}✓${FIN} npm: sesión de ${quien}`
      : `  ${AMBAR}·${FIN} npm: sin sesión ${GRIS}(sólo hace falta para publicar a mano)${FIN}`,
  );
  if (tagLocal && !tagRemoto) {
    console.log(`  ${AMBAR}·${FIN} el tag ${tag} existe en local y no en origin`);
  }

  // ── Menú ─────────────────────────────────────────────────────────────────
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    console.log(`\n${NEGRITA}Qué hacemos${FIN}`);
    console.log(`  ${NEGRITA}1${FIN}  Comprobar sin publicar ${GRIS}(typecheck, tests, build, contenido del tarball)${FIN}`);
    console.log(`  ${NEGRITA}2${FIN}  Publicar por CI ${GRIS}(empuja el tag ${tag}; el workflow publica con procedencia)${FIN}`);
    console.log(`  ${NEGRITA}3${FIN}  Publicar a mano ${GRIS}(npm publish desde aquí, con tu código de 2FA)${FIN}`);
    console.log(`  ${NEGRITA}4${FIN}  Salir`);

    const opcion = (await rl.question('\n> ')).trim();

    if (opcion === '1') {
      return comprobar();
    }

    if (opcion !== '2' && opcion !== '3') {
      console.log('\nNada hecho.');
      return;
    }

    if (bloqueado) {
      console.log(
        `\n${ROJO}Hay algo por arreglar antes de publicar.${FIN} Mira las cruces de arriba.`,
      );
      return;
    }

    comprobar();

    if (opcion === '2') {
      console.log(
        `\nEsto crea el tag ${NEGRITA}${tag}${FIN} y lo empuja. El workflow` +
          ` ${GRIS}.github/workflows/publish.yml${FIN} publica ${NEGRITA}${version}${FIN} en npm.`,
      );
      console.log(
        `${GRIS}Requiere el publicador dado de alta en npmjs.com → el paquete → Settings →` +
          ` Trusted Publisher (Nodus-Development / secretaria-connect / publish.yml).${FIN}`,
      );
      console.log(`${AMBAR}Publicar es irreversible: esa versión no se podrá reutilizar.${FIN}`);
      const confirma = await rl.question(`\nEscribe ${NEGRITA}${tag}${FIN} para continuar: `);
      if (confirma.trim() !== tag) {
        console.log('\nNada hecho.');
        return;
      }
      if (!tagLocal) correr('git', ['tag', '-a', tag, '-m', `${nombre} ${version}`]);
      correr('git', ['push', 'origin', tag]);
      console.log(
        `\n${VERDE}Tag empujado.${FIN} Sigue la ejecución con:\n  gh run watch -R Nodus-Development/secretaria-connect`,
      );
      return;
    }

    // Opción 3 · a mano
    if (!quien) {
      console.log(`\n${ROJO}No hay sesión de npm.${FIN} Entra con:\n  npm login\ny vuelve a ejecutar.`);
      return;
    }
    console.log(
      `\nEsto publica ${NEGRITA}${version}${FIN} en npm desde esta máquina,` +
        ` ${NEGRITA}sin procedencia${FIN} (la firma de origen sólo la da el CI).`,
    );
    console.log(`${AMBAR}Publicar es irreversible: esa versión no se podrá reutilizar.${FIN}`);
    const confirma = await rl.question(`\nEscribe ${NEGRITA}${version}${FIN} para continuar: `);
    if (confirma.trim() !== version) {
      console.log('\nNada hecho.');
      return;
    }
    const otp = (await rl.question('Código de 2FA (Enter si no lo pide): ')).trim();
    correr('npm', ['publish', '--access', 'public', ...(otp ? ['--otp', otp] : [])]);
    console.log(`\n${VERDE}Publicada ${version}.${FIN}`);
    console.log(
      `Queda el tag por crear, para que el repo diga lo mismo que npm:\n` +
        `  git tag -a ${tag} -m "${nombre} ${version}" && git push origin ${tag}`,
    );
  } finally {
    rl.close();
  }
}

/** Las tres puertas del CI, más lo que de verdad va a viajar dentro del tarball. */
function comprobar() {
  console.log(`\n${NEGRITA}Comprobando${FIN}`);
  correr('npm', ['run', 'typecheck']);
  correr('npm', ['test']);
  correr('npm', ['run', 'build']);
  console.log(`\n${NEGRITA}Lo que iría dentro del paquete${FIN}`);
  correr('npm', ['pack', '--dry-run']);
}

await main();
