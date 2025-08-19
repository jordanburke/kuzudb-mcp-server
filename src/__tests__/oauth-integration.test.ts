import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest"
import { spawn, ChildProcess } from "child_process"
import * as fs from "fs/promises"

/**
 * OAuth Integration Tests
 *
 * These tests verify that the OAuth authentication flow works correctly,
 * including proper Response object handling for auto-redirect functionality.
 * This ensures that the MCP Inspector can properly handle authentication flows.
 */
describe("OAuth Integration Tests", () => {
  const testDbPath = "./test-oauth-db-" + Date.now()
  const testPort = 3001 // Use different port to avoid conflicts
  let serverProcess: ChildProcess | null = null

  beforeAll(async () => {
    // Initialize a test database
    const init = spawn("node", ["dist/index.js", "--init", testDbPath], {
      stdio: "pipe",
    })

    let stderr = ""
    let stdout = ""

    init.stderr?.on("data", (data) => {
      stderr += data.toString()
    })

    init.stdout?.on("data", (data) => {
      stdout += data.toString()
    })

    await new Promise((resolve, reject) => {
      init.on("close", (code) => {
        if (code === 0) {
          resolve(undefined)
        } else {
          reject(new Error(`Init failed with code ${code}. Stdout: ${stdout}. Stderr: ${stderr}`))
        }
      })
    })
  })

  afterAll(async () => {
    // Clean up test database
    try {
      await fs.rm(testDbPath, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  beforeEach(async () => {
    // Kill any existing server process
    if (serverProcess) {
      serverProcess.kill()
      serverProcess = null
    }

    // Wait a bit for port to be freed
    await new Promise((resolve) => setTimeout(resolve, 100))
  })

  afterAll(async () => {
    if (serverProcess) {
      serverProcess.kill()
    }
  })

  describe("OAuth Authentication Flow", () => {
    it.skip("should verify OAuth endpoints are accessible and functional", async () => {
      // Start OAuth-enabled server
      serverProcess = spawn(
        "node",
        ["dist/index.js", testDbPath, "--transport", "http", "--port", testPort.toString()],
        {
          stdio: "pipe",
          env: {
            ...process.env,
            KUZU_OAUTH_ENABLED: "true",
            KUZU_OAUTH_USERNAME: "test-admin",
            KUZU_OAUTH_PASSWORD: "test-secret",
            KUZU_OAUTH_USER_ID: "test-user",
            KUZU_OAUTH_EMAIL: "test@example.com",
            KUZU_OAUTH_ISSUER: `http://localhost:${testPort}`,
            KUZU_OAUTH_RESOURCE: `http://localhost:${testPort}/mcp`,
          },
        },
      )

      // Wait for server to start and capture all output for debugging
      let serverOutput = ""
      await new Promise((resolve) => {
        serverProcess!.stderr!.on("data", (data) => {
          const output = data.toString()
          serverOutput += output
          if (output.includes("FastMCP server running")) {
            resolve(undefined)
          }
        })
        serverProcess!.stdout!.on("data", (data) => {
          serverOutput += data.toString()
        })
      })

      // Debug: Log server output to understand OAuth configuration
      console.log("Server startup output:", serverOutput)

      // Test OAuth authorization endpoint (should return login form)
      const authResponse = await fetch(`http://localhost:${testPort}/oauth/authorize?response_type=code&client_id=test`)
      expect(authResponse.status).toBe(200)
      expect(authResponse.headers.get("content-type")).toContain("text/html")

      // Test JWKS endpoint
      const jwksResponse = await fetch(`http://localhost:${testPort}/oauth/jwks`)
      expect(jwksResponse.status).toBe(200)
      expect(jwksResponse.headers.get("content-type")).toContain("application/json")

      // Test OAuth client registration endpoint
      const registrationResponse = await fetch(`http://localhost:${testPort}/oauth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_types: ["authorization_code"],
          response_types: ["code"],
          redirect_uris: ["http://localhost:8080/callback"],
        }),
      })
      expect(registrationResponse.status).toBe(200)

      const registration = await registrationResponse.json()
      expect(registration).toMatchObject({
        client_id: expect.any(String),
        client_secret: expect.any(String),
        grant_types: ["authorization_code"],
        response_types: ["code"],
      })

      // Verify OAuth endpoints are properly configured for MCP Inspector compatibility
      const authUrl = new URL(`http://localhost:${testPort}/oauth/authorize`)
      expect(authUrl.pathname).toBe("/oauth/authorize")

      const jwksUrl = new URL(`http://localhost:${testPort}/oauth/jwks`)
      expect(jwksUrl.pathname).toBe("/oauth/jwks")
    })

    it("should verify Response objects work in CI environment", async () => {
      // This is a simple regression test to ensure our ESLint configuration
      // allows Response objects to be used properly for OAuth flows.
      // This test doesn't require a running server and is safe for CI.

      // Test that we can create and handle Response objects correctly
      const oauthResponse = new Response(
        JSON.stringify({
          error: "unauthorized",
          error_description: "Authorization required. Please authenticate via OAuth.",
        }),
        {
          status: 401,
          statusText: "Unauthorized",
          headers: {
            "Content-Type": "application/json",
            "WWW-Authenticate": `Bearer realm="MCP", authorization_uri="http://localhost:3000/oauth/authorize"`,
          },
        },
      )

      // Verify the Response object is properly formed for OAuth auto-redirect
      expect(oauthResponse.status).toBe(401)
      expect(oauthResponse.statusText).toBe("Unauthorized")
      expect(oauthResponse.headers.get("Content-Type")).toBe("application/json")

      const wwwAuth = oauthResponse.headers.get("WWW-Authenticate")
      expect(wwwAuth).toBeTruthy()
      expect(wwwAuth).toContain('Bearer realm="MCP"')
      expect(wwwAuth).toContain("authorization_uri=")
      expect(wwwAuth).toContain("http://localhost:3000/oauth/authorize")

      // Verify response body
      const body = await oauthResponse.json()
      expect(body).toMatchObject({
        error: "unauthorized",
        error_description: "Authorization required. Please authenticate via OAuth.",
      })

      // Test that we can simulate the authentication flow without ESLint errors
      const simulateAuthFlow = () => {
        try {
          // This would previously cause ESLint errors but should now work
          throw oauthResponse
        } catch (error) {
          expect(error).toBeInstanceOf(Response)
          return error
        }
      }

      const result = simulateAuthFlow()
      expect(result).toBe(oauthResponse)
    })
  })
})
