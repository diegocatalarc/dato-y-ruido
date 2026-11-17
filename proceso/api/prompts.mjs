// Prompts de los cinco roles. El texto es el contrato: cada función devuelve
// { sistema, usuario } listo para el cliente de chat.

const REGLAS = `Reglas del programa (obligatorias):
- Programa «Dato y Ruido»: cada episodio toma una cifra que circula en Australia y explica de dónde sale, qué esconde y cómo usarla bien.
- Español claro, segunda persona, frases cortas, sin hype, sin urgencia falsa, sin emojis, sin listas de relleno.
- Fuentes primarias: ABS, RBA, APRA, organismos públicos y publicaciones con metodología. Un medio sirve para encontrar la fuente, no para ser la fuente.
- Distingue siempre: dato medido, estimación publicada, cálculo propio (con fórmula) e hipótesis.
- No inventes cifras, fechas, nombres ni URL. Si algo no se puede verificar, se dice.
- Nada de asesoría financiera, legal o de inversión.`;

export function sistema() {
  return `Eres parte del sistema de producción del podcast «Dato y Ruido» (análisis de datos, Australia).\n\n${REGLAS}`;
}

/** Dirección: convierte un tema en escaleta cerrada. Devuelve JSON. */
export function director({ tema, numero, fecha, episodiosPrevios = [] }) {
  const previos = episodiosPrevios.length
    ? `Episodios ya publicados (no repitas tema ni ángulo):\n${episodiosPrevios.map((e) => `- ${e}`).join("\n")}`
    : "No hay episodios anteriores: este es el primero.";

  return {
    sistema: sistema(),
    usuario: `Eres la DIRECCIÓN. Tema propuesto: «${tema}». Episodio ${numero}, fecha ${fecha}.

${previos}

Convierte el tema en una escaleta cerrada. No investigues: decide.

1. Elige la cifra o afirmación concreta que abre el episodio. Si el tema llega vago, escoge un número concreto que esté circulando; si ya es una cifra, no la cambies.
2. Define el ángulo: una tesis discutible y útil, no un catálogo.
3. Usa exactamente estas cinco secciones, en este orden, con minutos que sumen entre 12 y 18:
   «El titular», «De dónde sale», «Qué esconde», «Cómo se usa bien», «Cierre».
4. Propón entre 3 y 4 pistas de investigación. Cada pista lleva: key (slug corto, sin espacios), label, pregunta verificable y focus (qué debe cubrir). Al menos una pista debe buscar la definición o metodología de la fuente primaria y al menos una debe buscar el contraejemplo o lo que la cifra deja fuera.
5. Indica quién produce probablemente la cifra, sin afirmar que existe: eso lo confirma la investigación.

Responde SOLO con un objeto JSON válido, sin texto alrededor, con esta forma:
{
  "titulo": "3-6 palabras",
  "subtitulo": "una línea, qué mide de menos la cifra",
  "tesis": "la idea que el oyente se lleva",
  "angulo": "cómo se aborda y qué se evita",
  "duracionMin": 13,
  "secciones": [{ "nombre": "El titular", "minutos": 2, "objetivo": "..." }],
  "pistas": [{ "key": "definicion", "label": "Definición y metodología", "pregunta": "...", "focus": "..." }],
  "fuentesProbables": ["organismo o publicación probable"]
}`,
  };
}

/** Investigación: sintetiza el material traído por búsqueda y lectura. */
export function investigador({ tema, pista, escaleta, material }) {
  const lecturas = material
    .map(
      (entrada) => `### ${entrada.titulo}
URL: ${entrada.url}
Fecha: ${entrada.fecha ?? "sin fecha"}
Contenido:
${entrada.contenido}`,
    )
    .join("\n\n");

  return {
    sistema: sistema(),
    usuario: `Eres la INVESTIGACIÓN. Episodio sobre «${tema}». Pista: ${pista.label}.
Pregunta que debes responder: ${pista.pregunta}

Escaleta vigente:
${escaleta}

Material encontrado por el buscador y las páginas leídas (es tu única evidencia; no añadas datos de memoria):
${lecturas || "(sin material: escribe un informe breve diciendo que no se encontró evidencia)"}

Escribe el informe en markdown, máximo 900 palabras, con esta estructura:
## Hallazgos
Lista numerada. Cada hallazgo: una frase textual entre comillas de la fuente, la cifra exacta, el periodo y la URL. Máximo 8.
## Definiciones y metodología
Solo si la fuente las explica. Qué mide exactamente el dato y qué no.
## Incertidumbres
Lo que no se pudo verificar o lo que las fuentes no cubren.
## Fuentes
Lista de URL usadas, con fecha de publicación si se conoce.`,
  };
}

