/**
 * get-token.ts
 *
 * Fetches a fresh Adobe IMS access token using OAuth Server-to-Server
 * credentials and writes it to your .env file automatically.
 *
 * Usage:
 *   npm run get-token
 *
 * Prerequisites: set these in .env before running
 *   AEM_CLIENT_ID      – from Adobe Developer Console
 *   AEM_CLIENT_SECRET  – from Adobe Developer Console
 *   AEM_SCOPES         – comma-separated IMS scopes (see .env.example)
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
const SCOPES = process.env.AEM_SCOPES ?? 'AdobeID,openid,read_organizations,additional_info.projectedProductContext';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    '\nError: AEM_CLIENT_ID and AEM_CLIENT_SECRET must be set in your .env file.\n' +
    'Get these from: https://developer.adobe.com/console\n' +
    '  1. Create a project\n' +
    '  2. Add API → AEM as a Cloud Service\n' +
    '  3. Choose OAuth Server-to-Server\n' +
    '  4. Copy the Client ID and Client Secret into .env\n'
  );
  process.exit(1);
}

interface ImsTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

async function fetchToken(): Promise<ImsTokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: CLIENT_ID!,
    client_secret: CLIENT_SECRET!,
    scope: SCOPES,
  });

  const response = await fetch(IMS_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`IMS token request failed (${response.status}): ${text}`);
  }

  return response.json() as Promise<ImsTokenResponse>;
}

function writeTokenToEnv(token: string): void {
  if (!existsSync(envPath)) {
    writeFileSync(envPath, `AEM_ACCESS_TOKEN=${token}\n`, 'utf-8');
    console.log(`\nCreated .env with AEM_ACCESS_TOKEN`);
    return;
  }

  let contents = readFileSync(envPath, 'utf-8');

  if (/^AEM_ACCESS_TOKEN=.*/m.test(contents)) {
    contents = contents.replace(/^AEM_ACCESS_TOKEN=.*/m, `AEM_ACCESS_TOKEN=${token}`);
    console.log(`\nUpdated AEM_ACCESS_TOKEN in .env`);
  } else {
    contents += `\nAEM_ACCESS_TOKEN=${token}\n`;
    console.log(`\nAppended AEM_ACCESS_TOKEN to .env`);
  }

  writeFileSync(envPath, contents, 'utf-8');
}

function formatExpiry(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// ─── Main ────────────────────────────────────────────────────────────────────

console.log('Requesting Adobe IMS access token...');

try {
  const { access_token, token_type, expires_in } = await fetchToken();

  console.log(`\nToken received!`);
  console.log(`  Type:    ${token_type}`);
  console.log(`  Expires: in ${formatExpiry(expires_in)} (${expires_in}s)`);
  console.log(`  Token:   ${access_token.slice(0, 20)}...`);

  writeTokenToEnv(access_token);

  console.log('\nDone. You can now start the MCP server with: npm start\n');
} catch (err) {
  console.error(`\nFailed to fetch token: ${err}\n`);
  process.exit(1);
}
