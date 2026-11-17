# Edición · Episodio 01 · «La hora que cuenta»

**Veredicto: aprobado.** Cinco afirmaciones de mayor impacto verificadas contra la fuente
primaria; dos observaciones menores, ya corregidas en el guion antes de publicar.

**Nota de proceso.** Este episodio se produjo en una sola sesión de trabajo: dirección,
redacción y edición las ejecutó el mismo agente, sin pasar por el workflow automático. Por eso
este archivo deja la verificación explícita: es la parte que el sistema automático hace con
agentes separados y que aquí se ha hecho a mano. El episodio 02 sí debe pasar por
`proceso/workflow.mjs`, con la edición como agente independiente.

## Verificación de las afirmaciones de mayor impacto

| # | Afirmación del guion | Fuente | Comprobación | Estado |
| --- | --- | --- | --- | --- |
| 1 | «El desempleo sube al 4,7 %, el más alto en casi cinco años» | ABS, nota de prensa 15/10/2026 [2]; titular de PS News [5] | La ABS publica 4,7 % desestacionalizado en septiembre de 2026. El «casi cinco años» es del titular periodístico, no de la ABS: el guion lo atribuye al titular. | Soportada |
| 2 | «Para la ABS, una persona está empleada si trabajó una hora o más en la semana de referencia» | ABS, *How the ABS measures unemployment* [3] | Definición literal: no trabajar más de una hora; buscar en las cuatro semanas previas; estar disponible. | Soportada |
| 3 | «Desestacionalizado 4,7 % y tendencia 4,6 %; la ABS recomienda la tendencia» | ABS, nota 15/10/2026 [2] | Ambas series aparecen con esos valores; la nota recomienda la tendencia como mejor medida del comportamiento de fondo. | Soportada |
| 4 | «Participación 66,8 % (−0,2 pp); empleo-población 63,6 % (−0,3 pp)» | ABS, nota 15/10/2026 [2] | Cifras y variaciones coinciden al decimal. | Soportada |
| 5 | «Subempleo 6,3 %; subutilización 11,0 % con subida marginal» | ABS, nota 15/10/2026 [2] | El subempleo sube 0,1 pp hasta 6,3 %. La subutilización figura como 11,0 % con subida marginal en el párrafo de tendencia; el guion usa la misma formulación «con una subida marginal» y no le atribuye una serie distinta. | Soportada, con observación |
| 6 | «39.000 ocupados menos y 9.000 desempleados más» | ABS, nota 15/10/2026 [2] | Literal en la cita del responsable de estadísticas laborales. | Soportada |
| 7 | «Horas de tiempo parcial −1,5 %, tiempo completo +0,4 %, total +0,1 %» | ABS, nota 15/10/2026 [2] | Coincide. | Soportada |
| 8 | «Semana de referencia del 30 de agosto al 12 de septiembre; informe publicado el 15 de octubre» | ABS, nota 15/10/2026 [2] | Coincide. La diferencia es de 33 días, por lo que «más de un mes» es correcto. | Soportada |
| 9 | «Cambio de modelo de recolección; elimina un efecto que antes aparecía en febrero y agosto» | ABS, nota 15/10/2026 [2] | La nota lo dice así y pide cautela con el dato desestacionalizado de septiembre. | Soportada |
| 10 | «Una de cada nueve personas disponibles» | Cálculo propio sobre 11,0 % | 1 ÷ 0,11 = 9,09. Rotulado en el guion como aritmética nuestra. | Cálculo propio correcto |
| 11 | Ejemplo del denominador: 5/100 = 5 %; 3/98 = 3,1 % | Cálculo propio | Aritmética correcta; el guion lo rotula como ejemplo ilustrativo y aclara que no describe septiembre. | Cálculo propio correcto |

## Correcciones aplicadas

1. La tasa de subutilización se presentaba como «11,0 % en septiembre» sin serie. Se reescribió
   para reflejar la formulación de la fuente («con una subida marginal») y no atribuirle una
   serie que la nota no especifica en ese párrafo.
2. La entradilla decía «catorce minutos» con un guion de trece. Corregido.

## Observaciones no bloqueantes

- El titular «el más alto en casi cinco años» procede de un medio, no de la ABS. El guion lo
  atribuye explícitamente al titular, que es la forma correcta de usarlo.
- La dirección de la fuente 1 es «latest release»: cambia cada mes. Por eso la ficha de la
  fuente lleva la fecha de la edición y el guion cita la fecha al hablar.
- No se ha verificado el número absoluto de subempleados (981.400) porque solo aparece en
  fuentes secundarias; se usó la tasa, que sí está en la nota primaria.
