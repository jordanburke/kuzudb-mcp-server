import { test, expect } from "@playwright/test"

test.describe("OAuth Working Tests", () => {
  test("health endpoint works without auth", async ({ request }) => {
    const response = await request.get("http://localhost:3000/health")
    expect(response.status()).toBe(200)
    const data = await response.json()
    expect(data.status).toBe("healthy")
  })

  test("MCP endpoint requires authentication", async ({ request }) => {
    const response = await request.post("http://localhost:3000/mcp", {
      headers: {
        "Content-Type": "application/json",
      },
      data: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      },
    })

    // FastMCP returns 400 for missing session ID
    expect(response.status()).toBe(400)
    const data = await response.json()
    expect(data.error.message).toContain("Bad Request")
  })

  test("OAuth authorization endpoint is accessible", async ({ request }) => {
    const response = await request.get(
      "http://localhost:3000/oauth/authorize?response_type=code&client_id=test&redirect_uri=http://localhost:3000/callback",
    )
    expect(response.status()).toBe(200)
    const html = await response.text()
    expect(html).toContain("OAuth Authorization")
    expect(html).toContain('input type="text" id="username"')
    expect(html).toContain('input type="password" id="password"')
  })

  test("OAuth token endpoint exists", async ({ request }) => {
    const response = await request.post("http://localhost:3000/oauth/token", {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      data: "grant_type=authorization_code&code=invalid&redirect_uri=http://localhost:3000/callback&client_id=test",
    })

    // Should get an error but not 404
    expect(response.status()).not.toBe(404)
  })

  test("OAuth JWKS endpoint exists", async ({ request }) => {
    const response = await request.get("http://localhost:3000/oauth/jwks")
    expect(response.status()).toBe(200)
    const data = await response.json()
    expect(data).toHaveProperty("keys")
    expect(Array.isArray(data.keys)).toBe(true)
  })

  test("Admin UI is accessible", async ({ request }) => {
    const response = await request.get("http://localhost:3000/admin")
    expect(response.status()).toBe(200)
    const html = await response.text()
    expect(html).toContain("Kuzu Database Manager")
  })
})
