/* Alerta Paraná Corrientes
   Los datos salen de datos.json, que se actualiza solo con la lectura oficial (ver scripts/actualizar.py).
   Esta página no inventa valores: si la fuente no publica, lo dice. */

const REPO_RAW = 'https://raw.githubusercontent.com/gonzalezforastier-coder/parana-alerta-corrientes/main/datos.json';
const REFRESCO_MS = 5 * 60 * 1000;      // la página vuelve a pedir datos.json cada 5 minutos
const LIMITE_FUENTE_DIAS = 2;           // lectura oficial con 2 o más días: se avisa
const LIMITE_CONSULTA_HS = 3;           // si nadie consultó la fuente hace más de 3 horas: se avisa

const $ = s => document.querySelector(s);
const fmt = n => Number(n).toFixed(2).replace('.', ',');
const fmtFecha = iso => iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);
const hoyAR = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });

let datos = null;
let usuarioMovioSlider = false;
let mapa = null;

/* ---------- Carga de datos ---------- */
async function pedir(url) {
  const r = await fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' });
  if (!r.ok) throw new Error(url + ' → ' + r.status);
  return r.json();
}
async function cargarDatos() {
  const candidatos = [];
  for (const u of [REPO_RAW, 'datos.json']) {
    try { candidatos.push(await pedir(u)); } catch (e) { console.warn('Datos:', e.message); }
  }
  if (!candidatos.length) return null;
  candidatos.sort((a, b) => String(b.consultado).localeCompare(String(a.consultado)));
  return candidatos[0];
}

/* ---------- Pantalla ---------- */
function pintar() {
  const d = datos, L = d.lectura, E = d.escala;
  const h = L.altura_m;

  $('#altura').textContent = fmt(h);
  $('#fuente-linea').textContent =
    'Lectura oficial del ' + fmtFecha(L.fecha) + ' · Fuente: ' + L.fuente +
    ' · Datos consultados el ' + new Date(d.consultado).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', dateStyle: 'short', timeStyle: 'short' });

  const v = L.variacion_m;
  if (typeof v === 'number') {
    $('#tendencia').textContent = v > 0 ? '↑ Subiendo' : v < 0 ? '↓ Bajando' : '→ Estable';
    $('#variacion').textContent = (v > 0 ? '+' : '') + fmt(v) + ' m respecto de la lectura anterior';
  } else {
    $('#tendencia').textContent = '–'; $('#variacion').textContent = 'Sin dato de variación';
  }

  $('#nivel-alerta').textContent = fmt(E.alerta_m) + ' m';
  $('#nivel-evac').textContent = fmt(E.evacuacion_m) + ' m';
  const dif = h - E.evacuacion_m, caja = $('#nivel-actual');
  caja.className = dif > 0 ? 'over' : '';
  caja.querySelector('b').textContent = dif > 0
    ? '+' + Math.round(dif * 100) + ' cm sobre evacuación'
    : (h >= E.alerta_m ? 'Sobre alerta, ' + Math.round(-dif * 100) + ' cm bajo evacuación' : Math.round((E.alerta_m - h) * 100) + ' cm bajo alerta');

  avisos();
  grafico();
  if (!usuarioMovioSlider) $('#sim-range').value = Math.min(8.5, Math.max(4, h));
  simulacion();
}

function avisos() {
  const d = datos, b = $('#banner'), msgs = [];
  let clase = 'stale';
  const dias = Math.round((Date.parse(hoyAR()) - Date.parse(d.lectura.fecha)) / 86400000);
  if (dias >= LIMITE_FUENTE_DIAS) {
    msgs.push('Sin actualización oficial desde el ' + fmtFecha(d.lectura.fecha) + '. La altura que se muestra puede no ser la actual.');
  }
  const hs = (Date.now() - Date.parse(d.consultado)) / 3600000;
  if (hs > LIMITE_CONSULTA_HS) {
    msgs.push('Esta página no pudo consultar la fuente oficial desde hace ' + Math.floor(hs) + ' horas.');
  }
  if (d.estado && d.estado !== 'ok') {
    clase = 'error';
    msgs.push('No se pudo leer la fuente oficial en la última consulta' + (d.mensaje ? ' (' + d.mensaje + ')' : '') + '. Se muestra la última lectura válida.');
  }
  b.hidden = !msgs.length;
  b.className = 'banner ' + clase;
  b.innerHTML = msgs.map(m => '<div>' + m + '</div>').join('');
}

