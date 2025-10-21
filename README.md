# kuzudb-mcp-server

> **⚠️ ARCHIVED**: This project is archived as the Kuzu database repository was archived on October 10, 2025. See [ARCHIVE_NOTICE.md](./ARCHIVE_NOTICE.md) for details and alternatives.

---

A Model Context Protocol server that provides access to Kuzu graph databases. This server enables LLMs to inspect database schemas and execute queries with robust connection recovery, multi-agent coordination, and a built-in web interface.

## Archive Status

**Archived** - October 21, 2025

The Kuzu graph database repository was archived by its maintainers on October 10, 2025 and is now read-only. As Kuzu is no longer actively maintained, this MCP server is also being archived. The project remains fully functional with Kuzu v1.4.1-r.4. See [ARCHIVE_NOTICE.md](./ARCHIVE_NOTICE.md) for full details, technical achievements, and alternative graph database options.

## 🚀 Key Features

- **📊 Web UI**: Built-in database management interface with backup/restore capabilities
- **🔐 Authentication**: OAuth and Basic Auth support for secure access
- **🤝 Multi-Agent**: Safe concurrent access from multiple AI agents (experimental)
- **🔄 Auto-Recovery**: Automatic connection recovery with exponential backoff
- **🐳 Docker Ready**: Pre-built images and docker-compose workflow
- **📱 Dual Transport**: Both stdio and HTTP transport modes
- **🧠 AI-Powered**: Natural language to Cypher query generation

## Quick Start

### Install and Test
```bash
# Install globally
npm install -g kuzudb-mcp-server

# Quick test with auto-created database
pnpm serve:test              # stdio transport (default)
pnpm serve:test:http         # HTTP transport with Web UI
pnpm serve:test:inspect      # HTTP with MCP Inspector

# Server management
pnpm kill    # Stop running servers
pnpm restart # Restart with HTTP transport
```

### Development Setup
```bash
# Clone and setup
git clone https://github.com/jordanburke/kuzudb-mcp-server.git
cd kuzudb-mcp-server
pnpm install

# Initialize databases
pnpm db:init                 # Empty test database
pnpm db:init:movies          # Sample movie data
```

### One-Line Docker Setup
```bash
# Pull and run with mounted database
docker run -d -p 3000:3000 -p 3001:3001 \
  -v /path/to/your/database:/database \
  ghcr.io/jordanburke/kuzudb-mcp-server:latest

# Access Web UI at http://localhost:3001/admin
# MCP endpoint at http://localhost:3000/mcp
```

## Components

### Tools
- **getSchema** - Fetch complete database schema (nodes, relationships, properties)
- **query** - Execute Cypher queries with automatic error recovery

### Prompts  
- **generateKuzuCypher** - Convert natural language to Kuzu-specific Cypher queries

## 🖥️ Web UI for Database Management

The server includes a powerful web interface that automatically starts with HTTP transport.

### Features
- **📁 Database Backup & Restore**: Download `.kuzu` backups and restore from browser
- **📤 Direct File Upload**: Upload existing Kuzu database files (main + .wal)
- **📊 Database Info**: View path, mode, connection status, and schema statistics
- **🔒 Secure Access**: Optional authentication protection
- **👁️ Read-Only Support**: Upload/restore disabled in read-only mode

### Quick Access
```bash
# Start with Web UI (auto-enabled with HTTP)
pnpm serve:test:http

# Access Web UI
open http://localhost:3001/admin
```

### Docker with Web UI
```bash
# Using docker-compose (recommended)
docker-compose up -d
open http://localhost:3001/admin

# Manual Docker with Web UI
docker run -d \
  -p 3000:3000 -p 3001:3001 \
  -v /path/to/database:/database \
  -e KUZU_WEB_UI_AUTH_USER=admin \
  -e KUZU_WEB_UI_AUTH_PASSWORD=changeme \
  ghcr.io/jordanburke/kuzudb-mcp-server:latest
```

### API Endpoints
- `/admin` - Main web interface
- `/health` - Health check endpoint  
- `/api/info` - Database information (JSON)
- `/api/backup` - Download database backup
- `/api/restore` - Upload and restore database

## 🔐 Authentication & Security

The server supports two authentication methods for different use cases:

### OAuth (Production Recommended)
Best for production deployments with token-based security:

