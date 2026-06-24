/* ============================================================
   Backend de la plataforma Ascenso PNP 2026 sobre Google Sheets.

   Cómo instalar:
   1. Crea una Google Sheet nueva (vacía).
   2. Extensiones → Apps Script. Borra el contenido y pega TODO este archivo.
   3. Ajusta ALLOWED_DOMAIN abajo si quieres restringir el acceso a un
      dominio de correo (déjalo vacío "" para permitir cualquier cuenta
      de Google que tenga el enlace).
   4. En el editor, en el menú de funciones (arriba), elige "setup" y
      pulsa ▶ Ejecutar una vez. Esto crea las hojas necesarias.
      La primera vez te pedirá autorizar permisos: acéptalos.
   5. Implementar → Nueva implementación → tipo "Aplicación web".
      - Ejecutar como: Yo (tu cuenta)
      - Quién tiene acceso: Cualquier usuario
      Copia la URL que termina en /exec → pégala en config.js (APPS_SCRIPT_URL).
   6. Cada vez que edites este script, vuelve a Implementar → Gestionar
      implementaciones → ✏️ → Nueva versión, o la URL servirá código viejo.

   CONTROL DE ACCESO (allowlist):
   - El acceso se gestiona desde la hoja "Permitidos" (columna email).
   - Solo los correos que pongas ahí podrán entrar. Si la hoja está vacía,
     el acceso queda abierto a cualquier cuenta de Google.
   - Agregar o quitar correos en esa hoja toma efecto al instante, NO hace
     falta re-desplegar. (setup() siembra tu propio correo automáticamente.)
   ============================================================ */

const CLIENT_ID = "PEGA_AQUI_TU_GOOGLE_CLIENT_ID.apps.googleusercontent.com";
const ALLOWED_DOMAIN = ""; // ej: "pnp.gob.pe" — vacío = cualquier cuenta de Google
const SESSION_DAYS = 30;
const ACTIVE_WINDOW_MS = 60 * 1000;   // se considera "en línea" si hubo heartbeat en los últimos 60s
const MAX_MESSAGES = 300;             // recorta el historial de chat a este tamaño

function ss(){ return SpreadsheetApp.getActiveSpreadsheet(); }

function sheet(name, headers){
  const s = ss();
  let sh = s.getSheetByName(name);
  if(!sh){
    sh = s.insertSheet(name);
    sh.appendRow(headers);
    sh.setFrozenRows(1);
  }
  return sh;
}

function setup(){
  sheet("Users",    ["email","nombre","picture","grado","created_at"]);
  sheet("Sessions", ["token","email","created_at","expires_at"]);
  sheet("Scores",   ["email","nombre","puntaje","total","pct","duracion","created_at"]);
  sheet("Presence", ["email","nombre","picture","last_seen"]);
  sheet("Messages", ["id","email","nombre","text","created_at"]);
  const permit = sheet("Permitidos", ["email","nombre","nota"]);
  // siembra tu propio correo (el dueño del script) para que nunca te quedes fuera
  try{
    const owner = (Session.getEffectiveUser().getEmail() || "").trim().toLowerCase();
    if(owner && findRowIndex(permit, "email", owner) === -1){
      permit.appendRow([owner, "Administrador", "agregado automáticamente"]);
    }
  }catch(e){ /* sin permisos para leer el correo: ignora */ }
  Logger.log("Listo. Hojas: Users, Sessions, Scores, Presence, Messages, Permitidos.");
}

/* ---------------- lista de permitidos (allowlist) ----------------
   El acceso se controla desde la hoja "Permitidos" (columna email).
   - Si la hoja tiene al menos un correo, SOLO esos correos pueden entrar.
   - Si está vacía, el acceso queda ABIERTO (para no bloquearte antes de
     configurarla). Agrega/quita filas en la hoja para gestionar el acceso;
     NO necesitas re-desplegar el script para que tome efecto.
*/
function allowedEmails(){
  const sh = sheet("Permitidos", ["email","nombre","nota"]);
  return rowsAsObjects(sh)
    .map(r=> String(r.email||"").trim().toLowerCase())
    .filter(Boolean);
}
function isEmailAllowed(email){
  email = String(email||"").trim().toLowerCase();
  const list = allowedEmails();
  if(list.length === 0) return true;       // lista vacía = abierto
  return list.indexOf(email) !== -1;
}
/* utilidad opcional: agregar un correo desde el editor (Ejecutar) */
function addAllowed(){
  const email = "correo@gmail.com"; // ← cambia esto y ejecuta esta función
  const sh = sheet("Permitidos", ["email","nombre","nota"]);
  if(findRowIndex(sh, "email", email.trim().toLowerCase()) === -1){
    sh.appendRow([email.trim().toLowerCase(), "", "agregado manual"]);
  }
  Logger.log("Permitidos: " + allowedEmails().join(", "));
}

