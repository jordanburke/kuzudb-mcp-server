# kuzudb-mcp-server

A Model Context Protocol server that provides access to Kuzu databases. This server enables LLMs to inspect database schemas and execute queries on provided kuzu database.

## Components
### Tools 
- getSchema
  -  Fetch the full schema of the Kuzu database, including all nodes and relationships tables and their properties
  -  Input: None

- query
  - Run a Cypher query on the Kuzu database
  - Input: `cypher` (string): The Cypher query to run

### Prompt
- generateKuzuCypher
  - Generate a Cypher query for Kuzu
  - Argument: `question` (string): The question in natural language to generate the Cypher query for

## Usage with Claude Desktop
### With Docker (Recommended)
- Edit the configuration file `config.json`:
  - on macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
  - on Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Add the following configuration to the `mcpServers` object:
  ```json
  {
    "mcpServers": {
        "kuzu": {
            "command": "docker",
            "args": [
                "run",
                "-v",
                "{Absolute Path to the Kuzu database}:/database",
                "--rm",
                "-i",
                "kuzudb/mcp-server"
            ]
        }
    }
  }
  ```
  Change the `{Absolute Path to the Kuzu database}` to the actual path
- Restart Claude Desktop

### With npm/npx
- Install globally: `npm install -g kuzudb-mcp-server`
- Or use directly with npx: `npx kuzudb-mcp-server`
- Edit the configuration file `config.json`:
  - on macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
  - on Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Add the following configuration to the `mcpServers` object:
  ```json
  {
    "mcpServers": {
        "kuzu": {
            "command": "npx",
            "args": [
                "kuzudb-mcp-server",
                "{Absolute Path to the Kuzu database}"
            ]
        }
    }
  }
  ```
  Change the `{Absolute Path to the Kuzu database}` to the actual path
- Restart Claude Desktop

### Using Environment Variables
You can also specify the database path using the `KUZU_MCP_DATABASE_PATH` environment variable instead of passing it as an argument:

```json
{
    "mcpServers": {
        "kuzu": {
            "command": "npx",
            "args": ["kuzudb-mcp-server"],
            "env": {
                "KUZU_MCP_DATABASE_PATH": "{Absolute Path to the Kuzu database}"
            }
        }
    }
}
```

Alternatively, if you have `KUZU_MCP_DATABASE_PATH` set in your system environment, the server will automatically use it when no database path argument is provided.

### Read-Only Mode
The server can be run in read-only mode by setting the `KUZU_READ_ONLY` environment variable to `true`. In this mode, running any query that attempts to modify the database will result in an error. This flag can be set in the configuration file as follows:

#### With npm/npx:
```json
{
    "mcpServers": {
        "kuzu": {
            "command": "npx",
            "args": [
                "kuzudb-mcp-server",
                "{Absolute Path to the Kuzu database}"
            ],
            "env": {
                "KUZU_READ_ONLY": "true"
            }
        }
    }
}
```

#### With Docker:
```json
{
    "mcpServers": {
        "kuzu": {
            "command": "docker",
            "args": [
                "run",
                "-v",
                "{Absolute Path to the Kuzu database}:/database",
                "-e",
                "KUZU_READ_ONLY=true",
                "--rm",
                "-i",
                "kuzudb/mcp-server"
            ]
        }
    }
}
```

## Development

To build from source:

```bash
# Clone the repository
git clone https://github.com/jordanburke/kuzudb-mcp-server.git
cd kuzudb-mcp-server

# Install dependencies
pnpm install

# Build the project
pnpm run build

# Run development mode with watch
pnpm run dev

# Run tests and linting
pnpm run lint
pnpm run typecheck
pnpm run format:check
```

For local development, you can also configure Claude Desktop to use the local build:

```json
{
    "mcpServers": {
        "kuzu": {
            "command": "node",
            "args": [
                "/path/to/kuzudb-mcp-server/dist/index.js",
                "/path/to/kuzu/database"
            ]
        }
    }
}
```
