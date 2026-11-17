// Orquestador del podcast ejecutado con la API de DeepSeek.
// Dirección → Investigación → Redacción → Edición → Publicación, con artefactos en disco.
//
// Uso:
//   DEEPSEEK_API_KEY=... node proceso/api/episodio.mjs --tema "el 4,7 % de desempleo" --numero 2
//
// Opciones:
//   --tema <texto>        tema o cifra del episodio (obligatorio)
//   --numero <n>          número de episodio (por defecto, siguiente libre)
//   --slug <texto>        identificador de carpeta (por defecto, derivado del tema)
//   --fecha <AAAA-MM-DD>  fecha de publicación (por defecto, hoy)
//   --idioma <código>     idioma del guion (por defecto, es)
//   --modelo <nombre>     deepseek-flash (por defecto) o deepseek-v4-pro
//   --audio <modo>        auto | edge | tts | say | no (por defecto, auto)
//   --voz <nombre>        es-CL-LorenzoNeural (por defecto), otra voz neuronal, o stella/tide para TTS
//   --base-url <url>      endpoint alternativo (pruebas)
//   --raiz <ruta>         raíz del proyecto (pruebas)
//   --sin-construir       no regenera el sitio al terminar
//   --simulacro           no llama a la API: valida el flujo con datos de ejemplo

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { crearCliente } from "./cliente.mjs";
import * as prompts from "./prompts.mjs";
import { crearAudio } from "./audio.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);

function opcion(nombre, porDefecto) {
  const posicion = args.indexOf(`--${nombre}`);
  if (posicion === -1) return porDefecto;
  const valor = args[posicion + 1];
  return valor === undefined || valor.startsWith("--") ? true : valor;
}

function bandera(nombre) {
  return args.includes(`--${nombre}`);
}

const raiz = resolve(opcion("raiz", join(AQUI, "..", "..")));
const tema = opcion("tema");
if (!tema || tema === true) {
  console.error("Falta --tema. Ejemplo: --tema \"el 4,7 % de desempleo de septiembre\"");
  process.exit(2);
}

const fecha = opcion("fecha", new Date().toISOString().slice(0, 10));
const idioma = opcion("idioma", "es");
const modelo = opcion("modelo", "deepseek-flash");
const modoAudio = opcion("audio", "auto");
const voz = opcion("voz", "es-CL-LorenzoNeural");
const simulacro = bandera("simulacro");
const construirAlFinal = !bandera("sin-construir");
const topeBusquedas = Number(opcion("max-busquedas", 8));
const topeLecturas = Number(opcion("max-lecturas", 10));

const contenedor = join(raiz, "contenidos", "episodios");
const numero = Number(opcion("numero", siguienteNumero()));
const slug = opcion("slug", derivarSlug(tema));
const dirEpisodio = join(contenedor, `${String(numero).padStart(3, "0")}-${slug}`);

function siguienteNumero() {
  if (!existsSync(contenedor)) return 1;
  const numeros = readdirSync(contenedor, { withFileTypes: true })
    .filter((entrada) => entrada.isDirectory())
    .map((entrada) => Number.parseInt(entrada.name.slice(0, 3), 10))
    .filter((valor) => Number.isFinite(valor));
  return numeros.length ? Math.max(...numeros) + 1 : 1;
}

function derivarSlug(texto) {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42)
    .replace(/-+$/g, "") || "episodio";
}

function escribir(ruta, contenido) {
  mkdirSync(dirname(ruta), { recursive: true });
  writeFileSync(ruta, contenido.endsWith("\n") ? contenido : `${contenido}\n`, "utf8");
}

/** Extrae el primer objeto JSON de una respuesta, tolerando cercas de código. */
function leerJson(texto) {
  const limpio = texto.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const inicio = limpio.indexOf("{");
  const fin = limpio.lastIndexOf("}");
  if (inicio === -1 || fin === -1 || fin <= inicio) {
    throw new Error(`La respuesta no es JSON: ${limpio.slice(0, 200)}…`);
  }
  return JSON.parse(limpio.slice(inicio, fin + 1));
}

