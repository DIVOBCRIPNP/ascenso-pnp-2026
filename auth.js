/* Autenticación con Google + ranking/chat sobre Google Sheets (Apps Script) */
(function(){
"use strict";

const cfg = window.APP_CONFIG || {};
const configured = !!(
  cfg.GOOGLE_CLIENT_ID && cfg.GOOGLE_CLIENT_ID.indexOf("PEGA_AQUI") === -1 &&
  cfg.APPS_SCRIPT_URL && cfg.APPS_SCRIPT_URL.indexOf("PEGA_AQUI") === -1
);

const LS_SESSION = "pnp_session";

/* Guardado diferido del progreso: agrupa ráfagas de cambios en una sola
   escritura para no gastar la cuota diaria de Apps Script. */
let pendingProgress = null;
let saveTimer = null;
async function flushProgress(){
  if(saveTimer){ clearTimeout(saveTimer); saveTimer = null; }
  if(!pendingProgress) return;
  const data = pendingProgress;
  pendingProgress = null;
  const s = getLocalSession();
  if(!s || !s.token) return;
  const r = await api("saveProgress", { token:s.token, data });
  if(r && r.error === "too-big") console.warn("Progreso demasiado grande para guardar en la nube.");
}

function getLocalSession(){
  try{ return JSON.parse(localStorage.getItem(LS_SESSION)); }catch(e){ return null; }
}
function setLocalSession(s){
  try{ localStorage.setItem(LS_SESSION, JSON.stringify(s)); }catch(e){}
}
function clearLocalSession(){
  try{ localStorage.removeItem(LS_SESSION); }catch(e){}
}

// El POST se envía como text/plain a propósito: evita el preflight CORS
// que Apps Script no maneja, y el body se sigue leyendo como JSON del lado del servidor.
async function api(action, payload){
  if(!configured) return { ok:false, error:"no-config" };
  try{
    const res = await fetch(cfg.APPS_SCRIPT_URL, {
      method: "POST",
      body: JSON.stringify({ action, ...payload }),
    });
    return await res.json();
  }catch(e){
    console.warn("Error de red con Apps Script:", e);
    return { ok:false, error:"network" };
  }
}

const Auth = {
  configured(){ return configured; },

  getSession(){ return getLocalSession(); },

  // Redirige a login.html si no hay sesión local. Devuelve la sesión o null.
  requireAuth(){
    const s = getLocalSession();
    if(!s || !s.token){ window.location.replace("login.html"); return null; }
    return s;
  },

  name(session){
    return (session && (session.nombre || session.email)) || "Usuario";
  },

  // Llamado por login.html tras verificar el id_token de Google en el servidor.
  async loginWithGoogleCredential(idToken){
    const r = await api("login", { idToken });
    if(!r.ok) return r;
    const session = { token:r.token, email:r.email, nombre:r.nombre, picture:r.picture, rol:r.rol||"alumno" };
    setLocalSession(session);
    return { ok:true, session };
  },

  isAdmin(){
    const s = getLocalSession();
    return !!(s && s.rol === "admin");
  },

  // Refresca el rol desde el servidor y lo guarda (para sesiones ya abiertas)
  async refreshRole(){
    const s = getLocalSession();
    if(!s || !s.token) return;
    const r = await api("whoami", { token:s.token });
    if(r.ok && r.rol && r.rol !== s.rol){
      s.rol = r.rol;
      setLocalSession(s);
    }
  },

  // Progreso personal del usuario (se recupera en cualquier dispositivo)
  async getProgress(){
    const s = getLocalSession();
    if(!s) return null;
    const r = await api("getProgress", { token:s.token });
    return (r.ok && r.data) ? r.data : null;
  },

  // Guarda el progreso. Se agrupa (debounce) para no gastar cuota de Apps Script.
  saveProgress(data){
    const s = getLocalSession();
    if(!s) return;
    pendingProgress = data;
    if(saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(flushProgress, 1500);
  },

  // Fuerza el guardado inmediato (p. ej. antes de cerrar la pestaña)
  flushProgress(){ return flushProgress(); },

  async deleteMessage(id){
    const s = getLocalSession();
    if(!s) return false;
    const r = await api("deleteMessage", { token:s.token, id });
    return !!r.ok;
  },

  async resetRanking(){
    const s = getLocalSession();
    if(!s) return false;
    const r = await api("resetRanking", { token:s.token });
    return !!r.ok;
  },

  // Devuelve {users:[{email,nombre,created_at,last_seen,rol}], permitidos}
  async getUsers(){
    const s = getLocalSession();
    if(!s) return { users:[], permitidos:0 };
    const r = await api("getUsers", { token:s.token });
    return (r.ok ? { users:r.users||[], permitidos:r.permitidos||0 } : { users:[], permitidos:0 });
  },

  async signOut(){
    const s = getLocalSession();
    if(s && s.token){ api("logout", { token:s.token }); }
    clearLocalSession();
    window.location.replace("login.html");
  },

  async saveScore(result, session){
    if(!session) return false;
    const r = await api("saveScore", {
      token: session.token,
      puntaje: result.correct,
      total: result.total,
      pct: result.pct,
      duracion: result.durationSec,
    });
    return !!r.ok;
  },

  // Devuelve [{email, nombre, puntaje, total, pct, intentos}] ordenado desc por mejor puntaje
  async fetchRanking(){
    const s = getLocalSession();
    if(!s) return [];
    const r = await api("getRanking", { token:s.token });
    return (r.ok && r.rows) || [];
  },

  async heartbeat(){
    const s = getLocalSession();
    if(!s) return;
    api("heartbeat", { token:s.token });
  },

  // Devuelve [{email, nombre, picture}] de usuarios activos en los últimos ~60s
  async getActive(){
    const s = getLocalSession();
    if(!s) return [];
    const r = await api("getActive", { token:s.token });
    return (r.ok && r.users) || [];
  },

  async sendMessage(text){
    const s = getLocalSession();
    if(!s) return false;
    const r = await api("sendMessage", { token:s.token, text });
    return !!r.ok;
  },

  // Devuelve {messages:[{id,email,nombre,text,created_at}], lastId}
  async getMessages(sinceId){
    const s = getLocalSession();
    if(!s) return { messages:[], lastId:sinceId||0 };
    const r = await api("getMessages", { token:s.token, sinceId: sinceId||0 });
    if(!r.ok) return { messages:[], lastId:sinceId||0 };
    return { messages:r.messages||[], lastId:r.lastId||sinceId||0 };
  },
};

window.Auth = Auth;
})();
