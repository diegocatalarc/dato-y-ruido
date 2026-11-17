// Verifica el sitio del podcast en Chrome headless vía CDP y guarda capturas.
// Uso: node capturar.mjs [carpeta-del-sitio] [carpeta-de-capturas]

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const candidatos = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter((candidato) => candidato && existsSync(candidato));

if (candidatos.length === 0) {
  console.error("No se encontró un navegador Chromium. Define CHROME_PATH.");
  process.exit(2);
}

const sitio = resolve(process.argv[2] ?? "sitio");
const salida = resolve(process.argv[3] ?? "capturas");
const puerto = Number(process.env.CDP_PORT ?? 9444);
const perfil = mkdtempSync(join(tmpdir(), "dato-y-ruido-"));
mkdirSync(salida, { recursive: true });

const chrome = spawn(
  candidatos[0],
  [
    "--headless=new",
    "--no-sandbox",
    "--in-process-gpu",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-scrollbars",
    `--user-data-dir=${perfil}`,
    `--remote-debugging-port=${puerto}`,
    "about:blank",
  ],
  { stdio: "ignore" },
);

const limpiar = () => {
  try {
    chrome.kill("SIGKILL");
  } catch {
    // El navegador ya terminó.
  }
  try {
    rmSync(perfil, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch {
    // Chrome puede seguir escribiendo en el perfil temporal.
  }
};
process.on("exit", limpiar);

async function esperarCdp() {
  for (let intento = 0; intento < 50; intento += 1) {
    try {
      const version = await (await fetch(`http://127.0.0.1:${puerto}/json/version`)).json();
      if (version.webSocketDebuggerUrl) return;
    } catch {
      // Chrome todavía arranca.
    }
    await sleep(200);
  }
  throw new Error(`Chrome no expuso CDP en ${puerto}`);
}

await esperarCdp();
const objetivos = await (await fetch(`http://127.0.0.1:${puerto}/json/list`)).json();
const pagina = objetivos.find((objetivo) => objetivo.type === "page");
if (!pagina) throw new Error("No hay pestaña abierta");

const socket = new WebSocket(pagina.webSocketDebuggerUrl);
await new Promise((abrir, fallar) => {
  socket.addEventListener("open", abrir, { once: true });
  socket.addEventListener("error", fallar, { once: true });
});

let siguienteId = 1;
const pendientes = new Map();
const oyentes = new Map();
const errores = [];
let cargada = false;

socket.addEventListener("message", (evento) => {
  const mensaje = JSON.parse(evento.data);
  if (mensaje.method === "Page.loadEventFired") cargada = true;
  if (mensaje.method === "Runtime.exceptionThrown") {
    errores.push(mensaje.params.exceptionDetails?.exception?.description ?? "excepción");
  }
  if (mensaje.method === "Runtime.consoleAPICalled" && mensaje.params.type === "error") {
    errores.push(mensaje.params.args.map((arg) => arg.value ?? arg.description).join(" "));
  }
  const esperando = oyentes.get(mensaje.method);
  if (esperando) {
    oyentes.delete(mensaje.method);
    for (const oyente of esperando) oyente(mensaje.params);
  }
  if (mensaje.id && pendientes.has(mensaje.id)) {
    const { resolver, rechazar } = pendientes.get(mensaje.id);
    pendientes.delete(mensaje.id);
    if (mensaje.error) rechazar(new Error(mensaje.error.message));
    else resolver(mensaje.result);
  }
});

function enviar(method, params = {}) {
  const id = siguienteId++;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolver, rechazar) => pendientes.set(id, { resolver, rechazar }));
}

function esperarEvento(method, limiteMs = 20000) {
  return new Promise((resolver, rechazar) => {
    const temporizador = setTimeout(() => rechazar(new Error(`Timeout esperando ${method}`)), limiteMs);
    const oyente = (params) => {
      clearTimeout(temporizador);
      resolver(params);
    };
    const lista = oyentes.get(method) ?? [];
    lista.push(oyente);
    oyentes.set(method, lista);
  });
}

async function evaluar(expresion) {
  const resultado = await enviar("Runtime.evaluate", {
    expression: expresion,
    awaitPromise: true,
    returnByValue: true,
  });
  if (resultado.exceptionDetails) {
    throw new Error(resultado.exceptionDetails.exception?.description ?? "Error de evaluación");
  }
  return resultado.result.value;
}

