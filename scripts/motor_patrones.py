"""
MOTOR DE PATRONES DE ESTUDIO PNP — implementación del algoritmo del usuario.

Entrada:  data/preguntas.json  (banco oficial)
Salida:   data/motor_patrones.json  (etiquetas por pregunta + índices maestros)

Etiquetas por pregunta (algoritmo):
  K1  keyword exclusiva          K2/K3 keyword familia / doble
  RR  respuesta repetida         RE   respuesta exclusiva
  PE  pregunta espejo            AN   artículo ancla
  VR  verbo rector               CJ   categoría jurídica
  FC  frase canónica             AC   autoridad competente
  NP  número / plazo             DG   distractor gemelo
  DR  distractor recurrente      NE   negación / excepción

Confianza (regla del punto 16):
  MUY ALTA — 3+ señales fuertes  (misma resp + mismo art + familia + estructura)
  ALTA     — 2 señales fuertes
  MEDIA    — solo keyword o VR
  BAJA     — solo "más larga" u orden
"""
import json, os, re
from collections import Counter, defaultdict
from difflib import SequenceMatcher

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BANK = os.path.join(ROOT, "data", "preguntas.json")
OUT  = os.path.join(ROOT, "data", "motor_patrones.json")

# ==================== normalización ====================
def norm(s):
    s = (s or "").upper()
    s = re.sub(r"[^A-ZÁÉÍÓÚÑ0-9\s]", " ", s)
    s = re.sub(r"[ÁÉÍÓÚ]", lambda m: "AEIOU"["ÁÉÍÓÚ".index(m.group(0))], s)
    s = s.replace("Ñ","N")
    return re.sub(r"\s+", " ", s).strip()

STOP = set("""DE DEL LA EL LAS LOS AL A EN Y O U POR PARA CON SIN QUE SE SU SUS LO UN UNA UNOS UNAS
ES SON SER ESTAR COMO MAS MENOS ENTRE SEGUN SOBRE BAJO HASTA DESDE NI PERO NO YA SI SÍ
SU ESTA ESTE ESTOS ESTAS LE LES ME TE NOS OS TAMBIEN TAMBIÉN HAY HA HAN CUAL CUALES QUIEN QUIENES
DONDE CUANDO PUEDE PUEDEN DEBERA DEBEN OTRO OTROS OTRA OTRAS TODO TODA TODOS TODAS
ANTE HACIA MEDIANTE DURANTE POR TAL TALES CADA ESTO ESO ESA ESE ESAS ESOS""".split())

def tokens(s):
    return [t for t in norm(s).split() if t and t not in STOP and len(t) >= 3]

# ==================== vocabularios cerrados ====================
VERBOS_RECTORES = set("""
GARANTIZAR MANTENER RESTABLECER PROTEGER PREVENIR COMBATIR INVESTIGAR REALIZAR PRACTICAR
INTERVENIR DETENER CONDUCIR RECIBIR IDENTIFICAR REGISTRAR VIGILAR CONTROLAR FISCALIZAR
SUPERVISAR ADMINISTRAR EJERCER DISPONER APROBAR EMITIR RESOLVER SANCIONAR NOTIFICAR
COMUNICAR ORDENAR AUTORIZAR SOLICITAR PRESENTAR TRAMITAR DENUNCIAR ACREDITAR ADQUIRIR
COOPERAR COORDINAR PROMOVER PLANEAR EJECUTAR DIRIGIR ORGANIZAR CAPACITAR ASESORAR
FORMULAR DECLARAR ASEGURAR CONFERIR OTORGAR DESIGNAR NOMBRAR REMOVER RATIFICAR
INSPECCIONAR AUDITAR EVALUAR CALIFICAR CLASIFICAR
""".split())

