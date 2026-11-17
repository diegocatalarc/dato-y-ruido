# Dato y Ruido

Podcast de análisis de datos, publicado en GitHub Pages y producido por un sistema de cinco
agentes: **dirección, investigación, redacción, edición y publicación**. Cada episodio toma una
cifra que circula en Australia y responde de dónde sale, qué esconde y cómo usarla bien.

Este repositorio no es un documento de diseño: es el sistema funcionando, con el episodio 01
publicado y su rastro completo.

## El sistema en una imagen

```
tema o cifra
   │
   ▼
Dirección ─────────► escaleta.md · cinco secciones, ángulo y pistas de investigación
   │
   ▼
Investigación (3–4 pistas en paralelo) ─► investigacion/*.md con evidencia textual y URL
   │
   ▼
Redacción ─────────► guion.md hablado, ~1.800 palabras, citas [n] · fuentes.md
   │
   ▼
Edición ───────────► edicion.md · fact-check bloqueante (aprobado / no aprobado)
   │                        │
   │                        └── si no aprueba: el redactor corrige y se re-verifica (máx. 2 rondas)
   ▼
Publicación ───────► episodio.json → construir.mjs → sitio/ + feed.xml
```

Nada se publica sin la aprobación del editor. El contenido viaja por archivos; los agentes
devuelven confirmaciones cortas, así que el pipeline nunca pierde trabajo si un paso falla:
cada fase deja su artefacto en disco.

## Publicar en GitHub Pages

El sitio es estático: HTML, CSS y un JSON con el guion. No hay servidor ni dependencias.

1. Ajusta la URL real en [`podcast.json`](podcast.json) → `"urlBase": "https://TU-USUARIO.github.io/TU-REPO"`.
   El feed la usa para los enlaces absolutos.
2. Crea el repositorio y sube. Saca la carpeta del repositorio del harness (esta carpeta vive
   dentro de otro repositorio de git, y anidar repositorios confunde a ambos):

   ```sh
   cp -R podcast-datos ~/dato-y-ruido
   cd ~/dato-y-ruido
   git init -b main
   git add .
   git commit -m "Dato y Ruido: episodio 01"
   gh repo create dato-y-ruido --public --source=. --push
   ```

3. En el repositorio: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
   El workflow [`.github/workflows/paginas.yml`](.github/workflows/paginas.yml) construye el
   sitio y lo publica en cada push a `main`.
4. La primera publicación tarda un minuto. La URL aparece en la pestaña Actions y en Pages.

Para probar en local, sin red ni servidor:

```sh
node construir.mjs
open sitio/index.html      # funciona desde file://
```

## Añadir un episodio

### Con los agentes, dentro de DSH

Pide en el chat: «lanza el episodio 02 sobre *tema*». El agente prepara la carpeta y ejecuta el
workflow de [`proceso/workflow.mjs`](proceso/workflow.mjs) con estos argumentos:

```json
{
  "topic": "la cifra o el caso del episodio",
  "numero": 2,
  "slug": "identificador-corto",
  "fecha": "2026-12-01",
  "proyectoDir": "/ruta/absoluta/podcast-datos",
  "episodioDir": "/ruta/absoluta/podcast-datos/contenidos/episodios/002-identificador-corto",
  "idioma": "español"
}
```

`proyectoDir` y `episodioDir` deben ser absolutos y la carpeta del episodio debe existir antes de
lanzar. Los cinco roles se ejecutan en secuencia; la investigación va en paralelo. Al final queda
un episodio publicado y el rastro en la misma carpeta.

### Con la API de DeepSeek, independiente de DSH

El mismo sistema corre solo con tu clave, desde la terminal o desde GitHub Actions:

```sh
export DEEPSEEK_API_KEY=sk-...        # o: node --env-file=.env proceso/api/episodio.mjs ...
node proceso/api/episodio.mjs --tema "el 4,7 % de desempleo de septiembre" --fecha 2026-12-01
```

Qué hace, en orden: **dirección** (elige ángulo y cinco secciones), **investigación** (busca con la
Search API, lee las páginas con la Fetch API y escribe un informe por pista con la evidencia
literal), **redacción** (guion hablado con citas `[n]`), **edición** (vuelve a leer las fuentes
citadas y aprueba o rechaza con incidencias concretas) y **publicación** (metadatos, sitio y feed).
Si la edición rechaza, no se publica nada y el rastro queda para corregir.

