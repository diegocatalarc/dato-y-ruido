// Cliente mínimo de la API de DeepSeek: chat, búsqueda, lectura de URL y TTS.
// Sin dependencias: fetch nativo de Node.
//
// Clave: DEEPSEEK_API_KEY (o --clave / variable propia). Nunca se escribe en disco.
// Base: DEEPSEEK_BASE_URL (por defecto https://api.deepseek.com); las pruebas usan un
// servidor local simulado.

import { setTimeout as sleep } from "node:timers/promises";

const BASE_POR_DEFECTO = "https://api.deepseek.com";

/** Idiomas del TTS de DeepSeek según la documentación. Español no está en la lista. */
export const IDIOMAS_TTS = ["zh", "yue", "en", "ja", "ko", "ms", "ar", "id", "th", "vi"];

/** Precios públicos (USD) usados para estimar el coste de la ejecución. */
export const PRECIOS = {
  "deepseek-flash": { entrada: 0.3, salida: 1.2 },
  "deepseek-v4-pro": { entrada: 1.32, salida: 3.96 },
  busqueda: 0.75 / 1000,
  lectura: 0.75 / 1000,
  ttsPorCaracter: 0.45 / 10000,
};

export class ErrorApi extends Error {
  constructor(mensaje, estado, cuerpo) {
    super(mensaje);
    this.name = "ErrorApi";
    this.estado = estado;
    this.cuerpo = cuerpo;
  }
}

/**
 * Crea el cliente. `baseUrl` permite apuntar a un doble de pruebas.
 * `registro` acumula uso y coste estimado de toda la ejecución.
 */
