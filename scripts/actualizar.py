#!/usr/bin/env python3
"""Lee la altura del río Paraná en Corrientes desde la fuente oficial y actualiza datos.json.

Reglas:
- Solo guarda una lectura nueva si se pudo leer con certeza (altura + fecha + niveles de alerta
  y evacuación que coinciden con los del archivo). Si algo no cierra, NO inventa ni repite:
  deja la última lectura válida, marca estado "error" y la página lo muestra en un cartel.
- Fuente principal: INA, reporte diario (lecturas de Prefectura Naval Argentina).
- Fuente de respaldo (solo para confirmar, nunca para pisar con una fecha más vieja): Copernicus Argentina.
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
        "nombre": "INA, reporte diario (lecturas de Prefectura Naval Argentina)",
        "url": "https://alerta.ina.gob.ar/a5/diario/reporte_diario",
    },
    {
        "nombre": "Copernicus Argentina (lecturas de Prefectura Naval Argentina publicadas por el INA)",
        "url": "https://copernicus.com.ar/rio/corrientes",
    },
]
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


def main():
    d = json.loads(ARCHIVO.read_text(encoding="utf-8"))
    ahora = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    E = d["escala"]
    errores, hallazgo = [], None

    for i, f in enumerate(FUENTES):
        try:
            texto = a_texto(descargar(f["url"]))
            if i == 0:
                altura, fecha, variacion = leer(texto, E["alerta_m"], E["evacuacion_m"])
            else:
                altura, fecha, variacion = leer_copernicus(texto)
            if not (0 <= altura <= 12):
                raise ValueError(f"altura fuera de rango: {altura}")
            print(f"[ok] {f['nombre']}: {altura} m el {fecha}")
            hallazgo = {"altura": altura, "fecha": fecha, "variacion": variacion, "fuente": f}
            break
        except Exception as e:  # noqa: BLE001
            msg = f"{f['url']}: {e}"
            print("[falla]", msg, file=sys.stderr)
            errores.append(msg)

    d["consultado"] = ahora
    if not hallazgo:
        d["estado"] = "error"
        d["mensaje"] = "no se pudo leer la fuente"
        ARCHIVO.write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print("Sin lectura nueva. Detalle:\n" + "\n".join(errores), file=sys.stderr)
        return 0  # el cartel de la página avisa; no hace fallar el flujo

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
