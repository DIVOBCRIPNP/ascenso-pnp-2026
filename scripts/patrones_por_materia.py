"""
Motor de patrones POR MATERIA (12 materias del examen 15x100).

Detecta, para cada materia y artículo:
  - HALLAZGOS DE RESPUESTAS: palabras dominantes en las respuestas oficiales
    (ejemplo DL 1428: 'finalidad' aparece en 3 respuestas, 'objeto' en 1;
    'apoyo a la policía' ×2; 'atención a la denuncia' ×3;
    instituciones recurrentes: MTC, MINSA, INPE, BENEFICENCIA)
  - HALLAZGOS DE ARTÍCULO: preguntas del mismo artículo con misma respuesta
    (ejemplo DL 1267 Art. 3° → siempre 'atribución')
  - VALORES/LISTAS repetidas (ejemplo DL 1267 Art. VIII → 7 valores)
  - CIERRES DE FRASE distintivos (ejemplo DUDH → la última palabra decide)

Salida: data/patrones_por_materia.json
"""
import json, os, re
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BANK = os.path.join(ROOT, "data", "preguntas.json")
OUT  = os.path.join(ROOT, "data", "patrones_por_materia.json")

# Instituciones/organismos que suelen ser respuesta
INSTITUCIONES = [
    "MINSA","MINEDU","MINDEF","MINCUL","MININTER","MINJUS","MEF","MTC","MINEM","MTPE","MIDIS","MIMP","PRODUCE",
    "INPE","INEI","INDECOPI","OSCE","CEPLAN","CENEPRED","INDECI","OEFA","SUNAT","SUNARP","SUNAFIL","SUCAMEC",
    "SUNEDU","SUTRAN","OSITRAN","OSIPTEL","OSINERGMIN","SUSALUD","SBS","APCI","CONABI","CONADIS",
    "SIS","ESSALUD","RENIEC","JNE","ONPE","BCR","CGR","SERVIR","AMAG","SUNAA",
    "PNP","MP","PJ","TC","CNM","JNJ","DP",
    "BENEFICENCIA","BENEFICENCIA PÚBLICA","MUNICIPALIDAD","GOBIERNO REGIONAL","GOBIERNO LOCAL",
    "CONGRESO","PRESIDENCIA","PCM","DEFENSORÍA DEL PUEBLO",
]

# Categorías jurídicas típicas
CATEGORIAS = ["FUNCION","FUNCIONES","ATRIBUCION","ATRIBUCIONES","FACULTAD","FACULTADES",
              "COMPETENCIA","DERECHO","DERECHOS","DEBER","DEBERES","OBLIGACION","OBLIGACIONES",
              "FINALIDAD","FINALIDADES","PRINCIPIO","PRINCIPIOS","OBJETO"]

# Verbos rectores frecuentes en respuestas
VERBOS = ["GARANTIZAR","MANTENER","RESTABLECER","PROTEGER","PREVENIR","INVESTIGAR","REALIZAR","EJECUTAR",
          "DIRIGIR","ORGANIZAR","APROBAR","DISPONER","RECIBIR","EMITIR","CONTROLAR","SUPERVISAR",
          "PRESENTAR","ATENDER","APOYAR","REGISTRAR","DENUNCIAR"]

# Mapeo de materia oficial a nombre del examen (para reportar)
def norm(s):
    s = (s or "").upper().strip()
    s = re.sub(r"[^A-ZÁÉÍÓÚÑ0-9°\s.]", " ", s)
    s = re.sub(r"[ÁÉÍÓÚ]", lambda m: "AEIOU"["ÁÉÍÓÚ".index(m.group(0))], s)
    s = s.replace("Ñ","N")
    return re.sub(r"\s+", " ", s).strip()

def get_articulo(q):
    ub = q.get("ubicacion","") or ""
    m = re.search(r"ART[.:\s]*(\d+(?:[.\-]\d+)?(?:[.\-][a-zA-Z])?)", ub)
    if m: return f"Art. {m.group(1)}"
    m = re.search(r"ART[.:\s]*([IVX]+)", ub)
    if m: return f"Art. {m.group(1)}"
    return ""