CATEGORIAS_JURIDICAS = {
    "FUNCION":     ["FUNCION","FUNCIONES"],
    "ATRIBUCION":  ["ATRIBUCION","ATRIBUCIONES"],
    "FACULTAD":    ["FACULTAD","FACULTADES"],
    "COMPETENCIA": ["COMPETENCIA","COMPETENCIAS"],
    "DERECHO":     ["DERECHO","DERECHOS"],
    "DEBER":       ["DEBER","DEBERES"],
    "OBLIGACION":  ["OBLIGACION","OBLIGACIONES"],
    "FINALIDAD":   ["FINALIDAD","FINALIDADES"],
    "PRINCIPIO":   ["PRINCIPIO","PRINCIPIOS"],
    "SANCION":     ["SANCION","SANCIONES"],
    "INFRACCION":  ["INFRACCION","INFRACCIONES"],
    "MEDIDA":      ["MEDIDA","MEDIDAS"],
    "PROHIBICION": ["PROHIBICION","PROHIBICIONES"],
}
CJ_ALL = {t for lst in CATEGORIAS_JURIDICAS.values() for t in lst}

AUTORIDADES = {
    "juez":              [r"\bJUEZ(?:A|ES)?\b", r"\bJUZGADO\b"],
    "juez penal":        [r"\bJUEZ(?:A|ES)?\s+PENAL(?:ES)?\b", r"\bJUZGADO\s+PENAL\b"],
    "fiscal":            [r"\bFISCAL(?:ES)?\b", r"\bMINISTERIO\s+PUBLICO\b"],
    "ministerio público":[r"\bMINISTERIO\s+PUBLICO\b"],
    "presidente república":[r"\bPRESIDENTE\s+DE\s+LA\s+REPUBLICA\b"],
    "congreso":          [r"\bCONGRESO(?:\s+DE\s+LA\s+REPUBLICA)?\b"],
    "JNE":               [r"\bJURADO\s+NACIONAL\s+DE\s+ELECCIONES\b", r"\bJNE\b"],
    "procurador":        [r"\bPROCURADOR(?:ES)?\b", r"\bPROCURADURIA\b"],
    "inspectoría":       [r"\bINSPECTOR(?:IA|ES|GENERAL)?\b", r"\bINSPECTORIA\s+GENERAL\b"],
    "comandante general":[r"\bCOMANDANTE\s+GENERAL\b"],
    "director":          [r"\bDIRECTOR(?:A|ES|GENERAL)?\b"],
    "comisario":         [r"\bCOMISARIO\b", r"\bCOMISARIA\b"],
    "PNP":               [r"\bPOLICIA\s+NACIONAL\b"],
    "poder judicial":    [r"\bPODER\s+JUDICIAL\b"],
    "prefecto":          [r"\bPREFECTO\b", r"\bSUBPREFECTO\b"],
    "SUCAMEC":           [r"\bSUCAMEC\b"],
    "SUNAT":             [r"\bSUNAT\b"],
    "SUNARP":            [r"\bSUNARP\b"],
    "MININTER":          [r"\bMINISTERIO\s+DEL\s+INTERIOR\b", r"\bMININTER\b"],
    "gobernador":        [r"\bGOBERNADOR\b"],
    "alcalde":           [r"\bALCALDE\b", r"\bMUNICIPIO\b", r"\bMUNICIPAL(?:IDAD)?\b"],
    "defensor pueblo":   [r"\bDEFENSOR(?:IA)?\s+DEL\s+PUEBLO\b"],
    "controlador":       [r"\bCONTRALOR(?:IA|IA GENERAL)?\b"],
}

NE_TRIGGERS = [
    r"\bNO\s+(?:ES|SON|ESTA|ESTAN|SE|PUEDE|PUEDEN|CORRESPONDE|COMPRENDE|INCLUYE|FORMA|CONSTITUYE|HAY|DEBE|DEBEN|PODRA)\b",
    r"\bNADIE\b", r"\bNUNCA\b", r"\bSALVO\b", r"\bEXCEPTO\b",
    r"\bINCORRECT[AO]\b", r"\bFALS[AO]\b",
    r"\bMARC(?:AR|A|Ó|A)\s+LA\b",
    r"\bSE\s+SUSPENDE\b", r"\bSE\s+PIERDE\b", r"\bCESA\s+POR\b",
    r"\bPROH(?:IB|ÍB)\w+\b", r"\bIMPIDE\b", r"\bIMPEDIR\b",
    r"\bRESTRING\w+\b", r"\bSUSPEND\w+\b",
]

