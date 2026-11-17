// Reproductor del guion con la voz del navegador (SpeechSynthesis).
// Lee el guion sección a sección, sin descargar audio y sin dependencias.

(() => {
  const caja = document.getElementById("voz");
  const datos = document.getElementById("guion-datos");
  if (!caja || !datos) return;

  let secciones = [];
  try {
    secciones = JSON.parse(datos.textContent);
  } catch (error) {
    // El JSON inline lo genera construir.mjs; si está roto, no hay reproductor.
    void error;
    return;
  }

  const play = document.getElementById("vozPlay");
  const pausa = document.getElementById("vozPausa");
  const stop = document.getElementById("vozStop");
  const velocidad = document.getElementById("vozVelocidad");
  const estado = document.getElementById("vozEstado");

  if (!("speechSynthesis" in window)) {
    play.disabled = true;
    estado.textContent = "Este navegador no puede leer el guion en voz alta. Puedes leerlo completo abajo.";
    return;
  }

  const sintesis = window.speechSynthesis;
  let cola = [];
  let indice = 0;
  let sonando = false;
  let pausado = false;

  const marcar = (indiceSeccion) => {
    document.querySelectorAll(".seccion-guion").forEach((nodo, posicion) => {
      nodo.classList.toggle("activa", posicion === indiceSeccion);
    });
    const seccion = secciones[indiceSeccion];
    if (seccion) {
      estado.textContent = `Leyendo ${indiceSeccion + 1} de ${secciones.length} · ${seccion.titulo}`;
    }
  };

  /** Divide una sección en trozos cortos; los trozos largos no responden a la pausa. */
  const trocear = (texto) => {
    const frases = texto.split(/(?<=[.!?])\s+/);
    const trozos = [];
    let actual = "";
    for (const frase of frases) {
      if ((actual + " " + frase).trim().length > 180 && actual) {
        trozos.push(actual.trim());
        actual = frase;
      } else {
        actual = `${actual} ${frase}`.trim();
      }
    }
    if (actual.trim()) trozos.push(actual.trim());
    return trozos;
  };

  const construirCola = () => {
    cola = [];
    secciones.forEach((seccion, indiceSeccion) => {
      for (const trozo of trocear(seccion.texto)) {
        cola.push({ texto: trozo, indiceSeccion });
      }
    });
  };

  const hablarSiguiente = () => {
    if (indice >= cola.length) {
      terminar("Lectura terminada. Vuelve cuando quieras.");
      return;
    }
    const elemento = cola[indice];
    const locucion = new SpeechSynthesisUtterance(elemento.texto);
    locucion.lang = "es-ES";
    locucion.rate = Number(velocidad.value) || 1;
    locucion.pitch = 1;
    locucion.onstart = () => marcar(elemento.indiceSeccion);
    locucion.onend = () => {
      indice += 1;
      hablarSiguiente();
    };
    locucion.onerror = (evento) => {
      // "interrupted" y "canceled" llegan al detener: no son fallos.
      if (evento.error === "interrupted" || evento.error === "canceled") return;
      terminar("La lectura se interrumpió. Pulsa Escuchar para empezar de nuevo.");
    };
    sintesis.speak(locucion);
  };

  const actualizarBotones = () => {
    play.disabled = sonando && !pausado;
    pausa.disabled = !sonando;
    pausa.textContent = pausado ? "Reanudar" : "Pausar";
    stop.disabled = !sonando;
  };

  const terminar = (mensaje) => {
    sonando = false;
    pausado = false;
    indice = 0;
    cola = [];
    sintesis.cancel();
    document.querySelectorAll(".seccion-guion").forEach((nodo) => nodo.classList.remove("activa"));
    if (mensaje) estado.textContent = mensaje;
    actualizarBotones();
  };

  play.addEventListener("click", () => {
    sintesis.cancel();
    construirCola();
    indice = 0;
    sonando = true;
    pausado = false;
    actualizarBotones();
    // Algunos navegadores necesitan un ciclo antes de aceptar la locución.
    setTimeout(hablarSiguiente, 60);
  });

  pausa.addEventListener("click", () => {
    if (!sonando) return;
    if (pausado) {
      sintesis.resume();
      pausado = false;
      estado.textContent = "Leyendo…";
    } else {
      sintesis.pause();
      pausado = true;
      estado.textContent = "En pausa.";
    }
    actualizarBotones();
  });

  stop.addEventListener("click", () => terminar("Lectura detenida."));

  document.addEventListener("keydown", (evento) => {
    if (evento.key === "Escape" && sonando) terminar("Lectura detenida.");
  });

  window.addEventListener("pagehide", () => sintesis.cancel());
})();
