import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs/promises"
import * as path from "path"
import { LockManager, detectMutation, LockTimeoutError, type WriteLock } from "../lock-manager.js"

describe("LockManager", () => {
  const testDbPath = "/tmp/test-kuzu-db"
  const lockFilePath = path.join(testDbPath, ".mcp_write_lock")
  let lockManager: LockManager

  beforeEach(async () => {
    await fs.mkdir(testDbPath, { recursive: true })
    lockManager = new LockManager(testDbPath, "test-agent", 1000)
  })

  afterEach(async () => {
    try {
      await fs.unlink(lockFilePath)
    } catch {
      // Ignore if lock file doesn't exist
    }
  })

  describe("acquireWriteLock", () => {
    it("should acquire a lock when no existing lock", async () => {
      const lock = await lockManager.acquireWriteLock()

      expect(lock.processId).toBe(process.pid)
      expect(lock.agentId).toBe("test-agent")
      expect(lock.timeout).toBe(1000)

      const lockData = await fs.readFile(lockFilePath, "utf-8")
      const savedLock = JSON.parse(lockData) as WriteLock
      expect(savedLock.processId).toBe(process.pid)
    })

    it("should wait and acquire lock when existing lock expires", async () => {
      const expiredLock = {
        processId: 99999,
        agentId: "other-agent",
        timestamp: Date.now() - 2000,
        heartbeat: Date.now() - 2000,
        timeout: 1000,
      }
      await fs.writeFile(lockFilePath, JSON.stringify(expiredLock))

      const lock = await lockManager.acquireWriteLock()
      expect(lock.agentId).toBe("test-agent")
    })

    it("should throw LockTimeoutError when cannot acquire lock", async () => {
      const activeLock = {
        processId: process.pid,
        agentId: "other-agent",
        timestamp: Date.now(),
        heartbeat: Date.now(),
        timeout: 5000,
      }
      await fs.writeFile(lockFilePath, JSON.stringify(activeLock))

      await expect(lockManager.acquireWriteLock()).rejects.toThrow(LockTimeoutError)
    })

    it("should detect stale lock from dead process", async () => {
      const staleLock = {
        processId: 99999,
        agentId: "dead-agent",
        timestamp: Date.now() - 100,
        heartbeat: Date.now() - 100,
        timeout: 10000,
      }
      await fs.writeFile(lockFilePath, JSON.stringify(staleLock))

      const lock = await lockManager.acquireWriteLock()
      expect(lock.agentId).toBe("test-agent")
    })
  })

  describe("releaseLock", () => {
    it("should release an acquired lock", async () => {
      const lock = await lockManager.acquireWriteLock()
      await lockManager.releaseLock(lock)

      await expect(fs.access(lockFilePath)).rejects.toThrow()
    })

    it("should not delete lock owned by another agent", async () => {
      const lock = await lockManager.acquireWriteLock()

      const otherLock = {
        processId: 99999,
        agentId: "other-agent",
        timestamp: Date.now(),
        heartbeat: Date.now(),
        timeout: 5000,
      }
      await fs.writeFile(lockFilePath, JSON.stringify(otherLock))

      await lockManager.releaseLock(lock)

      await expect(fs.access(lockFilePath)).resolves.toBeUndefined()
    })
  })

  describe("heartbeat", () => {
    it("should update heartbeat periodically", async () => {
      const lock = await lockManager.acquireWriteLock()
      const initialHeartbeat = lock.heartbeat

      await new Promise((resolve) => setTimeout(resolve, 100))

      const lockData = await fs.readFile(lockFilePath, "utf-8")
      const currentLock = JSON.parse(lockData) as WriteLock

      expect(currentLock.heartbeat).toBeGreaterThanOrEqual(initialHeartbeat)

      await lockManager.releaseLock(lock)
    })
  })
})

describe("detectMutation", () => {
  it("should detect CREATE statements", () => {
    expect(detectMutation("CREATE NODE TABLE Person")).toBe(true)
    expect(detectMutation("  CREATE (n:Person {name: 'Alice'})")).toBe(true)
  })

  it("should detect MERGE statements", () => {
    expect(detectMutation("MERGE (n:Person {id: 1})")).toBe(true)
    expect(detectMutation("MATCH (a:Person) MERGE (b:Company)")).toBe(true)
  })

  it("should detect DELETE statements", () => {
    expect(detectMutation("DELETE n")).toBe(true)
    expect(detectMutation("MATCH (n) DELETE n")).toBe(true)
  })

  it("should detect SET statements", () => {
    expect(detectMutation("SET n.name = 'Bob'")).toBe(true)
    expect(detectMutation("MATCH (n) SET n.age = 30")).toBe(true)
  })

  it("should detect DROP statements", () => {
    expect(detectMutation("DROP TABLE Person")).toBe(true)
  })

  it("should detect ALTER statements", () => {
    expect(detectMutation("ALTER TABLE Person ADD COLUMN age INT")).toBe(true)
  })

  it("should detect COPY statements", () => {
    expect(detectMutation("COPY Person FROM '/path/to/file.csv'")).toBe(true)
  })

  it("should not detect read-only queries", () => {
    expect(detectMutation("MATCH (n) RETURN n")).toBe(false)
    expect(detectMutation("MATCH (n:Person) WHERE n.age > 21 RETURN n.name")).toBe(false)
    expect(detectMutation("CALL show_tables() RETURN *")).toBe(false)
  })

  it("should handle case-insensitive matching", () => {
    expect(detectMutation("create node table Person")).toBe(true)
    expect(detectMutation("MERGE (n:Person)")).toBe(true)
    expect(detectMutation("Set n.name = 'Alice'")).toBe(true)
  })

  it("should detect mutations in multi-line queries", () => {
    const query = `
      MATCH (p:Person {id: 1})
      SET p.updated = timestamp()
      RETURN p
    `
    expect(detectMutation(query)).toBe(true)
  })
})