PLAZO_RX = re.compile(
    r"\b(\d+)\s*(DIAS?|MESES?|A[NÑ]OS?|HORAS?|SEMANAS?|MINUTOS?|SEGUNDOS?|VECES?|MIEMBROS?|GRADOS?)\b",
    re.IGNORECASE
)
PORCENT_RX = re.compile(r"\b(\d+)\s*%")
ART_RX = re.compile(r"ART[.:\s]*(\d+(?:[.\-]\d+)?(?:[.\-][a-zA-Z])?)")

# ==================== carga ====================
with open(BANK) as f:
    DATA = json.load(f)
DATA.sort(key=lambda q: q.get("n", 0))
byn = {q["n"]: q for q in DATA}
print(f"Banco cargado: {len(DATA)} preguntas")

# ==================== RR y RE (respuestas repetidas / exclusivas) ====================
resp_counter = Counter()
resp_ns = defaultdict(list)
for q in DATA:
    r = norm(q.get("respuesta","") or q.get("opciones",[q.get("correcta",0)])[0] if q.get("opciones") else "")
    if not r: continue
    resp_counter[r] += 1
    resp_ns[r].append(q["n"])

RR_groups = [{"respuesta": r, "ns": sorted(ns), "cantidad": len(ns)}
             for r, ns in resp_ns.items() if len(ns) >= 2]
RR_groups.sort(key=lambda g: -g["cantidad"])
RE_ns = {ns[0] for r, ns in resp_ns.items() if len(ns) == 1}
print(f"RR (respuestas repetidas): {len(RR_groups)} grupos cubren {sum(g['cantidad'] for g in RR_groups)} preguntas")

# ==================== AN (artículo ancla) ====================
art_ns = defaultdict(list)
def get_art(q):
    ub = q.get("ubicacion","") or ""
    m = ART_RX.search(ub)
    return m.group(1) if m else ""

for q in DATA:
    a = get_art(q)
    if a: art_ns[a].append(q["n"])
AN_index = {a: sorted(ns) for a, ns in art_ns.items() if len(ns) >= 2}
print(f"AN (artículos ancla con ≥2 preguntas): {len(AN_index)}")

# ==================== Familias RR + AN ====================
fam_ra = defaultdict(list)
for q in DATA:
    r = norm(q.get("respuesta","") or "")
    a = get_art(q)
    if r and a:
        fam_ra[(r, a)].append(q["n"])
FAM_RA = [{"respuesta": r, "articulo": a, "ns": sorted(ns), "cantidad": len(ns)}
          for (r, a), ns in fam_ra.items() if len(ns) >= 2]
FAM_RA.sort(key=lambda g: -g["cantidad"])
print(f"Familias RR+AN: {len(FAM_RA)} · top: {FAM_RA[0]['cantidad']} preguntas → {FAM_RA[0]['respuesta'][:50]}")

# ==================== Preguntas espejo (PE) ====================
def inicio_key(s, n=7):
    return " ".join(norm(s).split()[:n])

espejo_buckets = defaultdict(list)
for q in DATA:
    k = inicio_key(q.get("pregunta",""))
    if k: espejo_buckets[k].append(q["n"])
PE_groups = [{"tronco": k, "ns": sorted(ns), "cantidad": len(ns)}
             for k, ns in espejo_buckets.items() if len(ns) >= 2]
PE_groups.sort(key=lambda g: -g["cantidad"])
print(f"PE (preguntas espejo, 7 palabras): {len(PE_groups)} familias")

# ==================== Keywords K1/K2/K3 ====================
# Contamos ocurrencias globales de tokens del enunciado (unigramas + bigramas)
kw_docs = defaultdict(set)  # kw → conjunto de n
for q in DATA:
    toks = tokens(q.get("pregunta",""))
    uni = set(toks)
    bi  = {toks[i]+" "+toks[i+1] for i in range(len(toks)-1)}
    for kw in uni | bi:
        kw_docs[kw].add(q["n"])

