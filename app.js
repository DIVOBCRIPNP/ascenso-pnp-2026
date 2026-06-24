/* Ascenso PNP 2026 - Banco de preguntas / generador de examenes */
(function(){
"use strict";

const LS_HISTORY = "pnp_historial";
const LS_EXAM = "pnp_examen_actual";
const LS_STUDY = "pnp_estudio_progreso";

let DATA = [];           // todas las preguntas
let MATERIAS = [];       // [{materia, grupo, count}]
let SESSION = null;      // sesión Supabase del usuario
let view = "home";
let examState = null;    // estado de examen en curso
let studyState = null;   // estado de modo estudio

const $app = document.getElementById("app");

/* iconos SVG (estilo Lucide) — sin emojis */
const ICONS = {
  exam:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="m9 15 2 2 4-4"/>',
  book:'<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  chart:'<path d="M3 3v18h18"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
  star:'<path d="M11.5 2.8 14 8l5.7.8-4.1 4 1 5.7-5.1-2.7L7.3 18.5l1-5.7-4.1-4L10 8z"/>',
  arrowL:'<path d="m12 19-7-7 7-7"/><path d="M19 12H5"/>',
  arrowR:'<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  eye:'<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  check:'<path d="M20 6 9 17l-5-5"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  trash:'<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  chat:'<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
  send:'<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
};
function svg(name, cls){
  return `<svg class="icon ${cls||""}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]||""}</svg>`;
}

function fmtPct(n){ return Math.round(n*1000)/10; }
function shuffle(arr){
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}
function sample(arr,n){ return shuffle(arr).slice(0,Math.min(n,arr.length)); }
function escapeHtml(s){
  return (s||"").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function shortMateria(m){
  if(!m) return "Sin materia";
  return m.length > 58 ? m.slice(0,55) + "…" : m;
}

/* ---------------- carga de datos ---------------- */
async function loadData(){
  const res = await fetch("data/preguntas.json");
  DATA = await res.json();
  const map = new Map();
  DATA.forEach(q=>{
    const key = q.materia;
    if(!map.has(key)) map.set(key, {materia:key, grupo:q.grupo, count:0});
    map.get(key).count++;
  });
  MATERIAS = Array.from(map.values()).sort((a,b)=>b.count-a.count);
}

/* ---------------- navegacion ---------------- */
function setView(v, opts){
  if(view === "chat" && v !== "chat") stopChatPolling();
  view = v;
  document.querySelectorAll(".nav-btn").forEach(b=>{
    b.classList.toggle("active", b.dataset.view === v);
  });
  render(opts);
  window.scrollTo({top:0, behavior:"smooth"});
}
document.querySelectorAll(".nav-btn").forEach(b=>{
  b.addEventListener("click", ()=> setView(b.dataset.view));
});

function render(opts){
  if(view === "home") return renderHome();
  if(view === "banco") return renderBanco();
  if(view === "hack") return renderHack();
  if(view === "examen") return renderExamenEntry();
  if(view === "ranking") return renderRanking();
  if(view === "chat") return renderChat();
  if(view === "historial") return renderHistorial();
  if(view === "quiz") return renderQuiz();
  if(view === "resultados") return renderResultados();
  if(view === "estudio") return renderEstudio();
}

/* ---------------- HOME ---------------- */
function renderHome(){
  const total = DATA.length;
  const comunes = DATA.filter(q=>q.grupo==="Materias Comunes").length;
  const especialidad = DATA.filter(q=>q.grupo==="Materias de Especialidad").length;
  const hist = getHistory();
  const last = hist[0];

  $app.innerHTML = `
    <div class="hero">
      <h1>Prepárate para el ascenso 2026</h1>
      <p>Banco oficial de ${total} preguntas para Oficiales Subalternos de Armas (Policía), organizado por materia.
      Genera simulacros de 100 preguntas con proporción automática según el peso real de cada materia en el banco, o estudia tema por tema con retroalimentación inmediata.</p>
      <div class="stat-row">
        <div class="stat"><b>${total}</b><span>preguntas totales</span></div>
        <div class="stat"><b>${comunes}</b><span>materias comunes</span></div>
        <div class="stat"><b>${especialidad}</b><span>materias de especialidad</span></div>
        <div class="stat"><b>${MATERIAS.length}</b><span>temas / leyes</span></div>
      </div>
    </div>

    <h2>¿Qué quieres hacer?</h2>
    <div class="grid grid-3">
      <div class="card option-card" id="op-examen" role="button" tabindex="0">
        <span class="option-icon">${svg("exam")}</span>
        <h3>Simulacro de 100 preguntas</h3>
        <p>Examen cronometrado con distribución proporcional por materia, igual que el examen real.</p>
      </div>
      <div class="card option-card" id="op-banco" role="button" tabindex="0">
        <span class="option-icon">${svg("book")}</span>
        <h3>Estudiar por materia</h3>
        <p>Repasa el banco completo tema por tema, con respuesta y base legal a la vista.</p>
      </div>
      <div class="card option-card" id="op-historial" role="button" tabindex="0">
        <span class="option-icon">${svg("chart")}</span>
        <h3>Mi progreso</h3>
        <p>${hist.length ? `Último simulacro: <b>${last.score}/100</b> (${last.date})` : "Aún no rindes ningún simulacro."}</p>
      </div>
    </div>
  `;
  const cards = {"op-examen":"examen","op-banco":"banco","op-historial":"historial"};
  Object.entries(cards).forEach(([id,v])=>{
    const el = document.getElementById(id);
    el.onclick = ()=> setView(v);
    el.onkeydown = (e)=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); setView(v); } };
  });
}
function goHome(){ setView("home"); }

