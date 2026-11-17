// Sistema de agentes del podcast «Dato y Ruido».
// Se ejecuta desde la herramienta `workflow` del harness: dentro del script existen
// `agent`, `parallel`, `phase`, `log` y `args`. No es un script Node: no tiene
// filesystem ni red; cada agente escribe sus artefactos con sus propias herramientas.
//
// Roles: Dirección → Investigación (en paralelo) → Redacción → Edición (bloqueante) → Publicación.
//
// Contrato:
//   - El texto viaja por archivos; cada agente devuelve una confirmación corta.
//   - Solo la dirección y la edición devuelven salida estructurada (escaleta y veredicto).
//   - Nada se publica sin el veredicto aprobado de la edición.
//   - Si un paso falla, se devuelve el estado parcial con las rutas ya escritas.
//
// args:
//   topic        tema o cifra del episodio (lo aporta la persona usuaria)
//   numero       número de episodio (entero)
//   slug         identificador de carpeta, por ejemplo "la-hora-que-cuenta"
//   fecha        fecha de publicación (AAAA-MM-DD)
//   proyectoDir  ruta absoluta de la carpeta del podcast (la que contiene construir.mjs)
//   episodioDir  ruta absoluta de contenidos/episodios/<numero>-<slug>
//   idioma       idioma del guion (por defecto, español)

const {
  topic,
  numero,
  slug,
  fecha,
  proyectoDir,
  episodioDir,
  idioma = "español",
} = args;

if (!topic || !numero || !slug || !fecha || !proyectoDir || !episodioDir) {
  throw new Error(
    "Faltan argumentos obligatorios: topic, numero, slug, fecha, proyectoDir, episodioDir",
  );
}

const escaletaPath = `${episodioDir}/escaleta.md`;
const investigacionDir = `${episodioDir}/investigacion`;
const guionPath = `${episodioDir}/guion.md`;
const fuentesPath = `${episodioDir}/fuentes.md`;
const edicionPath = `${episodioDir}/edicion.md`;
const episodioJsonPath = `${episodioDir}/episodio.json`;
const bibliaPath = `${proyectoDir}/biblia.md`;

const escaletaSchema = {
  type: "object",
  additionalProperties: false,
  required: ["titulo", "subtitulo", "tesis", "angulo", "duracionMin", "secciones", "pistas"],
  properties: {
    titulo: { type: "string" },
    subtitulo: { type: "string" },
    tesis: { type: "string" },
    angulo: { type: "string" },
    duracionMin: { type: "number" },
    secciones: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["nombre", "minutos", "objetivo"],
        properties: {
          nombre: { type: "string" },
          minutos: { type: "number" },
          objetivo: { type: "string" },
        },
      },
    },
    pistas: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "label", "pregunta", "focus"],
        properties: {
          key: { type: "string" },
          label: { type: "string" },
          pregunta: { type: "string" },
          focus: { type: "string" },
        },
      },
    },
  },
};

const veredictoSchema = {
  type: "object",
  additionalProperties: false,
  required: ["approved", "verdict"],
  properties: {
    approved: { type: "boolean" },
    verdict: { type: "string" },
  },
};

// --- Dirección -------------------------------------------------------------

