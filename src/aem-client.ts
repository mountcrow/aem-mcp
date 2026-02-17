import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

// Load .env from the project root regardless of the process working directory.
// import.meta.url points to dist/aem-client.js, so ../ is the project root.
dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

const AEM_AUTH_TYPE = process.env.AEM_AUTH_TYPE ?? 'basic'; // 'basic' | 'token'
const AEM_USERNAME = process.env.AEM_USERNAME ?? '';
const AEM_PASSWORD = process.env.AEM_PASSWORD ?? '';
const AEM_CLIENT_ID = process.env.AEM_CLIENT_ID ?? '';
const AEM_CLIENT_SECRET = process.env.AEM_CLIENT_SECRET ?? '';
const AEM_SCOPES = process.env.AEM_SCOPES ?? '';

const IMS_TOKEN_URL = 'https://ims-na1.adobelogin.com/ims/token/v3';

// Mutable token state — refreshed automatically when expired
let accessToken: string = process.env.AEM_ACCESS_TOKEN ?? '';
let tokenExpiresAt: number = 0; // epoch ms; 0 means unknown/expired

// CSRF token cache — AEM requires this header on all mutating requests
let csrfToken: string = '';

async function fetchCsrfToken(): Promise<string> {
  try {
    const response = await fetch(`${getBaseUrl()}/libs/granite/csrf/token.json`, {
      headers: { Authorization: await getAuthHeader() },
    });
    if (!response.ok) return '';
    const data = await response.json() as { token: string };
    csrfToken = data.token ?? '';
  } catch {
    csrfToken = '';
  }
  return csrfToken;
}

async function getCsrfToken(): Promise<string> {
  if (!csrfToken) await fetchCsrfToken();
  return csrfToken;
}

// Lazy getter so a missing AEM_BASE_URL only fails when a tool is called,
// not at startup — allowing Claude Desktop to connect first.
function getBaseUrl(): string {
  const url = process.env.AEM_BASE_URL ?? '';
  if (!url) throw new Error('AEM_BASE_URL is not set. Add it to your .env file.');
  return url.replace(/\/$/, '');
}

async function refreshAccessToken(): Promise<void> {
  if (!AEM_CLIENT_ID || !AEM_CLIENT_SECRET || !AEM_SCOPES) {
    throw new Error(
      'AEM_CLIENT_ID, AEM_CLIENT_SECRET, and AEM_SCOPES are required for automatic token refresh. ' +
      'Run `npm run get-token` to fetch a token manually, or add all three to .env. ' +
      'AEM_SCOPES must be copied exactly from Adobe Developer Console → OAuth Server-to-Server → Credential details.'
    );
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: AEM_CLIENT_ID,
    client_secret: AEM_CLIENT_SECRET,
    scope: AEM_SCOPES,
  });

  const response = await fetch(IMS_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`IMS token refresh failed (${response.status}): ${text}`);
  }

  const data = await response.json() as { access_token: string; expires_in: number };
  accessToken = data.access_token;
  // Subtract 60s buffer so we refresh before the token actually expires
  tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
}

async function ensureValidToken(): Promise<string> {
  if (!accessToken || Date.now() >= tokenExpiresAt) {
    await refreshAccessToken();
  }
  return accessToken;
}

async function getAuthHeader(): Promise<string> {
  if (AEM_AUTH_TYPE === 'token') {
    const token = await ensureValidToken();
    return `Bearer ${token}`;
  }
  // Default: basic auth
  if (!AEM_USERNAME || !AEM_PASSWORD) {
    throw new Error('AEM_USERNAME and AEM_PASSWORD are required when AEM_AUTH_TYPE=basic');
  }
  const credentials = Buffer.from(`${AEM_USERNAME}:${AEM_PASSWORD}`).toString('base64');
  return `Basic ${credentials}`;
}

