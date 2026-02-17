/**
 * get-token.ts
 *
 * Fetches a fresh Adobe IMS access token using OAuth Server-to-Server
 * credentials and writes it to your .env file automatically.
 *
 * Usage:
 *   npm run get-token
 *
 * Prerequisites – set ALL of these in .env before running:
 *
 *   AEM_CLIENT_ID      – "Client ID" from Developer Console → your project →
 *                        OAuth Server-to-Server → Credential details
 *
 *   AEM_CLIENT_SECRET  – "Client Secret" (click "Retrieve client secret")
 *
 *   AEM_SCOPES         – Copy the exact value from "Scopes" on the same page.
 *                        It looks like: AdobeID,openid,aem.cloud,...
 *                        Do NOT invent scopes – use exactly what Console shows.
 *
 * Common errors:
 *   unauthorized_client  → Wrong scopes, OR no product profile assigned.
 *                          In Developer Console: OAuth Server-to-Server →
 *                          "Assign product profiles" and add an AEM profile.
 *   invalid_client       → Wrong Client ID or Client Secret.
 */

import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = resolve(__dirname, '../.env');

dotenv.config({ path: envPath });

const IMS_TOKEN_URL = 'https://ims-na1.adobelogin.com/ims/token/v3';

const CLIENT_ID = process.env.AEM_CLIENT_ID;
const CLIENT_SECRET = process.env.AEM_CLIENT_SECRET;
const SCOPES = process.env.AEM_SCOPES;

// ─── Pre-flight checks ────────────────────────────────────────────────────────

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(`
Error: AEM_CLIENT_ID and AEM_CLIENT_SECRET must be set in .env

Where to find them:
  1. Go to https://developer.adobe.com/console
  2. Open your project → Credentials → OAuth Server-to-Server
  3. Copy "Client ID" → AEM_CLIENT_ID
  4. Click "Retrieve client secret" → AEM_CLIENT_SECRET
`);
  process.exit(1);
}

if (!SCOPES) {
  console.error(`
Error: AEM_SCOPES must be set in .env

Where to find it:
  1. Go to https://developer.adobe.com/console
  2. Open your project → Credentials → OAuth Server-to-Server → Credential details
  3. Copy the exact string from the "Scopes" field (e.g. AdobeID,openid,aem.cloud,...)
  4. Paste it as: AEM_SCOPES=<that string>

Do NOT use generic scope values — the string must match exactly what
Adobe Developer Console shows for your specific credential.

Also make sure:
  • The OAuth Server-to-Server credential has a product profile assigned.
    (Click "Assign product profiles" on the credential page and add an AEM profile.)
  • The AEM as a Cloud Service API has been added to your project.
`);
  process.exit(1);
}

// ─── Token request ────────────────────────────────────────────────────────────

interface ImsTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface ImsErrorResponse {
  error: string;
  error_description?: string;
}

async function fetchToken(): Promise<ImsTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: CLIENT_ID!,
    client_secret: CLIENT_SECRET!,
    scope: SCOPES!,
  });

  console.log(`  Endpoint: ${IMS_TOKEN_URL}`);
  console.log(`  Client ID: ${CLIENT_ID}`);
  console.log(`  Scopes: ${SCOPES}\n`);

  const response = await fetch(IMS_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const raw = await response.text();

  if (!response.ok) {
    let parsed: ImsErrorResponse | null = null;
    try { parsed = JSON.parse(raw) as ImsErrorResponse; } catch { /* ignore */ }

    const errorCode = parsed?.error ?? `HTTP ${response.status}`;
    const description = parsed?.error_description ?? raw;

    let hint = '';
    if (errorCode === 'unauthorized_client') {
      hint = `
Hint (unauthorized_client):
  • The most common cause is wrong or missing scopes.
    Copy the exact "Scopes" value from Developer Console → OAuth Server-to-Server.
  • Make sure a product profile is assigned to the credential.
    In Developer Console: OAuth Server-to-Server → "Assign product profiles".
  • Confirm the AEM as a Cloud Service API is added to the project.`;
    } else if (errorCode === 'invalid_client') {
      hint = `
Hint (invalid_client):
  • Double-check AEM_CLIENT_ID and AEM_CLIENT_SECRET in .env.
  • Client secret may have expired — regenerate it in Developer Console.`;
    }

    throw new Error(`IMS error [${errorCode}]: ${description}${hint}`);
  }

  return JSON.parse(raw) as ImsTokenResponse;
}

// ─── Write token to .env ──────────────────────────────────────────────────────

function writeTokenToEnv(token: string): void {
  if (!existsSync(envPath)) {
    writeFileSync(envPath, `AEM_ACCESS_TOKEN=${token}\n`, 'utf-8');
    console.log('Created .env with AEM_ACCESS_TOKEN');
    return;
  }

  let contents = readFileSync(envPath, 'utf-8');

  if (/^AEM_ACCESS_TOKEN=.*/m.test(contents)) {
    contents = contents.replace(/^AEM_ACCESS_TOKEN=.*/m, `AEM_ACCESS_TOKEN=${token}`);
    console.log('Updated AEM_ACCESS_TOKEN in .env');
  } else {
    contents += `\nAEM_ACCESS_TOKEN=${token}\n`;
    console.log('Appended AEM_ACCESS_TOKEN to .env');
  }

  writeFileSync(envPath, contents, 'utf-8');
}

function formatExpiry(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

console.log('Requesting Adobe IMS access token...\n');

try {
  const { access_token, token_type, expires_in } = await fetchToken();

  console.log('Token received!');
  console.log(`  Type:    ${token_type}`);
  console.log(`  Expires: in ${formatExpiry(expires_in)} (${expires_in}s)`);
  console.log(`  Token:   ${access_token.slice(0, 20)}...`);

  writeTokenToEnv(access_token);

  console.log('\nDone. Start the MCP server with: npm start\n');
} catch (err) {
  console.error(`\n${err}\n`);
  process.exit(1);
}