/* ---------------- helpers de datos ---------------- */
function rowsAsObjects(sh){
  const data = sh.getDataRange().getValues();
  const headers = data.shift();
  return data.map(row=>{
    const o = {};
    headers.forEach((h,i)=> o[h]=row[i]);
    return o;
  });
}
function findRowIndex(sh, colName, value){
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const col = headers.indexOf(colName);
  for(let i=1;i<data.length;i++){
    if(data[i][col] === value) return i+1; // 1-indexed, incluye encabezado
  }
  return -1;
}

function newToken(){
  return Utilities.getUuid().replace(/-/g,"") + Utilities.getUuid().replace(/-/g,"").slice(0,8);
}

function getSession(token){
  if(!token) return null;
  const sh = sheet("Sessions", ["token","email","created_at","expires_at"]);
  const rows = rowsAsObjects(sh);
  const row = rows.find(r=> r.token === token);
  if(!row) return null;
  if(Number(row.expires_at) < Date.now()) return null;
  const usersSh = sheet("Users", ["email","nombre","picture","grado","created_at"]);
  const users = rowsAsObjects(usersSh);
  const user = users.find(u=> u.email === row.email) || {};
  return { email: row.email, nombre: user.nombre || row.email, picture: user.picture || "" };
}

/* ---------------- acciones ---------------- */
function actionLogin(body){
  const idToken = body.idToken;
  if(!idToken) return { ok:false, error:"invalid-token" };

  let info;
  try{
    const resp = UrlFetchApp.fetch(
      "https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken),
      { muteHttpExceptions:true }
    );
    if(resp.getResponseCode() !== 200) return { ok:false, error:"invalid-token" };
    info = JSON.parse(resp.getContentText());
  }catch(e){ return { ok:false, error:"invalid-token" }; }

  if(info.aud !== CLIENT_ID) return { ok:false, error:"invalid-token" };
  if(!info.email || info.email_verified !== "true") return { ok:false, error:"invalid-token" };
  if(ALLOWED_DOMAIN && info.hd !== ALLOWED_DOMAIN && info.email.split("@")[1] !== ALLOWED_DOMAIN){
    return { ok:false, error:"not-allowed" };
  }
  // allowlist: solo los correos de la hoja "Permitidos" (si tiene alguno)
  if(!isEmailAllowed(info.email)){
    return { ok:false, error:"not-allowed" };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try{
    const usersSh = sheet("Users", ["email","nombre","picture","grado","created_at"]);
    const idx = findRowIndex(usersSh, "email", info.email);
    if(idx === -1){
      usersSh.appendRow([info.email, info.name||info.email, info.picture||"", "", new Date().toISOString()]);
    } else {
      usersSh.getRange(idx, 2, 1, 2).setValues([[info.name||info.email, info.picture||""]]);
    }

    const token = newToken();
    const sessSh = sheet("Sessions", ["token","email","created_at","expires_at"]);
    sessSh.appendRow([token, info.email, Date.now(), Date.now() + SESSION_DAYS*86400000]);

    return { ok:true, token, email:info.email, nombre:info.name||info.email, picture:info.picture||"" };
  } finally { lock.releaseLock(); }
}

function actionLogout(body){
  const sh = sheet("Sessions", ["token","email","created_at","expires_at"]);
  const idx = findRowIndex(sh, "token", body.token);
  if(idx > -1) sh.deleteRow(idx);
  return { ok:true };
}

function actionHeartbeat(body){
  const session = getSession(body.token);
  if(!session) return { ok:false, error:"unauthorized" };
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try{
    const sh = sheet("Presence", ["email","nombre","picture","last_seen"]);
    const idx = findRowIndex(sh, "email", session.email);
    const usersSh = sheet("Users", ["email","nombre","picture","grado","created_at"]);
    const u = rowsAsObjects(usersSh).find(x=>x.email===session.email) || {};
    if(idx === -1){
      sh.appendRow([session.email, u.nombre||session.email, u.picture||"", Date.now()]);
    } else {
      sh.getRange(idx, 2, 1, 3).setValues([[u.nombre||session.email, u.picture||"", Date.now()]]);
    }
    return { ok:true };
  } finally { lock.releaseLock(); }
}

function actionGetActive(body){
  const session = getSession(body.token);
  if(!session) return { ok:false, error:"unauthorized" };
  const sh = sheet("Presence", ["email","nombre","picture","last_seen"]);
  const cutoff = Date.now() - ACTIVE_WINDOW_MS;
  const users = rowsAsObjects(sh).filter(r=> Number(r.last_seen) >= cutoff);
  return { ok:true, users: users.map(u=>({ email:u.email, nombre:u.nombre, picture:u.picture })) };
}

function actionSaveScore(body){
  const session = getSession(body.token);
  if(!session) return { ok:false, error:"unauthorized" };
  const sh = sheet("Scores", ["email","nombre","puntaje","total","pct","duracion","created_at"]);
  sh.appendRow([session.email, session.nombre, body.puntaje, body.total, body.pct, body.duracion, new Date().toISOString()]);
  return { ok:true };
}

function actionGetRanking(body){
  const session = getSession(body.token);
  if(!session) return { ok:false, error:"unauthorized" };
  const rows = rowsAsObjects(sheet("Scores", ["email","nombre","puntaje","total","pct","duracion","created_at"]));
  const best = {}, counts = {};
  rows.forEach(r=>{
    counts[r.email] = (counts[r.email]||0) + 1;
    const cur = best[r.email];
    if(!cur || r.puntaje > cur.puntaje || (r.puntaje === cur.puntaje && r.pct > cur.pct)){
      best[r.email] = r;
    }
  });
  const out = Object.values(best)
    .map(r=> ({ email:r.email, nombre:r.nombre, puntaje:r.puntaje, total:r.total, pct:r.pct, intentos:counts[r.email] }))
    .sort((a,b)=> (b.puntaje - a.puntaje) || (b.pct - a.pct));
  return { ok:true, rows: out };
}

function actionSendMessage(body){
  const session = getSession(body.token);
  if(!session) return { ok:false, error:"unauthorized" };
  const text = String(body.text||"").trim().slice(0, 500);
  if(!text) return { ok:false, error:"empty" };
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try{
    const sh = sheet("Messages", ["id","email","nombre","text","created_at"]);
    const lastRow = sh.getLastRow();
    const lastId = lastRow > 1 ? Number(sh.getRange(lastRow, 1).getValue()) || 0 : 0;
    const id = lastId + 1;
    sh.appendRow([id, session.email, session.nombre, text, new Date().toISOString()]);
    // recorta el historial si crece demasiado
    const total = sh.getLastRow() - 1;
    if(total > MAX_MESSAGES){
      sh.deleteRows(2, total - MAX_MESSAGES);
    }
    return { ok:true, id };
  } finally { lock.releaseLock(); }
}

function actionGetMessages(body){
  const session = getSession(body.token);
  if(!session) return { ok:false, error:"unauthorized" };
  const sinceId = Number(body.sinceId)||0;
  const rows = rowsAsObjects(sheet("Messages", ["id","email","nombre","text","created_at"]))
    .filter(r=> Number(r.id) > sinceId);
  const lastId = rows.length ? Math.max(...rows.map(r=>Number(r.id))) : sinceId;
  return { ok:true, messages: rows, lastId };
}

/* ---------------- enrutador ---------------- */
function doPost(e){
  let body = {};
  try{ body = JSON.parse(e.postData.contents); }catch(err){ /* body vacío */ }

  const handlers = {
    login: actionLogin,
    logout: actionLogout,
    heartbeat: actionHeartbeat,
    getActive: actionGetActive,
    saveScore: actionSaveScore,
    getRanking: actionGetRanking,
    sendMessage: actionSendMessage,
    getMessages: actionGetMessages,
  };
  const fn = handlers[body.action];
  const result = fn ? fn(body) : { ok:false, error:"unknown-action" };
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(){
  return ContentService.createTextOutput(JSON.stringify({ ok:true, info:"Ascenso PNP 2026 API" }))
    .setMimeType(ContentService.MimeType.JSON);
}