async function aemRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  const isMutation = method !== 'GET' && method !== 'HEAD';
  const csrf = isMutation ? await getCsrfToken() : '';

  const url = `${getBaseUrl()}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: await getAuthHeader(),
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(csrf ? { 'CSRF-Token': csrf } : {}),
      ...options.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`AEM API error ${response.status} ${response.statusText}: ${body}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return response.json() as Promise<T>;
  }
  return response.text() as unknown as T;
}

// Shared helper for Sling POST Servlet / WCM Command form submissions
async function aemFormPost(endpoint: string, formData: URLSearchParams): Promise<Response> {
  const csrf = await getCsrfToken();
  const response = await fetch(`${getBaseUrl()}${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: await getAuthHeader(),
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(csrf ? { 'CSRF-Token': csrf } : {}),
    },
    body: formData.toString(),
  });
  return response;
}

// ─── Pages ───────────────────────────────────────────────────────────────────

export interface PageProperties {
  'jcr:title'?: string;
  'jcr:description'?: string;
  template?: string;
  [key: string]: unknown;
}

export async function getPage(pagePath: string): Promise<unknown> {
  return aemRequest(`${pagePath}.infinity.json`);
}

export async function listPages(parentPath: string): Promise<unknown> {
  return aemRequest(`${parentPath}.1.json`);
}

export async function createPage(
  parentPath: string,
  pageName: string,
  template: string,
  title: string
): Promise<unknown> {
  const formData = new URLSearchParams({
    cmd: 'createPage',
    parentPath,
    title,
    label: pageName,
    template,
    _charset_: 'utf-8',
  });

  const response = await aemFormPost('/bin/wcmcommand', formData);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`AEM create page error ${response.status}: ${body}`);
  }
  return response.json();
}

export async function updatePageProperties(
  pagePath: string,
  properties: PageProperties
): Promise<unknown> {
  const formData = new URLSearchParams({ _charset_: 'utf-8' });
  for (const [key, value] of Object.entries(properties)) {
    if (value !== undefined) {
      formData.append(key, String(value));
    }
  }

  const response = await aemFormPost(`${pagePath}/jcr:content`, formData);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`AEM update page error ${response.status}: ${body}`);
  }
  return { success: true, path: pagePath };
}

export async function deletePage(pagePath: string, force = false): Promise<unknown> {
  const formData = new URLSearchParams({
    cmd: 'deletePage',
    path: pagePath,
    force: force ? 'true' : 'false',
    _charset_: 'utf-8',
  });

  const response = await aemFormPost('/bin/wcmcommand', formData);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`AEM delete page error ${response.status}: ${body}`);
  }
  return { success: true, path: pagePath };
}

// ─── Search (QueryBuilder) ────────────────────────────────────────────────────

export interface QueryBuilderParams {
  path?: string;
  type?: string;
  fulltext?: string;
  limit?: number;
  offset?: number;
  orderby?: string;
  [key: string]: string | number | undefined;
}

export async function searchContent(params: QueryBuilderParams): Promise<unknown> {
  const query = new URLSearchParams();
  query.set('p.limit', String(params.limit ?? 20));
  query.set('p.offset', String(params.offset ?? 0));

  if (params.path) query.set('path', params.path);
  if (params.type) query.set('type', params.type);
  if (params.fulltext) query.set('fulltext', params.fulltext);
  if (params.orderby) query.set('orderby', params.orderby);

  // Pass through any additional query params (e.g. property.1_property, etc.)
  for (const [key, value] of Object.entries(params)) {
    if (!['path', 'type', 'fulltext', 'limit', 'offset', 'orderby'].includes(key) && value !== undefined) {
      query.set(key, String(value));
    }
  }

  return aemRequest(`/bin/querybuilder.json?${query.toString()}`);
}

// ─── Assets ──────────────────────────────────────────────────────────────────

export async function getAsset(assetPath: string): Promise<unknown> {
  return aemRequest(`${assetPath}.json`);
}

export async function listAssets(folderPath: string): Promise<unknown> {
  return searchContent({
    path: folderPath,
    type: 'dam:Asset',
    limit: 50,
  });
}

export async function getAssetRenditions(assetPath: string): Promise<unknown> {
  return aemRequest(`${assetPath}/jcr:content/renditions.1.json`);
}

// ─── Content Fragments ───────────────────────────────────────────────────────

export async function getContentFragment(fragmentPath: string): Promise<unknown> {
  return aemRequest(`/api/assets${fragmentPath}.json`);
}

export async function listContentFragments(
  folderPath: string,
  modelPath?: string
): Promise<unknown> {
  const params: QueryBuilderParams = {
    path: folderPath,
    type: 'dam:Asset',
    limit: 50,
    'property': 'jcr:content/contentFragment',
    'property.value': 'true',
  };

  if (modelPath) {
    params['property.1_property'] = 'jcr:content/data/cq:model';
    params['property.1_value'] = modelPath;
  }

  return searchContent(params);
}

export async function createContentFragment(
  parentPath: string,
  name: string,
  modelPath: string,
  title: string,
  description?: string
): Promise<unknown> {
  const body: Record<string, string> = {
    'jcr:title': title,
    template: modelPath,
  };
  if (description) body['jcr:description'] = description;

  const formData = new URLSearchParams({ ...body, _charset_: 'utf-8' });

  const response = await aemFormPost(`/api/assets${parentPath}/${name}`, formData);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`AEM create content fragment error ${response.status}: ${body}`);
  }
  return response.json();
}

export async function updateContentFragment(
  fragmentPath: string,
  properties: Record<string, string | string[]>
): Promise<unknown> {
  return aemRequest(`/api/assets${fragmentPath}`, {
    method: 'PUT',
    body: JSON.stringify({
      class: 'asset',
      properties,
    }),
  });
}

// ─── Replication ─────────────────────────────────────────────────────────────

export async function replicatePage(
  path: string,
  action: 'Activate' | 'Deactivate' = 'Activate'
): Promise<unknown> {
  const formData = new URLSearchParams({
    cmd: action,
    path,
    _charset_: 'utf-8',
  });

  const response = await aemFormPost('/bin/replicate.json', formData);

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`AEM replication error ${response.status}: ${body}`);
  }
  return { success: true, path, action };
}

// ─── Diagnostics ─────────────────────────────────────────────────────────────

export async function checkConnection(): Promise<Record<string, unknown>> {
  const baseUrl = getBaseUrl();
  const results: Record<string, unknown> = { baseUrl };

  // 1. Verify the token/auth reaches AEM at all via the CSRF endpoint
  try {
    const csrfRes = await fetch(`${baseUrl}/libs/granite/csrf/token.json`, {
      headers: { Authorization: await getAuthHeader() },
    });
    results.csrf = {
      status: csrfRes.status,
      ok: csrfRes.ok,
      token: csrfRes.ok ? ((await csrfRes.json() as { token: string }).token?.slice(0, 8) + '...') : null,
    };
  } catch (e) {
    results.csrf = { error: String(e) };
  }

  // 2. Identify the authenticated user and their group memberships
  try {
    const userRes = await fetch(`${baseUrl}/libs/granite/security/currentuser.json`, {
      headers: { Authorization: await getAuthHeader() },
    });
    if (userRes.ok) {
      const user = await userRes.json() as Record<string, unknown>;
      results.currentUser = user;
    } else {
      results.currentUser = { status: userRes.status, error: await userRes.text() };
    }
  } catch (e) {
    results.currentUser = { error: String(e) };
  }

  // 3. Try a basic read of /content (the most common 403 path)
  try {
    const contentRes = await fetch(`${baseUrl}/content.1.json`, {
      headers: { Authorization: await getAuthHeader() },
    });
    results.contentAccess = { status: contentRes.status, ok: contentRes.ok };
  } catch (e) {
    results.contentAccess = { error: String(e) };
  }

  // 4. Try a basic read of /content/dam
  try {
    const damRes = await fetch(`${baseUrl}/content/dam.1.json`, {
      headers: { Authorization: await getAuthHeader() },
    });
    results.damAccess = { status: damRes.status, ok: damRes.ok };
  } catch (e) {
    results.damAccess = { error: String(e) };
  }

  return results;
}