/* ---------------- BANCO (estudio por materia) ---------------- */
let bancoFiltro = "todas";
function renderBanco(){
  $app.innerHTML = `
    <h1>Banco de preguntas</h1>
    <p class="subtitle">Elige una materia para estudiarla con respuesta y base legal visibles, en orden o aleatorio.</p>
    <div class="section-toggle">
      <button data-g="todas" class="${bancoFiltro==='todas'?'active':''}">Todas (${DATA.length})</button>
      <button data-g="Materias Comunes" class="${bancoFiltro==='Materias Comunes'?'active':''}">Comunes</button>
      <button data-g="Materias de Especialidad" class="${bancoFiltro==='Materias de Especialidad'?'active':''}">Especialidad</button>
    </div>
    <div class="card" id="materia-list"></div>
  `;
  document.querySelectorAll(".section-toggle button").forEach(b=>{
    b.onclick = ()=>{ bancoFiltro = b.dataset.g; renderBanco(); };
  });
  const list = document.getElementById("materia-list");
  const items = MATERIAS.filter(m=> bancoFiltro==="todas" || m.grupo===bancoFiltro);
  list.innerHTML = items.map(m=>`
    <div class="materia-row" data-m="${escapeHtml(m.materia)}">
      <span class="mtag ${m.grupo==='Materias Comunes'?'comunes':'especialidad'}">${m.grupo==='Materias Comunes'?'Común':'Especialidad'}</span>
      <span class="mname">${shortMateria(m.materia)}</span>
      <span class="mcount">${m.count} preg.</span>
    </div>
  `).join("");
  list.querySelectorAll(".materia-row").forEach(row=>{
    row.onclick = ()=> startStudy(row.dataset.m);
  });
}

function startStudy(materia){
  const qs = shuffle(DATA.filter(q=>q.materia===materia));
  studyState = {materia, qs, idx:0, answered:null, hits:0, misses:0};
  setView("estudio");
}
function renderEstudio(){
  if(!studyState){ return setView("banco"); }
  const {qs, idx, answered} = studyState;
  const q = qs[idx];
  const done = answered !== null;
  const isCorrect = done && answered === q.correcta;
  const pct = Math.round((idx+1)/qs.length*100);
  const dots = qs.map((_,i)=>`<span class="pdot${i<=idx?' done':''}"></span>`).join("");
  $app.innerHTML = `
    <div class="quiz-top">
      <span class="qmeta">${shortMateria(studyState.materia)}</span>
      <span class="study-score">
        <span class="study-hit">${svg("check")} ${studyState.hits}</span>
        <span class="study-miss">${studyState.misses}</span>
      </span>
      <button class="btn outline" id="exit-study">← Volver al banco</button>
    </div>
    <div class="study-progress">
      <div class="pmeta">
        <span>Pregunta ${idx+1} de ${qs.length}</span>
        <span>${pct}%</span>
      </div>
      <div class="pdots" role="progressbar" aria-valuenow="${idx+1}" aria-valuemin="1" aria-valuemax="${qs.length}" aria-label="Progreso de estudio">${dots}</div>
    </div>
    <div class="card card-deep">
      <div class="qtext">${escapeHtml(q.pregunta)}</div>
      <div id="opts-study"></div>
      <div id="study-feedback" class="study-feedback ${done ? (isCorrect?'ok':'bad') : ''}" aria-live="polite">
        ${done ? (isCorrect
            ? `${svg('check')} ¡Correcto! La respuesta es la ${"ABCDE"[q.correcta]}.`
            : `${svg('trash')} Incorrecto. La respuesta correcta es la ${"ABCDE"[q.correcta]}: ${escapeHtml(q.opciones[q.correcta])}`)
          : ""}
      </div>
      <div class="qfoot">
        <span class="qmeta">${done && q.ubicacion ? "Base legal: " + escapeHtml(q.ubicacion) : ""}</span>
        <div class="btn-row" style="margin-top:0">
          <button class="btn outline" id="prev-study" ${idx===0?"disabled":""}>← Anterior</button>
          <button class="btn gold" id="next-study" ${idx===qs.length-1?"disabled":""} ${!done?"disabled":""}>Siguiente →</button>
        </div>
      </div>
    </div>
  `;
  const optsDiv = document.getElementById("opts-study");
  optsDiv.innerHTML = q.opciones.map((o,i)=>{
    let cls = "qoption";
    if(done){
      if(i===q.correcta) cls += " correct";
      else if(i===answered) cls += " incorrect";
    }
    return `<div class="${cls}" data-i="${i}" role="button" tabindex="0"><span class="letter">${"ABCDE"[i]||i+1}</span><span>${escapeHtml(o)}</span></div>`;
  }).join("");

  if(!done){
    optsDiv.querySelectorAll(".qoption").forEach(el=>{
      const pick = ()=>{
        const i = +el.dataset.i;
        studyState.answered = i;
        if(i===q.correcta) studyState.hits++; else studyState.misses++;
        renderEstudio();
      };
      el.onclick = pick;
      el.onkeydown = (e)=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); pick(); } };
    });
  }

  document.getElementById("exit-study").onclick = ()=> setView("banco");
  document.getElementById("prev-study").onclick = ()=>{ studyState.idx--; studyState.answered=null; renderEstudio(); };
  document.getElementById("next-study").onclick = ()=>{ studyState.idx++; studyState.answered=null; renderEstudio(); };
}

