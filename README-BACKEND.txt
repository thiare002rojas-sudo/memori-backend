═══════════════════════════════════════════════════════════
🚀 MEMORI BACKEND - GUÍA DE SETUP
═══════════════════════════════════════════════════════════

HOLA NICOLÁS,

Aquí tienes los archivos del backend de memori.

Este es el "motor" que hace que todo funcione:
- Registro de usuarios
- Login seguro
- Base de datos
- Integración Mercado Pago

═══════════════════════════════════════════════════════════
📋 ARCHIVOS QUE TIENES
═══════════════════════════════════════════════════════════

✅ server.js         → El servidor principal (corazón del backend)
✅ package.json      → Las librerías que necesita
✅ .env              → Configuración (contraseñas, APIs, etc.)
✅ .gitignore        → Archivos que NO subir a GitHub
✅ README.txt        → Este archivo

═══════════════════════════════════════════════════════════
🎯 CÓMO FUNCIONA (sin código)
═══════════════════════════════════════════════════════════

Alguien entra a memori.cl
         ↓
Hace CLICK en "Plan 2" → Mercado Pago
         ↓
PAGA $9.99
         ↓
El backend recibe: "Nicolás pagó por Plan 2"
         ↓
Crea una CUENTA para Nicolás en la base de datos
         ↓
Guarda: Email, nombre, contraseña (encriptada), plan
         ↓
Da un "TOKEN" especial a Nicolás
         ↓
Nicolás entra a memori con su TOKEN
         ↓
Ve su panel (hijos, fotos, cartas, etc.)

═══════════════════════════════════════════════════════════
🔧 PASO 1: CREAR REPOSITORIO EN GITHUB
═══════════════════════════════════════════════════════════

GitHub es donde guardaremos el código (gratis).

1. Ve a: https://github.com/
2. Login con tu cuenta
3. CLICK en "+" (arriba a la derecha)
4. Selecciona "New repository"
5. Rellena:

   Repository name: memori-backend
   Description: Backend de memori
   Visibility: Public
   
6. CLICK en "Create repository"

COPIAR ESTOS COMANDOS EN TERMINAL:

(Si NO tienes terminal, ve a PASO 2 - Alternativa sin código)

```
cd ruta-donde-guardaste-los-archivos
git init
git add .
git commit -m "Primer commit - backend memori"
git remote add origin https://github.com/TU-USUARIO/memori-backend.git
git branch -M main
git push -u origin main
```

LISTO. Tu código está en GitHub.

═══════════════════════════════════════════════════════════
📤 PASO 2: ALTERNATIVA SIN CÓDIGO (Drag & drop)
═══════════════════════════════════════════════════════════

Si terminal te asusta, aquí va lo fácil:

1. Ve a: https://github.com/
2. Login
3. CLICK en "+" → "New repository"
4. Rellena (igual que PASO 1)
5. Una vez creado, CLICK en "uploading an existing file"
6. ARRASTRA los 5 archivos:
   - server.js
   - package.json
   - .env
   - .gitignore
   - README.txt

7. CLICK en "Commit changes"

¡LISTO! Código en GitHub sin terminal.

═══════════════════════════════════════════════════════════
🚀 PASO 3: SUBIR A RENDER
═══════════════════════════════════════════════════════════

Render es donde va a vivir tu backend (en la nube, gratis).

1. Ve a: https://render.com/
2. LOGIN con tu cuenta
3. CLICK en "New +" (arriba a la derecha)
4. Selecciona "Web Service"
5. Conecta GitHub:
   - CLICK en "Connect repository"
   - Selecciona: memori-backend
   - CLICK en "Connect"

6. RELLENA:
   Name: memori-backend
   Environment: Node
   Build Command: npm install
   Start Command: npm start
   
7. SCROLL DOWN y busca "Environment"
8. AGREGA tus variables:

   KEY                           | VALUE
   ──────────────────────────────┼─────────────────────
   PORT                          | 3001
   JWT_SECRET                    | tu-secreto-aqui
   MERCADO_PAGO_ACCESS_TOKEN     | (lo agregaremos después)
   MERCADO_PAGO_PUBLIC_KEY       | (lo agregaremos después)

9. CLICK en "Create Web Service"

ESPERA 5-10 MINUTOS mientras Render buildea y sube tu backend.