def get_correct_text(q):
    c = q.get("correcta")
    ops = q.get("opciones",[]) or []
    if c is not None and 0 <= c < len(ops):
        return ops[c]
    return q.get("respuesta","") or ""

def find_institutions(text):
    up = norm(text)
    hits = []
    for inst in INSTITUCIONES:
        # buscar como palabra o al final
        if re.search(rf"\b{re.escape(inst)}\b", up):
            hits.append(inst)
    return hits

def find_categories(text):
    up = norm(text)
    hits = set()
    for cat in CATEGORIAS:
        if re.search(rf"\b{cat}\b", up): hits.add(cat)
    return sorted(hits)

def find_key_phrases(respuestas):
    """Detecta n-gramas (2-4 palabras) que se repitan ≥2 veces en las respuestas de un grupo."""
    ng = Counter()
    for r in respuestas:
        toks = norm(r).split()
        for n in [2, 3, 4]:
            for i in range(len(toks)-n+1):
                phrase = " ".join(toks[i:i+n])
                # descartar frases con solo stopwords
                if all(len(t) <= 3 for t in toks[i:i+n]): continue
                ng[phrase] += 1
    return [(p, c) for p, c in ng.most_common(20) if c >= 2]

def analyze_articulo(preguntas):
    """Devuelve hallazgos para un grupo de preguntas de un mismo artículo."""
    respuestas = [get_correct_text(q) for q in preguntas]
    respuestas = [r for r in respuestas if r]
    if not respuestas: return {}

    # 1. Categoría jurídica dominante (¿todas responden "atribución"? ¿"función"?)
    cats_per_ans = [find_categories(r) for r in respuestas]
    cat_counter = Counter(c for cats in cats_per_ans for c in cats)
    cat_dominante = None
    if cat_counter:
        top_cat, top_cnt = cat_counter.most_common(1)[0]
        if top_cnt >= max(2, len(respuestas)*0.5):
            cat_dominante = {"cat": top_cat, "cantidad": top_cnt, "de": len(respuestas)}

    # 2. Instituciones que aparecen
    inst_counter = Counter(i for r in respuestas for i in find_institutions(r))
    instituciones = [{"nombre": i, "cantidad": c} for i, c in inst_counter.most_common(10) if c >= 1]

    # 3. Verbos rectores
    verbos_counter = Counter()
    for r in respuestas:
        toks = norm(r).split()
        for v in VERBOS:
            if v in toks: verbos_counter[v] += 1
    verbos_top = [{"verbo": v, "cantidad": c} for v, c in verbos_counter.most_common(6) if c >= 2]

    # 4. Respuestas idénticas
    resp_counter = Counter(norm(r) for r in respuestas)
    resp_repetidas = [{"respuesta": r, "cantidad": c} for r, c in resp_counter.most_common(5) if c >= 2]

    # 5. Frases clave (n-gramas repetidos)
    frases = [{"frase": p, "cantidad": c} for p, c in find_key_phrases(respuestas)[:8]]

    # 6. "Binario": si una respuesta tiene una palabra clave y las otras tienen otra
    # ejemplo DL 1428: 'objeto' (1) vs 'finalidad' (3)
    binario = None
    for pair in [("OBJETO","FINALIDAD"), ("FUNCION","ATRIBUCION"), ("FACULTAD","DERECHO"),
                 ("PRESENTAR","ATENDER"), ("PRESENTAR","ATENCION")]:
        a, b = pair
        na = sum(1 for r in respuestas if re.search(rf"\b{a}\b", norm(r)))
        nb = sum(1 for r in respuestas if re.search(rf"\b{b}\b", norm(r)))
        if na >= 1 and nb >= 1 and (na+nb) >= 2:
            binario = {"palabra_minoria": a if na < nb else b,
                       "palabra_mayoria": b if na < nb else a,
                       "n_minoria": min(na, nb), "n_mayoria": max(na, nb)}
            break

    return {
        "total": len(preguntas),
        "categoria_dominante": cat_dominante,
        "instituciones": instituciones,
        "verbos": verbos_top,
        "respuestas_repetidas": resp_repetidas,
        "frases_clave": frases,
        "patron_binario": binario,
        "ns": [q["n"] for q in preguntas],
    }