/* ---------------- EL HACK (preguntas agrupadas por letra de respuesta) ---------------- */
let hackLetter = 0;       // índice de letra activa: 0=A,1=B,...
let hackGrupo = "todas";  // filtro de grupo
let hackHide = false;     // modo auto-evaluación: oculta respuestas hasta revelar
let hackRevealed = new Set(); // índices revelados en el grupo actual
function renderHack(){
  const LETRAS = "ABCDE";
  const pool = DATA.filter(q=> hackGrupo==="todas" || q.grupo===hackGrupo);
  // conteo por letra dentro del pool filtrado
  const counts = [0,0,0,0,0];
  pool.forEach(q=>{ if(q.correcta>=0 && q.correcta<5) counts[q.correcta]++; });
  if(counts[hackLetter]===0){ hackLetter = counts.findIndex(c=>c>0); if(hackLetter<0) hackLetter=0; }

  const qs = pool.filter(q=> q.correcta===hackLetter);

  $app.innerHTML = `
    <h1>El Hack <span class="hack-tag">técnica de memorización</span></h1>
    <p class="subtitle">Estudia todas las preguntas <b>agrupadas por la letra de su respuesta correcta</b>, en orden correlativo.
    Primero todas las que se responden <b>A</b>, luego las <b>B</b>, y así sucesivamente. La respuesta correcta va resaltada en cada una.</p>

    <div class="section-toggle">
      <button data-g="todas" class="${hackGrupo==='todas'?'active':''}">Todas (${DATA.length})</button>
      <button data-g="Materias Comunes" class="${hackGrupo==='Materias Comunes'?'active':''}">Comunes</button>
      <button data-g="Materias de Especialidad" class="${hackGrupo==='Materias de Especialidad'?'active':''}">Especialidad</button>
    </div>

    <div class="hack-letters" id="hack-letters">
      ${LETRAS.split("").map((L,i)=> counts[i]===0 ? "" :
        `<button class="hack-letter ${i===hackLetter?'active':''}" data-l="${i}">
           <span class="hl-letter">${L}</span><span class="hl-count">${counts[i]}</span>
         </button>`).join("")}
    </div>

    <div class="hack-head">
      <span>Respuesta <b>${LETRAS[hackLetter]}</b> · ${qs.length} pregunta${qs.length===1?'':'s'}</span>
      <button class="mark-btn ${hackHide?'marked':''}" id="hack-mode" aria-pressed="${hackHide?'true':'false'}">
        ${svg(hackHide?'eye':'check')} ${hackHide?'Modo auto-evaluación: ON':'Modo auto-evaluación: OFF'}
      </button>
    </div>
    <div id="hack-list"></div>
  `;

  document.querySelectorAll(".section-toggle button").forEach(b=>{
    b.onclick = ()=>{ hackGrupo = b.dataset.g; hackRevealed.clear(); renderHack(); };
  });
  document.querySelectorAll(".hack-letter").forEach(b=>{
    b.onclick = ()=>{ hackLetter = +b.dataset.l; hackRevealed.clear(); renderHack(); window.scrollTo({top:0,behavior:"smooth"}); };
  });
  document.getElementById("hack-mode").onclick = ()=>{ hackHide = !hackHide; hackRevealed.clear(); renderHack(); };

  const list = document.getElementById("hack-list");
  list.innerHTML = qs.map((q,n)=>{
    const shown = !hackHide || hackRevealed.has(n);
    const opts = q.opciones.map((o,i)=>{
      const ok = i===q.correcta;
      const mark = (ok && shown) ? " correct" : "";
      return `<div class="hack-opt${mark}"><span class="letter">${"ABCDE"[i]||i+1}</span><span>${escapeHtml(o)}${ok&&shown?' ✓':''}</span></div>`;
    }).join("");
    const footer = (hackHide && !shown)
      ? `<button class="btn outline hack-reveal" data-n="${n}" style="margin-top:10px">${svg("eye")} Ver respuesta</button>`
      : (q.ubicacion ? `<div class="legal" style="margin-top:8px">Base legal: ${escapeHtml(q.ubicacion)}</div>` : "");
    return `
      <div class="hack-card">
        <div class="hack-q-top">
          <span class="hack-num">${n+1}</span>
          <span class="qmeta">${shortMateria(q.materia)}</span>
        </div>
        <div class="qtext" style="font-size:15px">${escapeHtml(q.pregunta)}</div>
        <div class="hack-opts">${opts}</div>
        ${footer}
      </div>`;
  }).join("");

  list.querySelectorAll(".hack-reveal").forEach(b=>{
    b.onclick = ()=>{ hackRevealed.add(+b.dataset.n); renderHack(); };
  });
}