Cuando veas "Your service is live on...", COPIAR ESA URL.
Ejemplo: https://memori-backend.onrender.com

═══════════════════════════════════════════════════════════
✅ VERIFICAR QUE FUNCIONA
═══════════════════════════════════════════════════════════

Una vez esté LIVE:

1. Copia la URL que Render te dio
2. Agrega al final: /api/health
3. Ve a: https://tu-url.onrender.com/api/health

Deberías ver:
{
  "status": "Backend de memori funcionando ✅"
}

Si lo ves = ¡FUNCIONA! ✅

═══════════════════════════════════════════════════════════
🔐 RUTAS QUE CREAMOS (Para que entiendas)
═══════════════════════════════════════════════════════════

POST /api/auth/registro
  → Alguien nuevo se registra
  → Recibe: email, nombre, password, plan

POST /api/auth/login
  → Alguien entra a memori
  → Recibe: email, password
  → Devuelve: TOKEN para acceder

POST /api/usuario/hijos
  → Crear un nuevo hijo en el perfil
  → Recibe: nombre, edad, fecha_nacimiento

GET /api/usuario/hijos
  → Ver todos los hijos del usuario

POST /api/pagos/confirmar
  → Confirmación de pago Mercado Pago
  → Recibe: email, plan, mercado_pago_id

═══════════════════════════════════════════════════════════
🗄️ BASE DE DATOS (SIN CÓDIGO)
═══════════════════════════════════════════════════════════

Creamos 3 TABLAS:

TABLA: USUARIOS
├─ email (único, no se repite)
├─ nombre
├─ password (encriptada)
├─ plan (gratuito, plan1, plan2, etc.)
└─ fecha_registro

TABLA: HIJOS
├─ usuario_id (a quién le pertenece)
├─ nombre
├─ edad
└─ fecha_nacimiento

TABLA: PAGOS
├─ usuario_id (quién pagó)
├─ plan (qué plan)
├─ monto
├─ mercado_pago_id (ID de Mercado Pago)
└─ estado (confirmado, pendiente)

═══════════════════════════════════════════════════════════
🔒 SEGURIDAD (Cómo protegemos a tus usuarios)
═══════════════════════════════════════════════════════════

✅ CONTRASEÑAS: Encriptadas (no se ven ni si acceden la BD)
✅ TOKEN: Cada usuario recibe una llave de acceso especial
✅ API: Cada request se verifica (no cualquiera puede acceder)
✅ HTTPS: Todo es seguro (con TLS/SSL)

═══════════════════════════════════════════════════════════
❓ PREGUNTAS FRECUENTES
═══════════════════════════════════════════════════════════

P: ¿Por qué GitHub?
R: Para guardar el código en la nube y que Render lo lea.

P: ¿Por qué Render?
R: Es gratis, fácil y automático. Cuando cambias código en GitHub,
   Render automáticamente actualiza tu backend.

P: ¿Mi base de datos está segura?
R: Sí. SQLite es local en Render (no se ve desde internet).

P: ¿Cuánto cuesta?
R: $0 USD. Render free tier es infinito para proyectos pequeños.

P: ¿Qué es .env?
R: Un archivo secreto donde guardas contraseñas y APIs.
   NO debe subirse a GitHub (por eso está en .gitignore).

═══════════════════════════════════════════════════════════
🚨 IMPORTANTE: VARIABLES DE ENTORNO EN RENDER
═══════════════════════════════════════════════════════════

En RENDER, NO subes .env (es inseguro).

En lugar de eso, en el panel de Render:
1. Settings
2. Environment
3. Agrega cada variable manualmente

Así:
- El .env local (para testing)
- Las variables en Render (para producción)

═══════════════════════════════════════════════════════════
📝 PRÓXIMO PASO
═══════════════════════════════════════════════════════════

Una vez tu backend esté LIVE en Render:

1. Dame la URL que Render te dio
   (Ejemplo: https://memori-backend.onrender.com)

2. Conectamos tu REACT al backend
   (Tu app React hará "llamadas" al backend)

3. Agregaremos Mercado Pago
   (Para que el pago automático funcione)

═══════════════════════════════════════════════════════════

¿Preguntas? Escríbeme.

Vamos step by step.

═══════════════════════════════════════════════════════════
