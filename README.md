# kuzudb-mcp-server

A Model Context Protocol server that provides access to Kuzu databases. This server enables LLMs to inspect database schemas and execute queries on provided kuzu database.

## Quick Start

For quick testing and development:

```bash
# Install the package
npm install -g kuzudb-mcp-server
# or use pnpm/yarn

# Clone the repository for development
git clone https://github.com/jordanburke/kuzudb-mcp-server.git
cd kuzudb-mcp-server
pnpm install

# Quick test with auto-created database
pnpm serve:test              # stdio transport (default)
pnpm serve:test:http         # HTTP transport
pnpm serve:test:inspect      # HTTP with MCP Inspector

# Initialize databases manually
pnpm db:init                 # Create empty test database
pnpm db:init:movies          # Create database with movie data
```

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

### With Smithery

This server is available on [Smithery](https://smithery.ai) for easy installation:

```bash
# Install via Smithery CLI
smithery install kuzudb-mcp-server

# The server auto-initializes with a sample movies database
# No manual database setup required!
```

The Smithery version includes:
- Automatic database initialization with movies template
- No volume mounting required
- Ready-to-use graph database for testing and exploration

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

## Remote Connection (HTTP Transport)

The server supports both stdio (default) and HTTP transports, allowing remote connections and easier debugging.

### Docker Deployment (HTTP Server)

The easiest way to run the HTTP server is using Docker. Pre-built images are available from GitHub Container Registry:

```bash
# Pull the latest image
docker pull ghcr.io/jordanburke/kuzudb-mcp-server:latest

# Run with mounted database
docker run -d \
  -p 3000:3000 \
  -v /path/to/your/database:/database \
  -e KUZU_READ_ONLY=false \
  ghcr.io/jordanburke/kuzudb-mcp-server:latest

# Run with custom port and endpoint
docker run -d \
  -p 8080:8080 \
  -v /path/to/your/database:/database \
  -e PORT=8080 \
  ghcr.io/jordanburke/kuzudb-mcp-server:latest \
  node dist/index.js --transport http --port 8080 --endpoint /kuzu
```

#### Build Locally

```bash
# Build and run with docker-compose (auto-initializes database if needed)
docker-compose up -d

# The init container will:
# - Check if ./data directory contains a database
# - Initialize with movies template if empty
# - Skip initialization if database exists

# Or build manually
docker build -f Dockerfile.http -t kuzu-mcp-http .

# Run your local build
docker run -d \
  -p 3000:3000 \
  -v /path/to/your/database:/database \
  kuzu-mcp-http

# To use a different template or empty database, run init manually first:
docker-compose run kuzu-init node dist/index.js --init /database --template social
```

The HTTP server will be available at `http://localhost:3000/mcp` (or your custom endpoint).

### HTTP Server Mode

To run the server in HTTP mode:

```bash
# Command line
node dist/index.js /path/to/database --transport http --port 3000

# Using npm scripts (with test database)
pnpm serve:test:http
```

### Testing with MCP Inspector

The [MCP Inspector](https://github.com/modelcontextprotocol/inspector) is a web-based tool for testing and debugging MCP servers.

```bash
# Start server with inspector (automatically opens browser)
pnpm serve:test:inspect

# Or manually:
# 1. Start HTTP server
node dist/index.js /path/to/database --transport http

# 2. Open inspector
npx @modelcontextprotocol/inspector http://localhost:3000/mcp
```

### Remote Client Configuration

For applications supporting HTTP MCP connections:

```json
{
  "mcpServers": {
    "kuzu-remote": {
      "uri": "http://localhost:3000/mcp",
      "transport": "http"
    }
  }
}
```

### HTTP Server Options

- `--transport http` - Enable HTTP transport (default: stdio)
- `--port <number>` - HTTP server port (default: 3000)
- `--endpoint <path>` - Custom endpoint path (default: /mcp)

Example with custom options:
```bash
node dist/index.js /path/to/database --transport http --port 8080 --endpoint /kuzu
# Server will be available at http://localhost:8080/kuzu
```

### Multi-Agent Coordination (Experimental)

The server supports multi-agent coordination to allow multiple AI agents (e.g., Claude Desktop and Claude Code) to share the same Kuzu database safely. This feature addresses Kuzu's single-writer limitation through transparent file-based locking.

#### Enabling Multi-Agent Mode

Set the following environment variables in your configuration:

- `KUZU_MULTI_AGENT=true` - Enable multi-agent coordination
- `KUZU_AGENT_ID=string` - Unique identifier for the agent (e.g., "claude-desktop", "claude-code")
- `KUZU_LOCK_TIMEOUT=number` - Lock timeout in milliseconds (default: 10000)

#### Claude Desktop Configuration
```json
{
    "mcpServers": {
        "kuzu": {
            "command": "npx",
            "args": ["kuzudb-mcp-server", "/path/to/database"],
            "env": {
                "KUZU_MULTI_AGENT": "true",
                "KUZU_AGENT_ID": "claude-desktop"
            }
        }
    }
}
```

#### Claude Code Configuration
```json
{
    "mcpServers": {
        "kuzu": {
            "command": "npx",
            "args": ["kuzudb-mcp-server", "/path/to/database"],
            "env": {
                "KUZU_MULTI_AGENT": "true",
                "KUZU_AGENT_ID": "claude-code"
            }
        }
    }
}
```

#### How It Works

When multi-agent mode is enabled:
- Read queries execute immediately without coordination
- Write queries (CREATE, MERGE, SET, DELETE, etc.) acquire an exclusive lock
- Locks are automatically released after query completion
- Stale locks from crashed processes are detected and cleaned up
- Lock conflicts result in clear error messages with retry suggestions

#### Important Notes

- This feature is experimental and designed for local development scenarios
- Both agents must point to the same database path
- The lock file (`.mcp_write_lock`) is created in the database directory
- Lock timeout defaults to 10 seconds, which covers most operations

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

## Documentation

### Core Features
- **[Connection Recovery](./docs/connection-recovery.md)** - Automatic connection recovery, retry logic, and error handling
- **[Multi-Agent Coordination](./docs/Multi-Agent%20Coordination%20Design%20for%20kuzudb-mcp-server.md)** - Safe concurrent access with file-based locking
- **[Batch Query Improvements](./docs/batch-query-improvements.md)** - Enhanced DDL and multi-statement query handling

### Bug Workarounds
- **[Kuzu Bug Workarounds](./kuzu-bug-report/KUZU_BUG_WORKAROUNDS.md)** - Temporary fixes for known Kuzu issues

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `KUZU_READ_ONLY` | Enable read-only mode | `false` |
| `KUZU_MAX_RETRIES` | Connection recovery retry attempts | `2` |
| `KUZU_MULTI_AGENT` | Enable multi-agent coordination | `false` |
| `KUZU_AGENT_ID` | Unique agent identifier | `unknown-{pid}` |
| `KUZU_LOCK_TIMEOUT` | Lock acquisition timeout (ms) | `10000` |
| `KUZU_MCP_DATABASE_PATH` | Database path if not provided as argument | - |