/* ---------------- EXAMEN: configuracion ---------------- */
const EXAM_DEFAULTS = { total:100, minutes:100, timerOn:true };
function computeDistribution(total){
  const sumAll = DATA.length;
  const raw = MATERIAS.map(m => ({materia:m.materia, grupo:m.grupo, ideal: m.count/sumAll*total}));
  const dist = raw.map(r => ({...r, n: Math.floor(r.ideal)}));
  let used = dist.reduce((a,b)=>a+b.n,0);
  let remainder = raw.map((r,i)=>({i, frac:r.ideal - dist[i].n})).sort((a,b)=>b.frac-a.frac);
  let k=0;
  while(used < total && k < remainder.length){
    dist[remainder[k].i].n++; used++; k++;
  }
  return dist.filter(d=>d.n>0);
}

function renderExamenEntry(){
  const total = EXAM_DEFAULTS.total;
  const dist = computeDistribution(total);
  const comunes = dist.filter(d=>d.grupo==="Materias Comunes").reduce((a,b)=>a+b.n,0);
  const especialidad = dist.filter(d=>d.grupo==="Materias de Especialidad").reduce((a,b)=>a+b.n,0);

  $app.innerHTML = `
    <h1>Simulacro de examen</h1>
    <p class="subtitle">Distribución proporcional automática según el peso de cada materia en el banco de ${DATA.length} preguntas.</p>
    <div class="grid grid-2">
      <div class="card">
        <h2>Configuración</h2>
        <div class="config-row">
          <label>N° de preguntas<br><span class="hint">recomendado: 100 (igual al examen real)</span></label>
          <input type="number" id="cfg-total" min="10" max="${DATA.length}" step="10" value="${EXAM_DEFAULTS.total}">
        </div>
        <div class="config-row">
          <label>Tiempo límite (minutos)<br><span class="hint">0 = sin límite de tiempo</span></label>
          <input type="number" id="cfg-min" min="0" max="240" step="5" value="${EXAM_DEFAULTS.minutes}">
        </div>
        <div class="config-row">
          <label>Cronómetro visible</label>
          <button class="toggle ${EXAM_DEFAULTS.timerOn?'on':''}" id="cfg-timer"></button>
        </div>
        <div class="btn-row">
          <button class="btn gold" id="start-exam">Iniciar simulacro →</button>
        </div>
      </div>
      <div class="card">
        <h2>Distribución (${comunes} comunes / ${especialidad} especialidad)</h2>
        <div id="dist-list" style="max-height:280px;overflow:auto"></div>
      </div>
    </div>
  `;
  function refreshDist(){
    const t = parseInt(document.getElementById("cfg-total").value)||100;
    const d = computeDistribution(t);
    const c = d.filter(x=>x.grupo==="Materias Comunes").reduce((a,b)=>a+b.n,0);
    const e = d.filter(x=>x.grupo==="Materias de Especialidad").reduce((a,b)=>a+b.n,0);
    document.querySelector("#dist-list").parentElement.querySelector("h2").textContent = `Distribución (${c} comunes / ${e} especialidad)`;
    document.getElementById("dist-list").innerHTML = d.map(x=>`
      <div class="breakdown-row">
        <span class="bname">${shortMateria(x.materia)}</span>
        <span class="bscore">${x.n}</span>
      </div>`).join("");
  }
  refreshDist();
  document.getElementById("cfg-total").oninput = refreshDist;
  document.getElementById("cfg-timer").onclick = (e)=> e.target.classList.toggle("on");
  document.getElementById("start-exam").onclick = ()=>{
    const total = parseInt(document.getElementById("cfg-total").value)||100;
    const minutes = parseInt(document.getElementById("cfg-min").value)||0;
    const timerOn = document.getElementById("cfg-timer").classList.contains("on");
    startExam(total, minutes, timerOn);
  };
}

