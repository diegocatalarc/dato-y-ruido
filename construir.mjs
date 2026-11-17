// Construye el sitio estático del podcast a partir de contenidos/episodios/*/episodio.json.
// Sin dependencias: markdown propio, plantillas propias, RSS propio.
//
// Uso: node construir.mjs [--silencioso]
//
// Lee:  podcast.json, contenidos/episodios/<carpeta>/episodio.json, guion.md
// Escribe: sitio/index.html, sitio/episodio/<slug>/index.html, sitio/feed.xml,
//          sitio/episodios.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = dirname(fileURLToPath(import.meta.url));
const CONTENIDO = join(RAIZ, "contenidos", "episodios");
const SITIO = join(RAIZ, "sitio");
const SILENCIOSO = process.argv.includes("--silencioso");

const config = leerJson(join(RAIZ, "podcast.json"));
const AVISO = "El programa explica datos, no constituye asesoría financiera, legal ni de inversión.";

/** Lee un JSON y falla con un mensaje que dice qué archivo y qué falta. */
function leerJson(ruta) {
  if (!existsSync(ruta)) throw new Error(`Falta ${ruta}`);
  try {
    return JSON.parse(readFileSync(ruta, "utf8"));
  } catch (error) {
    throw new Error(`JSON inválido en ${ruta}: ${error.message}`);
  }
}

/** Escapa texto para HTML. */
function esc(texto) {
  return String(texto ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Formatea una fecha ISO en español para Australia. */
function fechaLarga(iso) {
  const fecha = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(fecha.getTime())) throw new Error(`Fecha inválida: ${iso}`);
  return new Intl.DateTimeFormat("es-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(fecha);
}

/**
 * Markdown mínimo y suficiente para un guion: encabezados, párrafos, listas,
 * citas, negrita, cursiva, código y enlaces. Las cifras entre corchetes ([3])
 * se convierten en enlaces a la fuente 3.
 */
function inline(texto, fuentes) {
  let salida = esc(texto);
  salida = salida.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, texto2, url) => {
    return `<a href="${url}">${texto2}</a>`;
  });
  salida = salida.replace(/`([^`]+)`/g, "<code>$1</code>");
  salida = salida.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  salida = salida.replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  salida = salida.replace(/\[(\d{1,3})\]/g, (_, numero) => {
    const existe = fuentes.some((fuente) => String(fuente.n) === numero);
    return existe
      ? `<a class="cita" href="#f${numero}" aria-label="Fuente ${numero}">${numero}</a>`
      : `[${numero}]`;
  });
  return salida;
}

/** Convierte markdown en bloques HTML. */
function markdown(md, fuentes) {
  const lineas = md.replace(/\r\n/g, "\n").split("\n");
  const bloques = [];
  let parrafo = [];
  let lista = null;

  const cerrarParrafo = () => {
    if (parrafo.length === 0) return;
    bloques.push(`<p>${inline(parrafo.join(" "), fuentes)}</p>`);
    parrafo = [];
  };
  const cerrarLista = () => {
    if (!lista) return;
    bloques.push(
      `<${lista.tipo}>${lista.items.map((item) => `<li>${inline(item, fuentes)}</li>`).join("")}</${lista.tipo}>`,
    );
    lista = null;
  };

  for (const linea of lineas) {
    const limpia = linea.trim();
    if (limpia === "") {
      cerrarParrafo();
      cerrarLista();
      continue;
    }
    const encabezado = /^(#{1,3})\s+(.*)$/.exec(limpia);
    if (encabezado) {
      cerrarParrafo();
      cerrarLista();
      const nivel = encabezado[1].length;
      bloques.push(`<h${nivel}>${inline(encabezado[2], fuentes)}</h${nivel}>`);
      continue;
    }
    const vineta = /^[-*]\s+(.*)$/.exec(limpia);
    const numerada = /^\d+[.)]\s+(.*)$/.exec(limpia);
    if (vineta || numerada) {
      cerrarParrafo();
      const tipo = vineta ? "ul" : "ol";
      if (lista && lista.tipo !== tipo) cerrarLista();
      if (!lista) lista = { tipo, items: [] };
      lista.items.push((vineta ?? numerada)[1]);
      continue;
    }
    if (limpia.startsWith("> ")) {
      cerrarParrafo();
      cerrarLista();
      bloques.push(`<blockquote><p>${inline(limpia.slice(2), fuentes)}</p></blockquote>`);
      continue;
    }
    cerrarLista();
    parrafo.push(limpia);
  }
  cerrarParrafo();
  cerrarLista();
  return bloques.join("\n");
}

/** Texto plano para el reproductor con voz del navegador. */
function textoPlano(md) {
  return md
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`>]/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\[(\d{1,3})\]/g, "")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Divide el guion en secciones de nivel 2; la primera parte sin encabezado es la entradilla. */
function seccionesDeGuion(md, fuentes) {
  const partes = md.replace(/\r\n/g, "\n").split(/^## /m);
  const secciones = [];
  if (partes[0].trim()) {
    secciones.push({ titulo: "Entradilla", html: markdown(partes[0], fuentes), texto: textoPlano(partes[0]) });
  }
  for (const parte of partes.slice(1)) {
    const [primera, ...resto] = parte.split("\n");
    const cuerpo = resto.join("\n");
    secciones.push({
      titulo: primera.trim(),
      html: markdown(cuerpo, fuentes),
      texto: textoPlano(cuerpo),
    });
  }
  return secciones;
}

/** Minutos estimados de lectura en voz alta (140 palabras por minuto). */
function minutosDeTexto(texto) {
  const palabras = texto.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(palabras / 140));
}