/* ---------- Gráfico ---------- */
function grafico() {
  const d = datos, E = d.escala, svg = $('#grafico');
  const serie = d.historial.slice();
  if (!serie.some(p => p.fecha === d.lectura.fecha)) serie.push({ fecha: d.lectura.fecha, altura_m: d.lectura.altura_m, tipo: 'publicado' });
  serie.sort((a, b) => a.fecha.localeCompare(b.fecha));
  const W = 1000, H = 380, p = { l: 62, r: 30, t: 34, b: 56 };
  const vals = serie.map(s => s.altura_m).concat([E.alerta_m, E.evacuacion_m]);
  const min = Math.floor(Math.min(...vals) - 0.4), max = Math.ceil(Math.max(...vals) + 0.4);
  const t = f => Date.parse(f + 'T12:00:00Z'), t0 = t(serie[0].fecha), t1 = t(serie[serie.length - 1].fecha) || t0 + 1;
  const x = s => serie.length === 1 ? (p.l + W - p.r) / 2 : p.l + (t(s.fecha) - t0) * (W - p.l - p.r) / (t1 - t0);
  const y = v => p.t + (max - v) * (H - p.t - p.b) / (max - min);
  const grilla = [];
  for (let m = min; m <= max; m++) grilla.push(`<line x1="${p.l}" x2="${W - p.r}" y1="${y(m)}" y2="${y(m)}" stroke="#e3e7e2"/><text class="g-lbl" x="${p.l - 10}" y="${y(m) + 4}" text-anchor="end">${m}</text>`);
  const umbral = [[E.alerta_m, 'alerta', 'Alerta ' + fmt(E.alerta_m) + ' m'], [E.evacuacion_m, 'evac', 'Evacuación ' + fmt(E.evacuacion_m) + ' m']]
    .map(([v, c, txt]) => `<line class="g-th ${c}" x1="${p.l}" x2="${W - p.r}" y1="${y(v)}" y2="${y(v)}"/><text class="g-lbl" x="${p.l + 6}" y="${y(v) - 7}">${txt}</text>`).join('');
  const linea = serie.map((s, i) => (i ? 'L' : 'M') + ' ' + x(s).toFixed(1) + ' ' + y(s.altura_m).toFixed(1)).join(' ');
  const area = linea + ` L ${x(serie[serie.length - 1]).toFixed(1)} ${H - p.b} L ${x(serie[0]).toFixed(1)} ${H - p.b} Z`;
  const puntos = serie.map(s => `<circle class="g-pt ${s.tipo === 'calculado' ? 'calc' : ''}" cx="${x(s).toFixed(1)}" cy="${y(s.altura_m).toFixed(1)}" r="7"><title>${fmtFecha(s.fecha)}: ${fmt(s.altura_m)} m (${s.tipo}${s.fuente ? '. ' + s.fuente : ''})</title></circle>` +
    `<text class="g-val" x="${x(s).toFixed(1)}" y="${(y(s.altura_m) - 14).toFixed(1)}" text-anchor="middle">${fmt(s.altura_m)}</text>` +
    `<text class="g-lbl" x="${x(s).toFixed(1)}" y="${H - 24}" text-anchor="middle">${s.fecha.slice(8, 10)}/${s.fecha.slice(5, 7)}</text>`).join('');
  svg.innerHTML = grilla.join('') + umbral + `<path class="g-area" d="${area}"/><path class="g-line" d="${linea}"/>` + puntos;
}

/* ---------- Simulación y cota del agua ---------- */
function cotaAgua(h) { const E = datos.escala; return E.cero_igin_m + h + (E.calibracion_m || 0); }

function simulacion() {
  const E = datos.escala, h = Number($('#sim-range').value), c = cotaAgua(h);
  let rel = '';
  if (h > E.evacuacion_m) rel = ' Supera el nivel de evacuación por ' + Math.round((h - E.evacuacion_m) * 100) + ' cm.';
  else if (h >= E.alerta_m) rel = ' Está sobre el nivel de alerta.';
  else rel = ' Está por debajo del nivel de alerta.';
  $('#sim-text').innerHTML = '<b>Simulación:</b> si la escala del puerto marcara <b>' + fmt(h) + ' m</b>, el agua estaría en la cota <b>' + fmt(c) +
    ' m</b> sobre el nivel del mar (' + fmt(E.cero_igin_m) + ' + ' + fmt(h) + ').' + rel +
    ' La zona celeste del mapa es terreno por debajo de esa cota según un modelo aproximado: posible exposición, no inundación confirmada.';
  ponerAgua(c);
}

let temporizador = null;
function ponerAgua(cota) {
  if (!mapa || !mapa.isStyleLoaded()) { pendiente = cota; return; }
  clearTimeout(temporizador);
  temporizador = setTimeout(() => {
    if (mapa.getLayer('agua')) mapa.removeLayer('agua');
    if (mapa.getSource('agua')) mapa.removeSource('agua');
    mapa.addSource('agua', { type: 'raster', tiles: ['wl://{z}/{x}/{y}?l=' + cota.toFixed(2)], tileSize: 256, maxzoom: 14 });
    mapa.addLayer({ id: 'agua', type: 'raster', source: 'agua', paint: { 'raster-opacity': 0.6, 'raster-fade-duration': 0 } }, 'contours');
  }, 250);
}
let pendiente = null;

