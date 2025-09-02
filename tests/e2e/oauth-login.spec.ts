import { test, expect, type Page } from "@playwright/test"

test.describe("OAuth Login Flow", () => {
  test("should display login form at authorization endpoint", async ({ page }) => {
    // Navigate to OAuth authorization endpoint
    await page.goto(
      "http://localhost:3000/oauth/authorize?client_id=test-client&redirect_uri=http://localhost:3000/callback&response_type=code&state=test-state",
    )

    // Check that login form is displayed
    await expect(page.locator("h3")).toContainText("OAuth Authorization")
    await expect(page.locator('input[name="username"]')).toBeVisible()
    await expect(page.locator('input[name="password"]')).toBeVisible()
    await expect(page.locator('button[type="submit"]')).toBeVisible()
  })

  test("should reject invalid credentials", async ({ page }) => {
    await page.goto(
      "http://localhost:3000/oauth/authorize?client_id=test-client&redirect_uri=http://localhost:3000/callback&response_type=code&state=test-state",
    )

    // Fill in wrong credentials
    await page.fill('input[name="username"]', "wronguser")
    await page.fill('input[name="password"]', "wrongpass")
    await page.click('button[type="submit"]')

    // Should show error message
    await expect(page.locator("text=Invalid credentials")).toBeVisible()
  })

  test("should complete full OAuth flow with valid credentials", async ({ page, request }) => {
    // 1. Navigate to authorization endpoint
    await page.goto(
      "http://localhost:3000/oauth/authorize?client_id=test-client&redirect_uri=http://localhost:3000/callback&response_type=code&state=test-state",
    )

    // 2. Fill in correct credentials
    await page.fill('input[name="username"]', "admin")
    await page.fill('input[name="password"]', "secret123")

    // 3. Submit form and wait for redirect
    const [response] = await Promise.all([
      page.waitForResponse((resp) => resp.url().includes("callback")),
      page.click('button[type="submit"]'),
    ])

    // 4. Extract authorization code from redirect URL
    const redirectUrl = response.url()
    const urlParams = new URLSearchParams(new URL(redirectUrl).search)
    const authCode = urlParams.get("code")
    const state = urlParams.get("state")

    expect(authCode).toBeTruthy()
    expect(state).toBe("test-state")

    // 5. Exchange authorization code for token
    const tokenResponse = await request.post("http://localhost:3000/oauth/token", {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      data: `grant_type=authorization_code&code=${authCode}&redirect_uri=http://localhost:3000/callback&client_id=test-client`,
    })

    expect(tokenResponse.status()).toBe(200)
    const tokenData = await tokenResponse.json()

    expect(tokenData).toHaveProperty("access_token")
    expect(tokenData).toHaveProperty("token_type", "Bearer")
    expect(tokenData).toHaveProperty("expires_in")

    // 6. Use the token to make an authenticated API call
    const apiResponse = await request.post("http://localhost:3000/mcp", {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        "Content-Type": "application/json",
        "X-FastMCP-Session-ID": "test-session-123",
      },
      data: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      },
    })

    // Should work with the JWT token
    expect(apiResponse.status()).toBe(200)
    const apiData = await apiResponse.json()
    expect(apiData).toHaveProperty("result")
    expect(apiData.result).toHaveProperty("tools")
  })

  test("should work with password grant type", async ({ request }) => {
    // Direct password grant (if supported)
    const tokenResponse = await request.post("http://localhost:3000/oauth/token", {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      data: "grant_type=password&username=admin&password=secret123&client_id=test-client",
    })

    if (tokenResponse.status() === 200) {
      const tokenData = await tokenResponse.json()
      expect(tokenData).toHaveProperty("access_token")

      // Test the token works
      const apiResponse = await request.post("http://localhost:3000/mcp", {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          "Content-Type": "application/json",
          "X-FastMCP-Session-ID": "test-session-456",
        },
        data: {
          jsonrpc: "2.0",
          id: 1,
          method: "get_schema",
          params: {},
        },
      })

      expect(apiResponse.status()).toBe(200)
    }
  })
})
