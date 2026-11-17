// Genera (o regenera) el audio de un episodio ya escrito, sin repetir la producción.
//
// Uso:
//   node proceso/api/narrar.mjs --episodio 001-la-hora-que-cuenta --modo say
//   DEEPSEEK_API_KEY=... node proceso/api/narrar.mjs --episodio 002-... --modo tts --voz stella
//
// Modos: auto (por defecto) | edge | tts | say | no

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { crearCliente } from "./cliente.mjs";
import { crearAudio, aTextoHablado } from "./audio.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

function opcion(nombre, porDefecto) {
  const posicion = args.indexOf(`--${nombre}`);
  if (posicion === -1) return porDefecto;
  const valor = args[posicion + 1];
  return valor === undefined || valor.startsWith("--") ? true : valor;
}

const raiz = resolve(opcion("raiz", join(AQUI, "..", "..")));
const referencia = opcion("episodio");
if (!referencia || referencia === true) {
  console.error("Falta --episodio. Ejemplo: --episodio 001-la-hora-que-cuenta");
  process.exit(2);
}

const contenedor = join(raiz, "contenidos", "episodios");
const carpetas = existsSync(contenedor)
  ? readdirSync(contenedor, { withFileTypes: true })
      .filter((entrada) => entrada.isDirectory())
      .map((entrada) => entrada.name)
  : [];
const carpeta = carpetas.find((nombre) => nombre === referencia || nombre.endsWith(`-${referencia}`));
if (!carpeta) {
  console.error(`No existe el episodio «${referencia}». Disponibles: ${carpetas.join(", ") || "ninguno"}`);
  process.exit(1);
}

const dir = join(contenedor, carpeta);
const rutaJson = join(dir, "episodio.json");
const rutaGuion = join(dir, "guion.md");
if (!existsSync(rutaGuion)) {
  console.error(`Falta ${rutaGuion}`);
  process.exit(1);
}

const metadata = existsSync(rutaJson) ? JSON.parse(readFileSync(rutaJson, "utf8")) : {};
const porDefecto = existsSync(join(raiz, "podcast.json"))
  ? JSON.parse(readFileSync(join(raiz, "podcast.json"), "utf8"))
  : {};
const idioma = opcion("idioma", metadata.idioma ?? porDefecto.idioma ?? "es");
const modo = opcion("modo", "auto");
const voz = opcion("voz", "es-CL-LorenzoNeural");
const guion = readFileSync(rutaGuion, "utf8");

console.log(`Audio · ${carpeta}`);
console.log(`Texto: ${aTextoHablado(guion).length} caracteres`);

let cliente = null;
if (modo === "tts") {
  try {
    cliente = crearCliente({ baseUrl: process.env.DEEPSEEK_BASE_URL });
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}
const archivo = await crearAudio({
  modo,
  idioma,
  cliente,
  voz,
  guion,
  dir,
  log: (mensaje) => console.log(`  ${mensaje}`),
});

if (!archivo) {
  console.error("No se generó audio (modo descartado o fallo registrado arriba).");
  process.exit(1);
}

metadata.audio = archivo;
metadata.idioma = idioma;

// La duración publicada debe ser la del audio real, no una estimación.
try {
  const { execFileSync } = await import("node:child_process");
  const segundos = Number(
    execFileSync("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=nw=1:nk=1",
      join(dir, archivo),
    ], { encoding: "utf8" }).trim(),
  );
  if (Number.isFinite(segundos) && segundos > 30) {
    metadata.duracionMin = Math.round(segundos / 60);
    console.log(`  duración real del audio: ${(segundos / 60).toFixed(1)} min`);
  }
} catch {
  // Sin ffprobe se conserva la duración estimada por palabras.
}
writeFileSync(rutaJson, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
console.log(`  episodio.json actualizado con «${archivo}»`);

const { spawnSync } = await import("node:child_process");
const construccion = spawnSync(process.execPath, ["construir.mjs"], { cwd: raiz, stdio: "inherit" });
process.exit(construccion.status ?? 0);