```bash
# Testing OAuth locally
pnpm serve:test:http:oauth     # admin/secret123
pnpm serve:test:inspect:oauth  # With MCP Inspector

# Production OAuth setup
KUZU_OAUTH_ENABLED=true \
KUZU_OAUTH_USERNAME=admin \
KUZU_OAUTH_PASSWORD=your-secure-password \
KUZU_OAUTH_USER_ID=admin-user \
KUZU_OAUTH_EMAIL=admin@example.com \
KUZU_JWT_EXPIRES_IN=31536000 \
node dist/index.js /path/to/database --transport http
```

### Basic Auth (Development/Testing)
Simpler setup for development and testing:

```bash
# Testing Basic Auth locally  
pnpm serve:test:http:basic     # admin/secret123
pnpm serve:test:inspect:basic  # With MCP Inspector

# Production Basic Auth setup
KUZU_BASIC_AUTH_USERNAME=admin \
KUZU_BASIC_AUTH_PASSWORD=your-secure-password \
KUZU_BASIC_AUTH_USER_ID=admin-user \
KUZU_BASIC_AUTH_EMAIL=admin@example.com \
node dist/index.js /path/to/database --transport http
```

### Web UI Authentication
Secure the Web UI interface:

```bash
# Add Web UI authentication
KUZU_WEB_UI_AUTH_USER=admin \
KUZU_WEB_UI_AUTH_PASSWORD=changeme \
node dist/index.js /path/to/database --transport http
```

### JWT Token Configuration
Configure JWT token lifetime (OAuth mode only):

```bash
# Set token expiration in seconds (default: 31536000 = 1 year)
KUZU_JWT_EXPIRES_IN=3600    # 1 hour
KUZU_JWT_EXPIRES_IN=86400   # 24 hours
KUZU_JWT_EXPIRES_IN=2592000 # 30 days
```

### Security Recommendations
- **Always use authentication** for production deployments
- **Use OAuth** for external-facing servers
- **Use Basic Auth** for internal development/testing
- **Enable Web UI auth** when exposing the interface
- **Use HTTPS** in production environments
- **Configure JWT expiration** based on your security requirements

## Usage with Claude Desktop

### Docker (Recommended)
```json
{
  "mcpServers": {
    "kuzu": {
      "command": "docker",
      "args": [
        "run", "-v", "/path/to/database:/database",
        "--rm", "-i", "ghcr.io/jordanburke/kuzudb-mcp-server:latest"
      ]
    }
  }
}
```

### npm/npx
```json
{
  "mcpServers": {
    "kuzu": {
      "command": "npx",
      "args": ["kuzudb-mcp-server", "/path/to/database"]
    }
  }
}
```

### Smithery (Easiest)
```bash
# Install via Smithery - includes sample database
smithery install kuzudb-mcp-server
```

### Environment Variables
```json
{
  "mcpServers": {
    "kuzu": {
      "command": "npx",
      "args": ["kuzudb-mcp-server"],
      "env": {
        "KUZU_MCP_DATABASE_PATH": "/path/to/database",
        "KUZU_READ_ONLY": "true"
      }
    }
  }
}
```

## 🌐 Remote Connection (HTTP Transport)

### Pre-built Docker Images
```bash
# Pull latest image
docker pull ghcr.io/jordanburke/kuzudb-mcp-server:latest

# Run with custom configuration
docker run -d \
  -p 3000:3000 -p 3001:3001 \
  -v /path/to/database:/database \
  -e KUZU_READ_ONLY=false \
  ghcr.io/jordanburke/kuzudb-mcp-server:latest
```

### Local Development
```bash
# HTTP server mode
node dist/index.js /path/to/database --transport http --port 3000

# With custom endpoint
node dist/index.js /path/to/database --transport http --port 8080 --endpoint /kuzu
```

### MCP Inspector Testing
```bash
# Auto-start inspector
pnpm serve:test:inspect

# Manual setup
node dist/index.js /path/to/database --transport http
npx @modelcontextprotocol/inspector http://localhost:3000/mcp
```

### Remote Client Configuration
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

## 🤝 Multi-Agent Coordination (Experimental)

Enable safe concurrent access from multiple AI agents (e.g., Claude Desktop + Claude Code):

### Configuration
```json
{
  "mcpServers": {
    "kuzu": {
      "command": "npx",
      "args": ["kuzudb-mcp-server", "/path/to/database"],
      "env": {
        "KUZU_MULTI_AGENT": "true",
        "KUZU_AGENT_ID": "claude-desktop",
        "KUZU_LOCK_TIMEOUT": "10000"
      }
    }
  }
}
```