const directorPrompt = () => `Eres el AGENTE DIRECTOR del podcast «Dato y Ruido»: análisis de datos con método, en ${idioma}, para gente que decide con datos en Australia.

TEMA PROPUESTO: «${topic}».
EPISODIO: ${numero}. Fecha de publicación: ${fecha}.

Antes de decidir nada, lee con la herramienta read:
- La biblia del programa: ${bibliaPath} (promesa, formato, voz y reglas de datos). Es obligatoria.
- Si existen, las escaletas anteriores en ${proyectoDir}/contenidos/episodios/ para no repetir tema ni ángulo.

Tu trabajo en esta fase es de dirección, no de investigación. Puedes hacer como máximo 2 web_search y 1 web_fetch para comprobar que la cifra o el caso existe ahora mismo y no está caducado. No redactes el episodio.

Decide:
1. La cifra o afirmación concreta que abre el episodio. Si el tema llega vago («la inflación»), elige un número concreto que esté circulando y explica en la escaleta por qué ese. Si el tema ya es una cifra, no la cambies: dale contexto.
2. El ángulo: una tesis discutible y útil, no un catálogo. Qué va a entender la persona al final que no entiende ahora.
3. Las cinco secciones fijas de la biblia con su duración en minutos (total entre 12 y 18) y el objetivo de cada una. Puedes recalibrar minutos, no eliminar secciones.
4. Las pistas de investigación: entre 3 y 4, cada una con una pregunta verificable y un foco. Al menos una debe ir a la definición o metodología de la fuente primaria, y al menos una debe buscar el contraejemplo o lo que la cifra deja fuera.
5. Quién produce la cifra: nombra el organismo o la publicación probable, sin afirmar todavía que existe (eso lo confirma la investigación).

Nada de promesas que no puedas cumplir con fuentes públicas. Si el tema no se puede verificar con fuentes primarias australianas, dilo en el ángulo y propone un recorte verificable.

Escribe la escaleta en ${escaletaPath} con la herramienta write: título, subtítulo, tesis, ángulo, tabla de secciones (número, nombre, minutos, objetivo), pistas de investigación con su pregunta, y una sección «Riesgos» con lo que podría no verificarse.

Devuelve la salida estructurada: los cinco campos del esquema. Duración y suma de secciones deben cuadrar.`;

// --- Investigación ---------------------------------------------------------

const investigadorPrompt = (pista, escaletaTexto) => `Eres el AGENTE INVESTIGADOR del podcast «Dato y Ruido». La dirección ya fijó el ángulo; tú traes la evidencia.

EPISODIO ${numero} (${fecha}) · TEMA: «${topic}».
TU PISTA: ${pista.label}.
PREGUNTA QUE DEBES RESPONDER: ${pista.pregunta}.

Escaleta vigente:
${escaletaTexto}

Reglas:
- Fuentes primarias ante todo: ABS, RBA, APRA, organismos públicos, documentos metodológicos y publicaciones con método explícito. Un medio sirve para encontrar la fuente, no para ser la fuente. Máximo 6 búsquedas web y 4 web_fetch; si una fuente falla, no insistas.
- Para cada hecho, anota la evidencia textual (una frase literal entre comillas) y la fuente exacta (URL con fecha de consulta). Sin evidencia, el hecho no entra.
- Distingue siempre: dato medido, estimación publicada, cálculo propio e hipótesis. Un cálculo propio lleva su fórmula y sus números de partida.
- No inventes cifras, fechas, nombres ni URLs. Si no puedes verificar algo, va a «Incertidumbres», no a «Hallazgos».
- Escribe en ${idioma}, markdown denso, máximo 900 palabras.

${pista.focus}

Escribe el informe en ${investigacionDir}/${pista.key}.md con la herramienta write en cuanto tengas 5 o 6 hechos verificados; puedes completarlo después con edit.

Respuesta final: una línea «LISTO ${pista.key}.md con N hechos verificados».`;

const investigadorRetryPrompt = (pista) => `Eres el AGENTE INVESTIGADOR. La primera pasada no dejó tu informe. Trabaja en corto:
- Como máximo 2 búsquedas web.
- Reúne 4 o 5 hechos con fuente y escribe YA ${investigacionDir}/${pista.key}.md con write.
- Tu tarea no es agotar el tema: es dejar evidencia trazable.

${pista.focus}
${pista.pregunta}

Respuesta final: «LISTO ${pista.key}.md».`;

// --- Redacción -------------------------------------------------------------

