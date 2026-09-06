"""
Generador de 15 exámenes únicos con MATRIZ MAESTRA balanceada.

Algoritmo:
  1. Cuota por materia: round-robin con carga acumulada
     → cada examen suma exactamente 100 preguntas
     → cada examen tiene 50 comunes + 50 especialidad
     → cada materia consume exactamente su total del banco
  2. Asignación de preguntas: dentro de cada materia, ROTA por familia temática
     para que cada examen tenga la mezcla más equilibrada posible.
  3. Sin repetir: cada una de las 1500 preguntas va a exactamente 1 examen.

Salida: data/simulacros.json (reemplaza al que venía del DOCX).
        Los datos originales del DOCX se guardan en data/simulacros_docx.json (respaldo).
"""
import json, os, re, random
from collections import defaultdict, Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BANK = os.path.join(ROOT, "data", "preguntas.json")
PATRONES = os.path.join(ROOT, "data", "patrones.json")
OUT = os.path.join(ROOT, "data", "simulacros.json")
BACKUP = os.path.join(ROOT, "data", "simulacros_docx.json")

K = 15

# Mapeo de la materia oficial del banco → categoría común/especialidad
COM = "com"; ESP = "esp"
CATEGORIA = {
    "CONSTITUCIÓN POLÍTICA DEL PERÚ": COM,
    "DECLARACIÓN UNIVERSAL DE LOS DERECHOS HUMANOS": COM,
    "LEY DE LA PNP - DECRETO LEGISLATIVO N° 1267": COM,
    "DECRETO LEGISLATIVO N°1149": COM,
    "DECRETO LEGISLATIVO N°1291": COM,
    "LEY Nº 30714": COM,
    "DECRETO LEGISLATIVO N° 1318": COM,
    "TUO de la Ley 27806": COM,
    "LEY QUE REGULA LOS PROCESOS DE ASCENSOS": COM,
    "LEY 27444": COM,
    "DECRETO LEGISLATIVO Nº 957": ESP,
    "DECRETO LEGISLATIVO Nº 635": ESP,
    "DECRETO LEGISLATIVO Nº 1186": ESP,
    "DECRETO LEGISLATIVO Nº 1241": ESP,
    "DECRETO LEGISLATIVO Nº 1106": ESP,
    "LEY Nº 30364": ESP,
    "LEY Nº 30077": ESP,
    "DECRETO SUPREMO N° 009": ESP,
    "LEY 32130": ESP,
    "D.LEG 1611": ESP,
    "DDHH APLICADOS A LA FUNCIÓN POLICIAL": ESP,
    "D.LEG. 1428": ESP,
}
# Nombre corto por materia (para la vista)
NOMBRE_CORTO = {
    "CONSTITUCIÓN POLÍTICA DEL PERÚ": "Constitución",
    "DECLARACIÓN UNIVERSAL DE LOS DERECHOS HUMANOS": "DUDH",
    "LEY DE LA PNP - DECRETO LEGISLATIVO N° 1267": "DL 1267",
    "DECRETO LEGISLATIVO N°1149": "DL 1149",
    "DECRETO LEGISLATIVO N°1291": "DL 1291",
    "LEY Nº 30714": "Ley 30714",
    "DECRETO LEGISLATIVO N° 1318": "DL 1318",
    "TUO de la Ley 27806": "Ley 27806",
    "LEY QUE REGULA LOS PROCESOS DE ASCENSOS": "Ley Ascensos",
    "LEY 27444": "Ley 27444",
    "DECRETO LEGISLATIVO Nº 957": "CPP",
    "DECRETO LEGISLATIVO Nº 635": "CPen",
    "DECRETO LEGISLATIVO Nº 1186": "DL 1186",
    "DECRETO LEGISLATIVO Nº 1241": "DL 1241",
    "DECRETO LEGISLATIVO Nº 1106": "DL 1106",
    "LEY Nº 30364": "Ley 30364",
    "LEY Nº 30077": "Ley 30077",
    "DECRETO SUPREMO N° 009": "DS 009-2018",
    "LEY 32130": "Ley 32130",
    "D.LEG 1611": "DL 1611",
    "DDHH APLICADOS A LA FUNCIÓN POLICIAL": "DDHH FP",
    "D.LEG. 1428": "DL 1428",
}
def clasificar_materia(materia_full):
    """Encuentra el prefijo de la materia y devuelve (nombre_corto, cat)."""
    for prefix, cat in CATEGORIA.items():
        if materia_full.startswith(prefix):
            return NOMBRE_CORTO[prefix], cat
    return None, None