function validarEscaleta(escaleta) {
  const fallos = [];
  for (const campo of ["titulo", "subtitulo", "tesis", "angulo", "secciones", "pistas"]) {
    if (!escaleta[campo]) fallos.push(`falta «${campo}»`);
  }
  if (!Array.isArray(escaleta.secciones) || escaleta.secciones.length !== 5) {
    fallos.push("debe haber exactamente 5 secciones");
  } else {
    const nombres = ["El titular", "De dónde sale", "Qué esconde", "Cómo se usa bien", "Cierre"];
    escaleta.secciones.forEach((seccion, indice) => {
      if (!seccion?.nombre || !seccion.nombre.includes(nombres[indice].split(" ")[0])) {
        fallos.push(`la sección ${indice + 1} debe ser «${nombres[indice]}»`);
      }
      if (typeof seccion?.minutos !== "number") fallos.push(`la sección ${indice + 1} no tiene minutos`);
    });
    const total = escaleta.secciones.reduce((suma, seccion) => suma + (seccion.minutos ?? 0), 0);
    if (total < 12 || total > 18) fallos.push(`la duración suma ${total} minutos; debe estar entre 12 y 18`);
  }
  if (!Array.isArray(escaleta.pistas) || escaleta.pistas.length < 3 || escaleta.pistas.length > 4) {
    fallos.push("debe haber entre 3 y 4 pistas de investigación");
  }
  if (fallos.length) throw new Error(`Escaleta inválida: ${fallos.join("; ")}`);
  return escaleta;
}

function validarGuion(salida) {
  const fallos = [];
  const texto = String(salida.guion ?? "");
  const palabras = texto.split(/\s+/).filter(Boolean).length;
  if (palabras < 1000) fallos.push(`el guion tiene ${palabras} palabras; faltan datos`);
  if (palabras > 3000) fallos.push(`el guion tiene ${palabras} palabras; sobra relleno`);
  for (const nombre of ["El titular", "De dónde sale", "Qué esconde", "Cómo se usa bien", "Cierre"]) {
    if (!new RegExp(`^##\\s+${nombre}`, "m").test(texto)) fallos.push(`falta la sección «${nombre}»`);
  }
  if (!Array.isArray(salida.fuentes) || salida.fuentes.length < 3) fallos.push("faltan fuentes");
  const marcadores = [...texto.matchAll(/\[(\d{1,2})\]/g)].map((m) => Number(m[1]));
  const maximo = Math.max(0, ...marcadores);
  if (maximo > (salida.fuentes?.length ?? 0)) {
    fallos.push(`el guion cita [${maximo}] pero solo hay ${salida.fuentes?.length ?? 0} fuentes`);
  }
  return { fallos, palabras };
}

/** Elige las URLs más fiables para leer: dominio oficial primero, luego autoridad. */
function priorizar(resultados) {
  const oficiales = /(^|\.)(abs\.gov\.au|rba\.gov\.au|apra\.gov\.au|treasury\.gov\.au|gov\.au|edu\.au)$/;
  return [...resultados].sort((a, b) => {
    const aOficial = oficiales.test(new URL(a.url).hostname) ? 2 : 0;
    const bOficial = oficiales.test(new URL(b.url).hostname) ? 2 : 0;
    return bOficial + (b.autoridad ?? 0) + b.puntuacion / 3 - (aOficial + (a.autoridad ?? 0) + a.puntuacion / 3);
  });
}

