# Ascenso PNP 2026 — Plataforma de estudio

Plataforma educativa estática para preparar el **proceso de ascenso por concurso de Oficiales PNP 2026 (Promoción 2027) — Oficiales Subalternos de Armas (Policía)**.

Banco oficial de **1500 preguntas** extraídas del documento SIECOPOL, organizadas en **22 materias** (Comunes y de Especialidad), con respuesta correcta y base legal.

## Funcionalidades

- **Banco por materia** — estudia tema por tema con respuesta y ubicación legal a la vista.
- **Simulacro de 100 preguntas** — generado al azar con **distribución proporcional** al peso de cada materia en el banco. Opciones barajadas en cada intento.
- **Cronómetro** configurable, **marcar preguntas** para revisar y **grilla de navegación** 1–100.
- **Resultados** con puntaje, desempeño por materia y revisión de errores con la respuesta correcta y la base legal.
- **Historial** de simulacros (guardado localmente en el navegador).
- **Acceso con Google** — login con tu cuenta de Google, sin contraseñas ni captcha aparte (Google ya filtra bots).
- **Ranking compartido** — tabla con el mejor puntaje de cada participante de la promoción.
- **Chat interno** — mensajes en vivo y lista de "quién está en línea ahora" entre los compañeros de promoción.

## Stack

HTML + CSS + JavaScript vanilla, sin framework ni build. Tipografía Lora/Inter (Google Fonts). Diseño accesible (foco visible, `prefers-reduced-motion`, targets ≥44px, contraste alto). Autenticación con **Google Identity Services**; ranking, presencia y chat sobre **Google Sheets** vía un **Google Apps Script** publicado como API.

```
login.html          · página de ingreso con botón "Iniciar sesión con Google"
index.html          · app: estructura y navegación
styles.css          · estilos (tema verde/dorado institucional)
app.js              · lógica de banco, examen, resultados, ranking, chat e historial
auth.js             · sesión, llamadas a la API de Apps Script (ranking/presencia/chat)
config.js           · TUS claves (Google Client ID + URL de Apps Script) — editar
apps-script.gs      · backend: pégalo en Google Apps Script (ver pasos abajo)
data/preguntas.json · banco de 1500 preguntas
netlify.toml        · configuración de despliegue
```

> **Sin configurar Google**, la app funciona en "modo local" (sin login, ranking ni chat): banco, simulacros, resultados e historial siguen operando. El login, el ranking y el chat se activan al completar los pasos siguientes.

## Configurar login + ranking + chat (Google + Apps Script)

### 1. Crear el Client ID de Google (gratis)
1. Entra a https://console.cloud.google.com/apis/credentials (usa tu cuenta de Workspace o cualquier cuenta Google).
2. **Crear credenciales → ID de cliente de OAuth → Tipo: Aplicación web**.
3. En **Orígenes de JavaScript autorizados** agrega tu dominio de Netlify (ej. `https://tu-sitio.netlify.app`) y `http://localhost:8000` para pruebas locales.
4. Copia el **Client ID** generado (termina en `.apps.googleusercontent.com`).

### 2. Publicar el backend en Google Apps Script (gratis)
1. Crea una **Google Sheet nueva** (vacía) — será tu base de datos.
2. **Extensiones → Apps Script**. Borra el contenido de ejemplo y pega TODO el archivo `apps-script.gs` de este proyecto.
3. Al inicio del script, pega tu **Client ID** en la constante `CLIENT_ID` (debe ser exactamente el mismo del paso 1).
4. Si quieres restringir el acceso a un dominio de correo institucional, pon ese dominio en `ALLOWED_DOMAIN` (ej. `"pnp.gob.pe"`). Déjalo vacío `""` para permitir cualquier cuenta de Google.
5. En el menú de funciones (arriba del editor) elige **setup** y pulsa ▶ **Ejecutar** una vez — crea las hojas `Users`, `Sessions`, `Scores`, `Presence` y `Messages`. La primera vez pedirá autorizar permisos: acéptalos (es tu propio script, solo accede a tu propia Sheet).
6. **Implementar → Nueva implementación → tipo "Aplicación web"**. Ejecutar como: **Yo**. Quién tiene acceso: **Cualquier usuario**. Copia la URL que termina en `/exec`.
7. Si luego editas `apps-script.gs`, debes volver a **Implementar → Gestionar implementaciones → ✏️ → Nueva versión** para que los cambios entren en vigor (la URL no cambia).

### 3. Pegar tus claves en `config.js`
```js
window.APP_CONFIG = {
  GOOGLE_CLIENT_ID: "123456789-abc.apps.googleusercontent.com",
  APPS_SCRIPT_URL:  "https://script.google.com/macros/s/AKfycb.../exec",
};
```

Listo: al abrir el sitio pedirá iniciar sesión con Google, los puntajes aparecen en **Ranking**, y en **Chat** se ve quién está en línea y los mensajes de la promoción.

> **Seguridad:** no hay contraseñas que gestionar — la identidad la verifica Google, y el servidor (`apps-script.gs`) valida el token con la API oficial de Google antes de crear la sesión. El `GOOGLE_CLIENT_ID` y la `APPS_SCRIPT_URL` son datos públicos y es correcto que estén en `config.js`. El acceso a la Google Sheet (datos crudos) queda limitado a tu cuenta, ya que el script corre "como tú" y nadie más puede leer la hoja directamente.
>
> **Límites a tener en cuenta:** Apps Script tiene cuotas diarias generosas pero finitas (ejecuciones, tiempo de CPU). Para un grupo de estudio de tamaño normal (decenas a un par de cientos de personas) no debería ser un problema; si el grupo crece mucho, sería el momento de migrar a una base de datos dedicada.

## Desarrollo local

```bash
python3 -m http.server 8000 --directory .
# abrir http://localhost:8000
```

## Despliegue en Netlify

**Opción rápida (drag & drop):** entra a https://app.netlify.com/drop y arrastra esta carpeta.

**Con Git:** conecta el repositorio en Netlify. No requiere build; `publish = "."` (ver `netlify.toml`).

## Estructura del dato (`data/preguntas.json`)

```json
{
  "n": 1,
  "grupo": "Materias Comunes",
  "materia": "CONSTITUCIÓN POLÍTICA DEL PERÚ ...",
  "pregunta": "TODA PERSONA TIENE DERECHO: ...",
  "opciones": ["...", "...", "...", "...", "..."],
  "respuesta": "RAZONES DE SANIDAD ...",
  "correcta": 2,
  "ubicacion": "(ART: 2)** [TITULO I] [CAPITULO I]",
  "codigo": "180838"
}
```

> Para ampliar el banco, agrega objetos con ese formato a `data/preguntas.json`. La distribución del simulacro se recalcula automáticamente.
