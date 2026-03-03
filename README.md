# Tab Fusion

Extensión de Chrome MV3 para consolidar tabs de varias ventanas en una sola, crear grupos manuales y restaurar snapshots guardados por la propia extensión.

## Features

- Unir todas las ventanas normales en una sola con un click desde el popup.
- Guardar un snapshot antes de cada consolidación para restaurarlo después.
- Deshacer el último merge de forma segura cuando el estado original sigue intacto.
- Crear grupos manuales de tabs en la ventana actual con nombre y color.
- Agrupar tabs automáticamente por dominio.
- Detectar y cerrar tabs duplicadas.
- Dashboard dedicado para revisar historial, restaurar snapshots y eliminarlos.
- Exportar e importar snapshots en JSON.

## Stack

- Manifest V3
- TypeScript
- React
- Vite
- Vitest
- Playwright

## Scripts

- `npm run build`: compila la extensión a `dist/`
- `npm run dev`: build en modo watch
- `npm run check`: typecheck + tests + build
- `npm run setup:e2e`: instala Chromium para Playwright
- `npm run package`: genera `release/tab-fusion.zip`
- `npm run typecheck`: validación estática
- `npm run test:run`: pruebas unitarias e integración
- `npm run e2e`: pruebas end-to-end reales cargando la extensión en Chromium
- `npm run verify:prod`: corre toda la validación y genera el zip de release

## Uso local

1. Ejecuta `npm install`.
2. Ejecuta `npm run build`.
3. Abre `chrome://extensions`.
4. Activa `Developer mode`.
5. Carga `dist/` con `Load unpacked`.

## Notas

- Los snapshots se guardan en `chrome.storage.local`.
- La restauración crea ventanas nuevas y no destruye tu sesión actual.
- Las URLs internas del navegador como `chrome://...` se registran en el snapshot pero se omiten durante la restauración.
- El popup incluye restauración rápida del snapshot más reciente.
- El dashboard incluye búsqueda por título o URL para revisar actividad.
- El undo del último merge elimina las tabs fusionadas sólo si no cambiaron desde la consolidación; si cambiaron, restaura el snapshot sin borrar el estado actual.