const redactorPrompt = () => `Eres el AGENTE REDACTOR del podcast «Dato y Ruido». Escribes para el oído, no para la vista: el texto se va a leer en voz alta y también a publicarse como guion.

EPISODIO ${numero} · «${topic}» · ${fecha}.

Lee antes de escribir:
- La escaleta: ${escaletaPath}
- Los informes de investigación: ${investigacionDir}/*.md
- La biblia (voz y reglas): ${bibliaPath}

Contrato del guion:
- Entre 1.700 y 2.100 palabras. Trece minutos son unas 1.800 palabras: no infles para llegar, ajusta.
- Abre con una escena concreta y una cifra; cierra con una acción. Sin «bienvenidos a otro episodio».
- Usa las cinco secciones de la escaleta como encabezados ## con el mismo nombre y en el mismo orden. Antes del primer encabezado escribe una entradilla de 100–140 palabras (sin encabezado).
- Hablado: frases cortas, una idea por frase, segunda persona, cero listas de viñetas, cero emojis, cero hype, cero urgencia falsa.
- Di las cifras como se dicen en voz alta (4,7 %, 732.000 personas) y no leas URLs ni notas al pie.
- Cada afirmación factual o cifra lleva un marcador [n] que remite a la lista de fuentes. Ninguna cifra sin fuente o sin el rótulo «cálculo nuestro» con su fórmula.
- Cuando la fuente principal no cubra algo, dilo en el guion: la honestidad sobre el límite es parte del programa.
- Escribe en ${idioma}, con markdown ## para secciones y párrafos normales.

Escribe:
1. ${guionPath} (write): el guion completo. Si es muy largo para un solo write, escribe por partes en archivos temporales y únelos con bash.
2. ${fuentesPath} (write): lista numerada de fuentes usadas, con título, URL y una línea de qué sostiene cada una; añade al final «Cálculos propios» si los hay.

Respuesta final: «LISTO guion.md · N palabras · N fuentes».`;

const correccionPrompt = () => `Eres el AGENTE REDACTOR. La edición encontró problemas en el guion. Corrige exactamente lo señalado en ${edicionPath}: no reescribas por gusto, mantén lo que pasó la verificación y conserva estructura, secciones y numeración de fuentes. Si una afirmación no se puede respaldar, elimínala o rótulala como hipótesis. Ajusta también ${fuentesPath} si cambia la lista.

Respuesta final: «LISTO guion.md · N palabras».`;

// --- Edición ---------------------------------------------------------------

const editorPrompt = (ronda) => `Eres el AGENTE EDITOR del podcast «Dato y Ruido». Tu trabajo es impedir que se publique un dato falso, mal entendido o mal contado. Ronda ${ronda + 1}.

Lee el guion (${guionPath}), las fuentes (${fuentesPath}), la escaleta (${escaletaPath}) y los informes de ${investigacionDir}/. Usa web_fetch sobre las fuentes primarias para verificar al menos las cinco afirmaciones de mayor impacto; no te fíes de la cita del redactor.

Revisa, en este orden:
1. Exactitud: cada cifra coincide con la fuente citada, en valor y en periodo. Marca cada afirmación revisada como soportada, no soportada o no verificable.
2. Interpretación: que la cifra signifique lo que el guion dice que significa. Un error común es confundir nivel con variación, o mezclar series (desestacionalizada y tendencia).
3. Aritmética: recalcula los «cálculos nuestros» y comprueba que el resultado del guion es el correcto.
4. Honestidad: cero cifras inventadas, cero promesas, cero autoridad falsa; los límites del dato están dichos.
5. Formato y voz: cinco secciones de la escaleta en orden, duración razonable, frases habladas, sin listas de relleno ni jerga sin traducir.
6. Fuentes: URLs reales, numeración coherente con los marcadores del guion, sin fuentes fantasma.

Escribe ${edicionPath} (write): veredicto, tabla de verificación con cita exacta del guion y de la fuente, y lista de correcciones concretas (qué cambiar y por qué).

Devuelve la salida estructurada {"approved": true|false, "verdict": "una frase"}. Aprueba solo si no queda ninguna incidencia alta y has verificado las cinco afirmaciones de mayor impacto.`;