export function crearCliente({ clave, baseUrl = BASE_POR_DEFECTO, registro } = {}) {
  const apiKey = clave ?? process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Falta la clave de la API. Define DEEPSEEK_API_KEY (o usa --env-file=.env). No se escribe nunca en el repositorio.",
    );
  }
  const raiz = baseUrl.replace(/\/$/, "");
  const uso = registro ?? {
    llamadas: 0,
    busquedas: 0,
    lecturas: 0,
    caracteresTts: 0,
    entrada: 0,
    salida: 0,
    costeUsd: 0,
  };

  const cabeceras = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };

  /** Petición con reintentos solo para errores transitorios. */
  async function pedir(ruta, { cuerpo, metodo = "POST", timeoutMs = 120000, crudo = false }) {
    const url = `${raiz}${ruta}`;
    let ultimoError;

    for (let intento = 0; intento < 3; intento += 1) {
      try {
        const respuesta = await fetch(url, {
          method: metodo,
          headers: cabeceras,
          body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
          signal: AbortSignal.timeout(timeoutMs),
        });

        if (respuesta.ok) {
          return crudo ? await respuesta.arrayBuffer() : await respuesta.json();
        }

        const texto = await respuesta.text();
        const esTransitorio = [408, 429, 500, 502, 503, 504].includes(respuesta.status);
        if (!esTransitorio || intento === 2) {
          throw new ErrorApi(traducirError(respuesta.status, texto), respuesta.status, texto);
        }
        ultimoError = new ErrorApi(`HTTP ${respuesta.status}`, respuesta.status, texto);
      } catch (error) {
        if (error instanceof ErrorApi) throw error;
        if (error.name === "TimeoutError" || error.name === "AbortError") {
          ultimoError = new Error(`La petición a ${ruta} agotó el tiempo (${timeoutMs} ms).`);
        } else {
          ultimoError = new Error(`No se pudo conectar con ${raiz}: ${error.message}`);
        }
        if (intento === 2) throw ultimoError;
      }
      await sleep(800 * 2 ** intento);
    }
    throw ultimoError ?? new Error(`Fallo desconocido al llamar a ${ruta}`);
  }

  /**
   * Una llamada al modelo.
   * @param {{sistema?: string, usuario?: string, mensajes?: Array<{role: string, content: string}>, json?: boolean, modelo?: string, pensamiento?: "enabled"|"disabled", maxTokens?: number, temperatura?: number}} opciones
   */
  async function chat({
    sistema,
    usuario,
    mensajes,
    json = false,
    modelo = "deepseek-flash",
    pensamiento = "enabled",
    maxTokens = 16000,
    temperatura = 1,
  }) {
    const conversacion = mensajes ?? (usuario ? [{ role: "user", content: usuario }] : []);
    if (conversacion.length === 0) throw new Error("La llamada al modelo no lleva mensajes.");
    const mensajesFinales = sistema
      ? [{ role: "system", content: sistema }, ...conversacion]
      : conversacion;

    const cuerpo = {
      model: modelo,
      messages: mensajesFinales,
      max_tokens: maxTokens,
      thinking: { type: pensamiento },
    };
    if (json) cuerpo.response_format = { type: "json_object" };
    // La temperatura no afecta en modo pensamiento; se envía solo cuando se usa.
    if (pensamiento === "disabled") cuerpo.temperature = temperatura;

    const respuesta = await pedir("/chat/completions", { cuerpo, timeoutMs: 600000 });
    const mensaje = respuesta.choices?.[0]?.message ?? {};
    const contenido = (mensaje.content ?? "").trim();
    const razonamiento = (mensaje.reasoning_content ?? "").trim();

    uso.llamadas += 1;
    uso.entrada += respuesta.usage?.prompt_tokens ?? 0;
    uso.salida += respuesta.usage?.completion_tokens ?? 0;
    const precio = PRECIOS[modelo] ?? PRECIOS["deepseek-flash"];
    uso.costeUsd +=
      ((respuesta.usage?.prompt_tokens ?? 0) / 1e6) * precio.entrada +
      ((respuesta.usage?.completion_tokens ?? 0) / 1e6) * precio.salida;

    if (respuesta.choices?.[0]?.finish_reason === "length") {
      throw new ErrorApi(
        "La respuesta del modelo se cortó por longitud. Sube maxTokens o acorta el material.",
        0,
        contenido.slice(0, 400),
      );
    }
    return { contenido, razonamiento, uso: respuesta.usage };
  }

  /** Búsqueda web. Devuelve resultados con título, URL, resumen y autoridad. */
  async function buscar(consulta, { cantidad = 6 } = {}) {
    const respuesta = await pedir(
      "/v1/tools/search",
      { cuerpo: { query: consulta, count: cantidad, need_content: false }, timeoutMs: 30000 },
    );
    uso.busquedas += 1;
    uso.costeUsd += PRECIOS.busqueda;
    return (respuesta.results ?? []).map((resultado) => ({
      titulo: resultado.title ?? "",
      url: resultado.url ?? "",
      resumen: resultado.summary ?? resultado.snippet ?? "",
      fecha: resultado.date ?? null,
      autoridad: typeof resultado.authority === "number" ? resultado.authority : -1,
      puntuacion: resultado.rerank_score ?? 0,
    }));
  }

  /** Lee una URL y devuelve su contenido como markdown. */
  async function leer(url) {
    const respuesta = await pedir("/v1/tools/fetch", { cuerpo: { url }, timeoutMs: 45000 });
    uso.lecturas += 1;
    uso.costeUsd += PRECIOS.lectura;
    return { titulo: respuesta.title ?? "", contenido: respuesta.content ?? "" };
  }

  /**
   * Convierte texto en audio. El idioma se detecta del texto: la lista publicada no
   * incluye español, así que el orquestador comprueba el idioma antes de llamar.
   */
  async function tts(texto, { voz = "stella", formato = "wav" } = {}) {
    if (texto.length > 9800) {
      throw new Error(
        `El TTS admite hasta 10.000 caracteres por petición y el texto tiene ${texto.length}. Divide el guion.`,
      );
    }
    const audio = await pedir("/v1/tools/tts", {
      cuerpo: { text: texto, voice_id: voz, format: formato, filter_markdown: true },
      timeoutMs: 300000,
      crudo: true,
    });
    uso.caracteresTts += texto.length;
    uso.costeUsd += texto.length * PRECIOS.ttsPorCaracter;
    return Buffer.from(audio);
  }

  return { chat, buscar, leer, tts, uso };
}

/** Traduce los códigos de error documentados a algo accionable. */
function traducirError(estado, cuerpo) {
  const detalle = cuerpo?.slice(0, 300) ?? "";
  if (estado === 401) return "Clave de API no válida o ausente (401). Revisa DEEPSEEK_API_KEY.";
  if (estado === 402) return "La cuenta no tiene saldo (402). Recarga en platform.deepseek.com.";
  if (estado === 404) return `No se pudo leer esa URL o recurso (404). ${detalle}`;
  if (estado === 429) return "Demasiadas peticiones (429). Baja la concurrencia o reintenta.";
  if (estado === 400) return `Petición inválida (400). ${detalle}`;
  return `Error ${estado} de la API. ${detalle}`;
}
