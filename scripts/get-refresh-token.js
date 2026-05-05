/**
 * get-refresh-token.js — Script ONE-TIME para obtener el refresh_token de Google
 *
 * Uso:
 *   1. Completa GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en tu .env LOCAL
 *   2. node scripts/get-refresh-token.js
 *   3. Abre la URL en el navegador, autoriza con la cuenta de Google Business
 *   4. Copia el código y pégalo aquí
 *   5. Copia el refresh_token al .env del VPS
 *
 * Este script solo se corre UNA VEZ localmente. El refresh_token no expira
 * (a menos que se revoque manualmente en Google Account → Seguridad → Acceso).
 */

'use strict';

require('dotenv').config();
const fetch    = require('node-fetch');
const readline = require('readline');

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI  = 'urn:ietf:wg:oauth:2.0:oob'; // Flujo Desktop App

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
  `&prompt=consent`   // fuerza mostrar el refresh_token aunque ya haya autorizado antes
].join('');

console.log('\n╔══════════════════════════════════════════════════════╗');
console.log('║   GMB Worker — Obtener Google Refresh Token          ║');
console.log('╚══════════════════════════════════════════════════════╝\n');

console.log('PASO 1: Abre este URL en tu navegador (Chrome recomendado):\n');
console.log('  ' + authUrl);
console.log('\n──────────────────────────────────────────────────────');
console.log('PASO 2: Inicia sesión con la cuenta de Google que administra');
console.log('  el perfil de negocio (Google Business Profile).');
console.log('  Haz clic en "Continuar" aunque aparezca advertencia de app no verificada.');
console.log('\nPASO 3: Google te mostrará un código. Cópialo.');
console.log('──────────────────────────────────────────────────────\n');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

rl.question('PASO 4: Pega el código aquí y presiona Enter:\n> ', async (code) => {
  rl.close();
  code = (code || '').trim();

  if (!code) {
    console.error('\n❌ No se ingresó ningún código.\n');
    process.exit(1);
  }

  console.log('\nIntercambiando código por tokens...');

  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
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

    const data = await res.json();

    if (data.refresh_token) {
      console.log('\n✅ ¡Éxito! Agrega esto al .env del VPS:\n');
      console.log(`  GOOGLE_REFRESH_TOKEN=${data.refresh_token}`);
      console.log('\n⚠️  Guárdalo en un lugar seguro. No vuelve a mostrarse.');
      console.log('    Si lo pierdes, debes repetir este proceso.\n');
    } else if (data.error) {
      console.error('\n❌ Error de Google:', data.error, '-', data.error_description);
      console.error('   Respuesta completa:', JSON.stringify(data, null, 2));
    } else {
      console.error('\n❌ Respuesta inesperada:', JSON.stringify(data, null, 2));
    }
  } catch (err) {
    console.error('\n❌ Error de red:', err.message);
  }
});