// --- Publicación -----------------------------------------------------------

const publicadorPrompt = (veredicto) => `Eres el AGENTE PUBLICADOR del podcast «Dato y Ruido». La edición aprobó el guion («${veredicto}»). Toca convertirlo en una página publicada y en el feed.

Lee:
- Guion: ${guionPath}
- Fuentes: ${fuentesPath}
- Escaleta: ${escaletaPath}
- Ejemplo de metadatos de otro episodio, si existe: ${proyectoDir}/contenidos/episodios/*/episodio.json

Escribe ${episodioJsonPath} (write) con este formato exacto y nada más:
{
  "numero": ${numero},
  "slug": "${slug}",
  "titulo": "...",
  "subtitulo": "...",
  "fecha": "${fecha}",
  "duracionMin": 13,
  "resumen": "dos frases, sin hype",
  "escaleta": [{ "nombre": "...", "minutos": 2, "objetivo": "..." }],
  "fuentes": [{ "n": 1, "titulo": "...", "url": "...", "nota": "qué sostiene" }]
}

Reglas:
- «numero» y «slug» no se tocan. «duracionMin»: palabras del guion ÷ 140, redondeado.
- La lista de fuentes debe cubrir todos los marcadores [n] del guion, en el mismo orden y sin huecos. Si el guion cita [7], la lista llega a 7.
- Los títulos son los de la fuente real, sin adornos. Las URL, verificables.
- Nada de campos extra, nada de texto de relleno.

Después, con bash:
1. cd ${proyectoDir} && node construir.mjs
2. Comprueba que se generó ${proyectoDir}/sitio/index.html, que contiene el título del episodio, y que ${proyectoDir}/sitio/feed.xml incluye un <item> con el título y una URL https.
3. Comprueba que no queda texto de relleno: grep -ri "lorem\\|TODO\\|xxx" en el HTML generado.
Si algo falla, corrige y repite. No cambies el guion aprobado.

Respuesta final: «LISTO episodio.json · N fuentes · sitio construido · comprobaciones: ...».`;

// --- Orquestación ----------------------------------------------------------

phase("Dirección");
log(`Episodio ${numero} · ${topic}`);

const escaleta = await agent(directorPrompt(), {
  label: "Dirección · ángulo y secciones",
  phase: "Dirección",
  schema: escaletaSchema,
});

if (!escaleta || !Array.isArray(escaleta.pistas) || escaleta.pistas.length === 0) {
  return {
    ok: false,
    etapa: "direccion",
    motivo: "La dirección no devolvió una escaleta con pistas de investigación.",
    episodioDir,
    escaletaPath,
  };
}
log(`Título: «${escaleta.titulo}» · ${escaleta.secciones.length} secciones · ${escaleta.pistas.length} pistas`);

const escaletaTexto = [
  `Título: ${escaleta.titulo}`,
  `Subtítulo: ${escaleta.subtitulo}`,
  `Tesis: ${escaleta.tesis}`,
  `Ángulo: ${escaleta.angulo}`,
  "",
  "Secciones:",
  ...escaleta.secciones.map(
    (seccion, indice) => `${indice + 1}. ${seccion.nombre} (${seccion.minutos} min) — ${seccion.objetivo}`,
  ),
].join("\n");

phase("Investigación");
log(`${escaleta.pistas.length} pistas en paralelo`);

const pistas = escaleta.pistas.slice(0, 4);

const correrPista = async (pista) => {
  const primera = await agent(investigadorPrompt(pista, escaletaTexto), {
    label: `Investigación · ${pista.label}`,
    phase: "Investigación",
  });
  if (primera && primera.trim().length > 0) return { key: pista.key, texto: primera };
  log(`Pista ${pista.key} sin respuesta; reintento corto`);
  const segunda = await agent(investigadorRetryPrompt(pista), {
    label: `Investigación · ${pista.label} (reintento)`,
    phase: "Investigación",
  });
  return { key: pista.key, texto: segunda ?? "" };
};