# K1 = keyword con ≤3 apariciones y todas comparten misma respuesta
K1_index = {}
for kw, ns in kw_docs.items():
    if len(ns) < 2 or len(ns) > 3: continue
    resps = {norm(byn[n].get("respuesta","")) for n in ns}
    if len(resps) == 1 and next(iter(resps)):
        K1_index[kw] = sorted(ns)

# K2 = keyword frecuente pero asociada a una familia RR mayoritaria
fam_by_resp = {g["respuesta"]: set(g["ns"]) for g in RR_groups}
K2_index = {}
for kw, ns in kw_docs.items():
    if len(ns) < 5: continue
    # ¿mayoría de las apariciones pertenece a la misma familia RR?
    for resp, fam_ns in fam_by_resp.items():
        inter = ns & fam_ns
        if len(inter) >= max(3, len(ns)*0.6):
            K2_index[kw] = {"familia": resp, "ns_kw": sorted(ns), "ns_familia": sorted(fam_ns)}
            break
print(f"K1 (keywords exclusivas): {len(K1_index)} · K2 (keyword-familia): {len(K2_index)}")

# ==================== Frases canónicas (FC) ====================
# Trigramas y tetragramas frecuentes en respuestas (>=3 apariciones)
ng_counter = Counter()
for q in DATA:
    toks = norm(q.get("respuesta","") or "").split()
    for i in range(len(toks)-2):
        if all(t not in STOP for t in toks[i:i+3]):
            ng_counter[" ".join(toks[i:i+3])] += 1
FC_index = {ng: c for ng, c in ng_counter.items() if c >= 3}
print(f"FC (frases canónicas ≥3): {len(FC_index)}")

# ==================== Distractor recurrente (DR) ====================
# Para cada respuesta correcta, cuáles distractores aparecen más
dr_pairs = defaultdict(Counter)
for q in DATA:
    ops = q.get("opciones",[])
    c = q.get("correcta")
    if c is None or c >= len(ops): continue
    correct = norm(ops[c])
    for i, o in enumerate(ops):
        if i == c: continue
        dr_pairs[correct][norm(o)] += 1
DR_index = {}
for correct, distractors in dr_pairs.items():
    tops = [d for d, cnt in distractors.most_common(5) if cnt >= 2]
    if tops: DR_index[correct] = tops
print(f"DR (respuestas con distractores recurrentes): {len(DR_index)}")

# ==================== Por pregunta: enriquecimiento completo ====================
def find_autoridad(text):
    up = norm(text)
    hits = []
    for name, patterns in AUTORIDADES.items():
        for p in patterns:
            if re.search(p, up):
                hits.append(name); break
    return list(dict.fromkeys(hits))  # dedup preservando orden

def find_plazo(text):
    hits = []
    for m in PLAZO_RX.finditer(text or ""):
        hits.append(f"{m.group(1)} {m.group(2).lower()}")
    for m in PORCENT_RX.finditer(text or ""):
        hits.append(f"{m.group(1)}%")
    return hits

def find_verbo_rector(pregunta):
    for t in norm(pregunta).split():
        if t in VERBOS_RECTORES: return t
    return ""

def find_categoria_juridica(pregunta, opciones):
    # ¿la pregunta pide función/atribución/facultad…?
    up = norm(pregunta)
    cats = set()
    for cat, forms in CATEGORIAS_JURIDICAS.items():
        if any(f in up for f in forms): cats.add(cat)
    # o si las opciones son las 4-5 categorías gemelas
    ops_norm = [norm(o) for o in (opciones or [])]
    if sum(1 for o in ops_norm if any(w in CJ_ALL for w in o.split())) >= 3:
        # todos son categorías → es una pregunta clásica de contraste
        cats.add("CONTRASTE")
    return sorted(cats)

def find_negacion(pregunta):
    up = norm(pregunta)
    return any(re.search(p, up) for p in NE_TRIGGERS)