async function principal() {
  console.log(`Dato y Ruido · episodio ${numero} · «${tema}»`);
  console.log(`Carpeta: ${dirEpisodio}`);

  const registro = {
    llamadas: 0,
    busquedas: 0,
    lecturas: 0,
    caracteresTts: 0,
    entrada: 0,
    salida: 0,
    costeUsd: 0,
  };

  let cliente;
  try {
    cliente = simulacro
      ? crearClienteSimulado()
      : crearCliente({ baseUrl: opcion("base-url", process.env.DEEPSEEK_BASE_URL), registro });
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }

  // 1. Dirección -----------------------------------------------------------
  mkdirSync(join(dirEpisodio, "investigacion"), { recursive: true });

  console.log("\n1/5 Dirección");
  const previos = existsSync(contenedor)
    ? readdirSync(contenedor, { withFileTypes: true })
        .filter((entrada) => entrada.isDirectory())
        .map((entrada) => entrada.name.replace(/^\d+-/, "").replace(/-/g, " "))
    : [];
  let escaleta;
  try {
    const respuesta = await cliente.chat({
      ...prompts.director({ tema, numero, fecha, episodiosPrevios: previos }),
      json: true,
      modelo,
    });
    escaleta = validarEscaleta(leerJson(respuesta.contenido));
  } catch (error) {
    console.error(`La dirección falló: ${error.message}`);
    process.exit(1);
  }
  console.log(`   «${escaleta.titulo}» · ${escaleta.secciones.reduce((s, x) => s + x.minutos, 0)} min · ${escaleta.pistas.length} pistas`);
  escribir(join(dirEpisodio, "escaleta.md"), escaletaEnMarkdown(escaleta, tema, fecha));

  const escaletaTexto = `Título: ${escaleta.titulo}\nSubtítulo: ${escaleta.subtitulo}\nTesis: ${escaleta.tesis}\nÁngulo: ${escaleta.angulo}\n\nSecciones:\n${escaleta.secciones
    .map((seccion, indice) => `${indice + 1}. ${seccion.nombre} (${seccion.minutos} min) — ${seccion.objetivo}`)
    .join("\n")}`;

  // 2. Investigación -------------------------------------------------------
  console.log("\n2/5 Investigación");
  const lecturas = new Map(); // url → { titulo, url, fecha, contenido }
  const informes = [];
  let busquedas = 0;
  let lecturasHechas = 0;

  for (const pista of escaleta.pistas) {
    if (busquedas >= topeBusquedas) break;
    console.log(`   pista ${pista.key}: ${pista.pregunta}`);
    let resultados = [];
    try {
      resultados = await cliente.buscar(pista.pregunta, { cantidad: 6 });
      busquedas += 1;
    } catch (error) {
      console.warn(`   búsqueda fallida: ${error.message}`);
      continue;
    }
    const material = [];
    for (const resultado of priorizar(resultados).slice(0, 2)) {
      if (lecturasHechas >= topeLecturas) break;
      if (!resultado.url) continue;
      if (lecturas.has(resultado.url)) {
        material.push(lecturas.get(resultado.url));
        continue;
      }
      try {
        const pagina = await cliente.leer(resultado.url);
        lecturasHechas += 1;
        const entrada = {
          titulo: resultado.titulo || pagina.titulo || resultado.url,
          url: resultado.url,
          fecha: resultado.fecha,
          contenido: recortar(pagina.contenido, 7000),
        };
        lecturas.set(resultado.url, entrada);
        material.push(entrada);
      } catch (error) {
        console.warn(`   no se pudo leer ${resultado.url}: ${error.message}`);
      }
    }
    if (material.length === 0) {
      material.push(...resultados.slice(0, 3).map((resultado) => ({
        titulo: resultado.titulo,
        url: resultado.url,
        fecha: resultado.fecha,
        contenido: resultado.resumen,
      })));
    }
    const respuesta = await cliente.chat({
      ...prompts.investigador({ tema, pista, escaleta: escaletaTexto, material }),
      modelo,
    });
    informes.push({ key: pista.key, texto: respuesta.contenido });
    escribir(join(dirEpisodio, "investigacion", `${pista.key}.md`), respuesta.contenido);
  }
  console.log(`   ${informes.length} informes · ${busquedas} búsquedas · ${lecturasHechas} páginas leídas`);

  // 3. Redacción -----------------------------------------------------------
  console.log("\n3/5 Redacción");
  let articulo;
  try {
    const respuesta = await cliente.chat({
      ...prompts.redactor({ tema, fecha, escaleta: escaletaTexto, informes }),
      json: true,
      modelo,
      maxTokens: 48000,
    });
    articulo = leerJson(respuesta.contenido);
  } catch (error) {
    console.error(`La redacción falló: ${error.message}`);
    process.exit(1);
  }
  let validacion = validarGuion(articulo);
  if (validacion.fallos.length) {
    console.warn(`   el guion no cumple: ${validacion.fallos.join("; ")}`);
  }

  // Ajuste de duración: el episodio es de 13 minutos, no de lo que salga.
  for (let intento = 0; intento < 2; intento += 1) {
    const palabras = articulo.guion.split(/\s+/).filter(Boolean).length;
    if (palabras >= 1600 && palabras <= 2300) break;
    const incidencia = {
      cita: articulo.guion.slice(0, 120),
      problema: `El guion tiene ${palabras} palabras; el episodio necesita entre 1.700 y 2.100.`,
      correccion: palabras < 1600
        ? "Amplía con material que ya está en los informes: definiciones, series, un ejemplo numérico propio. No añadas datos nuevos."
        : "Recorta repeticiones y párrafos de transición; no elimines cifras ni fuentes.",
    };
    console.log(`   ajustando duración (${palabras} palabras)`);
    try {
      const ajustado = await cliente.chat({
        ...prompts.corrector({ guion: articulo.guion, fuentes: articulo.fuentes, incidencias: [incidencia] }),
        json: true,
        modelo,
      });
      const nuevo = leerJson(ajustado.contenido);
      if (nuevo.guion) articulo = { ...articulo, ...nuevo };
    } catch (error) {
      console.warn(`   el ajuste falló: ${error.message}`);
      break;
    }
  }
  validacion = validarGuion(articulo);
  console.log(`   ${validacion.palabras} palabras · ${articulo.fuentes.length} fuentes`);

  // 4. Edición -------------------------------------------------------------
  console.log("\n4/5 Edición");
  const materialEditorial = await prepararLecturasEditoriales(cliente, articulo.fuentes, lecturas);
  if (materialEditorial.length < 2) {
    console.error("   no se pudieron leer al menos dos fuentes citadas: no se puede verificar ni publicar.");
  }
  let veredicto = materialEditorial.length < 2
    ? { aprobado: false, veredicto: "Sin material verificable: las fuentes citadas no respondieron.", incidencias: [] }
    : await editar(cliente, { articulo, escaleta: escaletaTexto, materialEditorial, modelo });
  let rondas = 0;
  while (!veredicto.aprobado && rondas < 2) {
    rondas += 1;
    console.log(`   corrección ${rondas}: ${veredicto.veredicto}`);
    try {
      const corregido = await cliente.chat({
        ...prompts.corrector({
          guion: articulo.guion,
          fuentes: articulo.fuentes,
          incidencias: veredicto.incidencias ?? [],
        }),
        json: true,
        modelo,
      });
      const nuevo = leerJson(corregido.contenido);
      if (nuevo.guion) articulo = { ...articulo, ...nuevo };
      validacion = validarGuion(articulo);
    } catch (error) {
      console.error(`La corrección falló: ${error.message}`);
      break;
    }
    veredicto = await editar(cliente, { articulo, escaleta: escaletaTexto, materialEditorial, modelo });
  }
  console.log(`   veredicto: ${veredicto.aprobado ? "APROBADO" : "RECHAZADO"} · ${veredicto.veredicto}`);

  escribir(join(dirEpisodio, "guion.md"), articulo.guion);
  escribir(join(dirEpisodio, "fuentes.md"), fuentesEnMarkdown(articulo.fuentes));
  escribir(join(dirEpisodio, "edicion.md"), edicionEnMarkdown(veredicto, rondas));

  if (!veredicto.aprobado) {
    escribir(join(dirEpisodio, "coste.json"), `${JSON.stringify(registro, null, 2)}\n`);
    console.error("\nNo se publica: la edición no aprobó el guion. El rastro queda en la carpeta para corregir a mano.");
    process.exit(1);
  }

  // 5. Publicación ---------------------------------------------------------
  console.log("\n5/5 Publicación");
  const palabras = articulo.guion.split(/\s+/).filter(Boolean).length;
  const duracionMin = Math.max(1, Math.round(palabras / 140));

  const metadata = {
    numero,
    slug,
    titulo: articulo.titulo || escaleta.titulo,
    subtitulo: articulo.subtitulo || escaleta.subtitulo,
    fecha,
    duracionMin,
    resumen: articulo.resumen || escaleta.tesis,
    escaleta: escaleta.secciones.map((seccion) => ({
      nombre: seccion.nombre,
      minutos: seccion.minutos,
      objetivo: seccion.objetivo,
    })),
    fuentes: articulo.fuentes.map((fuente, indice) => ({
      n: indice + 1,
      titulo: fuente.titulo,
      url: fuente.url,
      nota: fuente.nota ?? "",
    })),
  };

  // Audio opcional
  const audio = await crearAudio({
    modo: modoAudio,
    idioma,
    cliente: simulacro ? null : cliente,
    voz,
    guion: articulo.guion,
    dir: dirEpisodio,
    log: (mensaje) => console.log(`   ${mensaje}`),
  });
  if (audio) {
    metadata.audio = audio;
  }

  escribir(join(dirEpisodio, "episodio.json"), `${JSON.stringify(metadata, null, 2)}\n`);
  escribir(join(dirEpisodio, "coste.json"), `${JSON.stringify(registro, null, 2)}\n`);

  if (construirAlFinal) {
    const construccion = spawnSync(process.execPath, ["construir.mjs"], { cwd: raiz, stdio: "inherit" });
    if (construccion.status !== 0) {
      console.error("El sitio no se pudo construir.");
      process.exit(1);
    }
  }

  console.log(
    `\nListo. ${registro.llamadas} llamadas · ${registro.busquedas} búsquedas · ${registro.lecturas} lecturas · ${registro.caracteresTts} caracteres de audio · ≈ ${registro.costeUsd.toFixed(3)} USD`,
  );
  console.log(`Artefactos: ${dirEpisodio}`);
}