const resultados = await parallel(pistas.map((pista) => () => correrPista(pista)));
const utiles = resultados.filter((resultado) => resultado && resultado.texto.trim().length > 0);

if (utiles.length < 2) {
  return {
    ok: false,
    etapa: "investigacion",
    motivo: `Solo ${utiles.length} pista(s) devolvieron respuesta; se necesitan al menos 2.`,
    episodioDir,
    escaletaPath,
    investigacionDir,
  };
}
log(`${utiles.length} pistas con evidencia`);

phase("Redacción");
log("Guion en progreso");

const guion = await agent(redactorPrompt(), {
  label: "Redacción · guion",
  phase: "Redacción",
});
if (!guion || guion.trim().length === 0) {
  return {
    ok: false,
    etapa: "redaccion",
    motivo: "El redactor no devolvió respuesta.",
    episodioDir,
    escaletaPath,
    guionPath,
  };
}

phase("Edición");
log("Verificación de cifras y fuentes");

let veredicto = await agent(editorPrompt(0), {
  label: "Edición · verificación",
  phase: "Edición",
  schema: veredictoSchema,
});
if (!veredicto) {
  return {
    ok: false,
    etapa: "edicion",
    motivo: "La edición no devolvió veredicto estructurado.",
    episodioDir,
    escaletaPath,
    guionPath,
  };
}
log(`Ronda 1: aprobado=${veredicto.approved} · ${veredicto.verdict}`);

let rondas = 0;
while (!veredicto.approved && rondas < 2) {
  rondas += 1;
  log(`Correcciones del redactor · ronda ${rondas}`);
  const corregido = await agent(correccionPrompt(), {
    label: `Redacción · correcciones ${rondas}`,
    phase: "Edición",
  });
  if (!corregido || corregido.trim().length === 0) {
    return {
      ok: false,
      etapa: "correccion",
      motivo: `El redactor falló en la corrección ${rondas}.`,
      episodioDir,
      guionPath,
      edicionPath,
      veredicto,
    };
  }
  veredicto = await agent(editorPrompt(rondas), {
    label: `Edición · verificación ${rondas + 1}`,
    phase: "Edición",
    schema: veredictoSchema,
  });
  if (!veredicto) {
    return {
      ok: false,
      etapa: "edicion",
      motivo: `La edición falló en la verificación ${rondas + 1}.`,
      episodioDir,
      guionPath,
      edicionPath,
    };
  }
  log(`Ronda ${rondas + 1}: aprobado=${veredicto.approved} · ${veredicto.verdict}`);
}

if (!veredicto.approved) {
  return {
    ok: false,
    etapa: "edicion",
    motivo: "El guion no quedó aprobado tras las rondas de corrección.",
    episodioDir,
    guionPath,
    edicionPath,
    veredicto,
  };
}

phase("Publicación");
log("Metadatos y sitio");

const publicado = await agent(publicadorPrompt(veredicto.verdict), {
  label: "Publicación · sitio y feed",
  phase: "Publicación",
});
if (!publicado || publicado.trim().length === 0) {
  return {
    ok: false,
    etapa: "publicacion",
    motivo: "El publicador no devolvió respuesta.",
    episodioDir,
    guionPath,
    episodioJsonPath,
  };
}

return {
  ok: true,
  episodio: {
    numero,
    slug,
    titulo: escaleta.titulo,
    subtitulo: escaleta.subtitulo,
    duracionMin: escaleta.duracionMin,
    pistas: pistas.length,
    fuentes: veredicto.verdict,
  },
  rutas: {
    escaleta: escaletaPath,
    investigacion: investigacionDir,
    guion: guionPath,
    fuentes: fuentesPath,
    edicion: edicionPath,
    metadatos: episodioJsonPath,
  },
  rondasDeEdicion: rondas + 1,
  veredicto,
  publicado: publicado.slice(0, 600),
};