def find_kws(q):
    # K1: keywords exclusivas presentes en esta pregunta
    tok_set = set(tokens(q.get("pregunta","")))
    tok_bi = set()
    toks = tokens(q.get("pregunta",""))
    for i in range(len(toks)-1): tok_bi.add(toks[i]+" "+toks[i+1])
    all_kw = tok_set | tok_bi
    k1 = [kw for kw in all_kw if kw in K1_index]
    k2 = [kw for kw in all_kw if kw in K2_index]
    # K3: pares de K2 juntos → mayor confianza
    k3 = []
    if len(k2) >= 2:
        for i in range(len(k2)):
            for j in range(i+1, len(k2)):
                k3.append(f"{k2[i]} + {k2[j]}")
    return {"k1": k1[:5], "k2": k2[:5], "k3": k3[:5]}

def find_frases_canonicas(respuesta):
    toks = norm(respuesta or "").split()
    hits = []
    for i in range(len(toks)-2):
        tri = " ".join(toks[i:i+3])
        if tri in FC_index: hits.append(tri)
    return hits[:3]

# Precomputo membresías rápidas
n_to_rr = {}
for g in RR_groups:
    for n in g["ns"]: n_to_rr[n] = g["respuesta"]
n_to_pe = {}
for g in PE_groups:
    for n in g["ns"]: n_to_pe.setdefault(n, []).append(g["tronco"])
n_to_fam_ra = {}
for g in FAM_RA:
    for n in g["ns"]: n_to_fam_ra[n] = (g["respuesta"], g["articulo"])

por_pregunta = {}
CONF_ORDER = {"MUY ALTA":4,"ALTA":3,"MEDIA":2,"BAJA":1}
for q in DATA:
    n = q["n"]
    art = get_art(q)
    resp = q.get("respuesta","") or ""
    correct_text = q.get("opciones",[])[q.get("correcta",0)] if q.get("opciones") else resp
    all_text = q.get("pregunta","") + " " + " || ".join(q.get("opciones",[]))

    is_rr = n in n_to_rr
    is_pe = n in n_to_pe
    is_an = bool(art) and art in AN_index
    is_fam_ra = n in n_to_fam_ra
    is_ne = find_negacion(q.get("pregunta",""))
    autoridad = find_autoridad(correct_text)
    plazo = find_plazo(correct_text)
    verbo = find_verbo_rector(q.get("pregunta",""))
    cat_jur = find_categoria_juridica(q.get("pregunta",""), q.get("opciones",[]))
    frases = find_frases_canonicas(correct_text)
    kws = find_kws(q)
    dr = DR_index.get(norm(correct_text), [])

    # patrones etiquetados
    patrones = []
    if is_rr:       patrones.append("RR")
    if is_an:       patrones.append("AN")
    if is_pe:       patrones.append("PE")
    if is_fam_ra:   patrones.append("RR+AN")
    if kws["k1"]:   patrones.append("K1")
    if kws["k2"]:   patrones.append("K2")
    if kws["k3"]:   patrones.append("K3")
    if verbo:       patrones.append("VR")
    if cat_jur:     patrones.append("CJ")
    if frases:      patrones.append("FC")
    if autoridad:   patrones.append("AC")
    if plazo:       patrones.append("NP")
    if dr:          patrones.append("DR")
    if is_ne:       patrones.append("NE")
    if n in RE_ns:  patrones.append("RE")

    # confianza (regla del punto 16)
    señales_fuertes = 0
    if is_rr:      señales_fuertes += 1
    if is_an:      señales_fuertes += 1
    if is_fam_ra:  señales_fuertes += 1
    if kws["k1"]:  señales_fuertes += 1
    if kws["k3"]:  señales_fuertes += 1
    if is_pe:      señales_fuertes += 1
    señales_medias = 0
    if kws["k2"] and not kws["k1"]: señales_medias += 1
    if verbo:      señales_medias += 1
    if cat_jur:    señales_medias += 1

    if señales_fuertes >= 3:
        confianza = "MUY ALTA"
    elif señales_fuertes >= 2:
        confianza = "ALTA"
    elif señales_fuertes == 1 or señales_medias >= 1:
        confianza = "MEDIA"
    else:
        confianza = "BAJA"

    # dificultad: NE eleva el piso a ALTA
    dificultad = "ALTA" if is_ne else ("MEDIA" if patrones else "BAJA")

    # técnica de estudio (motor del punto 17, prioridades)
    if is_fam_ra:  tecnica = "Familia RR+AN (misma respuesta y mismo artículo)"
    elif is_rr:    tecnica = "Familia por respuesta repetida"
    elif is_pe:    tecnica = "Estudiar preguntas espejo lado a lado"
    elif autoridad:tecnica = "Tabla acción → autoridad competente"
    elif plazo:    tecnica = "Tarjeta evento → número"
    elif cat_jur and "CONTRASTE" in cat_jur:
                   tecnica = "Contrastar función/atribución/facultad/derecho"
    elif frases:   tecnica = "Memorizar frase canónica como bloque"
    elif is_ne:    tecnica = "Alerta negativa: leer NO/SALVO/EXCEPTO primero"
    elif kws["k1"]: tecnica = "Ancla por keyword exclusiva"
    elif kws["k2"]: tecnica = "Keyword familia + segunda señal"
    else:          tecnica = "Estudio directo"

    por_pregunta[n] = {
        "patrones": patrones,
        "confianza": confianza,
        "dificultad_motor": dificultad,
        "articulo_ancla": art,
        "familia_ra": {"respuesta": n_to_fam_ra[n][0], "articulo": n_to_fam_ra[n][1]} if is_fam_ra else None,
        "verbo_rector": verbo,
        "categoria_juridica": cat_jur,
        "frases_canonicas": frases,
        "autoridades": autoridad,
        "plazos": plazo,
        "distractores_recurrentes": dr[:4],
        "keywords": kws,
        "espejo_tronco": n_to_pe.get(n, [])[:1],
        "espejo_hermanas": (sorted(set(sum([espejo_buckets[t] for t in n_to_pe.get(n,[])], [])) - {n}))[:8] if is_pe else [],
        "familia_rr_hermanas": sorted(set(resp_ns.get(n_to_rr.get(n,""), [])) - {n})[:12] if is_rr else [],
        "es_negativa": is_ne,
        "es_exclusiva": n in RE_ns,
        "tecnica": tecnica,
    }