function cargarEpisodios() {
  if (!existsSync(CONTENIDO)) return [];
  const carpetas = readdirSync(CONTENIDO, { withFileTypes: true })
    .filter((entrada) => entrada.isDirectory())
    .map((entrada) => entrada.name)
    .sort();

  const episodios = carpetas.map((carpeta) => {
    const dir = join(CONTENIDO, carpeta);
    const json = leerJson(join(dir, "episodio.json"));
    const faltantes = ["numero", "slug", "titulo", "fecha", "resumen"].filter(
      (campo) => json[campo] === undefined || json[campo] === "",
    );
    if (faltantes.length) {
      throw new Error(`${carpeta}/episodio.json no define: ${faltantes.join(", ")}`);
    }
    const rutaGuion = join(dir, "guion.md");
    const guion = existsSync(rutaGuion) ? readFileSync(rutaGuion, "utf8") : "";
    const fuentes = Array.isArray(json.fuentes) ? json.fuentes : [];
    const secciones = guion ? seccionesDeGuion(guion, fuentes) : [];
    const duracion =
      json.duracionMin ?? minutosDeTexto(secciones.map((seccion) => seccion.texto).join(" ").trim());
    return {
      ...json,
      carpeta,
      dir,
      fuentes,
      secciones,
      duracionMin: duracion,
      tieneAudio: Boolean(json.audio && existsSync(join(dir, json.audio))),
      url: `episodio/${json.slug}/`,
    };
  });

  return episodios.sort((a, b) => b.numero - a.numero);
}

function pagina({ base, titulo, descripcion, cuerpo, clase = "", extraHead = "" }) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(titulo)}</title>
<meta name="description" content="${esc(descripcion)}">
<meta name="color-scheme" content="dark">
<meta name="theme-color" content="${esc(config.fondo)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(titulo)}">
<meta property="og:description" content="${esc(descripcion)}">
<meta property="og:locale" content="es_ES">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%230b0a09'/%3E%3Cg fill='%23f2a860'%3E%3Crect x='13' y='26' width='4' height='12' rx='2'/%3E%3Crect x='21' y='20' width='4' height='24' rx='2'/%3E%3Crect x='29' y='14' width='4' height='36' rx='2'/%3E%3Crect x='37' y='22' width='4' height='20' rx='2'/%3E%3Crect x='45' y='28' width='4' height='8' rx='2'/%3E%3C/g%3E%3C/svg%3E">
<link rel="alternate" type="application/rss+xml" title="${esc(config.nombre)}" href="${base}feed.xml">
<link rel="stylesheet" href="${base}estilos.css">
${extraHead}
</head>
<body class="${clase}">
<a class="saltar" href="#contenido">Saltar al contenido</a>
<header class="cabecera">
  <a class="marca" href="${base}./" aria-label="${esc(config.nombre)} · inicio">
    <svg viewBox="0 0 64 64" aria-hidden="true" width="30" height="30"><g fill="currentColor"><rect x="6" y="27" width="4" height="10" rx="2"/><rect x="14" y="21" width="4" height="22" rx="2"/><rect x="22" y="15" width="4" height="34" rx="2"/><rect x="30" y="23" width="4" height="18" rx="2"/><rect x="38" y="11" width="4" height="42" rx="2"/><rect x="46" y="25" width="4" height="14" rx="2"/><rect x="54" y="29" width="4" height="6" rx="2"/></g></svg>
    <span>${esc(config.nombre)}</span>
  </a>
  <nav class="nav" aria-label="Principal">
    <a href="${base}feed.xml">RSS</a>
  </nav>