| Opción | Por defecto | Para qué |
| --- | --- | --- |
| `--tema` | obligatorio | Cifra o caso del episodio |
| `--numero` | siguiente libre | Número de episodio |
| `--slug` | derivado del tema | Nombre de carpeta |
| `--fecha` | hoy | Fecha de emisión |
| `--modelo` | `deepseek-flash` | O `deepseek-v4-pro` para más criterio |
| `--audio` | `auto` | `edge`, `tts`, `say`, `no` |
| `--voz` | `es-CL-CatalinaNeural` | Id neuronal (`es-MX-DaliaNeural`…) o `stella`/`tide` para TTS |
| `--simulacro` | — | Recorre todo el flujo sin llamar a la API |

El gasto de la ejecución se escribe en `coste.json` dentro de la carpeta del episodio: llamadas,
búsquedas, lecturas, tokens y USD estimados.

### A mano

1. Crea `contenidos/episodios/002-slug/` con `episodio.json` (metadatos), `guion.md`
   (`## Sección` + párrafos, citas `[1]`) y, si quieres, `fuentes.md`.
2. `node construir.mjs` y revisa `sitio/`.

`episodio.json` es el contrato con el generador:

```json
{
  "numero": 2,
  "slug": "slug-del-episodio",
  "titulo": "Título",
  "subtitulo": "Una línea",
  "fecha": "2026-12-01",
  "duracionMin": 13,
  "resumen": "Dos frases sin hype.",
  "escaleta": [{ "nombre": "El titular", "minutos": 2, "objetivo": "Qué hace la sección" }],
  "fuentes": [{ "n": 1, "titulo": "Título real", "url": "https://…", "nota": "Qué sostiene" }]
}
```

## Audio

Cada episodio puede tener audio real. El episodio 01 lo tiene: 12 minutos, voz sintética del
sistema, MP3 de 96 kbps, con su `<enclosure>` en el feed.

Cuatro caminos, en orden de calidad y coste:

| Modo | Cómo | Coste | Idioma |
| --- | --- | --- | --- |
| `edge` | Voz neuronal (edge-tts), la que suena a podcast | 0 | Español y más |
| `tts` | TTS de la API de DeepSeek, voces `stella` y `tide` | 0,45 USD por 10.000 caracteres | Solo zh, yue, en, ja, ko, ms, ar, id, th, vi |
| `say` | Voz del sistema (macOS), robótica | 0 | Español y más |
| Grabación | Tu voz, editada a mano | 0 | El que quieras |

La voz neuronal se instala una vez y no necesita clave:

```sh
python3 -m venv .venv-audio
.venv-audio/bin/pip install edge-tts
```

Voces españolas disponibles con `--voz`: `es-CL-CatalinaNeural` (Chile, por defecto),
`es-CL-LorenzoNeural`, `es-MX-DaliaNeural`, `es-ES-ElviraNeural`, `es-AR-ElenaNeural`. En modo
`auto` el sistema elige `edge` si está instalado, luego `tts` si el idioma está soportado y, si no,
`say`.

**El TTS de DeepSeek no publica español.** No es una limitación del sistema: es la lista de idiomas
del servicio. Por eso `--audio auto` usa `say` cuando el guion es en español y `tts` cuando el
idioma está soportado. Si quieres audio con la API sí o sí, el programa tendría que emitirse en
inglés (`--idioma en --audio tts`).

Regenerar el audio de un episodio ya escrito, sin repetir la producción:

```sh
node proceso/api/narrar.mjs --episodio 001-la-hora-que-cuenta --modo say
```

Escribe `audio.mp3`, actualiza `duracionMin` con la duración real (medida con `ffprobe`) y
reconstruye el sitio. Para publicar en Apple Podcasts o Spotify añade además una portada de
1400×1400 en PNG y `"portada": "portada.png"` en `podcast.json`: sin portada, el feed se rechaza.

## Coste y clave

- **Clave:** solo en `DEEPSEEK_API_KEY`, nunca en el repositorio (`.gitignore` cubre `.env`). En
  GitHub Actions, como *secret* del repositorio.
