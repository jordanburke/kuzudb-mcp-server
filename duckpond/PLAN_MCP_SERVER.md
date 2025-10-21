/# DuckPond MCP Server Implementation Plan

## Overview

Create an MCP (Model Context Protocol) server that exposes DuckPond's multi-tenant DuckDB capabilities to AI agents. The server will enable agents to manage per-user databases, execute SQL queries, and leverage R2/S3 cloud storage through a standardized MCP interface.

## Key Insight: Library-First Approach

**YES - Having the DuckPond library built fundamentally changes the MCP implementation:**

### What's Already Done ✅
- Core multi-tenant database management (DuckPond class)
- Functional error handling with `Either<DuckPondError, T>`
- LRU caching with automatic eviction
- R2/S3 cloud storage integration
- Type-safe API with comprehensive TypeScript types
- 14/14 tests passing
- Production-ready build (ESM + CJS + types)

### New Focus: Thin Transport Layer
The MCP server becomes a **thin wrapper** that:
- Exposes DuckPond methods as MCP tools
- Handles stdio/HTTP transport modes
- Manages authentication and authorization
- Provides multi-agent coordination
- Includes web UI for database management

**Estimated effort: 2-3 days vs 2-3 weeks without the library**

## Architecture

```
┌─────────────┐     ┌──────────────┐
│ stdio Mode  │     │  HTTP Mode   │
│ (index.ts)  │     │(FastMCP/3000)│
└──────┬──────┘     └──────┬───────┘
       │                   │
       └───────┬───────────┘
               │
       ┌───────▼────────┐
       │ MCP Tool Layer │
       │ - query        │
       │ - execute      │
       │ - getUserStats │
       │ - detachUser   │
       └───────┬────────┘
               │
       ┌───────▼────────┐
       │    DuckPond    │  ← npm: duckpond@^0.1.0
       │ - Multi-tenant │
       │ - LRU Cache    │
       │ - R2/S3        │
       │ - Either<E,T>  │
       └───────┬────────┘
               │
       ┌───────▼────────┐
       │ DuckDB + Cloud │
       └────────────────┘
```

## MCP Tools Design

### 1. `query` - Execute SQL Query
Execute a SQL query for a specific user and return results.

**Input Schema (Zod)**:
```typescript
{
  userId: z.string().min(1).describe("User identifier"),
  sql: z.string().min(1).describe("SQL query to execute")
}
```

**Output**:
```typescript
{
  rows: T[],              // Query results as array of objects
  rowCount: number,       // Number of rows returned
  executionTime: number   // Query execution time in ms
}
```

**Error Mapping**:
- `NOT_INITIALIZED` → "DuckPond not initialized"
- `QUERY_EXECUTION_ERROR` → Include SQL and error context
- `USER_NOT_FOUND` → "User database not found"
- `MEMORY_LIMIT_EXCEEDED` → Include memory limit info

### 2. `execute` - Execute DDL/DML
Execute SQL without returning results (CREATE, INSERT, UPDATE, DELETE).

**Input Schema**:
```typescript
{
  userId: z.string().min(1).describe("User identifier"),
  sql: z.string().min(1).describe("SQL statement to execute")
}
```

**Output**:
```typescript
{
  success: boolean,
  message: string,
  executionTime: number
}
```

### 3. `getUserStats` - Get User Statistics
Retrieve statistics about a user's database.

**Input Schema**:
```typescript
{
  userId: z.string().min(1).describe("User identifier")
}
```

**Output**:
```typescript
{
  userId: string,
  attached: boolean,        // Is user currently cached?
  lastAccess: string,       // ISO 8601 timestamp
  memoryUsage: number,      // Bytes
  storageUsage: number,     // Bytes
  queryCount: number
}
```

### 4. `detachUser` - Manual Cache Eviction
Manually detach a user's database from the cache.

**Input Schema**:
```typescript
{
  userId: z.string().min(1).describe("User identifier")
}
```

**Output**:
```typescript
{
  success: boolean,
  message: string
}
```

### 5. `isAttached` - Check Cache Status
Check if a user's database is currently cached.

**Input Schema**:
```typescript
{
  userId: z.string().min(1).describe("User identifier")
}
```

**Output**:
```typescript
{
  attached: boolean,
  userId: string
}
```

### 6. `listUsers` - List Cached Users
Get list of all currently cached users.

**Input Schema**: None

**Output**:
```typescript
{
  users: string[],
  count: number,
  maxActiveUsers: number,
  utilizationPercent: number
}
```

## Implementation Details

### Project Setup

**Package Name**: `duckpond-mcp-server`