</header>
<main id="contenido">
${cuerpo}
</main>
<footer class="pie">
  <p><strong>${esc(config.nombre)}</strong> · ${esc(config.tagline)}</p>
  <p>${esc(AVISO)}</p>
  <p class="pie-meta"><a href="${base}feed.xml">Suscribirse por RSS</a> · Publicado con GitHub Pages</p>
</footer>
</body>
</html>
`;
}

function tarjetaEpisodio(episodio, base) {
  return `<article class="tarjeta">
  <a class="tarjeta-enlace" href="${base}${episodio.url}">
    <span class="tarjeta-num">${String(episodio.numero).padStart(2, "0")}</span>
    <span class="tarjeta-cuerpo">
      <span class="tarjeta-kicker">${esc(fechaLarga(episodio.fecha))} · ${episodio.duracionMin} min</span>
      <span class="tarjeta-titulo">${esc(episodio.titulo)}</span>
      <span class="tarjeta-resumen">${esc(episodio.resumen)}</span>
      <span class="tarjeta-meta">${episodio.tieneAudio ? "Audio del episodio" : "Guion completo y voz del navegador"} · ${episodio.fuentes.length} fuentes</span>
    </span>
  </a>
</article>`;
}

function construirPortada(episodios) {
  const ultimo = episodios[0];
  const destacado = ultimo
    ? `<section class="destacado" aria-labelledby="ultimo">
  <p class="etiqueta">Último episodio</p>
  <h2 id="ultimo" class="destacado-titulo"><a href="${ultimo.url}">${esc(ultimo.titulo)}</a></h2>
  <p class="destacado-resumen">${esc(ultimo.resumen)}</p>
  <p class="destacado-meta">${esc(fechaLarga(ultimo.fecha))} · ${ultimo.duracionMin} min · ${ultimo.fuentes.length} fuentes</p>
</section>`
    : `<section class="vacio"><p>Todavía no hay episodios publicados. El primero está en el horno.</p></section>`;

  const lista = episodios.map((episodio) => tarjetaEpisodio(episodio, "")).join("\n");

  return pagina({
    base: "",
    titulo: `${config.nombre} · ${config.tagline}`,
    descripcion: config.descripcion,
    clase: "vista-portada",
    cuerpo: `<section class="hero">
  <p class="etiqueta">Podcast de análisis de datos</p>
  <h1>${esc(config.nombre)}</h1>
  <p class="hero-tagline">${esc(config.tagline)}</p>
  <p class="hero-texto">${esc(config.descripcion)}</p>
  <p class="hero-acciones">
    <a class="boton" href="${ultimo ? ultimo.url : "#episodios"}">Escuchar el último</a>
    <a class="boton boton-fantasma" href="feed.xml">Suscribirse por RSS</a>
  </p>
</section>
${destacado}
<section class="episodios" id="episodios" aria-labelledby="todos">
  <h2 id="todos" class="seccion-titulo">Todos los episodios</h2>
  ${lista || "<p class='vacio'>Sin episodios todavía.</p>"}
</section>
<section class="metodo" aria-labelledby="metodo">
  <h2 id="metodo" class="seccion-titulo">Cómo se hace</h2>
  <ol class="metodo-pasos">
    <li><strong>Dirección</strong> elige la cifra y arma las cinco secciones del episodio.</li>
    <li><strong>Investigación</strong> busca la fuente primaria y anota la evidencia textual.</li>
    <li><strong>Redacción</strong> escribe el guion hablado con citas numeradas.</li>
    <li><strong>Edición</strong> verifica cada cifra contra la fuente y bloquea lo que no se sostiene.</li>
    <li><strong>Publicación</strong> genera esta página y el feed; nada se publica sin aprobación.</li>
  </ol>
  <p class="metodo-nota">Cada episodio deja su rastro: escaleta, investigación, guion, revisión y fuentes.</p>