- **Coste estimado por episodio** (precios públicos de hoy, modelo `deepseek-flash`): unas 20
  búsquedas y lecturas (~0,03 USD), 6–8 llamadas al modelo con 100–200 mil tokens de entrada y
  20–40 mil de salida (~0,05–0,10 USD) y, si usas TTS, ~11.000 caracteres (~0,25–0,50 USD).
  Es decir: **menos de 0,15 USD por episodio sin audio y menos de 0,60 USD con audio**. Cada
  ejecución deja el número exacto en `coste.json`.
- **Límites prácticos:** 1M de contexto y 384K de salida por llamada; el TTS corta a 10.000
  caracteres por petición (el orquestador trocea el guion solo).

## Estructura

```
podcast-datos/
  podcast.json                 Marca, descripción y URL base del sitio
  biblia.md                    Qué es el programa: promesa, voz, cinco secciones, reglas de datos
  construir.mjs                Genera sitio/ desde contenidos/ y recursos/ (sin dependencias)
  capturar.mjs                 Verificación en Chrome headless + capturas
  publicar.sh                  Publica en GitHub Pages con gh (idempotente)
  recursos/                    estilos.css y reproductor.js: fuente que se copia a sitio/
  proceso/
    workflow.mjs               Los cinco agentes dentro de DSH (herramienta workflow)
    verificar-workflow.mjs     Comprueba la sintaxis del script del workflow
    api/
      episodio.mjs             Producción completa con la API de DeepSeek
      cliente.mjs              Chat, Search, Fetch y TTS con reintentos y coste
      prompts.mjs              Los cinco roles como prompts
      audio.mjs                TTS de DeepSeek y voz local, con MP3 opcional
      narrar.mjs               Regenera el audio de un episodio existente
  contenidos/episodios/
    001-la-hora-que-cuenta/
      escaleta.md              Dirección: ángulo, secciones y pistas
      investigacion/           Evidencia con fuente (carpeta opcional)
      guion.md                 Redacción: el texto que se escucha
      fuentes.md               Lista numerada y cálculos propios
      edicion.md               Fact-check y veredicto
      episodio.json            Metadatos que consume el generador
  sitio/                       Salida publicada: se regenera y no se versiona (está en .gitignore)
    index.html · feed.xml · episodios.json · estilos.css · reproductor.js · episodio/<slug>/
  .github/workflows/paginas.yml   Despliegue en GitHub Pages
```

## Verificación

```sh
node construir.mjs                       # regenera el sitio
node capturar.mjs                        # Chrome headless: recursos, secciones, citas, responsive, capturas
node proceso/verificar-workflow.mjs      # sintaxis del workflow de DSH
rsync -a --exclude capturas ./ /tmp/copia/ && node proceso/api/episodio.mjs \
  --simulacro --tema "prueba" --numero 99 --audio no --raiz /tmp/copia
                                         # pipeline completo sin clave ni gasto de tokens
```

`capturar.mjs` comprueba que no haya peticiones de red, que las secciones y fuentes estén, que la
entradilla no lleve número, que haya reproductor (audio real o voz del navegador) y que no haya
desbordamiento horizontal a 390 px. Las capturas quedan en `capturas/`.

## Límites honestos

- **La edición es un agente, no una certificación.** Verifica lo que puede; un dato mal publicado
  sigue siendo posible. La fecha de consulta queda en cada fuente.
- **El feed ya tiene enclosure** con el MP3 del episodio 01; para entrar en Apple Podcasts falta
  la portada 1400×1400 y que el audio sea tuyo (la voz del sistema sirve, pero se nota).
- **GitHub Pages no es un CDN de audio.** Sirve para 10–20 episodios sin problema (límite suave de
  1 GB por repositorio y 100 MB por archivo). Si el catálogo crece, el audio se mueve a un
  almacenamiento externo y el feed apunta allí.
- **Un episodio es una cifra, no un tema.** La biblia lo exige a propósito: es lo que hace que el
  programa sea análisis y no comentario.

## Por qué agentes separados y no un solo chat

Un chat que hace todo pierde el rastro y mezcla intereses: quien escribe tiende a defender lo que
escribió. Aquí cada rol tiene su archivo y su puerta: la dirección no investiga, la investigación
no redacta, la redacción no decide si su texto es correcto, y el editor puede bloquear. Esa
separación es lo que hace que el resultado sea auditable y repetible con otro tema el mes que
viene. No hace falta un enjambre: cinco roles y un orquestador bastan para un programa.
