#!/usr/bin/env python3
"""Lee la altura del río Paraná en Corrientes (lecturas de Prefectura Naval Argentina) y actualiza datos.json.

Reglas:
- Solo guarda una lectura nueva si se pudo leer con certeza (altura + fecha + niveles de alerta
  y evacuación que coinciden con los del archivo). Si algo no cierra, NO inventa ni repite:
  deja la última lectura válida, marca estado "error" y la página lo muestra en un cartel.
- Consulta varias páginas que publican las lecturas de Prefectura y guarda la de fecha más reciente,
  indicando siempre de cuál salió. Nunca reemplaza una lectura por otra de fecha anterior.
"""
import html
import json
import re
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

ARCHIVO = Path(__file__).resolve().parent.parent / "datos.json"
FUENTES = [
    {
        "tipo": "rioparana",
        "nombre": "Prefectura Naval Argentina (vía rioparana.com.ar)",
        "url": "https://rioparana.com.ar/rio/corrientes",
    },
    {
        "tipo": "copernicus",
        "nombre": "Prefectura Naval Argentina (lecturas publicadas por el INA, vía Copernicus Argentina)",
        "url": "https://copernicus.com.ar/rio/corrientes",
    },
    {
        "tipo": "ina",
        "nombre": "INA, reporte diario (lecturas de Prefectura Naval Argentina)",
        "url": "https://alerta.ina.gob.ar/a5/diario/reporte_diario",
    },
]
MESES = {m: i + 1 for i, m in enumerate("enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre".split())}
NUM = r"(\d{1,2}[.,]\d{1,2})"


