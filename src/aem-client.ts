import 'dotenv/config';

const AEM_BASE_URL = process.env.AEM_BASE_URL ?? '';
const AEM_AUTH_TYPE = process.env.AEM_AUTH_TYPE ?? 'basic'; // 'basic' | 'token'
const AEM_USERNAME = process.env.AEM_USERNAME ?? '';
const AEM_PASSWORD = process.env.AEM_PASSWORD ?? '';
const AEM_ACCESS_TOKEN = process.env.AEM_ACCESS_TOKEN ?? '';

if (!AEM_BASE_URL) {
  throw new Error('AEM_BASE_URL environment variable is required');
}

function getAuthHeader(): string {
  if (AEM_AUTH_TYPE === 'token') {
    if (!AEM_ACCESS_TOKEN) {
      throw new Error('AEM_ACCESS_TOKEN is required when AEM_AUTH_TYPE=token');
    }
    return `Bearer ${AEM_ACCESS_TOKEN}`;
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
  const url = `${AEM_BASE_URL.replace(/\/$/, '')}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: getAuthHeader(),
      'Content-Type': 'application/json',
      Accept: 'application/json',
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

  const response = await fetch(
    `${AEM_BASE_URL.replace(/\/$/, '')}/bin/wcmcommand`,
    {
      method: 'POST',
      headers: {
        Authorization: getAuthHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    }
  );

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

  const response = await fetch(
    `${AEM_BASE_URL.replace(/\/$/, '')}${pagePath}/jcr:content`,
    {
      method: 'POST',
      headers: {
        Authorization: getAuthHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    }
  );

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

  const response = await fetch(
    `${AEM_BASE_URL.replace(/\/$/, '')}/bin/wcmcommand`,
    {
      method: 'POST',
      headers: {
        Authorization: getAuthHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    }
  );

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

  const response = await fetch(
    `${AEM_BASE_URL.replace(/\/$/, '')}/api/assets${parentPath}/${name}`,
    {
      method: 'POST',
      headers: {
        Authorization: getAuthHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    }
  );

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

  const response = await fetch(
    `${AEM_BASE_URL.replace(/\/$/, '')}/bin/replicate.json`,
    {
      method: 'POST',
      headers: {
        Authorization: getAuthHeader(),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: formData.toString(),
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`AEM replication error ${response.status}: ${body}`);
  }
  return { success: true, path, action };
}
