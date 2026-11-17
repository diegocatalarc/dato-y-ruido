// Audio del episodio.
//
// - TTS de DeepSeek: solo para los idiomas publicados (no incluye español).
//   Se pide PCM (24 kHz, 16 bits, mono), se concatena y se envuelve en un WAV.
// - Voz local de macOS (`say`): sirve para español y no cuesta nada.
// - Si hay ffmpeg se convierte a MP3; si no, se queda en WAV (lo reproducen los
//   navegadores, pero los directorios de podcast prefieren MP3).

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { IDIOMAS_TTS } from "./cliente.mjs";

const FRECUENCIA = 24000;
const MAX_CARACTERES_TTS = 9000;

/** Punto de entrada: decide el modo y devuelve el nombre del archivo o null. */
export async function crearAudio({ modo, idioma, cliente, voz, guion, dir, log }) {
  if (modo === "no") return null;

  const idiomaBase = (idioma ?? "es").split("-")[0].toLowerCase();
  const soportaTts = IDIOMAS_TTS.includes(idiomaBase);
  const puedeDecir = process.platform === "darwin" && existeBinario("say");

  let efectivo = modo;
  if (modo === "auto") {
    efectivo = soportaTts ? "tts" : puedeDecir ? "say" : null;
    if (!soportaTts) {
      log(
        `el TTS de DeepSeek no publica ${idiomaBase}; se usa la voz local${puedeDecir ? "" : " (no disponible en este sistema)"}`,
      );
    }
  }

  if (efectivo === "tts" && !soportaTts) {
    log(
      `AVISO: el TTS de DeepSeek solo cubre ${IDIOMAS_TTS.join(", ")}. Para ${idiomaBase} usa --audio say o publica en inglés.`,
    );
    return null;
  }
  if (efectivo === "say" && !puedeDecir) {
    log("AVISO: la voz local solo está disponible en macOS con el comando say.");
    return null;
  }
  if (!efectivo) return null;

  const texto = aTextoHablado(guion);
  if (texto.length < 200) {
    log("el guion es demasiado corto para generar audio");
    return null;
  }

  try {
    if (efectivo === "tts") return await conTts({ cliente, voz, texto, dir, log });
    return await conVozLocal({ texto, dir, log });
  } catch (error) {
    log(`el audio falló sin detener la publicación: ${error.message}`);
    return null;
  }
}

/** Convierte markdown en texto para leer en voz alta. */
function aTextoHablado(guion) {
  return guion
    .replace(/^##\s+/gm, "\n\n")
    .replace(/\[(\d{1,2})\]/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function conTts({ cliente, voz, texto, dir, log }) {
  const trozos = trocear(texto, MAX_CARACTERES_TTS);
  log(`TTS de DeepSeek (${voz}): ${trozos.length} fragmento(s), ${texto.length} caracteres`);
  const pcm = [];
  for (const [indice, trozo] of trozos.entries()) {
    const audio = await cliente.tts(trozo, { voz, formato: "pcm" });
    pcm.push(audio);
    log(`  fragmento ${indice + 1}/${trozos.length} · ${(audio.length / 1024).toFixed(0)} KB`);
  }
  const wav = join(dir, "audio.wav");
  writeFileSync(wav, envolverWav(Buffer.concat(pcm)));
  return aMp3SiSePuede(wav, dir, log);
}

async function conVozLocal({ texto, dir, log }) {
  const voz = elegirVozEspanola();
  log(`voz local de macOS${voz ? ` (${voz})` : " (voz por defecto)"}`);
  const temporal = mkdtempSync(join(tmpdir(), "dato-y-ruido-voz-"));
  const entrada = join(temporal, "guion.txt");
  const wav = join(dir, "audio.wav");
  writeFileSync(entrada, texto, "utf8");
  try {
    const args = ["-r", "120", "-f", entrada, "-o", wav, "--data-format=LEI16@22050"];
    if (voz) args.unshift("-v", voz);
    execFileSync("say", args, { stdio: "pipe" });
  } finally {
    rmSync(temporal, { recursive: true, force: true });
  }
  log("audio generado con la voz del sistema");
  return aMp3SiSePuede(wav, dir, log);
}

/** Divide el texto por párrafos sin superar el máximo por petición. */
function trocear(texto, maximo) {
  const parrafos = texto.split(/\n{2,}/);
  const trozos = [];
  let actual = "";
  for (const parrafo of parrafos) {
    if ((actual + "\n\n" + parrafo).length > maximo && actual) {
      trozos.push(actual.trim());
      actual = parrafo;
    } else {
      actual = actual ? `${actual}\n\n${parrafo}` : parrafo;
    }
  }
  if (actual.trim()) trozos.push(actual.trim());
  return trozos;
}

/** Envuelve PCM 16-bit mono 24 kHz en un contenedor WAV. */
function envolverWav(pcm) {
  const cabecera = Buffer.alloc(44);
  cabecera.write("RIFF", 0);
  cabecera.writeUInt32LE(36 + pcm.length, 4);
  cabecera.write("WAVE", 8);
  cabecera.write("fmt ", 12);
  cabecera.writeUInt32LE(16, 16);
  cabecera.writeUInt16LE(1, 20); // PCM
  cabecera.writeUInt16LE(1, 22); // mono
  cabecera.writeUInt32LE(FRECUENCIA, 24);
  cabecera.writeUInt32LE(FRECUENCIA * 2, 28);
  cabecera.writeUInt16LE(2, 32);
  cabecera.writeUInt16LE(16, 34);
  cabecera.write("data", 36);
  cabecera.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([cabecera, pcm]);
}

/** Convierte a MP3 si hay ffmpeg; si no, deja el WAV. */
function aMp3SiSePuede(wav, dir, log) {
  if (!existeBinario("ffmpeg")) {
    log("ffmpeg no está instalado: el audio queda en WAV");
    return "audio.wav";
  }
  const mp3 = join(dir, "audio.mp3");
  execFileSync("ffmpeg", ["-y", "-i", wav, "-codec:a", "libmp3lame", "-b:a", "96k", mp3], { stdio: "pipe" });
  rmSync(wav, { force: true });
  log("audio convertido a MP3 (96 kbps)");
  return "audio.mp3";
}

function existeBinario(nombre) {
  try {
    execFileSync("which", [nombre], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/** Busca una voz española instalada en macOS, con preferencia por voces naturales. */
function elegirVozEspanola() {
  if (process.platform !== "darwin") return null;
  const preferidas = ["Mónica", "Paulina", "Jorge", "Diego", "Soledad", "Angelica", "Carlos", "Juan"];
  try {
    const listado = execFileSync("say", ["-v", "?"], { encoding: "utf8" });
    const voces = listado
      .split("\n")
      .map((linea) => /^(.+?)\s{2,}es_[A-Z]{2}\b/.exec(linea.trim())?.[1] ?? null)
      .filter(Boolean);
    if (voces.length === 0) return null;
    const elegida = preferidas.find((nombre) => voces.some((voz) => voz.startsWith(nombre)));
    return elegida ?? voces[0];
  } catch {
    return null;
  }
}

export { aTextoHablado, envolverWav, trocear };