def descargar(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (alerta-parana-corrientes; lectura publica)"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read().decode("utf-8", errors="replace")


def a_texto(crudo):
    t = re.sub(r"(?is)<(script|style).*?</\1>", " ", crudo)
    # los textos emergentes (title, etc.) suelen traer la fecha de la lectura: pasarlos a texto visible
    t = re.sub(r'(?is)<([a-z0-9]+)([^>]*?)\s(?:title|data-title|data-original-title|data-bs-original-title|aria-label)="([^"]*)"([^>]*)>',
               r"<\1\2\4> \3 ", t)
    t = re.sub(r"<[^>]+>", " ", t)
    t = html.unescape(t)
    return re.sub(r"\s+", " ", t)


def num(s):
    return float(s.replace(",", "."))


def fecha_iso(dd, mm, aaaa):
    return f"{aaaa}-{int(mm):02d}-{int(dd):02d}"


def leer(texto, alerta, evac):
    """Devuelve (altura, fecha_iso, variacion|None) o lanza ValueError con el motivo."""
    for m in re.finditer(r"Corrientes", texto):
        ventana = texto[m.start(): m.start() + 400]
        numeros = [(x.group(1), x.start()) for x in re.finditer(NUM, ventana)]
        valores = [num(n) for n, _ in numeros]
        # buscamos el par consecutivo alerta, evacuación; el nivel es el número anterior
        for i in range(1, len(valores) - 1):
            if abs(valores[i] - alerta) < 0.001 and abs(valores[i + 1] - evac) < 0.001:
                altura = valores[i - 1]
                variacion = None
                if i >= 2 and abs(valores[i - 2]) < 2:
                    variacion = valores[i - 2]
                # fecha: la primera dd/mm/aaaa dentro de la ventana, o la más cercana en la página
                f = re.search(r"(\d{1,2})/(\d{1,2})/(20\d{2})", ventana)
                if not f:
                    raise ValueError("se leyó la altura pero no la fecha de esa lectura (no se usa la fecha de otra parte de la página)")
                return altura, fecha_iso(*f.groups()), variacion
    raise ValueError("no se encontró la fila de Corrientes con alerta y evacuación esperadas")


def leer_copernicus(texto):
    """Respaldo: 'Corrientes ... 7,36 m ... 21/10/2026'."""
    m = re.search(r"(\d{1,2}[.,]\d{2})\s*m[^0-9]{0,120}?(\d{1,2})/(\d{1,2})/(20\d{2})", texto)
    if not m:
        raise ValueError("no se encontró altura y fecha")
    return num(m.group(1)), fecha_iso(m.group(2), m.group(3), m.group(4)), None


def leer_rioparana(texto):
    """'Corrientes (17 de octubre de 2026) ... 6,66 m'"""
    m = re.search(r"Corrientes\s*\(\s*(\d{1,2}) de ([a-záéíóú]+) de (20\d{2})\s*\)", texto, re.I)
    if not m or m.group(2).lower() not in MESES:
        raise ValueError("no se encontró 'Corrientes (fecha)'")
    ventana = texto[m.end(): m.end() + 250]
    h = re.search(r"(\d{1,2}[.,]\d{1,2})\s*m\b", ventana)
    if not h:
        raise ValueError("no se encontró la altura junto a la fecha")
    return num(h.group(1)), fecha_iso(m.group(1), MESES[m.group(2).lower()], m.group(3)), None


def main():
    d = json.loads(ARCHIVO.read_text(encoding="utf-8"))
    ahora = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    E = d["escala"]
    errores, hallazgo = [], None

    encontrados = []
    for prioridad, f in enumerate(FUENTES):
        try:
            texto = a_texto(descargar(f["url"]))
            if f["tipo"] == "ina":
                altura, fecha, variacion = leer(texto, E["alerta_m"], E["evacuacion_m"])
            elif f["tipo"] == "rioparana":
                altura, fecha, variacion = leer_rioparana(texto)
            else:
                altura, fecha, variacion = leer_copernicus(texto)
            if not (0 <= altura <= 12):
                raise ValueError(f"altura fuera de rango: {altura}")
            print(f"[ok] {f['nombre']}: {altura} m el {fecha}")
            encontrados.append({"altura": altura, "fecha": fecha, "variacion": variacion, "fuente": f, "prioridad": prioridad})
        except Exception as e:  # noqa: BLE001
            msg = f"{f['url']}: {e}"
            print("[falla]", msg, file=sys.stderr)
            errores.append(msg)
    if encontrados:
        # la lectura de fecha más reciente; si empatan, la de la fuente que figura primero
        hallazgo = sorted(encontrados, key=lambda h: (h["fecha"], -h["prioridad"]))[-1]
        otras = [h for h in encontrados if h["fecha"] == hallazgo["fecha"] and abs(h["altura"] - hallazgo["altura"]) > 0.015]
        if otras:
            print("[aviso] fuentes con la misma fecha y alturas distintas:", [(h["fuente"]["tipo"], h["altura"]) for h in encontrados], file=sys.stderr)

    d["consultado"] = ahora
    if not hallazgo:
        d["estado"] = "error"
        d["mensaje"] = "no se pudo leer la fuente"
        ARCHIVO.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("Sin lectura nueva. Detalle:\n" + "\n".join(errores), file=sys.stderr)
        return 0  # el cartel de la página avisa; no hace fallar el flujo

    # verificación de plausibilidad: un río grande no sube ni baja más de 1 m por día
    dias = (datetime.strptime(hallazgo["fecha"], "%Y-%m-%d") - datetime.strptime(d["lectura"]["fecha"], "%Y-%m-%d")).days
    if dias >= 1 and abs(hallazgo["altura"] - d["lectura"]["altura_m"]) > 1.0 * dias:
        d["estado"] = "error"
        d["mensaje"] = f"lectura con salto inusual ({hallazgo['altura']} m el {hallazgo['fecha']}); se conserva la anterior"
        ARCHIVO.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("Salto inusual; se conserva la lectura anterior:", d["mensaje"], file=sys.stderr)
        return 0

    # no retroceder: nunca reemplazar por una lectura de fecha anterior
    if hallazgo["fecha"] < d["lectura"]["fecha"]:
        d["estado"] = "ok"
        d["mensaje"] = ""
        print("La fuente muestra una fecha anterior a la guardada; se conserva la guardada.")
    else:
        var = hallazgo["variacion"]
        if var is None:
            # la variación solo se calcula contra la lectura del día anterior; si falta, no se inventa
            ayer = (datetime.strptime(hallazgo["fecha"], "%Y-%m-%d") - timedelta(days=1)).strftime("%Y-%m-%d")
            previa = [h for h in d["historial"] if h["fecha"] == ayer and h["tipo"] == "publicado"]
            if previa:
                var = round(hallazgo["altura"] - previa[0]["altura_m"], 2)
        d["lectura"] = {
            "fecha": hallazgo["fecha"],
            "altura_m": hallazgo["altura"],
            "variacion_m": var,
            "fuente": hallazgo["fuente"]["nombre"],
            "url": hallazgo["fuente"]["url"],
        }
        d["estado"] = "ok"
        d["mensaje"] = ""
        existente = [h for h in d["historial"] if h["fecha"] == hallazgo["fecha"]]
        if existente:
            existente[0].update({"altura_m": hallazgo["altura"], "tipo": "publicado", "fuente": hallazgo["fuente"]["nombre"]})
        else:
            d["historial"].append({"fecha": hallazgo["fecha"], "altura_m": hallazgo["altura"], "tipo": "publicado", "fuente": hallazgo["fuente"]["nombre"]})
        d["historial"].sort(key=lambda h: h["fecha"])

    ARCHIVO.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
