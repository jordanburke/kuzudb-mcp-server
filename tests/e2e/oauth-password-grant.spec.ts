import { test, expect } from "@playwright/test"

test.describe("OAuth Password Grant Authentication", () => {
  let accessToken: string

  test("should authenticate with username/password and get JWT token", async ({ request }) => {
    // Use password grant to get token
    const tokenResponse = await request.post("http://localhost:3000/oauth/token", {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      data: "grant_type=password&username=admin&password=secret123&client_id=test-client",
    })

    expect(tokenResponse.status()).toBe(200)
    const tokenData = await tokenResponse.json()

    // Verify token response structure
    expect(tokenData).toHaveProperty("access_token")
    expect(tokenData).toHaveProperty("token_type", "Bearer")
    expect(tokenData).toHaveProperty("expires_in")
    expect(typeof tokenData.access_token).toBe("string")
    expect(tokenData.access_token.length).toBeGreaterThan(20)

    // Store token for other tests
    accessToken = tokenData.access_token
  })

  test("should reject invalid credentials", async ({ request }) => {
    const tokenResponse = await request.post("http://localhost:3000/oauth/token", {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      data: "grant_type=password&username=wronguser&password=wrongpass&client_id=test-client",
    })

    expect(tokenResponse.status()).toBe(401)
    const errorData = await tokenResponse.json()
    expect(errorData).toHaveProperty("error")
  })

  test("should use JWT token to call MCP API - tools/list", async ({ request }) => {
    // First get a fresh token
    const tokenResponse = await request.post("http://localhost:3000/oauth/token", {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      data: "grant_type=password&username=admin&password=secret123&client_id=test-client",
    })

    const { access_token } = await tokenResponse.json()

    // Use token to call MCP API
    const apiResponse = await request.post("http://localhost:3000/mcp", {
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
        "X-FastMCP-Session-ID": "test-session-" + Date.now(),
      },
      data: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      },
    })

    expect(apiResponse.status()).toBe(200)
    const apiData = await apiResponse.json()

    // Verify response structure
    expect(apiData).toHaveProperty("jsonrpc", "2.0")
    expect(apiData).toHaveProperty("id", 1)
    expect(apiData).toHaveProperty("result")
    expect(apiData.result).toHaveProperty("tools")
    expect(Array.isArray(apiData.result.tools)).toBe(true)

    // Check that expected tools are present
    const toolNames = apiData.result.tools.map((t: any) => t.name)
    expect(toolNames).toContain("execute_query")
    expect(toolNames).toContain("get_schema")
    expect(toolNames).toContain("generate_cypher_from_schema")
  })

  test("should use JWT token to execute a query", async ({ request }) => {
    // Get token
    const tokenResponse = await request.post("http://localhost:3000/oauth/token", {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      data: "grant_type=password&username=admin&password=secret123&client_id=test-client",
    })

    const { access_token } = await tokenResponse.json()

    // Execute a simple query
    const apiResponse = await request.post("http://localhost:3000/mcp", {
      headers: {
        Authorization: `Bearer ${access_token}`,
        "Content-Type": "application/json",
        "X-FastMCP-Session-ID": "test-session-" + Date.now(),
      },
      data: {
        jsonrpc: "2.0",
        id: 2,
        method: "execute_query",
        params: {
          query: "RETURN 1 + 1 AS result",
        },
      },
    })

    expect(apiResponse.status()).toBe(200)
    const apiData = await apiResponse.json()

    expect(apiData).toHaveProperty("result")
    expect(apiData.result).toHaveProperty("rows")
    expect(apiData.result.rows[0]).toHaveProperty("result", 2)
  })

  test("should reject requests without token", async ({ request }) => {
    const apiResponse = await request.post("http://localhost:3000/mcp", {
      headers: {
        "Content-Type": "application/json",
        "X-FastMCP-Session-ID": "test-session-" + Date.now(),
      },
      data: {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/list",
        params: {},
      },
    })

    // Should be unauthorized without token
    expect(apiResponse.status()).toBe(401)
  })

  test("should reject requests with invalid token", async ({ request }) => {
    const apiResponse = await request.post("http://localhost:3000/mcp", {
      headers: {
        Authorization: "Bearer invalid-token-12345",
        "Content-Type": "application/json",
        "X-FastMCP-Session-ID": "test-session-" + Date.now(),
      },
      data: {
        jsonrpc: "2.0",
        id: 4,
        method: "tools/list",
        params: {},
      },
    })

    // Should be unauthorized with invalid token
    expect(apiResponse.status()).toBe(401)
  })
})