def build_hallazgo_texto(art, hallazgo):
    """Texto legible del hallazgo, tipo la Ficha del usuario."""
    tips = []
    if hallazgo["categoria_dominante"]:
        c = hallazgo["categoria_dominante"]
        tips.append(f"Si aparece este artículo, la respuesta gira en torno a «{c['cat']}» ({c['cantidad']}/{c['de']} preguntas).")
    if hallazgo["patron_binario"]:
        b = hallazgo["patron_binario"]
        tips.append(f"Patrón binario: «{b['palabra_mayoria']}» en {b['n_mayoria']} respuestas · «{b['palabra_minoria']}» solo en {b['n_minoria']}.")
    if hallazgo["respuestas_repetidas"]:
        r = hallazgo["respuestas_repetidas"][0]
        tips.append(f"Respuesta que se repite {r['cantidad']} veces: «{r['respuesta'][:80]}».")
    if hallazgo["instituciones"]:
        insts = [i["nombre"] for i in hallazgo["instituciones"][:4]]
        tips.append(f"Instituciones recurrentes: {', '.join(insts)}.")
    if hallazgo["frases_clave"]:
        frases = [f['frase'] for f in hallazgo["frases_clave"][:3]]
        tips.append(f"Frases clave a memorizar: {' · '.join(frases)}.")
    return " ".join(tips) if tips else "Preguntas de reconocimiento; leer completo cada alternativa."

def main():
    DATA = json.load(open(BANK))
    DATA.sort(key=lambda q: q.get("n", 0))
    print(f"Banco: {len(DATA)}")

    # Agrupar por materia + artículo
    materias = defaultdict(lambda: defaultdict(list))
    for q in DATA:
        m = q.get("materia","") or "SIN MATERIA"
        a = get_articulo(q)
        materias[m][a].append(q)

    resultado = {"version": 1, "materias": []}
    for materia, arts in sorted(materias.items(), key=lambda x: -sum(len(v) for v in x[1].values())):
        total = sum(len(preg) for preg in arts.values())
        articulos_out = []
        for art, preg in sorted(arts.items(), key=lambda x: -len(x[1])):
            if len(preg) < 1: continue
            h = analyze_articulo(preg)
            articulos_out.append({
                "articulo": art,
                "cantidad": len(preg),
                "hallazgo_texto": build_hallazgo_texto(art, h),
                "hallazgo": h,
            })
        # cortar tras top 25 artículos por materia
        articulos_out = articulos_out[:40]

        resultado["materias"].append({
            "materia": materia,
            "total": total,
            "articulos": articulos_out,
        })

    # También un índice: pregunta n → hallazgo del artículo al que pertenece
    por_pregunta = {}
    for m in resultado["materias"]:
        for a in m["articulos"]:
            for n in a["hallazgo"]["ns"]:
                por_pregunta[n] = {
                    "materia": m["materia"],
                    "articulo": a["articulo"],
                    "hallazgo_texto": a["hallazgo_texto"],
                    "categoria_dominante": a["hallazgo"]["categoria_dominante"],
                    "patron_binario": a["hallazgo"]["patron_binario"],
                    "instituciones": a["hallazgo"]["instituciones"][:4],
                    "verbos": a["hallazgo"]["verbos"][:3],
                }
    resultado["por_pregunta"] = por_pregunta

    with open(OUT, "w") as f:
        json.dump(resultado, f, ensure_ascii=False)
    print(f"✓ Escrito {OUT}  ({os.path.getsize(OUT)//1024} KB)")

    # Reporte
    print(f"\n=== Materias procesadas: {len(resultado['materias'])} ===")
    for m in resultado["materias"][:8]:
        print(f"\n  {m['materia'][:70]}  ({m['total']} preguntas · {len(m['articulos'])} artículos)")
        for a in m["articulos"][:5]:
            print(f"    · {a['articulo']} ({a['cantidad']}): {a['hallazgo_texto'][:120]}")

if __name__ == "__main__":
    main()