/* Capa que pinta de celeste los píxeles del modelo de elevación que están por debajo de la cota */
function registrarProtocoloAgua() {
  maplibregl.addProtocol('wl', async params => {
    const m = params.url.match(/^wl:\/\/(\d+)\/(\d+)\/(\d+)\?l=(-?[\d.]+)/);
    const [, z, x, y, l] = m, nivel = parseFloat(l);
    const r = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`);
    const img = await createImageBitmap(await r.blob());
    const cv = new OffscreenCanvas(256, 256), cx = cv.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, 0, 256, 256);
    const im = cx.getImageData(0, 0, 256, 256), px = im.data;
    for (let i = 0; i < px.length; i += 4) {
      const elev = px[i] * 256 + px[i + 1] + px[i + 2] / 256 - 32768;
      if (elev <= nivel) { px[i] = 47; px[i + 1] = 140; px[i + 2] = 255; px[i + 3] = 255; } else px[i + 3] = 0;
    }
    cx.putImageData(im, 0, 0);
    const out = await cv.convertToBlob({ type: 'image/png' });
    return { data: await out.arrayBuffer() };
  });
}

/* ---------- Mapa ---------- */
function iniciarMapa() {
  const lectura = $('#terrain-readout');
  const falla = () => { lectura.textContent = 'No se pudo cargar el relieve. Revisá la conexión y actualizá la página.'; };
  if (!window.maplibregl || !window.mlcontour) return falla();
  try {
    registrarProtocoloAgua();
    const dem = new mlcontour.DemSource({ url: 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png', encoding: 'terrarium', maxzoom: 15, worker: false });
    dem.setupMaplibre(maplibregl);
    mapa = new maplibregl.Map({
      container: 'terrain-map', center: [-58.82, -27.47], zoom: 12.2, pitch: 35, bearing: -8, minZoom: 10.5, maxZoom: 17,
      maxBounds: [[-58.97, -27.60], [-58.65, -27.31]], attributionControl: false,
      style: {
        version: 8, glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
        sources: {
          satellite: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, attribution: 'Esri World Imagery' },
          terrain: { type: 'raster-dem', tiles: [dem.sharedDemProtocolUrl], tileSize: 256, maxzoom: 15, encoding: 'terrarium' },
          contours: { type: 'vector', tiles: [dem.contourProtocolUrl({ thresholds: { 10: [5, 25], 11: [5, 25], 12: [2, 10], 13: [2, 10], 14: [1, 5], 15: [1, 5], 16: [1, 5], 17: [1, 5] }, overzoom: 1, elevationKey: 'ele', levelKey: 'level', contourLayer: 'contours' })], maxzoom: 17 }
        },
        layers: [
          { id: 'satellite', type: 'raster', source: 'satellite' },
          { id: 'hillshade', type: 'hillshade', source: 'terrain', paint: { 'hillshade-shadow-color': '#102f31', 'hillshade-highlight-color': '#fff1cd', 'hillshade-accent-color': '#5f817b', 'hillshade-exaggeration': .42 } },
          { id: 'contours', type: 'line', source: 'contours', 'source-layer': 'contours', paint: { 'line-color': ['match', ['get', 'level'], 1, '#fff2a8', '#41d6be'], 'line-opacity': .95, 'line-width': ['match', ['get', 'level'], 1, 2, 1] } },
          { id: 'contour-labels', type: 'symbol', source: 'contours', 'source-layer': 'contours', filter: ['>', ['get', 'level'], 0], layout: { 'symbol-placement': 'line', 'text-size': 11, 'text-field': ['concat', ['number-format', ['get', 'ele'], { 'max-fraction-digits': 0 }], ' m'], 'text-font': ['Noto Sans Bold'] }, paint: { 'text-color': '#fff', 'text-halo-color': '#07343a', 'text-halo-width': 2 } }
        ],
        terrain: { source: 'terrain', exaggeration: 1.8 }
      }
    });
    mapa.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-right');
    mapa.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
    mapa.on('load', () => { lectura.textContent = 'Mapa cargado · tocá un terreno para conocer su cota aproximada'; mapa.resize(); if (datos) ponerAgua(cotaAgua(Number($('#sim-range').value))); });
    mapa.on('error', e => { if (e && e.error) console.warn('Mapa:', e.error.message); });
    mapa.on('click', e => {
      const el = mapa.queryTerrainElevation(e.lngLat, { exaggerated: false });
      const txt = Number.isFinite(el) ? 'Cota aproximada: ' + String(Math.round(el * 10) / 10).replace('.', ',') + ' m s. n. m.' : 'Cota no disponible en este punto';
      lectura.textContent = txt;
      new maplibregl.Popup({ closeButton: false, offset: 10 }).setLngLat(e.lngLat).setHTML('<strong>' + txt + '</strong>').addTo(mapa);
    });
  } catch (err) { console.warn(err); falla(); }
}

/* ---------- Arranque ---------- */
$('#sim-range').addEventListener('input', () => { usuarioMovioSlider = true; simulacion(); });
$('#sim-reset').addEventListener('click', () => { usuarioMovioSlider = false; if (datos) { $('#sim-range').value = Math.min(8.5, Math.max(4, datos.lectura.altura_m)); simulacion(); } });

async function actualizar() {
  const nuevo = await cargarDatos();
  if (!nuevo) { if (!datos) $('#fuente-linea').textContent = 'No se pudieron cargar los datos. Actualizá la página.'; return; }
  datos = nuevo;
  pintar();
}
iniciarMapa();
actualizar();
setInterval(actualizar, REFRESCO_MS);
