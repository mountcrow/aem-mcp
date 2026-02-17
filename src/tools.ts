import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  checkConnection,
  getPage,
  listPages,
  createPage,
  updatePageProperties,
  deletePage,
  searchContent,
  getAsset,
  listAssets,
  getAssetRenditions,
  getContentFragment,
  listContentFragments,
  createContentFragment,
  updateContentFragment,
  replicatePage,
} from './aem-client.js';

function textResult(data: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
      },
    ],
  };
}

function errorResult(message: string) {
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: `Error: ${message}`,
      },
    ],
  };
}

export function registerTools(server: McpServer): void {
  // ─── Diagnostics ───────────────────────────────────────────────────────────

  server.tool(
    'aem_check_connection',
    'Diagnose the AEM connection: tests authentication, identifies the current user and their group memberships, and checks read access to /content and /content/dam. Run this first if you are getting 403 errors.',
    {},
    async () => {
      try {
        const result = await checkConnection();
        return textResult(result);
      } catch (err) {
        return errorResult(String(err));
      }
    }
  );

  // ─── Pages ─────────────────────────────────────────────────────────────────

  server.tool(
    'aem_get_page',
    'Get AEM page content and properties at the specified JCR path. Returns the full node tree.',
    {
      page_path: z
        .string()
        .describe('JCR path of the page, e.g. /content/mysite/en/home'),
    },
    async ({ page_path }) => {
      try {
        const result = await getPage(page_path);
        return textResult(result);
      } catch (err) {
        return errorResult(String(err));
      }
    }
  );

  server.tool(
    'aem_list_pages',
    'List direct child pages under an AEM path. Returns one level of children with their properties.',
    {
      parent_path: z
        .string()
        .describe('JCR path of the parent node, e.g. /content/mysite/en'),
    },
    async ({ parent_path }) => {
      try {
        const result = await listPages(parent_path);
        return textResult(result);
      } catch (err) {
        return errorResult(String(err));
      }
    }
  );

  server.tool(
    'aem_create_page',
    'Create a new AEM page under the specified parent path using a page template.',
    {
      parent_path: z
        .string()
        .describe('JCR path of the parent page, e.g. /content/mysite/en'),
      page_name: z
        .string()
        .describe('URL-safe name for the new page (used in the path), e.g. my-new-page'),
      template: z
        .string()
        .describe('Path to the page template, e.g. /conf/mysite/settings/wcm/templates/content-page'),
      title: z
        .string()
        .describe('Human-readable title for the page'),
    },
    async ({ parent_path, page_name, template, title }) => {
      try {
        const result = await createPage(parent_path, page_name, template, title);
        return textResult(result);
      } catch (err) {
        return errorResult(String(err));
      }
    }
  );

  server.tool(
    'aem_update_page',
    'Update properties of an existing AEM page (e.g. title, description, tags). Targets jcr:content node.',
    {
      page_path: z
        .string()
        .describe('JCR path of the page, e.g. /content/mysite/en/home'),
      properties: z
        .record(z.string())
        .describe(
          'Key/value map of JCR properties to update, e.g. {"jcr:title": "New Title", "jcr:description": "..."}'
        ),
    },
    async ({ page_path, properties }) => {
      try {
        const result = await updatePageProperties(page_path, properties);
        return textResult(result);
      } catch (err) {
        return errorResult(String(err));
      }
    }
  );

  server.tool(
    'aem_delete_page',
    'Delete an AEM page at the specified path. Use force=true to delete pages with child pages.',
    {
      page_path: z
        .string()
        .describe('JCR path of the page to delete, e.g. /content/mysite/en/old-page'),
      force: z
        .boolean()
        .optional()
        .describe('If true, delete the page even if it has children. Defaults to false.'),
    },
    async ({ page_path, force }) => {
      try {
        const result = await deletePage(page_path, force ?? false);
        return textResult(result);
      } catch (err) {
        return errorResult(String(err));
      }
    }
  );

  server.tool(
    'aem_replicate_page',
    'Activate or deactivate (publish/unpublish) an AEM page to the publish instance.',
    {
      page_path: z
        .string()
        .describe('JCR path of the page to replicate, e.g. /content/mysite/en/home'),
      action: z
        .enum(['Activate', 'Deactivate'])
        .optional()
        .describe('Replication action: Activate (publish) or Deactivate (unpublish). Defaults to Activate.'),
    },
    async ({ page_path, action }) => {
      try {
        const result = await replicatePage(page_path, action ?? 'Activate');
        return textResult(result);
      } catch (err) {
        return errorResult(String(err));
      }
    }
  );

  // ─── Search ────────────────────────────────────────────────────────────────

  server.tool(
    'aem_search',
    'Search AEM content using the QueryBuilder API. Supports full-text search, path filtering, and type filtering.',
    {
      fulltext: z
        .string()
        .optional()
        .describe('Full-text search term to find in content'),
      path: z
        .string()
        .optional()
        .describe('Restrict search to this JCR path, e.g. /content/mysite'),
      type: z
        .string()
        .optional()
        .describe('JCR node type filter, e.g. cq:Page, dam:Asset, nt:unstructured'),
      limit: z
        .number()
        .optional()
        .describe('Maximum number of results to return (default 20)'),
      offset: z
        .number()
        .optional()
        .describe('Number of results to skip for pagination (default 0)'),
      orderby: z
        .string()
        .optional()
        .describe('Property to sort results by, e.g. @jcr:created'),
    },
    async ({ fulltext, path, type, limit, offset, orderby }) => {
      try {
        const result = await searchContent({ fulltext, path, type, limit, offset, orderby });
        return textResult(result);
      } catch (err) {
        return errorResult(String(err));
      }
    }
  );

  // ─── Assets ────────────────────────────────────────────────────────────────

  server.tool(
    'aem_get_asset',
    'Get metadata and properties of a DAM asset at the specified path.',
    {
      asset_path: z
        .string()
        .describe('JCR path of the asset, e.g. /content/dam/mysite/images/photo.jpg'),
    },
    async ({ asset_path }) => {
      try {
        const result = await getAsset(asset_path);
        return textResult(result);
      } catch (err) {
        return errorResult(String(err));
      }
    }
  );

  server.tool(
    'aem_list_assets',
    'List all DAM assets inside a given folder path.',
    {
      folder_path: z
        .string()
        .describe('JCR path of the DAM folder, e.g. /content/dam/mysite/images'),
    },
    async ({ folder_path }) => {
      try {
        const result = await listAssets(folder_path);
        return textResult(result);
      } catch (err) {
        return errorResult(String(err));
      }
    }
  );

  server.tool(
    'aem_get_asset_renditions',
    'Get all available renditions (sizes/formats) for a DAM asset.',
    {
      asset_path: z
        .string()
        .describe('JCR path of the asset, e.g. /content/dam/mysite/images/photo.jpg'),
    },
    async ({ asset_path }) => {
      try {
        const result = await getAssetRenditions(asset_path);
        return textResult(result);
      } catch (err) {
        return errorResult(String(err));
      }
    }
  );

  // ─── Content Fragments ─────────────────────────────────────────────────────

  server.tool(
    'aem_get_content_fragment',
    'Get the content and metadata of an AEM Content Fragment at the specified path.',
    {
      fragment_path: z
        .string()
        .describe('JCR path of the content fragment, e.g. /content/dam/mysite/fragments/article-1'),
    },
    async ({ fragment_path }) => {
      try {
        const result = await getContentFragment(fragment_path);
        return textResult(result);
      } catch (err) {
        return errorResult(String(err));
      }
    }
  );

  server.tool(
    'aem_list_content_fragments',
    'List Content Fragments in a DAM folder, optionally filtered by Content Fragment Model.',
    {
      folder_path: z
        .string()
        .describe('JCR path of the DAM folder to search in, e.g. /content/dam/mysite/fragments'),
      model_path: z
        .string()
        .optional()
        .describe(
          'Optional path to the Content Fragment Model to filter by, e.g. /conf/mysite/settings/dam/cfm/models/article'
        ),
    },
    async ({ folder_path, model_path }) => {
      try {
        const result = await listContentFragments(folder_path, model_path);
        return textResult(result);
      } catch (err) {
        return errorResult(String(err));
      }
    }
  );

  server.tool(
    'aem_create_content_fragment',
    'Create a new Content Fragment in AEM DAM using a specified Content Fragment Model.',
    {
      parent_path: z
        .string()
        .describe('JCR path of the parent DAM folder, e.g. /content/dam/mysite/fragments'),
      name: z
        .string()
        .describe('URL-safe name for the new fragment, e.g. my-article'),
      model_path: z
        .string()
        .describe('Path to the Content Fragment Model, e.g. /conf/mysite/settings/dam/cfm/models/article'),
      title: z
        .string()
        .describe('Title of the content fragment'),
      description: z
        .string()
        .optional()
        .describe('Optional description of the content fragment'),
    },
    async ({ parent_path, name, model_path, title, description }) => {
      try {
        const result = await createContentFragment(parent_path, name, model_path, title, description);
        return textResult(result);
      } catch (err) {
        return errorResult(String(err));
      }
    }
  );

  server.tool(
    'aem_update_content_fragment',
    'Update the properties or field values of an existing AEM Content Fragment.',
    {
      fragment_path: z
        .string()
        .describe('JCR path of the content fragment, e.g. /content/dam/mysite/fragments/article-1'),
      properties: z
        .record(z.union([z.string(), z.array(z.string())]))
        .describe(
          'Key/value map of fragment properties to update. Values can be strings or arrays of strings for multi-value fields.'
        ),
    },
    async ({ fragment_path, properties }) => {
      try {
        const result = await updateContentFragment(fragment_path, properties);
        return textResult(result);
      } catch (err) {
        return errorResult(String(err));
      }
    }
  );
}