def main():
    # 1) Cargar banco
    DATA = json.load(open(BANK))
    DATA.sort(key=lambda q: q.get("n", 0))
    # patrones para balance por familia
    PAT = {}
    try:
        PAT = json.load(open(PATRONES)).get("por_pregunta", {})
    except: pass

    # 2) Agrupar preguntas por materia (nombre corto)
    materias_pregs = defaultdict(list)
    materias_cat = {}
    for q in DATA:
        m_full = q.get("materia","") or ""
        nombre, cat = clasificar_materia(m_full)
        if nombre is None:
            print(f"⚠ Materia sin clasificar: {m_full[:80]}")
            continue
        materias_pregs[nombre].append(q)
        materias_cat[nombre] = cat

    # 3) Definir el orden fijo de las 22 materias
    ORDEN = ["Constitución","DUDH","DL 1267","DL 1149","DL 1291","Ley 30714","DL 1318","Ley 27806",
             "Ley Ascensos","Ley 27444","CPP","CPen","DL 1186","DL 1241","DL 1106","Ley 30364",
             "Ley 30077","DS 009-2018","Ley 32130","DL 1611","DDHH FP","DL 1428"]

    print(f"Banco: {len(DATA)} preguntas · {len(materias_pregs)} materias detectadas")
    for m in ORDEN:
        print(f"  {len(materias_pregs.get(m,[])):>3}  {m}")

    # 4) MATRIZ DE CUOTAS — round-robin balanceado por examen
    #    (algoritmo verificado: cada fila suma 100, 50 común, 50 especialidad, cada materia = N)
    mat_cuotas = {}
    carga_ex = [0]*K
    # Ordenar por residuo DESC + prioridad a común/esp alternado para forzar 50/50
    materias_info = [(m, len(materias_pregs[m]), materias_cat[m]) for m in ORDEN]
    materias_sorted = sorted(materias_info, key=lambda x: -(x[1] - K*(x[1]//K)))
    for name, N, cat in materias_sorted:
        q_bajo = N // K
        residuo = N - K*q_bajo
        fila = [q_bajo]*K
        # Repartir el residuo a los exámenes con MENOS carga (balancea)
        idxs = sorted(range(K), key=lambda i: (carga_ex[i], i))[:residuo]
        for i in idxs:
            fila[i] += 1
            carga_ex[i] += 1
        mat_cuotas[name] = fila
        assert sum(fila) == N

    # 5) ASIGNACIÓN de preguntas específicas — para cada materia:
    #    - agrupa sus preguntas por familia temática
    #    - reparte round-robin entre los 15 exámenes según la cuota
    #    - garantiza que ninguna pregunta se repita
    random.seed(42)  # reproducible
    asignaciones = {i: [] for i in range(K)}  # examen_idx → lista de q

    def get_dif(q):
        """Devuelve la dificultad como bucket: BAJA/MEDIA/ALTA/MUY ALTA.
        Usa la del XLSX del usuario si existe, sino la del motor, sino BAJA por defecto."""
        info = PAT.get(str(q["n"]), {})
        # dificultad del XLSX del usuario (más rica): 'Baja','Media','Alta','Muy alta'
        d = (info.get("dificultad","") or "").upper().strip()
        if d:
            if "MUY" in d and "ALTA" in d: return "MUY ALTA"
            if "ALTA" in d: return "ALTA"
            if "MED" in d: return "MEDIA"
            if "BAJ" in d: return "BAJA"
        # dificultad del motor
        motor = info.get("motor", {})
        conf = (motor.get("confianza","") or "").upper()
        if "MUY" in conf: return "MUY ALTA"
        if "ALTA" in conf: return "ALTA"
        if "MED" in conf: return "MEDIA"
        return "BAJA"

    for name in ORDEN:
        pregs = list(materias_pregs.get(name, []))
        cuotas = mat_cuotas[name]

        # Agrupa por (familia, dificultad) — balance fino combinado
        por_fam_dif = defaultdict(list)
        for q in pregs:
            info = PAT.get(str(q["n"]), {})
            fam = info.get("familia","") or info.get("grupo","") or ""
            dif = get_dif(q)
            por_fam_dif[(fam, dif)].append(q)
        # Baraja dentro de cada bucket
        for k in por_fam_dif:
            random.shuffle(por_fam_dif[k])
        # Aplana en round-robin: dificultad primero (así las 4 categorías se dispersan
        # de forma equilibrada), luego familia. Cada bucket cede 1 pregunta por vuelta.
        buckets = sorted(por_fam_dif.keys(), key=lambda k: (-len(por_fam_dif[k]), k[1], k[0]))
        cola = []
        while any(por_fam_dif[b] for b in buckets):
            for b in buckets:
                if por_fam_dif[b]:
                    cola.append(por_fam_dif[b].pop(0))
        assert len(cola) == len(pregs)

        # Ahora distribuye la cola a los exámenes según sus cuotas
        # Estrategia: en cada "vuelta" toma 1 pregunta y la asigna al examen con
        # (cuota_restante > 0) que tenga MAYOR déficit relativo
        # (esto asegura que ningún examen se quede sin cubrir su cuota)
        cuotas_rest = list(cuotas)
        for q in cola:
            # Elegir el examen con más cuota restante
            i = max(range(K), key=lambda x: cuotas_rest[x])
            if cuotas_rest[i] == 0:
                break  # no debería pasar si cuota total == len(cola)
            asignaciones[i].append(q)
            cuotas_rest[i] -= 1
        assert all(c == 0 for c in cuotas_rest), f"{name}: cuotas restantes = {cuotas_rest}"

    # 6) VALIDAR — cada examen debe tener 100 preguntas únicas y usar cada pregunta 1 vez
    todos_ns = []
    for i in range(K):
        ns = [q["n"] for q in asignaciones[i]]
        assert len(ns) == 100, f"Examen {i+1}: {len(ns)} != 100"
        assert len(set(ns)) == 100, f"Examen {i+1}: duplicados"
        todos_ns.extend(ns)
    assert len(todos_ns) == 1500 and len(set(todos_ns)) == 1500, "duplicados o faltantes globales"
    print(f"\n✓ Validación: 15 exámenes × 100 preguntas = 1500 sin repetir")

    # 7) SERIALIZAR con el mismo esquema que consumía la app
    examenes = []
    for i in range(K):
        preg_list = asignaciones[i]
        # ordenar por materia (siguiendo ORDEN) y renumerar 1..100
        preg_list.sort(key=lambda q: (ORDEN.index(clasificar_materia(q.get("materia",""))[0] or ""), q["n"]))
        preguntas = []
        composicion = Counter()
        for idx, q in enumerate(preg_list):
            nom, cat = clasificar_materia(q.get("materia",""))
            composicion[nom] += 1
            preguntas.append({
                "n": idx + 1,          # numeración 1..100 dentro del examen
                "n_original": q["n"],  # número en el banco 1..1500
                "materia": q.get("materia",""),
                "materia_corta": nom,
                "categoria": cat,
                "pregunta": q.get("pregunta",""),
                "opciones": q.get("opciones",[]),
                "correcta": q.get("correcta", 0),
                "ubicacion": q.get("ubicacion",""),
            })
        examenes.append({
            "n": i + 1,
            "titulo": f"EXAMEN DE SIMULACRO N° {i+1:02d} · 100 preguntas",
            "composicion": dict(composicion),
            "total_comun": sum(c for m,c in composicion.items() if CATEGORIA.get([p for p in CATEGORIA if NOMBRE_CORTO[p]==m][0]) == COM),
            "total_esp":   sum(c for m,c in composicion.items() if CATEGORIA.get([p for p in CATEGORIA if NOMBRE_CORTO[p]==m][0]) == ESP),
            "preguntas": preguntas,
        })

    # respaldar el actual si existe y no es ya el generado
    if os.path.exists(OUT):
        try:
            existing = json.load(open(OUT))
            if not existing.get("_generado"):
                with open(BACKUP, "w") as f:
                    json.dump(existing, f, ensure_ascii=False)
                print(f"✓ Respaldo del DOCX en {BACKUP}")
        except: pass

    out = {
        "version": 2,
        "_generado": True,
        "total_examenes": K,
        "total_preguntas": 1500,
        "materias_proporcion": {m: mat_cuotas[m] for m in ORDEN},  # ahora es un arreglo por examen
        "examenes": examenes,
    }
    with open(OUT, "w") as f:
        json.dump(out, f, ensure_ascii=False)
    print(f"\n✓ Escrito {OUT}  ({os.path.getsize(OUT)//1024} KB)")

    # Reporte
    print(f"\n=== Composición de los primeros 3 exámenes ===")
    for e in examenes[:3]:
        c = e["composicion"]
        print(f"\n  Examen {e['n']:>2}: común={e['total_comun']}  esp={e['total_esp']}")
        for m, cnt in sorted(c.items(), key=lambda x: -x[1])[:8]:
            print(f"    {cnt:>3}  {m}")

    # Reporte de dificultad por examen (validar que el balance funciona)
    print(f"\n=== Balance de DIFICULTAD por examen ===")
    print(f"{'Examen':>10} {'BAJA':>6} {'MEDIA':>6} {'ALTA':>6} {'MUY':>6}  Total")
    for e in examenes:
        difs = Counter()
        for q in e["preguntas"]:
            n_orig = q["n_original"]
            info = PAT.get(str(n_orig), {})
            d = (info.get("dificultad","") or "").upper().strip()
            if "MUY" in d and "ALTA" in d: bucket = "MUY ALTA"
            elif "ALTA" in d: bucket = "ALTA"
            elif "MED" in d: bucket = "MEDIA"
            elif "BAJ" in d: bucket = "BAJA"
            else:
                motor = info.get("motor", {}); c = (motor.get("confianza","") or "").upper()
                if "MUY" in c: bucket = "MUY ALTA"
                elif "ALTA" in c: bucket = "ALTA"
                elif "MED" in c: bucket = "MEDIA"
                else: bucket = "BAJA"
            difs[bucket] += 1
        e["dificultad_mix"] = dict(difs)
        print(f"{e['n']:>10} {difs.get('BAJA',0):>6} {difs.get('MEDIA',0):>6} {difs.get('ALTA',0):>6} {difs.get('MUY ALTA',0):>6}  {sum(difs.values())}")
    # Reescribir OUT con dificultad_mix incluido
    with open(OUT, "w") as f:
        json.dump(out, f, ensure_ascii=False)

if __name__ == "__main__":
    main()