function startExam(total, minutes, timerOn){
  const dist = computeDistribution(total);
  let qs = [];
  dist.forEach(d=>{
    const pool = DATA.filter(q=>q.materia===d.materia);
    qs = qs.concat(sample(pool, d.n));
  });
  qs = shuffle(qs).map(q=>{
    // mezclar opciones manteniendo el indice correcto
    const order = shuffle(q.opciones.map((_,i)=>i));
    const opciones = order.map(i=>q.opciones[i]);
    const correcta = order.indexOf(q.correcta);
    return {...q, opciones, correcta};
  });
  examState = {
    qs, answers: new Array(qs.length).fill(-1),
    marked: new Array(qs.length).fill(false),
    idx: 0, minutes, timerOn,
    startedAt: Date.now(),
    deadline: minutes>0 ? Date.now()+minutes*60000 : null,
    finished:false,
  };
  saveExamState();
  setView("quiz");
}

function saveExamState(){
  try{ localStorage.setItem(LS_EXAM, JSON.stringify(examState)); }catch(e){}
}

let quizTimerId = null;
function renderQuiz(){
  if(!examState) return setView("examen");
  clearInterval(quizTimerId);
  const {qs, idx, answers, marked} = examState;
  const q = qs[idx];
  const answeredCount = answers.filter(a=>a>=0).length;

  $app.innerHTML = `
    <div class="quiz-wrap">
      <div class="quiz-main">
        <div class="quiz-top">
          <span class="qmeta">Pregunta ${idx+1} de ${qs.length} · ${shortMateria(q.materia)}</span>
          ${examState.deadline ? `<span class="qtimer" id="qtimer" role="timer" aria-label="Tiempo restante">${svg("clock")} <span id="qtimer-val"></span></span>` : ""}
        </div>
        <div class="study-progress">
          <div class="pmeta">
            <span>${answeredCount} de ${qs.length} respondidas</span>
            <span>${Math.round(answeredCount/qs.length*100)}%</span>
          </div>
          <div class="pdots" role="progressbar" aria-valuenow="${answeredCount}" aria-valuemin="0" aria-valuemax="${qs.length}" aria-label="Avance del examen">${qs.map((_,i)=>`<span class="pdot${answers[i]>=0?' done':''}${i===idx?' current':''}"></span>`).join("")}</div>
        </div>
        <div class="card card-deep">
          <div class="qtext">${escapeHtml(q.pregunta)}</div>
          <div id="opts-quiz"></div>
          <div class="qfoot">
            <button class="mark-btn ${marked[idx]?'marked':''}" id="mark-btn" aria-pressed="${marked[idx]?'true':'false'}">${svg("star")} ${marked[idx]?'Marcada para revisar':'Marcar para revisar'}</button>
            <div class="btn-row" style="margin-top:0">
              <button class="btn outline" id="prev-q" ${idx===0?"disabled":""}>← Anterior</button>
              ${idx===qs.length-1
                ? `<button class="btn danger" id="finish-q">Finalizar examen</button>`
                : `<button class="btn" id="next-q">Siguiente →</button>`}
            </div>
          </div>
        </div>
      </div>
      <div class="quiz-side">
        <div class="card">
          <div class="qmeta">Avance: ${answeredCount}/${qs.length} respondidas</div>
          <div class="grid-nav" id="grid-nav"></div>
          <div class="legend">
            <span><span class="dot answered"></span> Respondida</span>
            <span><span class="dot unanswered"></span> Sin responder</span>
            <span><span class="dot unanswered marked"></span> Marcada</span>
          </div>
          <div class="btn-row">
            <button class="btn danger" id="finish-side" style="width:100%">Finalizar examen</button>
          </div>
        </div>
      </div>
    </div>
  `;

  const optsDiv = document.getElementById("opts-quiz");
  optsDiv.innerHTML = q.opciones.map((o,i)=>{
    const sel = answers[idx]===i ? " selected" : "";
    return `<div class="qoption${sel}" data-i="${i}"><span class="letter">${"ABCDE"[i]||i+1}</span><span>${escapeHtml(o)}</span></div>`;
  }).join("");
  optsDiv.querySelectorAll(".qoption").forEach(el=>{
    el.onclick = ()=>{
      examState.answers[idx] = parseInt(el.dataset.i);
      saveExamState();
      renderQuiz();
    };
  });

  document.getElementById("mark-btn").onclick = ()=>{
    examState.marked[idx] = !examState.marked[idx];
    saveExamState();
    renderQuiz();
  };
  document.getElementById("prev-q").onclick = ()=>{ examState.idx--; saveExamState(); renderQuiz(); };
  const nextBtn = document.getElementById("next-q");
  if(nextBtn) nextBtn.onclick = ()=>{ examState.idx++; saveExamState(); renderQuiz(); };
  const finishBtn = document.getElementById("finish-q");
  if(finishBtn) finishBtn.onclick = finishExam;
  document.getElementById("finish-side").onclick = finishExam;

  const gridNav = document.getElementById("grid-nav");
  gridNav.innerHTML = qs.map((_,i)=>{
    let cls = "";
    if(answers[i]>=0) cls += " answered";
    if(marked[i]) cls += " marked";
    if(i===idx) cls += " current";
    return `<button class="${cls.trim()}" data-i="${i}">${i+1}</button>`;
  }).join("");
  gridNav.querySelectorAll("button").forEach(b=>{
    b.onclick = ()=>{ examState.idx = parseInt(b.dataset.i); saveExamState(); renderQuiz(); };
  });

  if(examState.deadline){
    const tick = ()=>{
      const remaining = examState.deadline - Date.now();
      const timerEl = document.getElementById("qtimer");
      const valEl = document.getElementById("qtimer-val");
      if(!timerEl || !valEl) return;
      if(remaining <= 0){
        valEl.textContent = "00:00";
        clearInterval(quizTimerId);
        finishExam();
        return;
      }
      const m = Math.floor(remaining/60000);
      const s = Math.floor((remaining%60000)/1000);
      valEl.textContent = `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
      timerEl.classList.toggle("low", remaining < 5*60000);
    };
    tick();
    quizTimerId = setInterval(tick, 1000);
  }
}

function finishExam(){
  if(!examState || examState.finished) return;
  clearInterval(quizTimerId);
  examState.finished = true;
  const {qs, answers} = examState;
  let correct = 0;
  const byMateria = {};
  qs.forEach((q,i)=>{
    const ok = answers[i] === q.correcta;
    if(ok) correct++;
    if(!byMateria[q.materia]) byMateria[q.materia] = {ok:0, total:0, grupo:q.grupo};
    byMateria[q.materia].total++;
    if(ok) byMateria[q.materia].ok++;
  });
  const result = {
    date: new Date().toLocaleString("es-PE", {dateStyle:"medium", timeStyle:"short"}),
    total: qs.length, correct, score: correct,
    pct: fmtPct(correct/qs.length),
    byMateria,
    durationSec: Math.round((Date.now()-examState.startedAt)/1000),
  };
  saveHistoryEntry(result);
  examState.result = result;
  saveExamState();
  // guarda el puntaje en el ranking compartido (no bloquea la vista)
  if(window.Auth && SESSION){ window.Auth.saveScore(result, SESSION); }
  setView("resultados");
}

function renderResultados(){
  if(!examState || !examState.result) return setView("home");
  const {qs, answers, marked, result} = examState;
  const wrong = qs.map((q,i)=>({q,i})).filter(({q,i}) => answers[i] !== q.correcta);

  const breakdown = Object.entries(result.byMateria)
    .sort((a,b)=> (a[1].ok/a[1].total) - (b[1].ok/b[1].total));

  $app.innerHTML = `
    <div class="score-banner">
      <div class="big">${result.correct}/${result.total}</div>
      <div class="label">${result.pct}% de respuestas correctas · ${Math.floor(result.durationSec/60)} min ${result.durationSec%60}s</div>
    </div>
    <div class="grid grid-2">
      <div class="card">
        <h2>Desempeño por materia</h2>
        <div id="breakdown"></div>
      </div>
      <div class="card">
        <h2>Acciones</h2>
        <p class="subtitle">Revisa tus errores abajo, o vuelve a intentarlo con un nuevo simulacro generado al azar.</p>
        <div class="btn-row">
          <button class="btn gold" id="retry-exam">Nuevo simulacro</button>
          <button class="btn outline" id="see-history">Ver historial</button>
          <button class="btn outline" id="back-home">Inicio</button>
        </div>
      </div>
    </div>
    <h2 style="margin-top:26px">Revisión de preguntas (${wrong.length} incorrectas o sin responder de ${result.total})</h2>
    <div id="review-list"></div>
  `;
  document.getElementById("breakdown").innerHTML = breakdown.map(([m,b])=>{
    const pct = b.ok/b.total;
    return `<div class="breakdown-row">
      <span class="bname">${shortMateria(m)}</span>
      <div class="bar-bg"><div class="bar-fill ${pct<0.6?'low':''}" style="width:${pct*100}%"></div></div>
      <span class="bscore">${b.ok}/${b.total}</span>
    </div>`;
  }).join("");

  document.getElementById("review-list").innerHTML = wrong.length ? wrong.map(({q,i})=>{
    const ans = answers[i];
    return `<div class="review-item">
      <span class="review-tag bad">${ans<0?"Sin responder":"Incorrecta"}</span>
      ${marked[i] ? `<span class="review-tag" style="background:#fdf6e6;color:#8a6a23">Marcada</span>` : ""}
      <div class="rqtext" style="margin-top:8px">${escapeHtml(q.pregunta)}</div>
      ${q.opciones.map((o,oi)=>{
        let cls = "qoption";
        if(oi===q.correcta) cls += " correct";
        else if(oi===ans) cls += " incorrect";
        return `<div class="${cls}"><span class="letter">${"ABCDE"[oi]}</span><span>${escapeHtml(o)}</span></div>`;
      }).join("")}
      <div class="review-meta">${shortMateria(q.materia)} ${q.ubicacion ? "· " + escapeHtml(q.ubicacion) : ""}</div>
    </div>`;
  }).join("") : `<div class="empty">¡Sin errores! Excelente trabajo.</div>`;

  document.getElementById("retry-exam").onclick = ()=> setView("examen");
  document.getElementById("see-history").onclick = ()=> setView("historial");
  document.getElementById("back-home").onclick = ()=> setView("home");
}

/* ---------------- HISTORIAL ---------------- */
function getHistory(){
  try{ return JSON.parse(localStorage.getItem(LS_HISTORY)) || []; }catch(e){ return []; }
}
function saveHistoryEntry(result){
  const hist = getHistory();
  hist.unshift({date:result.date, score:result.correct, total:result.total, pct:result.pct});
  if(hist.length>50) hist.length = 50;
  try{ localStorage.setItem(LS_HISTORY, JSON.stringify(hist)); }catch(e){}
}
function renderHistorial(){
  const hist = getHistory();
  $app.innerHTML = `
    <h1>Historial de simulacros</h1>
    <p class="subtitle">Tus últimos resultados, guardados en este navegador.</p>
    <div class="card">
      ${hist.length ? hist.map(h=>`
        <div class="history-item">
          <div>
            <div class="hscore ${h.pct<60?'low':''}">${h.score}/${h.total}</div>
            <div class="hdate">${h.date}</div>
          </div>
          <div class="qmeta">${h.pct}%</div>
        </div>
      `).join("") : `<div class="empty">Aún no has rendido ningún simulacro.<br><br>
        <button class="btn gold" id="go-exam">Iniciar mi primer simulacro</button></div>`}
    </div>
    ${hist.length ? `<div class="btn-row"><button class="btn outline" id="clear-hist">Borrar historial</button></div>` : ""}
  `;
  const goExam = document.getElementById("go-exam");
  if(goExam) goExam.onclick = ()=> setView("examen");
  const clearBtn = document.getElementById("clear-hist");
  if(clearBtn) clearBtn.onclick = ()=>{
    if(confirm("¿Borrar todo el historial de simulacros?")){
      localStorage.removeItem(LS_HISTORY);
      renderHistorial();
    }
  };
}

/* ---------------- RANKING ---------------- */
async function renderRanking(){
  $app.innerHTML = `
    <h1>Ranking de participantes</h1>
    <p class="subtitle">Mejor puntaje de cada persona en los simulacros. Compite por el primer lugar de la promoción.</p>
    <div class="card" id="ranking-box"><div class="empty">Cargando ranking…</div></div>
  `;
  const box = document.getElementById("ranking-box");
  if(!window.Auth || !window.Auth.configured()){
    box.innerHTML = `<div class="empty">El ranking compartido requiere configurar el acceso con Google (ver README).</div>`;
    return;
  }
  let rows = [];
  try{ rows = await window.Auth.fetchRanking(); }
  catch(e){ box.innerHTML = `<div class="empty">No se pudo cargar el ranking.</div>`; return; }

  if(!rows.length){
    box.innerHTML = `<div class="empty">Aún no hay puntajes registrados.<br><br>
      <button class="btn gold" id="rk-exam">Rendir el primer simulacro</button></div>`;
    document.getElementById("rk-exam").onclick = ()=> setView("examen");
    return;
  }
  const myEmail = SESSION ? SESSION.email : null;
  box.innerHTML = `
    <table class="ranking-table">
      <thead><tr><th>#</th><th>Participante</th><th>Mejor puntaje</th><th>%</th><th>Intentos</th></tr></thead>
      <tbody>
        ${rows.map((r,i)=>{
          const medal = i===0?"🥇":i===1?"🥈":i===2?"🥉":"";
          const me = r.email===myEmail ? " rk-me" : "";
          return `<tr class="${me.trim()}">
            <td class="rk-pos">${medal || (i+1)}</td>
            <td>${escapeHtml(r.nombre || "Participante")}${r.email===myEmail?' <span class="rk-you">tú</span>':''}</td>
            <td class="rk-score">${r.puntaje}/${r.total}</td>
            <td>${Math.round(r.pct)}%</td>
            <td>${r.intentos}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
  `;
}

/* ---------------- CHAT interno ---------------- */
let chatPollId = null;
let chatLastId = 0;

function stopChatPolling(){
  if(chatPollId){ clearInterval(chatPollId); chatPollId = null; }
}

function renderChat(){
  if(!window.Auth || !window.Auth.configured()){
    $app.innerHTML = `
      <h1>Chat de la promoción</h1>
      <div class="card"><div class="empty">El chat interno requiere configurar el acceso con Google (ver README).</div></div>
    `;
    return;
  }
  $app.innerHTML = `
    <h1>Chat de la promoción</h1>
    <p class="subtitle">Conversa con quienes están estudiando ahora mismo.</p>
    <div class="chat-wrap">
      <div class="card chat-online">
        <h2>En línea</h2>
        <div id="chat-online-list" class="online-list"><div class="empty">Cargando…</div></div>
      </div>
      <div class="card chat-panel">
        <div id="chat-feed" class="chat-feed" aria-live="polite"></div>
        <form id="chat-form" class="chat-input-row">
          <input type="text" id="chat-input" maxlength="500" placeholder="Escribe un mensaje…" autocomplete="off">
          <button type="submit" class="btn gold" aria-label="Enviar">${svg("send")}</button>
        </form>
      </div>
    </div>
  `;

  chatLastId = 0;
  const feed = document.getElementById("chat-feed");
  const onlineList = document.getElementById("chat-online-list");
  const myEmail = SESSION ? SESSION.email : null;

  function renderOnline(users){
    if(!users.length){ onlineList.innerHTML = `<div class="empty" style="padding:14px 0">Nadie más está en línea.</div>`; return; }
    onlineList.innerHTML = users.map(u=>`
      <div class="online-row">
        <span class="online-dot"></span>
        <span class="online-name">${escapeHtml(u.nombre || u.email)}${u.email===myEmail?' <span class="rk-you">tú</span>':''}</span>
      </div>
    `).join("");
  }

  function appendMessages(msgs){
    if(!msgs.length) return;
    const wasAtBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 40;
    msgs.forEach(m=>{
      const mine = m.email === myEmail;
      const div = document.createElement("div");
      div.className = "chat-msg" + (mine ? " mine" : "");
      div.innerHTML = `
        <span class="chat-author">${escapeHtml(m.nombre || m.email)}</span>
        <span class="chat-text">${escapeHtml(m.text)}</span>
      `;
      feed.appendChild(div);
    });
    if(wasAtBottom || msgs.some(m=>m.email===myEmail)) feed.scrollTop = feed.scrollHeight;
  }

  async function pollOnline(){
    const users = await window.Auth.getActive();
    renderOnline(users);
  }
  async function pollMessages(){
    const { messages, lastId } = await window.Auth.getMessages(chatLastId);
    if(messages.length){ appendMessages(messages); chatLastId = lastId; }
  }

  feed.innerHTML = `<div class="empty">Cargando mensajes…</div>`;
  (async ()=>{
    const { messages, lastId } = await window.Auth.getMessages(0);
    feed.innerHTML = "";
    if(!messages.length){ feed.innerHTML = `<div class="empty">Aún no hay mensajes. ¡Sé el primero en escribir!</div>`; }
    else appendMessages(messages);
    chatLastId = lastId;
    feed.scrollTop = feed.scrollHeight;
  })();
  pollOnline();

  document.getElementById("chat-form").addEventListener("submit", async (e)=>{
    e.preventDefault();
    const input = document.getElementById("chat-input");
    const text = input.value.trim();
    if(!text) return;
    input.value = "";
    if(feed.querySelector(".empty")) feed.innerHTML = "";
    await window.Auth.sendMessage(text);
    pollMessages();
  });

  stopChatPolling();
  chatPollId = setInterval(()=>{ pollMessages(); pollOnline(); }, 4000);
}

/* ---------------- init ---------------- */
window.App = { goHome };

function setupUserUI(){
  const chip = document.getElementById("user-chip");
  const logout = document.getElementById("logout-btn");
  if(SESSION && window.Auth){
    if(chip){ chip.hidden = false; chip.textContent = window.Auth.name(SESSION); }
    if(logout){
      logout.hidden = false;
      logout.onclick = ()=> window.Auth.signOut();
    }
  }
}

(async function init(){
  $app.innerHTML = `<div class="empty">Verificando acceso…</div>`;

  // Guard de sesión: si el acceso con Google está configurado, exige login
  if(window.Auth && window.Auth.configured()){
    SESSION = window.Auth.requireAuth();
    if(!SESSION) return; // redirige a login.html
    setupUserUI();
    window.Auth.heartbeat();
    setInterval(()=> window.Auth.heartbeat(), 20000);
  }

  $app.innerHTML = `<div class="empty">Cargando banco de preguntas…</div>`;
  await loadData();
  // recuperar examen en curso si existe
  try{
    const saved = JSON.parse(localStorage.getItem(LS_EXAM));
    if(saved && !saved.finished) examState = saved;
  }catch(e){}
  setView("home");
})();

})();