async function editar(cliente, { articulo, escaleta, materialEditorial, modelo }) {
  try {
    const respuesta = await cliente.chat({
      ...prompts.editor({
        guion: articulo.guion,
        fuentes: articulo.fuentes,
        escaleta,
        lecturas: materialEditorial,
      }),
      json: true,
      modelo,
    });
    const veredicto = leerJson(respuesta.contenido);
    if (typeof veredicto.aprobado !== "boolean") {
      veredicto.aprobado = false;
      veredicto.veredicto = veredicto.veredicto ?? "Veredicto sin campo «aprobado».";
    }
    if (!Array.isArray(veredicto.incidencias)) veredicto.incidencias = [];
    return veredicto;
  } catch (error) {
    console.error(`La edición falló: ${error.message}`);
    return { aprobado: false, veredicto: "La edición no pudo completarse.", incidencias: [] };
  }
}

/** Reúne el contenido de las URLs citadas para que la edición verifique. */
async function prepararLecturasEditoriales(cliente, fuentes, cache) {
  const material = [];
  for (const fuente of fuentes.slice(0, 6)) {
    if (!fuente?.url) continue;
    if (cache.has(fuente.url)) {
      material.push({ url: fuente.url, contenido: cache.get(fuente.url).contenido });
      continue;
    }
    try {
      const pagina = await cliente.leer(fuente.url);
      material.push({ url: fuente.url, contenido: recortar(pagina.contenido, 6000) });
    } catch (error) {
      console.warn(`   la edición no pudo leer ${fuente.url}: ${error.message}`);
    }
  }
  return material;
}

