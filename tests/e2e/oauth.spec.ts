import { test, expect, type APIRequestContext } from "@playwright/test"

const VALID_TOKEN = "test-token-123"
const INVALID_TOKEN = "invalid-token"

test.describe("OAuth Authentication", () => {
  let apiContext: APIRequestContext

  test.beforeAll(async ({ playwright }) => {
    apiContext = await playwright.request.newContext({
      baseURL: "http://localhost:3000",
    })
  })

  test.afterAll(async () => {
    await apiContext.dispose()
  })

  test.describe("Authentication Flow", () => {
    test("should reject requests without authorization header", async () => {
      const response = await apiContext.post("/", {
        data: {
          jsonrpc: "2.0",
          id: 1,
          method: "execute_query",
          params: { query: "MATCH (n) RETURN n LIMIT 1" },
        },
      })

      expect(response.status()).toBe(401)
      const body = await response.json()
      expect(body.error).toBe("Authorization header missing")
    })

    test("should reject requests with invalid token", async () => {
      const response = await apiContext.post("/", {
        headers: {
          Authorization: `Bearer ${INVALID_TOKEN}`,
        },
        data: {
          jsonrpc: "2.0",
          id: 1,
          method: "execute_query",
          params: { query: "MATCH (n) RETURN n LIMIT 1" },
        },
      })

      expect(response.status()).toBe(401)
      const body = await response.json()
      expect(body.error).toBe("Invalid token")
    })

    test("should accept requests with valid token", async () => {
      const response = await apiContext.post("/", {
        headers: {
          Authorization: `Bearer ${VALID_TOKEN}`,
        },
        data: {
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
          params: {},
        },
      })

      expect(response.status()).toBe(200)
      const body = await response.json()
      expect(body.jsonrpc).toBe("2.0")
      expect(body.result).toBeDefined()
      expect(body.result.tools).toBeInstanceOf(Array)
    })
  })

  test.describe("Health Check", () => {
    test("should not require authentication for health endpoint", async () => {
      const response = await apiContext.get("/health")
      expect(response.status()).toBe(200)
      const body = await response.json()
      expect(body.status).toBe("healthy")
    })
  })
})
