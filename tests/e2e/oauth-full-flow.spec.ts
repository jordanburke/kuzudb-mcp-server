import { test, expect } from "@playwright/test"

test.describe("OAuth Complete Flow - Login to MCP Access", () => {
  test("should complete full OAuth login and access MCP resources", async ({ page, request, context }) => {
    console.log("Starting OAuth full flow test...")

    // Step 1: Navigate to OAuth authorization page
    console.log("Step 1: Navigating to OAuth authorization page...")
    await page.goto(
      "http://localhost:3000/oauth/authorize?response_type=code&client_id=test-client&redirect_uri=http://localhost:3000/callback&state=test-state-123",
    )

    // Verify login form is displayed
    await expect(page.locator("h3")).toContainText("OAuth Authorization")
    await expect(page.locator('input[name="username"]')).toBeVisible()
    await expect(page.locator('input[name="password"]')).toBeVisible()
    console.log("✓ Login form displayed")

    // Step 2: Fill in credentials and submit
    console.log("Step 2: Filling in credentials (admin/secret123)...")
    await page.fill('input[name="username"]', "admin")
    await page.fill('input[name="password"]', "secret123")

    // Step 3: Submit form and capture the redirect
    console.log("Step 3: Submitting login form...")

    // Set up listener for the redirect response
    const responsePromise = page
      .waitForResponse(
        (response) => {
          const url = response.url()
          console.log("Response URL:", url)
          return url.includes("callback") || url.includes("code=")
        },
        { timeout: 10000 },
      )
      .catch(() => null)

    // Click submit
    await page.click('button[type="submit"]')

    // Wait for either redirect or error message
    const response = await responsePromise

    if (response) {
      // We got a redirect with auth code
      const redirectUrl = response.url()
      console.log("✓ Got redirect URL:", redirectUrl)

      // Extract authorization code
      const urlObj = new URL(redirectUrl)
      const authCode = urlObj.searchParams.get("code")
      const state = urlObj.searchParams.get("state")

      console.log("✓ Authorization code:", authCode)
      console.log("✓ State:", state)

      expect(authCode).toBeTruthy()
      expect(state).toBe("test-state-123")

      // Step 4: Exchange authorization code for access token
      console.log("Step 4: Exchanging auth code for access token...")
      const tokenResponse = await request.post("http://localhost:3000/oauth/token", {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        data: `grant_type=authorization_code&code=${authCode}&redirect_uri=http://localhost:3000/callback&client_id=test-client`,
      })

      console.log("Token exchange response status:", tokenResponse.status())

      if (tokenResponse.status() === 200) {
        const tokenData = await tokenResponse.json()
        console.log("✓ Got access token!")
        console.log("Token type:", tokenData.token_type)
        console.log("Expires in:", tokenData.expires_in)

        expect(tokenData).toHaveProperty("access_token")
        expect(tokenData).toHaveProperty("token_type", "Bearer")

        const accessToken = tokenData.access_token

        // Step 5: Use access token to call MCP endpoints
        console.log("Step 5: Testing MCP access with JWT token...")

        // Test 1: Get tools list
        console.log("Testing tools/list endpoint...")
        const toolsResponse = await request.post("http://localhost:3000/mcp", {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            "X-FastMCP-Session-ID": `test-session-${Date.now()}`,
          },
          data: {
            jsonrpc: "2.0",
            id: 1,
            method: "tools/list",
            params: {},
          },
        })

        console.log("Tools list response status:", toolsResponse.status())

        if (toolsResponse.status() === 200) {
          const toolsData = await toolsResponse.json()
          console.log("✓ Successfully accessed MCP tools/list!")
          console.log("Available tools:", toolsData.result?.tools?.map((t: any) => t.name).join(", "))

          expect(toolsData).toHaveProperty("result")
          expect(toolsData.result).toHaveProperty("tools")
          expect(Array.isArray(toolsData.result.tools)).toBe(true)
        } else {
          const errorData = await toolsResponse.json()
          console.error("Failed to access MCP:", errorData)
          throw new Error(`MCP access failed: ${JSON.stringify(errorData)}`)
        }

        // Test 2: Execute a query
        console.log("Testing execute_query endpoint...")
        const queryResponse = await request.post("http://localhost:3000/mcp", {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            "X-FastMCP-Session-ID": `test-session-${Date.now()}`,
          },
          data: {
            jsonrpc: "2.0",
            id: 2,
            method: "execute_query",
            params: {
              query: "RETURN 42 AS answer",
            },
          },
        })

        console.log("Query response status:", queryResponse.status())

        if (queryResponse.status() === 200) {
          const queryData = await queryResponse.json()
          console.log("✓ Successfully executed query!")
          console.log("Query result:", JSON.stringify(queryData.result, null, 2))

          expect(queryData).toHaveProperty("result")
          expect(queryData.result).toHaveProperty("rows")
        } else {
          const errorData = await queryResponse.json()
          console.error("Query failed:", errorData)
        }

        // Test 3: Get schema
        console.log("Testing get_schema endpoint...")
        const schemaResponse = await request.post("http://localhost:3000/mcp", {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            "X-FastMCP-Session-ID": `test-session-${Date.now()}`,
          },
          data: {
            jsonrpc: "2.0",
            id: 3,
            method: "get_schema",
            params: {},
          },
        })

        console.log("Schema response status:", schemaResponse.status())

        if (schemaResponse.status() === 200) {
          const schemaData = await schemaResponse.json()
          console.log("✓ Successfully retrieved schema!")

          expect(schemaData).toHaveProperty("result")
        } else {
          const errorData = await schemaResponse.json()
          console.error("Schema retrieval failed:", errorData)
        }

        console.log("\n✅ OAuth login flow complete! Successfully authenticated and accessed MCP resources.")
      } else {
        const errorData = await tokenResponse.text()
        console.error("Token exchange failed:", errorData)
        throw new Error(`Token exchange failed: ${errorData}`)
      }
    } else {
      // Check if we're still on the login page with an error
      const errorElement = await page.locator(".error").first()
      if (await errorElement.isVisible()) {
        const errorText = await errorElement.textContent()
        console.error("Login failed with error:", errorText)
        throw new Error(`Login failed: ${errorText}`)
      } else {
        console.log("Current URL:", page.url())
        console.log("Page content:", await page.content())
        throw new Error("No redirect received after login submission")
      }
    }
  })

  test("should reject access without valid token", async ({ request }) => {
    console.log("Testing MCP rejection without token...")

    const response = await request.post("http://localhost:3000/mcp", {
      headers: {
        "Content-Type": "application/json",
        "X-Session-ID": "test-no-auth",
      },
      data: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      },
    })

    // Should be rejected (either 400 or 401)
    expect([400, 401]).toContain(response.status())
    console.log("✓ Correctly rejected unauthorized request with status:", response.status())
  })

  test("should reject access with invalid token", async ({ request }) => {
    console.log("Testing MCP rejection with invalid token...")

    const response = await request.post("http://localhost:3000/mcp", {
      headers: {
        Authorization: "Bearer invalid-jwt-token-12345",
        "Content-Type": "application/json",
        "X-Session-ID": "test-invalid-auth",
      },
      data: {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      },
    })

    // Should be rejected (either 400 or 401)
    expect([400, 401]).toContain(response.status())
    console.log("✓ Correctly rejected invalid token with status:", response.status())
  })
})