# ==================== salida ====================
out = {
    "version": 4,
    "meta": {
        "total": len(DATA),
        "patrones_conteo": Counter(p for info in por_pregunta.values() for p in info["patrones"]),
        "confianza_conteo": Counter(info["confianza"] for info in por_pregunta.values()),
    },
    "indices": {
        "RR_groups": RR_groups[:200],  # top 200 grupos
        "FAM_RA":    FAM_RA[:200],
        "AN_index":  {a: ns for a, ns in list(sorted(AN_index.items(), key=lambda x:-len(x[1])))[:200]},
        "PE_groups": PE_groups[:200],
        "K1_index":  {k: ns for k, ns in list(K1_index.items())[:300]},
        "K2_index":  {k: {"familia": v["familia"][:80], "ns_kw": v["ns_kw"][:20]} for k, v in list(K2_index.items())[:150]},
        "FC_index":  dict(sorted(FC_index.items(), key=lambda x:-x[1])[:100]),
    },
    "por_pregunta": por_pregunta,
}

# Counter → dict serializable
out["meta"]["patrones_conteo"] = dict(out["meta"]["patrones_conteo"].most_common())
out["meta"]["confianza_conteo"] = dict(out["meta"]["confianza_conteo"].most_common())

with open(OUT, "w") as f:
    json.dump(out, f, ensure_ascii=False)
print(f"\n✓ Escrito {OUT}  ({os.path.getsize(OUT)//1024} KB)")

# Reporte
print("\n=== Distribución de patrones ===")
for p, c in out["meta"]["patrones_conteo"].items():
    print(f"  {p:8s} {c:>5d}  ({c*100//len(DATA)}%)")
print("\n=== Confianza ===")
for c, n in out["meta"]["confianza_conteo"].items():
    print(f"  {c:10s} {n:>5d}")
