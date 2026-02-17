# AEM MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that connects Claude AI to Adobe Experience Manager (AEM), enabling natural language content operations.

## Features

**Pages**
- Get page content and properties
- List child pages
- Create pages from templates
- Update page properties (title, description, tags, etc.)
- Delete pages
- Activate/deactivate (publish/unpublish) pages

**Search**
- Full-text search using AEM QueryBuilder
- Filter by path, node type, and custom properties

**Assets (DAM)**
- Get asset metadata
- List assets in a folder
- Get available asset renditions

**Content Fragments**
- Get and list content fragments
- Create content fragments from models
- Update content fragment fields

## Prerequisites

- Node.js 18 or later
- AEM Author instance (local or AEM as a Cloud Service)

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your AEM connection details:

**Local / Dev instance (basic auth):**
```env
AEM_BASE_URL=http://localhost:4502
AEM_AUTH_TYPE=basic
AEM_USERNAME=admin
AEM_PASSWORD=admin
```

**AEM as a Cloud Service (token auth):**
```env
AEM_BASE_URL=https://author-pXXXXX-eYYYYYY.adobeaemcloud.com
AEM_AUTH_TYPE=token
AEM_ACCESS_TOKEN=<your-ims-access-token>
```

To obtain an IMS access token for AEM Cloud Service:
1. Go to [Adobe Developer Console](https://developer.adobe.com/console)
2. Create a project and add the **AEM as a Cloud Service** API
3. Use the **Service Account (JWT)** credentials to generate an access token
4. Paste the bearer token value into `AEM_ACCESS_TOKEN`

### 3. Build

```bash
npm run build
```

### 4. Register with Claude

Add the server to your Claude configuration file:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "aem": {
      "command": "node",
      "args": ["/absolute/path/to/aem-mcp/dist/index.js"]
    }
  }
}
```

Restart Claude Desktop after saving the configuration.

## Available Tools

| Tool | Description |
|------|-------------|
| `aem_get_page` | Get page content and properties by JCR path |
| `aem_list_pages` | List child pages under a parent path |
| `aem_create_page` | Create a new page from a template |
| `aem_update_page` | Update page JCR properties |
| `aem_delete_page` | Delete a page (with optional force) |
| `aem_replicate_page` | Publish or unpublish a page |
| `aem_search` | Full-text and filtered content search |
| `aem_get_asset` | Get DAM asset metadata |
| `aem_list_assets` | List assets in a DAM folder |
| `aem_get_asset_renditions` | List renditions available for an asset |
| `aem_get_content_fragment` | Get a content fragment by path |
| `aem_list_content_fragments` | List content fragments in a folder |
| `aem_create_content_fragment` | Create a new content fragment |
| `aem_update_content_fragment` | Update content fragment fields |

## Example Prompts

Once connected, you can ask Claude things like:

- *"Show me all pages under /content/mysite/en"*
- *"Create a new page called 'About Us' at /content/mysite/en using the content-page template"*
- *"Search for pages that mention 'sustainability' in /content/mysite"*
- *"List all assets in /content/dam/mysite/images"*
- *"Get the content fragment at /content/dam/mysite/fragments/article-1"*
- *"Publish the page at /content/mysite/en/home"*

## Development

Run TypeScript compiler in watch mode:

```bash
npm run dev
```

## Project Structure

```
aem-mcp/
├── src/
│   ├── index.ts        # MCP server entry point (stdio transport)
│   ├── aem-client.ts   # AEM REST API client with auth support
│   └── tools.ts        # Claude tool definitions and handlers
├── .env.example        # Environment variable template
├── package.json
└── tsconfig.json
```
