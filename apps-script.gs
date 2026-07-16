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
const ADMIN_EMAILS = []; // opcional, respaldo: correos admin "fijos". Lo normal es poner rol=admin en la hoja Permitidos.
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
  sheet("Progreso", ["email","data","updated_at"]);
  const permit = sheet("Permitidos", ["email","nombre","rol","nota"]);
  ensureColumn(permit, "rol");   // migra hojas antiguas que no tenían columna rol
  ensureColumn(permit, "nota");
  // siembra tu propio correo (dueño del script) como admin, para que nunca te quedes fuera
  try{
    const owner = (Session.getEffectiveUser().getEmail() || "").trim().toLowerCase();
    if(owner){
      const idx = findRowIndex(permit, "email", owner);
      if(idx === -1){
        permit.appendRow([owner, "Administrador", "admin", "agregado automáticamente"]);
      } else {
        setCellByName(permit, idx, "rol", "admin");
      }
    }
  }catch(e){ /* sin permisos para leer el correo: ignora */ }
  Logger.log("Listo. Hojas: Users, Sessions, Scores, Presence, Messages, Permitidos.");
}

/* añade una columna con ese encabezado si no existe (no toca las filas) */
function ensureColumn(sh, name){
  const lastCol = Math.max(1, sh.getLastColumn());
  const headers = sh.getRange(1,1,1,lastCol).getValues()[0].map(h=> String(h).trim().toLowerCase());
  if(headers.indexOf(name.toLowerCase()) === -1){
    sh.getRange(1, sh.getLastColumn()+1).setValue(name);
  }
}
/* escribe una celda buscando la columna por nombre de encabezado */
function setCellByName(sh, rowIdx, colName, value){
  const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(h=> String(h).trim().toLowerCase());
  const c = headers.indexOf(colName.toLowerCase());
  if(c >= 0) sh.getRange(rowIdx, c+1).setValue(value);
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
/* rol del usuario: "admin" o "alumno" (deriva de Permitidos.rol o de ADMIN_EMAILS) */
function getUserRole(email){
  email = String(email||"").trim().toLowerCase();
  if(ADMIN_EMAILS.map(e=> String(e).trim().toLowerCase()).indexOf(email) !== -1) return "admin";
  const sh = sheet("Permitidos", ["email","nombre","rol","nota"]);
  const r = rowsAsObjects(sh).find(x=> String(x.email||"").trim().toLowerCase() === email);
  if(r && String(r.rol||"").trim().toLowerCase() === "admin") return "admin";
  return "alumno";
}
/* exige sesión válida con rol admin. Devuelve {session} o {err} */
function requireAdmin(token){
  const s = getSession(token);
  if(!s) return { err: { ok:false, error:"unauthorized" } };
  if(s.rol !== "admin") return { err: { ok:false, error:"forbidden" } };
  return { session: s };
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
  return { email: row.email, nombre: user.nombre || row.email, picture: user.picture || "", rol: getUserRole(row.email) };
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

    return { ok:true, token, email:info.email, nombre:info.name||info.email, picture:info.picture||"", rol: getUserRole(info.email) };
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

/* ---------------- progreso por usuario (memoria personal) ----------------
   Cada usuario tiene UNA fila en la hoja "Progreso" con un JSON de su avance
   (historial de simulacros, fichas dominadas, etc.). Va atado a su correo, así
   que lo recupera desde cualquier dispositivo al iniciar sesión con Google. */
function actionGetProgress(body){
  const session = getSession(body.token);
  if(!session) return { ok:false, error:"unauthorized" };
  const sh = sheet("Progreso", ["email","data","updated_at"]);
  const idx = findRowIndex(sh, "email", session.email);
  if(idx === -1) return { ok:true, data:{} };
  let data = {};
  try{ data = JSON.parse(sh.getRange(idx, 2).getValue() || "{}"); }catch(e){ data = {}; }
  return { ok:true, data: data };
}

function actionSaveProgress(body){
  const session = getSession(body.token);
  if(!session) return { ok:false, error:"unauthorized" };
  // Límite de celda de Sheets: 50 000 caracteres. Cortamos antes por seguridad.
  const json = JSON.stringify(body.data || {});
  if(json.length > 45000) return { ok:false, error:"too-big" };
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try{
    const sh = sheet("Progreso", ["email","data","updated_at"]);
    const idx = findRowIndex(sh, "email", session.email);
    const now = new Date().toISOString();
    if(idx === -1) sh.appendRow([session.email, json, now]);
    else sh.getRange(idx, 2, 1, 2).setValues([[json, now]]);
    return { ok:true };
  } finally { lock.releaseLock(); }
}

/* ---------------- acciones de ADMIN ---------------- */
// devuelve el rol del usuario actual (para refrescar la UI sin re-login)
function actionWhoami(body){
  const s = getSession(body.token);
  if(!s) return { ok:false, error:"unauthorized" };
  return { ok:true, email:s.email, nombre:s.nombre, rol:s.rol };
}

// borrar un mensaje del chat por id (solo admin)
function actionDeleteMessage(body){
  const g = requireAdmin(body.token); if(g.err) return g.err;
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try{
    const sh = sheet("Messages", ["id","email","nombre","text","created_at"]);
    const idx = findRowIndex(sh, "id", Number(body.id));
    if(idx > -1) sh.deleteRow(idx);
    return { ok:true };
  } finally { lock.releaseLock(); }
}

// reiniciar el ranking: borra todos los puntajes (solo admin)
function actionResetRanking(body){
  const g = requireAdmin(body.token); if(g.err) return g.err;
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try{
    const sh = sheet("Scores", ["email","nombre","puntaje","total","pct","duracion","created_at"]);
    const last = sh.getLastRow();
    if(last > 1) sh.deleteRows(2, last - 1);
    return { ok:true };
  } finally { lock.releaseLock(); }
}

// lista de inscritos (usuarios que han entrado) con su última conexión (solo admin)
function actionGetUsers(body){
  const g = requireAdmin(body.token); if(g.err) return g.err;
  const users = rowsAsObjects(sheet("Users", ["email","nombre","picture","grado","created_at"]));
  const presence = rowsAsObjects(sheet("Presence", ["email","nombre","picture","last_seen"]));
  const lastSeen = {};
  presence.forEach(p=> { lastSeen[p.email] = Number(p.last_seen) || 0; });
  const out = users.map(u=> ({
    email: u.email,
    nombre: u.nombre,
    created_at: u.created_at,
    last_seen: lastSeen[u.email] || 0,
    rol: getUserRole(u.email),
  })).sort((a,b)=> (b.last_seen||0) - (a.last_seen||0));
  return { ok:true, users: out, permitidos: allowedEmails().length };
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
    whoami: actionWhoami,
    getProgress: actionGetProgress,
    saveProgress: actionSaveProgress,
    deleteMessage: actionDeleteMessage,
    resetRanking: actionResetRanking,
    getUsers: actionGetUsers,
  };
  const fn = handlers[body.action];
  const result = fn ? fn(body) : { ok:false, error:"unknown-action" };
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

function doGet(){
  return ContentService.createTextOutput(JSON.stringify({ ok:true, info:"Ascenso PNP 2026 API" }))
    .setMimeType(ContentService.MimeType.JSON);
}
