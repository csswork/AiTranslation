# Capturas y GIF del README

[English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [Français](README.fr.md) · [Deutsch](README.de.md) · **Español** · [العربية](README.ar.md)

Fecha de captura: 2026-11-13. Versión de la extensión: **2.2.0 de desarrollo**, cargada desde el código fuente; esto no significa que ya esté disponible en las tiendas.

Capturas realizadas en macOS con Chrome for Testing 150, cargando `apps/extension` de este repositorio en un perfil de navegador independiente. La interfaz está en chino simplificado. La traducción utiliza DeepSeek (`deepseek-flash`). El reconocimiento de imágenes, la traducción de artículos y las expresiones alternativas siguen el flujo real de solicitudes de la extensión y muestran las respuestas del modelo en esa ejecución.

Los PNG son capturas directas del navegador a 1280 × 800. Los GIF proceden de fotogramas grabados realmente por Chrome, codificados según sus marcas de tiempo a 1000 × 625 y 10 fps, con repetición infinita. Solo se comprimen la resolución y la paleta. La automatización activa los mensajes o la inyección de scripts de las acciones del menú contextual; los GIF no incluyen el menú nativo del navegador.

## Demostraciones animadas

| Archivo | Acciones |
| --- | --- |
| [image-recognition.gif](image-recognition.gif) | Reconocer un menú japonés → superponer la traducción al chino → comparar con el original → abrir el editor de una traducción → seleccionar una zona |
| [bilingual-reader.gif](bilingual-reader.gif) | Analizar un artículo → quitar anuncios y mostrar el texto bilingüe → elegir otra expresión → alternar disposición vertical / en paralelo → guardar → activar modo oscuro |

## Capturas estáticas

| Archivo | Escena |
| --- | --- |
| [01-bilingual-reader.png](01-bilingual-reader.png) | Párrafos originales y traducidos alineados en paralelo |
| [02-word-alternatives.png](02-word-alternatives.png) | Expresión seleccionada, texto original, alternativas y sustitución personalizada |
| [03-reader-library.png](03-reader-library.png) | Lectura en modo oscuro y artículos guardados en el dispositivo |
| [04-image-translation.png](04-image-translation.png) | Reconocimiento de un menú japonés con traducciones siguiendo la forma del texto |
| [05-image-editing.png](05-image-editing.png) | Editar una traducción de imagen, ajustar el tamaño de letra o volver a traducir |
| [06-selection-translation.png](06-selection-translation.png) | Ventana de traducción del texto seleccionado con el original desplegado |
| [07-translation-panel.png](07-translation-panel.png) | Panel de traducción independiente |
| [08-pdf-translation.png](08-pdf-translation.png) | PDF original y traducido en paralelo; procesado localmente, dos páginas |
| [09-region-translation.png](09-region-translation.png) | Traducción de una zona en la propia página con botón al pasar el cursor |

## Materiales de ejemplo

El artículo, la imagen del menú japonés y el PDF son materiales locales de ejemplo ya existentes en este repositorio. Los nombres de medios, autores, fechas y datos de prueba del PDF son ilustrativos; no representan noticias reales ni resultados de rendimiento. El artículo incluye espacios publicitarios. La página de lectura muestra el cuerpo extraído por la extensión tras eliminar los anuncios. El modelo reconoce y traduce el menú y la extensión dibuja la traducción al chino.

Los scripts de captura, fotogramas intermedios y perfiles de navegador se guardan en el directorio local ignorado `tools/capture/` y no forman parte de los paquetes de la extensión. Este directorio solo contiene los archivos multimedia finales y su documentación.