**Dependencies**:
```json
{
  "dependencies": {
    "duckpond": "^0.1.0",
    "@modelcontextprotocol/sdk": "^1.0.0",
    "fastmcp": "^1.0.0",
    "zod": "^3.22.0",
    "debug": "^4.4.3"
  },
  "devDependencies": {
    "@types/node": "^22.18.11",
    "typescript": "^5.9.3",
    "vitest": "^3.2.4",
    "tsup": "^8.5.0"
  }
}
```

**Scripts**:
```json
{
  "scripts": {
    "validate": "pnpm format && pnpm lint && pnpm test && pnpm build",
    "build": "tsup",
    "dev": "tsup --watch",
    "test": "vitest run",
    "serve:test": "tsx src/index.ts ./test-db",
    "serve:test:http": "tsx src/index.ts ./test-db --transport http"
  }
}
```

### Core Modules

#### 1. `src/index.ts` - CLI Entry Point
```typescript
import { Command } from 'commander'
import { startStdioServer } from './server-stdio'
import { startHttpServer } from './server-fastmcp'

const program = new Command()
  .argument('[database-path]', 'Database path (or use env DUCKPOND_DATABASE_PATH)')
  .option('-t, --transport <type>', 'Transport mode: stdio or http', 'stdio')
  .option('-p, --port <port>', 'HTTP port', '3000')

// Parse and start appropriate server
```

#### 2. `src/server-core.ts` - DuckPond Instance Management
```typescript
import { DuckPond } from 'duckpond'
import { Either } from 'duckpond'

export class DuckPondServer {
  private pond: DuckPond | null = null

  async init(config: DuckPondConfig): Promise<Either<Error, void>> {
    this.pond = new DuckPond(config)
    return await this.pond.init()
  }

  // Wrapper methods that convert Either to MCP responses
  async query<T>(userId: string, sql: string): Promise<MCPResult<T[]>>
  async execute(userId: string, sql: string): Promise<MCPResult<void>>
  async getUserStats(userId: string): Promise<MCPResult<UserStats>>
  async detachUser(userId: string): Promise<MCPResult<void>>
  async isAttached(userId: string): Promise<MCPResult<boolean>>
}
```

#### 3. `src/server-stdio.ts` - stdio Transport
```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { registerTools } from './tools'

export async function startStdioServer(config: DuckPondConfig) {
  const server = new Server({ name: 'duckpond', version: '1.0.0' })
  const duckpond = new DuckPondServer()

  await duckpond.init(config)
  registerTools(server, duckpond)

  const transport = new StdioServerTransport()
  await server.connect(transport)
}
```

#### 4. `src/server-fastmcp.ts` - HTTP Transport
```typescript
import { FastMCP } from 'fastmcp'
import { DuckPondServer } from './server-core'

export async function startHttpServer(config: DuckPondConfig, port: number) {
  const mcp = new FastMCP({ name: 'duckpond' })
  const duckpond = new DuckPondServer()

  await duckpond.init(config)

  // Register tools with FastMCP
  mcp.tool('query', querySchema, async (input) => {
    const result = await duckpond.query(input.userId, input.sql)
    return handleEitherResult(result)
  })

  // OAuth and Basic Auth setup
  if (process.env.DUCKPOND_OAUTH_ENABLED) {
    mcp.useOAuth(/* config */)
  }

  await mcp.listen(port)
}
```

#### 5. `src/tools/index.ts` - Tool Registration
```typescript
import { z } from 'zod'
import type { Server } from '@modelcontextprotocol/sdk/server/index.js'

export function registerTools(server: Server, duckpond: DuckPondServer) {
  server.tool('query', querySchema, async (input) => {
    return handleEitherResult(await duckpond.query(input.userId, input.sql))
  })

  server.tool('execute', executeSchema, async (input) => {
    return handleEitherResult(await duckpond.execute(input.userId, input.sql))
  })

  // ... other tools
}

function handleEitherResult<T>(result: Either<DuckPondError, T>): MCPResult<T> {
  return result.fold(
    error => ({ error: formatError(error) }),
    value => ({ success: true, data: value })
  )
}
```

#### 6. `src/lock-manager.ts` - Multi-Agent Coordination
```typescript
import fs from 'fs/promises'
import path from 'path'

export class LockManager {
  private lockDir: string
  private agentId: string

  async acquireWriteLock(userId: string, timeout: number): Promise<Either<Error, void>> {
    const lockFile = path.join(this.lockDir, `.mcp_write_lock_${userId}`)
    // File-based locking with stale lock detection
  }

  async releaseWriteLock(userId: string): Promise<void> {
    // Remove lock file
  }

  private async cleanStaleLocks(): Promise<void> {
    // Remove locks older than 30 seconds
  }
}
```