async function captura(nombre) {
  const datos = await enviar("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(salida, nombre), Buffer.from(datos.data, "base64"));
  console.log(`  captura ${nombre}`);
}

async function ir(url) {
  cargada = false;
  const espera = esperarEvento("Page.loadEventFired");
  await enviar("Page.navigate", { url });
  await espera;
  await sleep(600);
}

async function desplazar(fraccion) {
  await evaluar(
    `document.documentElement.style.scrollBehavior='auto';window.scrollTo(0,(document.documentElement.scrollHeight-window.innerHeight)*${fraccion});true`,
  );
  await sleep(450);
}

const comprobaciones = [];
const comprobar = (nombre, ok, detalle = "") => {
  comprobaciones.push({ nombre, ok });
  console.log(`${ok ? "ok   " : "FALLA"} ${nombre}${detalle ? ` — ${detalle}` : ""}`);
};

await enviar("Page.enable");
await enviar("Runtime.enable");
await enviar("Emulation.setDeviceMetricsOverride", {
  width: 1280,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
});

const portada = `file://${join(sitio, "index.html")}`;
await ir(portada);

const datosPortada = await evaluar(`(() => {
  const remotos = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /^https?:/i.test(n));
  return {
    titulo: document.title,
    lang: document.documentElement.lang,
    viewport: document.querySelector('meta[name="viewport"]')?.content ?? '',
    remotos,
    tarjetas: document.querySelectorAll('.tarjeta').length,
    enlaceEpisodio: document.querySelector('.tarjeta-enlace')?.getAttribute('href') ?? '',
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  };
})()`);

comprobar("portada: título", datosPortada.titulo.length > 10, datosPortada.titulo);
comprobar("portada: idioma es", datosPortada.lang === "es");
comprobar("portada: viewport", /width=device-width/i.test(datosPortada.viewport));
comprobar("portada: sin recursos de red", datosPortada.remotos.length === 0, datosPortada.remotos.join(", "));
comprobar("portada: tarjetas", datosPortada.tarjetas >= 1, `${datosPortada.tarjetas}`);
comprobar("portada: enlace a episodio", datosPortada.enlaceEpisodio.includes("episodio/"), datosPortada.enlaceEpisodio);

await captura("01-portada.png");
await desplazar(0.55);
await captura("02-portada-episodios.png");

const enlaceEpisodio = new URL(datosPortada.enlaceEpisodio, portada);
const episodio = enlaceEpisodio.pathname.endsWith(".html") ? enlaceEpisodio.href : `${enlaceEpisodio.href}index.html`;
await ir(episodio);

const datosEpisodio = await evaluar(`(() => {
  const remotos = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /^https?:/i.test(n));
  return {
    titulo: document.title,
    remotos,
    secciones: document.querySelectorAll('.seccion-guion').length,
    entradillaSinNumero: (() => {
      const primera = document.querySelector('.seccion-guion');
      return Boolean(primera?.classList.contains('entradilla') && !primera.querySelector('.marca-seccion'));
    })(),
    numeradas: document.querySelectorAll('.marca-seccion').length,
    fuentes: document.querySelectorAll('.lista-fuentes li').length,
    citas: document.querySelectorAll('a.cita').length,
    reproductor: document.querySelector('audio[src]') ? 'audio' : document.querySelectorAll('#voz button').length === 3 ? 'voz' : 'ninguno',
    escaleta: document.querySelectorAll('.escaleta li').length,
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    alto: document.documentElement.scrollHeight,
  };
})()`);

comprobar("episodio: sin recursos de red", datosEpisodio.remotos.length === 0, datosEpisodio.remotos.join(", "));
comprobar("episodio: secciones", datosEpisodio.secciones >= 5, `${datosEpisodio.secciones}`);
comprobar("episodio: entradilla sin número", datosEpisodio.entradillaSinNumero);
comprobar("episodio: secciones numeradas", datosEpisodio.numeradas === 5, `${datosEpisodio.numeradas}`);
comprobar("episodio: fuentes", datosEpisodio.fuentes >= 5, `${datosEpisodio.fuentes}`);
comprobar("episodio: citas enlazadas", datosEpisodio.citas >= 10, `${datosEpisodio.citas}`);
comprobar("episodio: reproductor", datosEpisodio.reproductor !== "ninguno", datosEpisodio.reproductor);
comprobar("episodio: escaleta", datosEpisodio.escaleta === 5, `${datosEpisodio.escaleta}`);
comprobar("episodio: sin desbordamiento", datosEpisodio.scrollWidth <= datosEpisodio.innerWidth + 1);

await captura("03-episodio.png");
await desplazar(0.32);
await captura("04-episodio-guion.png");
await evaluar("document.querySelector('.fuentes')?.scrollIntoView({block:'start'});true");
await sleep(400);
await captura("05-episodio-fuentes.png");

await enviar("Emulation.setDeviceMetricsOverride", {
  width: 390,
  height: 844,
  deviceScaleFactor: 2,
  mobile: true,
});
await ir(episodio);
const movil = await evaluar(`({
  scrollWidth: document.documentElement.scrollWidth,
  innerWidth: window.innerWidth,
  reproductor: document.querySelector('audio[src]') ? 'audio' : document.querySelectorAll('#voz button').length,
})`);
comprobar("móvil: sin desbordamiento", movil.scrollWidth <= movil.innerWidth + 1, JSON.stringify(movil));
comprobar("móvil: reproductor visible", Boolean(movil.reproductor));
await captura("06-movil-episodio.png");
await ir(portada);
await captura("07-movil-portada.png");

comprobar("sin errores de consola", errores.length === 0, errores.join(" | "));

const fallidas = comprobaciones.filter((entrada) => !entrada.ok);
console.log(fallidas.length === 0 ? "\nVerificación correcta." : `\n${fallidas.length} comprobación(es) fallida(s).`);

socket.close();
chrome.kill("SIGKILL");
process.exit(fallidas.length > 0 ? 1 : 0);