### How It Works
- **Read queries**: Execute immediately without coordination
- **Write queries**: Acquire exclusive file-based locks
- **Auto cleanup**: Stale locks detected and removed
- **Clear errors**: Lock conflicts return helpful retry messages

### Important Notes
- Experimental feature for local development
- Both agents must use the same database path
- Lock files created in database directory
- 10-second default timeout covers most operations

## 🛠️ Development

### Build and Test
```bash
# Install dependencies
pnpm install

# Build project
pnpm build

# Development with watch
pnpm dev

# Run tests
pnpm test
pnpm test:ui
pnpm test:coverage

# Linting and formatting
pnpm lint
pnpm typecheck
pnpm format:check
```

### Local Claude Desktop Setup
```json
{
  "mcpServers": {
    "kuzu": {
      "command": "node",
      "args": [
        "/path/to/kuzudb-mcp-server/dist/index.js",
        "/path/to/database"
      ]
    }
  }
}
```

## 🔧 Environment Variables Reference

| Variable | Description | Default | Usage |
|----------|-------------|---------|-------|
| **Database** |
| `KUZU_MCP_DATABASE_PATH` | Database path if not in args | - | Startup |
| `KUZU_READ_ONLY` | Enable read-only mode | `false` | Security |
| **Connection** |
| `KUZU_MAX_RETRIES` | Connection recovery attempts | `2` | Reliability |
| **Multi-Agent** |
| `KUZU_MULTI_AGENT` | Enable coordination | `false` | Concurrency |
| `KUZU_AGENT_ID` | Unique agent identifier | `unknown-{pid}` | Locking |
| `KUZU_LOCK_TIMEOUT` | Lock timeout (ms) | `10000` | Performance |
| **Web UI** |
| `KUZU_WEB_UI_ENABLED` | Enable/disable Web UI | `true` | Interface |
| `KUZU_WEB_UI_PORT` | Web UI port | `3001` | Network |
| `KUZU_WEB_UI_AUTH_USER` | Web UI username | - | Security |
| `KUZU_WEB_UI_AUTH_PASSWORD` | Web UI password | - | Security |
| **Authentication** |
| `KUZU_OAUTH_ENABLED` | Enable OAuth | `false` | Security |
| `KUZU_OAUTH_USERNAME` | OAuth username | - | Auth |
| `KUZU_OAUTH_PASSWORD` | OAuth password | - | Auth |
| `KUZU_BASIC_AUTH_USERNAME` | Basic Auth username | - | Auth |
| `KUZU_BASIC_AUTH_PASSWORD` | Basic Auth password | - | Auth |

## 🔍 Troubleshooting

### Connection Issues
- **"Database connection could not be restored"** → Check database file exists and permissions
- **"getAll timeout"** → DDL operation hung, server will auto-recover
- **Lock timeout** → Another agent writing, wait and retry

### Web UI Issues  
- **404 on /admin** → Ensure HTTP transport mode is enabled
- **Authentication failing** → Check `KUZU_WEB_UI_AUTH_*` variables
- **Port conflicts** → Change `KUZU_WEB_UI_PORT` or `PORT`

### Docker Issues
- **Health check failing** → Verify database mount and port availability
- **Permission errors** → Check volume mount permissions
- **Database not found** → Ensure correct path mapping

### Performance Notes
Based on testing:
- **Simple queries**: < 100ms response time
- **Complex multi-hop**: 200-500ms response time  
- **Schema retrieval**: ~100-200ms response time
- **AI query generation**: 1-3 seconds (normal for LLM processing)

## 📚 Documentation

### Core Features
- **[Connection Recovery](./docs/connection-recovery.md)** - Automatic recovery and retry logic
- **[Multi-Agent Coordination](./docs/Multi-Agent%20Coordination%20Design%20for%20kuzudb-mcp-server.md)** - Concurrent access design
- **[Batch Query Improvements](./docs/batch-query-improvements.md)** - DDL and multi-statement handling

### Bug Workarounds
- **[Kuzu Bug Workarounds](./kuzu-bug-report/KUZU_BUG_WORKAROUNDS.md)** - Known issue fixes

---

**Repository**: [github.com/jordanburke/kuzudb-mcp-server](https://github.com/jordanburke/kuzudb-mcp-server)  
**Docker Images**: [ghcr.io/jordanburke/kuzudb-mcp-server](https://github.com/jordanburke/kuzudb-mcp-server/pkgs/container/kuzudb-mcp-server)  
**Package**: [npmjs.com/package/kuzudb-mcp-server](https://www.npmjs.com/package/kuzudb-mcp-server)