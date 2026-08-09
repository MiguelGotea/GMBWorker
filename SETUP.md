# SETUP — GMB Worker (Google Business Profile Reviews Sync)

## Índice
1. [Google Cloud Console — Crear OAuth Desktop App](#1-google-cloud-console)
2. [Obtener el refresh_token](#2-obtener-el-refresh_token)
3. [Primer deploy en el VPS](#3-primer-deploy-en-el-vps)
4. [Configurar secrets en GitHub](#4-configurar-secrets-en-github)
5. [Configurar permisos en el ERP](#5-configurar-permisos-en-el-erp)
6. [Verificar que todo funciona](#6-verificar-que-todo-funciona)

---

## 1. Google Cloud Console

### 1.1 — Encontrar tu proyecto existente

1. Ve a **[console.cloud.google.com](https://console.cloud.google.com)**
2. En la barra superior, haz clic en el selector de proyecto (dice el nombre del proyecto activo)
3. Busca el proyecto de tu sistema (ej. "Pitaya GMB Integration") o crea uno nuevo.

### 1.2 — Habilitar las APIs de Google Business

*Nota: Google dividió recientemente la antigua API de Google My Business en varias APIs específicas.*

Para que el GMBWorker funcione, **debes habilitar estas dos APIs**:
1. En el menú izquierdo: **APIs y Servicios → Biblioteca**
2. Busca y habilita: **`My Business Account Management API`** (Para leer las cuentas con acceso).
3. Busca y habilita: **`My Business Business Information API`** (Para leer las sucursales/locales).

### 1.3 — Configurar la Google Auth Platform (Pantalla de Consentimiento)

La interfaz de Google ha cambiado a "Google Auth Platform". Sigue estos pasos:
1. Ve a **APIs y Servicios → Pantalla de consentimiento de OAuth** (o "Google Auth Platform" / "Auth Platform").
2. Haz clic en **Comenzar** si es la primera vez.
3. En **Información de la marca**: Asigna un nombre a la app (ej. "GMB Worker") y tu correo de soporte.
4. En **Público (Audience)**: Selecciona que tu app es **Externa**. Al ser externa y no verificada por Google, entrará en modo de "Prueba" (Testing).
5. **MUY IMPORTANTE (Usuarios de prueba)**: En esa misma sección de "Público", debes agregar tu correo (ej. `batidospitaya@gmail.com`) en la lista de **Usuarios de prueba (Test users)**. Si no lo haces, recibirás un error `403 access_denied` al intentar autenticarte. Guarda los cambios.

### 1.4 — Crear el OAuth 2.0 Client ID tipo "Desktop App"

1. En el menú izquierdo ve a **APIs y Servicios → Credenciales** (o "Clientes" en la nueva Auth Platform).
2. Haz clic en **+ CREAR CREDENCIALES → ID de cliente de OAuth** (OAuth client ID).
3. En "Tipo de aplicación" selecciona: **Aplicación de escritorio** (Desktop app).
4. Nombre: `GMB Worker — Batidos Pitaya` (o cualquier nombre descriptivo).
5. Haz clic en **Crear**.
6. Google te mostrará el **Client ID** y el **Client Secret**. Cópialos.

> El **Client ID** termina en `.apps.googleusercontent.com`
> El **Client Secret** es una cadena corta (ej: `GOCSPX-...`)

---

## 2. Obtener el refresh_token

Este paso se corre **UNA SOLA VEZ** en tu máquina local (Windows).

### Preparar el .env local

En la carpeta `GMBWorker/`, crea un archivo `.env` (a partir de `.env.example`) y pega las variables de Google:
```env
GOOGLE_CLIENT_ID=TU_CLIENT_ID_AQUI
GOOGLE_CLIENT_SECRET=TU_CLIENT_SECRET_AQUI
```

### Instalar dependencias localmente

Debes instalar las librerías del proyecto antes de correr el script:
```powershell
# Abrir terminal en la carpeta GMBWorker
npm install
```

### Correr el script interactivo

```powershell
node scripts/get-refresh-token.js
```

El script te guiará:
1. En la terminal aparecerá una URL larga. Presiona `Ctrl + Clic` o pégala en tu navegador.
2. Inicia sesión con la cuenta de Google configurada como "Usuario de prueba".
3. Si Google advierte que la app no está verificada, haz clic en **Continuar** (es tu propia app).
4. Otorga los permisos solicitados.
5. Google te mostrará un código. **Cópialo**.
6. Vuelve a la terminal de VSCode, pega el código y presiona Enter.
7. El script te devolverá un mensaje de éxito con el `GOOGLE_REFRESH_TOKEN`.

> ⚠️ Toma este token y agrégalo también a tu archivo `.env`. Guarda el refresh_token en un lugar seguro; no caduca a menos que se revoque el acceso manualmente.

---

## 3. Primer deploy en el VPS

### 3.1 — Conectarte al VPS

```bash
ssh root@198.211.97.243
```

### 3.2 — Crear el directorio aislado

```bash
mkdir -p /opt/gmb-worker
mkdir -p /opt/gmb-worker/logs
```

### 3.3 — Clonar el repo (primera vez)

```bash
cd /opt/gmb-worker
git clone https://github.com/TU_ORG/GMBWorker.git .
```

O si usas rsync (GitHub Actions lo hará automáticamente después):
```bash
# Solo en el primer deploy manual
rsync -avz ... (ver el workflow deploy.yml)
```

### 3.4 — Instalar dependencias

```bash
cd /opt/gmb-worker
npm install --production
```

### 3.5 — Configurar el .env en el VPS

```bash
cp .env.example .env
nano .env
```

Llenar los valores:
```
GOOGLE_CLIENT_ID=TU_CLIENT_ID
GOOGLE_CLIENT_SECRET=TU_CLIENT_SECRET
GOOGLE_REFRESH_TOKEN=EL_TOKEN_DEL_PASO_2
HOSTINGER_API_URL=https://api.batidospitaya.com
HOSTINGER_API_TOKEN=c5b155ba8f6877a2eefca0183ab18e37fe9a6accde340cf5c88af724822cbf50
CRON_SCHEDULE=0 2 * * *
CONCURRENCY=5
PORT=3009
```

### 3.6 — Abrir el puerto 3009

```bash
ufw allow 3009/tcp
ufw status
```

### 3.7 — Registrar en PM2

```bash
cd /opt/gmb-worker
pm2 start ecosystem.config.js
pm2 save
pm2 list
```

Deberías ver `gmb-worker` con status `online`.

---

## 4. Configurar secrets en GitHub

En el repositorio `GMBWorker` en GitHub:

**Settings → Secrets and variables → Actions → New repository secret**

| Secret      | Valor                  |
|-------------|------------------------|
| `DO_HOST`   | `198.211.97.243`       |
| `DO_USER`   | `root`                 |
| `DO_SSH_KEY`| (contenido de la llave privada SSH — mismo que usan los otros repos) |
| `DO_PATH`   | `/opt/gmb-worker`      |

Después de esto: cualquier `push` a `main` despliega automáticamente.

---

## 5. Configurar permisos en el ERP

Ejecuta este SQL en la base de datos (`u839374897_erp`):

```sql
-- 1. Registrar la herramienta
INSERT INTO tools_erp (nombre, descripcion)
VALUES ('configuracion_bot_resenasgoogle', 'Control del GMB Worker — Sync de Reseñas Google');

-- 2. Registrar la acción 'vista'
INSERT INTO acciones_tools_erp (tool_erp_id, nombre_accion)
SELECT id, 'vista' FROM tools_erp WHERE nombre = 'configuracion_bot_resenasgoogle';

-- 3. Dar permiso a los cargos que deben ver el panel del bot
--    (ajusta CodNivelesCargos según los roles de tu sistema)
INSERT INTO permisos_tools_erp (accion_tool_erp_id, CodNivelesCargos, permiso)
SELECT a.id, 1, 'allow'   -- Ajustar el CodNivelesCargos según corresponda
FROM acciones_tools_erp a
INNER JOIN tools_erp t ON t.id = a.tool_erp_id
WHERE t.nombre = 'configuracion_bot_resenasgoogle'
  AND a.nombre_accion = 'vista';
```

> Repite el INSERT de permisos para cada `CodNivelesCargos` que deba tener acceso.

---

## 6. Verificar que todo funciona

### Test 1 — El worker está vivo

```bash
curl http://198.211.97.243:3009/health
# Esperado: {"status":"ok","service":"gmb-worker","time":"..."}
```

### Test 2 — Trigger manual desde el VPS

```bash
curl -X POST http://localhost:3009/sync/trigger
# Esperado: {"message":"Sync iniciado","startedAt":"..."}
```

### Test 3 — Ver logs en tiempo real

```bash
pm2 logs gmb-worker
```

Deberías ver algo como:
```
[2026-05-04 02:00:00] ════════ GMB Sync iniciado ════════
[2026-05-04 02:00:01] Cuentas Google encontradas: 1
[2026-05-04 02:00:02]   Cuenta 123456789 → 8 sucursales
[2026-05-04 02:00:03] → Procesando: Batidos Pitaya Managua
[2026-05-04 02:00:05]   Google: 47 reseñas encontradas
[2026-05-04 02:00:05]   Resultado: +3 nuevas, ~1 actualizadas, -0 eliminadas
...
```

### Test 4 — Trigger desde el ERP

1. Ve a `https://erp.batidospitaya.com/modulos/marketing/resenas_google_descargado.php`
2. El panel del bot debe aparecer con el estado del último sync
3. Haz clic en "Sincronizar Ahora"
4. El botón debe cambiar a "Sincronizando..." y el estado actualizar en tiempo real

### Test 5 — Verificar la tabla ResenasGoogle

```sql
-- Ver columna deleted_at (debe existir ahora)
SHOW COLUMNS FROM ResenasGoogle LIKE 'deleted_at';

-- Ver últimas reseñas sincronizadas
SELECT locationId, reviewerName, starRating, createTime, extractionDate
FROM ResenasGoogle
ORDER BY extractionDate DESC
LIMIT 20;
```

---

## Troubleshooting

### El worker no puede conectar a Google API
```bash
# Verificar que el refresh_token es válido
cd /opt/gmb-worker
node -e "
  require('dotenv').config();
  const auth = require('./src/auth/google');
  auth.getAccessToken().then(t => console.log('Token OK:', t.slice(0,20)+'...')).catch(console.error);
"
```

### El ERP no puede conectar al worker (port 3009)
```bash
# Desde el servidor Hostinger (o cualquier servidor con curl):
curl -m 5 http://198.211.97.243:3009/health

# Si falla, verificar firewall:
ufw status | grep 3009
```

### Reiniciar el worker
```bash
pm2 restart gmb-worker
pm2 logs gmb-worker --lines 50
```

### Ver el último sync guardado
```bash
cat /opt/gmb-worker/logs/last-sync.json | python3 -m json.tool
```
