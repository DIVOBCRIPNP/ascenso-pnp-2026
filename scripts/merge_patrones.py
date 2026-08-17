"""
Fusiona data/patrones.json v3 (matriz manual del usuario, 16 familias temáticas,
respuestas repetidas, palabras que cambian, observaciones) con el motor
data/motor_patrones.json (patrones RR/AN/PE/K1..K3/CJ/AC/NP/VR/FC/DR/NE +
confianza + técnica por pregunta).

Resultado: data/patrones.json v4 (una sola fuente para la app).
"""
import json, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = json.load(open(os.path.join(ROOT, "data", "patrones.json")))
M = json.load(open(os.path.join(ROOT, "data", "motor_patrones.json")))

P["version"] = 4
P["motor"]   = {"indices": M["indices"], "meta": M["meta"]}
# adjunto info del motor a cada pregunta bajo `motor`
for n, info in M["por_pregunta"].items():
    if n in P["por_pregunta"]:
        P["por_pregunta"][n]["motor"] = info
    else:
        P["por_pregunta"][n] = {"motor": info}
# meta agregada
P["meta"]["motor_patrones"] = M["meta"]["patrones_conteo"]
P["meta"]["motor_confianza"] = M["meta"]["confianza_conteo"]

out = os.path.join(ROOT, "data", "patrones.json")
with open(out, "w") as f:
    json.dump(P, f, ensure_ascii=False)
print(f"✓ Fusionado en {out}  ({os.path.getsize(out)//1024} KB)")
print(f"  version={P['version']} | familias={len(P.get('familias',[]))} | motor.patrones={list(P['motor']['meta']['patrones_conteo'].keys())}")