#### 7. `src/web-ui/index.ts` - Management Interface
```typescript
import express from 'express'
import { DuckPondServer } from '../server-core'

export function createWebUI(duckpond: DuckPondServer, port: number) {
  const app = express()

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', version: '1.0.0' })
  })

  app.get('/api/users', async (req, res) => {
    // List cached users
  })

  app.post('/api/backup/:userId', async (req, res) => {
    // Backup user database
  })

  app.post('/api/restore/:userId', async (req, res) => {
    // Restore user database
  })

  app.listen(port)
}
```

### Environment Variables

| Variable | Description | Default | Example |
|----------|-------------|---------|---------|
| `DUCKPOND_R2_ACCOUNT_ID` | Cloudflare R2 account ID | - | `abc123` |
| `DUCKPOND_R2_ACCESS_KEY_ID` | R2 access key | - | `key123` |
| `DUCKPOND_R2_SECRET_ACCESS_KEY` | R2 secret key | - | `secret123` |
| `DUCKPOND_R2_BUCKET` | R2 bucket name | - | `my-bucket` |
| `DUCKPOND_S3_REGION` | AWS S3 region | - | `us-east-1` |
| `DUCKPOND_S3_ACCESS_KEY_ID` | S3 access key | - | `AKIA...` |
| `DUCKPOND_S3_SECRET_ACCESS_KEY` | S3 secret key | - | `secret...` |
| `DUCKPOND_S3_BUCKET` | S3 bucket name | - | `my-bucket` |
| `DUCKPOND_S3_ENDPOINT` | S3 endpoint (for MinIO) | - | `http://localhost:9000` |
| `DUCKPOND_MEMORY_LIMIT` | DuckDB memory limit | `4GB` | `8GB` |
| `DUCKPOND_THREADS` | Number of threads | `4` | `8` |
| `DUCKPOND_MAX_ACTIVE_USERS` | LRU cache size | `10` | `50` |
| `DUCKPOND_EVICTION_TIMEOUT` | Idle timeout (ms) | `300000` | `600000` |
| `DUCKPOND_CACHE_TYPE` | DuckDB cache type | `disk` | `memory` |
| `DUCKPOND_STRATEGY` | Storage strategy | `parquet` | `duckdb` |
| `DUCKPOND_OAUTH_ENABLED` | Enable OAuth | `false` | `true` |
| `DUCKPOND_BASIC_AUTH_USERNAME` | Basic auth username | - | `admin` |
| `DUCKPOND_BASIC_AUTH_PASSWORD` | Basic auth password | - | `secret123` |
| `DUCKPOND_MULTI_AGENT` | Enable multi-agent locking | `false` | `true` |
| `DUCKPOND_AGENT_ID` | Unique agent identifier | `unknown-{pid}` | `agent-1` |
| `DUCKPOND_LOCK_TIMEOUT` | Lock acquisition timeout (ms) | `10000` | `30000` |
| `DUCKPOND_WEB_UI_ENABLED` | Enable web UI | `true` | `false` |
| `DUCKPOND_WEB_UI_PORT` | Web UI port | `3001` | `8080` |

## Error Handling Strategy

Convert DuckPond's `Either<DuckPondError, T>` to MCP-friendly responses:

```typescript
function formatError(error: DuckPondError): MCPError {
  return {
    code: mapErrorCode(error.code),
    message: error.message,
    details: {
      originalCode: error.code,
      context: error.context,
      cause: error.cause?.message
    }
  }
}

function mapErrorCode(code: ErrorCode): string {
  switch (code) {
    case ErrorCode.NOT_INITIALIZED:
      return 'SERVICE_UNAVAILABLE'
    case ErrorCode.USER_NOT_FOUND:
      return 'NOT_FOUND'
    case ErrorCode.QUERY_EXECUTION_ERROR:
      return 'INVALID_REQUEST'
    case ErrorCode.MEMORY_LIMIT_EXCEEDED:
      return 'RESOURCE_EXHAUSTED'
    // ... other mappings
  }
}
```

## Testing Strategy

### Unit Tests
- `tools/query.test.ts` - Query tool with mocked DuckPond
- `tools/execute.test.ts` - Execute tool with mocked DuckPond
- `tools/stats.test.ts` - Stats tools with mocked DuckPond
- `error-handling.test.ts` - Error mapping tests
- `lock-manager.test.ts` - Multi-agent coordination