</section>`,
  });
}

function construirEpisodio(episodio, siguiente, anterior) {
  const base = "../../";
  const fuentes = episodio.fuentes
    .map(
      (fuente) =>
        `<li id="f${fuente.n}"><span class="fuente-n">${fuente.n}</span> <a href="${esc(fuente.url)}">${esc(fuente.titulo)}</a>${fuente.nota ? `<span class="fuente-nota">${esc(fuente.nota)}</span>` : ""}</li>`,
    )
    .join("\n");

  let marcadas = 0;
  const cuerpos = episodio.secciones
    .map((seccion, indice) => {
      const esEntradilla = seccion.titulo === "Entradilla";
      if (!esEntradilla) marcadas += 1;
      const marca = esEntradilla
        ? ""
        : `<span class="marca-seccion">${String(marcadas).padStart(2, "0")}</span> `;
      return `<section class="seccion-guion${esEntradilla ? " entradilla" : ""}" id="s${indice}">
  <h2 class="seccion-guion-titulo">${marca}${esc(seccion.titulo)}</h2>
  ${seccion.html}
</section>`;
    })
    .join("\n");

  const datosVoz = episodio.secciones.map((seccion) => ({
    titulo: seccion.titulo,
    texto: seccion.texto,
  }));

  const reproductor = episodio.tieneAudio
    ? `<div class="reproductor">
  <p class="reproductor-etiqueta">Audio del episodio</p>
  <audio controls preload="metadata" src="${esc(basename(episodio.audio))}"></audio>
  <p class="reproductor-nota">También puedes leer el guion completo abajo.</p>
</div>`
    : `<div class="reproductor" id="voz">
  <p class="reproductor-etiqueta">Escuchar con la voz del navegador</p>
  <div class="reproductor-controles">
    <button type="button" class="boton" id="vozPlay">Escuchar</button>
    <button type="button" class="boton boton-fantasma" id="vozPausa" disabled>Pausar</button>
    <button type="button" class="boton boton-fantasma" id="vozStop" disabled>Detener</button>
    <label class="voz-velocidad">Velocidad
      <select id="vozVelocidad">
        <option value="0.9">0,9×</option>
        <option value="1" selected>1×</option>
        <option value="1.15">1,15×</option>
        <option value="1.3">1,3×</option>
      </select>
    </label>
  </div>
  <p class="reproductor-nota" id="vozEstado">Se lee el guion completo con la voz del navegador. No hace falta descargar nada.</p>
</div>`;

  const enlacesNav = [
    siguiente
      ? `<a class="nav-ep" href="${base}${siguiente.url}"><span>Más reciente</span><strong>${String(siguiente.numero).padStart(2, "0")} · ${esc(siguiente.titulo)}</strong></a>`
      : "",
    anterior
      ? `<a class="nav-ep nav-ep-siguiente" href="${base}${anterior.url}"><span>Episodio anterior</span><strong>${String(anterior.numero).padStart(2, "0")} · ${esc(anterior.titulo)}</strong></a>`
      : "",
  ].filter(Boolean);
  const nav = enlacesNav.length
    ? `<nav class="navegacion" aria-label="Otros episodios">
  ${enlacesNav.join("\n  ")}
</nav>`
    : "";

  return pagina({
    base,
    titulo: `${episodio.titulo} · ${config.nombre}`,
    descripcion: episodio.resumen,
    clase: "vista-episodio",
    extraHead: `<script type="application/json" id="guion-datos">${JSON.stringify(datosVoz).replace(/</g, "\\u003c")}</script>`,
    cuerpo: `<article class="episodio">
  <header class="episodio-cabecera">
    <p class="etiqueta">Episodio ${String(episodio.numero).padStart(2, "0")}</p>
    <h1>${esc(episodio.titulo)}</h1>
    ${episodio.subtitulo ? `<p class="episodio-subtitulo">${esc(episodio.subtitulo)}</p>` : ""}
    <p class="episodio-meta">${esc(fechaLarga(episodio.fecha))} · ${episodio.duracionMin} min · ${episodio.fuentes.length} fuentes</p>
  </header>
  ${reproductor}
  <div class="episodio-cuerpo">
    ${
      Array.isArray(episodio.escaleta) && episodio.escaleta.length
        ? `<section class="escaleta" aria-labelledby="en-este-episodio"><h2 id="en-este-episodio">En este episodio</h2><ol>${episodio.escaleta
            .map((s) => `<li><strong>${esc(s.nombre)}</strong> <span>${s.minutos} min</span> — ${esc(s.objetivo)}</li>`)
            .join("")}</ol></section>`
        : ""
    }
    ${cuerpos}
    ${fuentes ? `<section class="fuentes" aria-labelledby="fuentes"><h2 id="fuentes">Fuentes</h2><ol class="lista-fuentes">${fuentes}</ol></section>` : ""}
  </div>
  ${nav}
