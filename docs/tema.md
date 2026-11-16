# Tema, logo y voz de los avisos

Todo lo visual es una plantilla. Pon tus archivos en `datos/tema/`; el repositorio solo trae el tema neutro.

| Archivo | Para qué |
| --- | --- |
| `tema.css` | Colores, letras y logo (variables CSS). Parte de [`themes/neutro.css`](../themes/neutro.css). |
| `icono.svg`, `icono-180.png`, `icono-192.png`, `icono-512.png` | Ícono de la app instalada y de los avisos. |
| `avisos.json` | Textos, sonido y botones de cada aviso para todo tu equipo. Parte de [`themes/avisos.ejemplo.json`](../themes/avisos.ejemplo.json). |
| Letras u otros archivos | Se sirven en `/tema/…`, por ejemplo `url(/tema/fonts/MiLetra.woff2)`. |

Variables de `tema.css`: `--fondo`, `--superficie`, `--texto`, `--suave`, `--linea`, `--acento`, `--acento-texto`, `--peligro`, `--ok`, `--fuente`, `--fuente-titulos`, `--mayus-titulos`, `--radio`, `--sombra`, `--logo`.

Cada persona puede editar encima de `avisos.json` desde **Ajustes → Personalizar → Avisos**. Botones disponibles: `iniciar`, `sugerencia1`, `sugerencia2`, `seguir`, `parar`, `silenciar30`, `silenciar60`, `armar`, `abrir`. Variables: `{titulo} {hora} {fin} {minutos} {sin_registrar} {sugerencia} {lleva} {estimado} {agenda} {nombre}`.