### Integration Tests
- `integration/stdio.test.ts` - stdio transport end-to-end
- `integration/http.test.ts` - HTTP transport end-to-end
- `integration/auth.test.ts` - OAuth and Basic Auth
- `integration/multi-tenant.test.ts` - Multiple users simultaneously

### Test Utilities
```typescript
// test/helpers.ts
export function createTestDuckPond(): DuckPond {
  return new DuckPond({
    memoryLimit: '1GB',
    maxActiveUsers: 5,
    // No R2/S3 for tests - uses in-memory only
  })
}

export async function setupTestUser(pond: DuckPond, userId: string) {
  await pond.execute(userId, 'CREATE TABLE test (id INT, name VARCHAR)')
}
```

## Documentation

### README.md Structure
1. Overview and features
2. Installation (npm, npx, Docker)
3. Quick start with Claude Desktop
4. Configuration guide
5. Available MCP tools
6. Authentication setup
7. Multi-agent coordination
8. Web UI access
9. Troubleshooting

### CLAUDE.md Structure
1. Project overview
2. Development commands
3. Architecture breakdown
4. MCP tools implementation details
5. Error handling patterns
6. Testing strategy
7. Common issues and solutions

### Claude Desktop Configuration
```json
{
  "mcpServers": {
    "duckpond": {
      "command": "npx",
      "args": ["-y", "duckpond-mcp-server"],
      "env": {
        "DUCKPOND_R2_ACCOUNT_ID": "your-account-id",
        "DUCKPOND_R2_ACCESS_KEY_ID": "your-access-key",
        "DUCKPOND_R2_SECRET_ACCESS_KEY": "your-secret-key",
        "DUCKPOND_R2_BUCKET": "your-bucket"
      }
    }
  }
}
```

## Distribution

### npm Package
- Package name: `duckpond-mcp-server`
- Binary: `duckpond-mcp-server`
- Global install: `npm install -g duckpond-mcp-server`
- Direct use: `npx duckpond-mcp-server`

### Docker Image

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY ../dist ./dist
CMD ["node", "dist/index.js"]
```

### GitHub Actions CI/CD
- Lint, typecheck, test, build on every push
- Publish to npm on version tags
- Build and push Docker image to GHCR
- CodeQL security scanning

### MCP Registry
Submit to official MCP registry with:
- Category: Databases
- Tags: duckdb, analytics, multi-tenant, cloud-storage
- Example use cases

## Development Workflow

### Initial Setup
```bash
git clone https://github.com/jordanburke/duckpond-mcp-server.git
cd duckpond-mcp-server
pnpm install
```

### Development
```bash
pnpm dev                    # Watch mode
pnpm serve:test            # Test stdio transport
pnpm serve:test:http       # Test HTTP transport
```

### Pre-commit
```bash
pnpm validate              # Format, lint, test, build
```

### Publishing
```bash
npm version patch          # Bump version
pnpm validate             # Run all checks
npm publish               # Publish to npm
git push --tags           # Trigger Docker build
```

## Timeline Estimate

With DuckPond library already built:

- **Day 1**: Project setup, MCP tool wrappers, stdio transport
- **Day 2**: HTTP transport (FastMCP), authentication, web UI
- **Day 3**: Multi-agent locking, testing, documentation
- **Day 4**: Docker setup, CI/CD, publishing

**Total: 3-4 days for production-ready MCP server**

Compare to: 2-3 weeks if building from scratch without DuckPond library.

## Key Benefits

### Why This Approach Works
1. **Separation of concerns**: DuckPond handles database logic, MCP handles transport
2. **Type safety preserved**: DuckPond's types flow through to MCP tools
3. **Error handling unified**: `Either<E,T>` converts cleanly to MCP errors
4. **Testing simplified**: Mock DuckPond for unit tests, use real instance for integration
5. **Maintenance reduced**: Bug fixes in DuckPond automatically benefit MCP server

### Reusability
The DuckPond library can also be used in:
- Express/Fastify web servers
- GraphQL APIs
- tRPC endpoints
- Other MCP servers
- Standalone CLI tools

This validates the library-first architecture!

## Next Steps

1. Create new repository: `duckpond-mcp-server`
2. Archive this repository: `duckpond` (library only)
3. Follow implementation plan above
4. Reference this document throughout development
5. Update this plan as discoveries are made

## References

- DuckPond library: `/home/jordanburke/IdeaProjects/duckpond`
- Kuzu MCP server: `/home/jordanburke/IdeaProjects/kuzudb-mcp-server`
- MCP specification: https://modelcontextprotocol.io
- FastMCP: https://github.com/jlowin/fastmcp
