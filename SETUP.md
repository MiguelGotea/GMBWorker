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
3. Busca el proyecto que ya usa la **Business Profile API** (probablemente el mismo que tiene el Apps Script)
   - Si no sabes cuál es, ve a **APIs & Services → Enabled APIs** y busca "Business Profile"

### 1.2 — Habilitar la Business Profile API (si no está habilitada)

1. En el menú izquierdo: **APIs & Services → Library**
2. Busca: `Business Profile Performance API` → Enable
3. Busca: `My Business Account Management API` → Enable
4. Busca: `My Business Business Information API` → Enable

> ⚠️ Si las APIs requieren aprobación (pantalla de consentimiento en modo "Testing"), puedes agregar tu email de Google como "Test User" en **APIs & Services → OAuth consent screen → Test users**.

### 1.3 — Crear el OAuth 2.0 Client ID tipo "Desktop App"

Este client ID es diferente al que usa Apps Script (que es automático). El worker necesita uno propio.

1. Ve a **APIs & Services → Credentials**
2. Haz clic en **+ CREATE CREDENTIALS → OAuth client ID**
3. En "Application type" selecciona: **Desktop app**
4. Nombre: `GMB Worker — Batidos Pitaya` (o cualquier nombre descriptivo)
5. Haz clic en **CREATE**
6. Google te mostrará el **Client ID** y el **Client Secret**. Cópialos o descarga el JSON.

> El **Client ID** termina en `.apps.googleusercontent.com`
> El **Client Secret** es una cadena corta (ej: `GOCSPX-...`)

### 1.4 — Configurar la pantalla de consentimiento (si aún no lo has hecho)

1. Ve a **APIs & Services → OAuth consent screen**
2. Si está en modo "Testing", agrega tu email de Google en **Test users**
3. El worker usará esa cuenta para autenticarse

---

## 2. Obtener el refresh_token

Este paso se corre **UNA SOLA VEZ** en tu máquina local (Windows).

### Preparar el .env local

En la carpeta `GMBWorker/`, crea un archivo `.env` con:
```
GOOGLE_CLIENT_ID=TU_CLIENT_ID_AQUI
GOOGLE_CLIENT_SECRET=TU_CLIENT_SECRET_AQUI
```

### Instalar dependencias localmente

```powershell
cd "C:\Users\migue\Desktop\Sistema\Pitaya Web\VisualCode\GMBWorker"
npm install
```

### Correr el script interactivo

```powershell
node scripts/get-refresh-token.js
```

El script te dará instrucciones paso a paso:
1. Abre el URL que muestra en Chrome
2. Inicia sesión con la cuenta de Google que administra el perfil de negocio
3. Si aparece "App no verificada", haz clic en **"Continuar"** (es tu propio app)
4. Autoriza los permisos
5. Copia el código que aparece en pantalla
6. Pégalo en la terminal y presiona Enter
7. El script imprime el `GOOGLE_REFRESH_TOKEN`

> ⚠️ Guarda el refresh_token en un lugar seguro. No vuelve a mostrarse.

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