function recortar(texto, limite) {
  if (!texto) return "";
  return texto.length > limite ? `${texto.slice(0, limite)}\n…[recortado]` : texto;
}

function escaletaEnMarkdown(escaleta, tema, fecha) {
  return `# Escaleta · Episodio ${numero} · «${escaleta.titulo}»

**Tema de partida:** ${tema}
**Fecha de emisión:** ${fecha}
**Duración objetivo:** ${escaleta.secciones.reduce((suma, seccion) => suma + seccion.minutos, 0)} minutos

## Tesis

${escaleta.tesis}

## Ángulo

${escaleta.angulo}

## Secciones

| # | Sección | Min | Objetivo |
| --- | --- | --- | --- |
${escaleta.secciones.map((seccion, indice) => `| ${indice + 1} | ${seccion.nombre} | ${seccion.minutos} | ${seccion.objetivo} |`).join("\n")}

## Pistas de investigación

${escaleta.pistas.map((pista) => `### ${pista.label} (\`${pista.key}\`)\n\n**Pregunta:** ${pista.pregunta}\n\n**Foco:** ${pista.focus}`).join("\n\n")}

## Fuentes probables

${(escaleta.fuentesProbables ?? []).map((fuente) => `- ${fuente}`).join("\n") || "- Por confirmar en la investigación."}
`;
}

function fuentesEnMarkdown(fuentes) {
  return `# Fuentes

${fuentes.map((fuente) => `${fuente.n}. **${fuente.titulo}**\n   ${fuente.url}${fuente.nota ? `\n   ${fuente.nota}` : ""}`).join("\n\n")}
`;
}

function edicionEnMarkdown(veredicto, rondas) {
  const incidencias = (veredicto.incidencias ?? [])
    .map((incidencia, indice) => `${indice + 1}. Cita: «${incidencia.cita}»\n   - Problema: ${incidencia.problema}\n   - Corrección: ${incidencia.correccion}`)
    .join("\n\n");
  return `# Edición

**Veredicto: ${veredicto.aprobado ? "aprobado" : "rechazado"}.** ${veredicto.veredicto}

Rondas de corrección: ${rondas}.

## Incidencias

${incidencias || "Sin incidencias registradas."}
`;
}

/** Doble del cliente para probar el flujo completo sin clave ni gasto. */
function crearClienteSimulado() {
  return {
    uso: {},
    async chat({ usuario = "", json }) {
      if (usuario.includes("Eres la DIRECCIÓN")) {
        return { contenido: JSON.stringify(escaletaSimulada()) };
      }
      if (usuario.includes("Eres la INVESTIGACIÓN")) {
        return { contenido: "## Hallazgos\n1. «Prueba» de flujo con la cifra 4,7 %.\n\n## Fuentes\n- https://example.com" };
      }
      if (usuario.includes("Eres la REDACCIÓN. Escribe el guion")) {
        return { contenido: JSON.stringify(articuloSimulado()) };
      }
      if (usuario.includes("Eres la EDICIÓN")) {
        return { contenido: JSON.stringify({ aprobado: true, veredicto: "Simulacro: cifras conformes.", incidencias: [] }) };
      }
      if (usuario.includes("Corrige exactamente")) {
        return { contenido: JSON.stringify({ guion: guionSimulado(), fuentes: articuloSimulado().fuentes }) };
      }
      if (json) return { contenido: "{}" };
      return { contenido: "Simulacro." };
    },
    async buscar() {
      return [
        { titulo: "Fuente uno", url: "https://example.com/1", resumen: "resumen", fecha: "2026-01-01", autoridad: 3, puntuacion: 2 },
        { titulo: "Fuente dos", url: "https://example.com/2", resumen: "resumen", fecha: "2026-01-02", autoridad: 2, puntuacion: 1.8 },
      ];
    },
    async leer(url) {
      return { titulo: url, contenido: "Contenido de prueba con la cifra 4,7 % y la fecha 15/10/2026." };
    },
    async tts() {
      return Buffer.from("RIFF");
    },
  };
}

function escaletaSimulada() {
  return {
    titulo: "Prueba sintética",
    subtitulo: "Una prueba de flujo",
    tesis: "El flujo funciona.",
    angulo: "Validar el pipeline.",
    duracionMin: 13,
    secciones: [
      { nombre: "El titular", minutos: 2, objetivo: "Presentar." },
      { nombre: "De dónde sale", minutos: 3, objetivo: "Fuente." },
      { nombre: "Qué esconde", minutos: 4, objetivo: "Análisis." },
      { nombre: "Cómo se usa bien", minutos: 3, objetivo: "Decisión." },
      { nombre: "Cierre", minutos: 1, objetivo: "Recordar." },
    ],
    pistas: [
      { key: "definicion", label: "Definición", pregunta: "¿Qué mide?", focus: "Metodología." },
      { key: "contexto", label: "Contexto", pregunta: "¿Qué la rodea?", focus: "Series." },
      { key: "limites", label: "Límites", pregunta: "¿Qué deja fuera?", focus: "Sesgos." },
    ],
    fuentesProbables: ["ABS"],
  };
}

function articuloSimulado() {
  return {
    titulo: "Prueba sintética",
    subtitulo: "Una prueba de flujo",
    resumen: "Resumen de prueba.",
    guion: guionSimulado(),
    fuentes: [
      { n: 1, titulo: "Fuente uno", url: "https://example.com/1", nota: "Sostiene el dato." },
      { n: 2, titulo: "Fuente dos", url: "https://example.com/2", nota: "Contexto." },
      { n: 3, titulo: "Fuente tres", url: "https://example.com/3", nota: "Serie." },
    ],
  };
}

function guionSimulado() {
  const parrafo = (texto) => `${texto} [1] ${texto.split(" ").slice(0, 20).join(" ")} [2].`;
  const relleno = "La cifra se lee en voz alta y se explica con calma para que el oyente pueda seguirla sin papel. ".repeat(13);
  return `Entradilla de prueba que sitúa la escena y presenta la cifra del episodio [1].

## El titular
${parrafo("El titular de prueba dice 4,7 %")}
${relleno}

## De dónde sale
${parrafo("La fuente de prueba es un organismo")}
${relleno}

## Qué esconde
${parrafo("El dato esconde una definición")}
${relleno}

## Cómo se usa bien
${parrafo("Se usa mirando tres cifras")}
${relleno}

## Cierre
${parrafo("La cifra no está mal, es estrecha")}
`;
}

await principal();