</article>
<script src="${base}reproductor.js" defer></script>`,
  });
}

function construirFeed(episodios) {
  const base = config.urlBase.replace(/\/$/, "");
  const items = episodios
    .slice(0, 50)
    .map((episodio) => {
      const audio = episodio.tieneAudio
        ? `<enclosure url="${base}/${episodio.url}${esc(basename(episodio.audio))}" type="audio/mpeg"/>`
        : "";
      return `<item>
  <title>${esc(episodio.titulo)}</title>
  <link>${base}/${episodio.url}</link>
  <guid isPermaLink="true">${base}/${episodio.url}</guid>
  <description>${esc(episodio.resumen)}</description>
  <pubDate>${new Date(`${episodio.fecha}T09:00:00Z`).toUTCString()}</pubDate>
  <itunes:episode>${episodio.numero}</itunes:episode>
  ${audio}
</item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
<channel>
  <title>${esc(config.nombre)}</title>
  <link>${base}/</link>
  <description>${esc(config.descripcion)}</description>
  <language>${esc(config.idioma)}</language>
  <itunes:author>${esc(config.autor)}</itunes:author>
  <itunes:summary>${esc(config.descripcion)}</itunes:summary>
  <itunes:explicit>false</itunes:explicit>
  ${config.portada ? `<itunes:image href="${base}/${esc(config.portada)}"/>` : ""}
${items}
</channel>
</rss>
`;
}

// --- Construcción -----------------------------------------------------------

const episodios = cargarEpisodios();

mkdirSync(SITIO, { recursive: true });
const RECURSOS = join(RAIZ, "recursos");
if (existsSync(RECURSOS)) {
  for (const entrada of readdirSync(RECURSOS, { withFileTypes: true })) {
    if (entrada.isFile()) {
      copyFileSync(join(RECURSOS, entrada.name), join(SITIO, entrada.name));
    }
  }
}

rmSync(join(SITIO, "episodio"), { recursive: true, force: true });
for (const [indice, episodio] of episodios.entries()) {
  const destino = join(SITIO, "episodio", episodio.slug);
  mkdirSync(destino, { recursive: true });
  writeFileSync(
    join(destino, "index.html"),
    construirEpisodio(episodio, episodios[indice - 1] ?? null, episodios[indice + 1] ?? null),
    "utf8",
  );
  if (episodio.tieneAudio) {
    copyFileSync(join(episodio.dir, episodio.audio), join(destino, basename(episodio.audio)));
  }
}

writeFileSync(join(SITIO, "index.html"), construirPortada(episodios), "utf8");
writeFileSync(join(SITIO, "feed.xml"), construirFeed(episodios), "utf8");
writeFileSync(
  join(SITIO, "episodios.json"),
  `${JSON.stringify(
    episodios.map((episodio) => ({
      numero: episodio.numero,
      slug: episodio.slug,
      titulo: episodio.titulo,
      fecha: episodio.fecha,
      duracionMin: episodio.duracionMin,
      resumen: episodio.resumen,
      url: episodio.url,
      audio: episodio.tieneAudio ? basename(episodio.audio) : null,
      fuentes: episodio.fuentes.length,
    })),
    null,
    2,
  )}\n`,
  "utf8",
);

if (!SILENCIOSO) {
  console.log(`Sitio construido: ${episodios.length} episodio(s)`);
  for (const episodio of episodios) {
    console.log(
      `  ${String(episodio.numero).padStart(2, "0")} · ${episodio.titulo} · ${episodio.duracionMin} min · ${episodio.fuentes.length} fuentes`,
    );
  }
  console.log(`  ${join(SITIO, "index.html")}`);
}