/** Redacción: escribe el guion hablado con citas. Devuelve JSON. */
export function redactor({ tema, fecha, escaleta, informes }) {
  return {
    sistema: sistema(),
    usuario: `Eres la REDACCIÓN. Escribe el guion del episodio sobre «${tema}» (${fecha}).

Escaleta:
${escaleta}

Informes de investigación (única fuente de datos admitida):
${informes.map((informe) => `--- ${informe.key} ---\n${informe.texto}`).join("\n\n")}

Contrato del guion:
- Entre 1.700 y 2.100 palabras. Trece minutos son unas 1.800: no infles.
- Abre con una escena concreta y la cifra; cierra con una acción.
- Usa las cinco secciones de la escaleta como encabezados «## » con el nombre exacto y en el mismo orden. Antes del primer encabezado, una entradilla de 100–140 palabras sin encabezado.
- Hablado: frases cortas, segunda persona, sin viñetas, sin leer URL.
- Cada cifra lleva un marcador [n] que remite a la lista de fuentes. Si es un cálculo propio, dilo y da la fórmula.
- Di las cifras como se dicen en voz alta (4,7 %, 732.000 personas).

Responde SOLO con JSON válido:
{
  "titulo": "el de la escaleta, o mejor si mejora sin perder precisión",
  "subtitulo": "una línea",
  "resumen": "dos frases para la web, sin hype",
  "guion": "markdown completo, con \\n\\n entre párrafos",
  "fuentes": [{ "n": 1, "titulo": "título real de la fuente", "url": "https://...", "nota": "qué sostiene" }]
}
La lista de fuentes debe cubrir todos los marcadores [n] del guion, sin huecos.`,
  };
}

/** Corrección: aplica las incidencias del editor. Devuelve JSON. */
export function corrector({ guion, fuentes, incidencias }) {
  return {
    sistema: sistema(),
    usuario: `Eres la REDACCIÓN. La edición encontró problemas. Corrige exactamente lo señalado y no reescribas por gusto.

Guion actual:
${guion}

Fuentes actuales:
${JSON.stringify(fuentes)}

Incidencias:
${incidencias.map((i, n) => `${n + 1}. Cita: «${i.cita}» — problema: ${i.problema}. Corrección pedida: ${i.correccion}`).join("\n")}

Si una afirmación no se puede respaldar, elimínala o rótulala como hipótesis. Mantén estructura, secciones y numeración de fuentes.

Responde SOLO con JSON válido: { "guion": "...", "fuentes": [...] }`,
  };
}

/** Edición: verifica contra las páginas leídas. Devuelve JSON con veredicto. */
export function editor({ guion, fuentes, escaleta, lecturas }) {
  const material = lecturas
    .map(
      (lectura) => `### ${lectura.url}
${lectura.contenido}`,
    )
    .join("\n\n");

  return {
    sistema: sistema(),
    usuario: `Eres la EDICIÓN. Debes impedir que se publique un dato falso, mal entendido o mal contado. Verifica contra el material leído; no te fíes de la cita del redactor.

Escaleta:
${escaleta}

Guion:
${guion}

Fuentes declaradas:
${JSON.stringify(fuentes)}

Páginas originales leídas (material de verificación):
${material || "(sin material: no puedes verificar, así que no apruebes a ciegas)"}

Revisa en este orden:
1. Exactitud: cada cifra coincide con el material, en valor y periodo.
2. Interpretación: el guion no confunde nivel con variación ni mezcla series.
3. Aritmética: recalcula los cálculos propios.
4. Honestidad: ninguna cifra sin respaldo, ningún límite oculto.
5. Formato: las cinco secciones de la escaleta, en orden, y una duración razonable.

Responde SOLO con JSON válido:
{
  "aprobado": false,
  "veredicto": "una frase",
  "incidencias": [{ "cita": "texto exacto del guion", "problema": "...", "correccion": "..." }]
}
Aprueba solo si las cifras verificables coinciden y no queda ninguna incidencia alta.`,
  };
}
