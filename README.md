# Alerta Paraná Corrientes

Muestra la última altura oficial del río Paraná en Puerto Corrientes, un mapa de cotas de Corrientes Capital y una simulación de cómo cambiaría la cota del agua según la altura de la escala.

- `datos.json`: última lectura oficial e historial. Lo actualiza solo `scripts/actualizar.py` (flujo `.github/workflows/actualizar.yml`, cada 30 minutos).
- `index.html`, `app.js`, `styles.css`: la página. Vuelve a pedir `datos.json` cada 5 minutos, sin recargar.
- Si la fuente no publica o no se puede leer, la página lo avisa y conserva la última lectura válida. Nunca inventa valores.
- Cero de la escala de Puerto Corrientes: 41,42 m sobre el nivel del mar (referencia IGN). Dato a confirmar con INA/IGN.

Fuentes: INA (reporte diario), Prefectura Naval Argentina, historial de Copernicus Argentina (CC BY 4.0).
