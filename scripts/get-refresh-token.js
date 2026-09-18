/**
 * get-refresh-token.js — Script para obtener el refresh_token de Google
 *
 * Uso:
 *   1. node scripts/get-refresh-token.js
 *   2. Se abrirá automáticamente tu navegador (o copia la URL).
 *   3. Inicia sesión y autoriza a Batidos Pitaya.
 *   4. El script captura automáticamente el token en http://127.0.0.1:8085.
 */

'use strict';

require('dotenv').config();
const http     = require('http');
const url      = require('url');
const fetch    = require('node-fetch');
const { exec } = require('child_process');

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const PORT          = 8085;
const REDIRECT_URI  = `http://127.0.0.1:${PORT}`;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('\n❌ ERROR: Agrega GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET al .env primero.\n');
  process.exit(1);
}

const SCOPE   = 'https://www.googleapis.com/auth/business.manage';
const authUrl = [
  'https://accounts.google.com/o/oauth2/v2/auth',
  `?client_id=${encodeURIComponent(CLIENT_ID)}`,
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`,
  `&response_type=code`,
  `&scope=${encodeURIComponent(SCOPE)}`,
  `&access_type=offline`,
  `&prompt=consent`
].join('');

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);

  if (parsedUrl.pathname === '/' || parsedUrl.pathname === '') {
    const code  = parsedUrl.query.code;
    const error = parsedUrl.query.error;

    if (error) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
        <!DOCTYPE html>
        <html>
        <head><meta charset="utf-8"><title>Error de Autorización</title></head>
        <body style="font-family:sans-serif; text-align:center; padding:50px;">
          <h1 style="color:#d32f2f;">❌ Error al autorizar</h1>
          <p>${error}</p>
        </body>
        </html>
      `);
      console.error('\n❌ Error retornado por Google:', error);
      server.close();
      process.exit(1);
    }

    if (!code) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h1>No se recibió el código de autorización</h1>');
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <!DOCTYPE html>
      <html>
      <head><meta charset="utf-8"><title>Autorización Exitosa</title></head>
      <body style="font-family:sans-serif; text-align:center; padding:60px 20px; background:#f4f9f4;">
        <h1 style="color:#1b5e20; font-size:32px;">✅ ¡Autorización Exitosa!</h1>
        <p style="font-size:18px; color:#333;">Google ha transferido las credenciales a tu script local.</p>
        <p style="font-size:16px; color:#666;">Ya puedes cerrar esta pestaña del navegador y volver a la terminal de VS Code.</p>
      </body>
      </html>
    `);

    console.log('\n[✓] Código de autorización recibido con éxito.');
    console.log('    Intercambiando código por refresh_token con Google...');

    try {
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id:     CLIENT_ID,
          client_secret: CLIENT_SECRET,
          redirect_uri:  REDIRECT_URI,
          grant_type:    'authorization_code'
        })
      });

      const data = await tokenRes.json();

      if (data.refresh_token) {
        console.log('\n╔══════════════════════════════════════════════════════════════════════════╗');
        console.log('║               ✅ ¡REFRESH TOKEN OBTENIDO EXITOSAMENTE!                   ║');
        console.log('╚══════════════════════════════════════════════════════════════════════════╝\n');
        console.log(`GOOGLE_REFRESH_TOKEN=${data.refresh_token}\n`);
        console.log('──────────────────────────────────────────────────────────────────────────');
        console.log('Copia este valor y colócalo en el .env del VPS (/opt/gmb-worker/.env)');
        console.log('──────────────────────────────────────────────────────────────────────────\n');
      } else {
        console.error('\n❌ Google no devolvió un refresh_token:', JSON.stringify(data, null, 2));
      }
    } catch (err) {
      console.error('\n❌ Error de red al solicitar el token:', err.message);
    } finally {
      setTimeout(() => {
        server.close();
        process.exit(0);
      }, 1000);
    }
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║   GMB Worker — Obtener Google Refresh Token          ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');
  console.log(`[✓] Servidor local escuchando en: ${REDIRECT_URI}`);
  console.log('[✓] Intentando abrir el navegador automáticamente...\n');
  console.log('Si no se abre automáticamente, haz Clic o copia este enlace en tu navegador:\n');
  console.log('  ' + authUrl + '\n');
  console.log('──────────────────────────────────────────────────────');
  console.log('Esperando que autorices en Google...');

  const startCmd = process.platform === 'win32'
    ? `start "" "${authUrl}"`
    : (process.platform === 'darwin' ? `open "${authUrl}"` : `xdg-open "${authUrl}"`);

  exec(startCmd, (err) => {
    if (err) {
      // Si falla abrir el navegador automáticamente, no pasa nada, ya imprimió el link
    }
  });
});
