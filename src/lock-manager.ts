import * as fs from "fs/promises"
import * as path from "path"
import { constants } from "fs"

interface ErrnoException extends Error {
  code?: string
}

export interface WriteLock {
  processId: number
  agentId: string
  timestamp: number
  heartbeat: number
  timeout: number
}

export class LockTimeoutError extends Error {
  constructor(currentHolder: string, timeRemaining: number) {
    super(`Database locked by ${currentHolder}, estimated time remaining: ${timeRemaining}ms`)
    this.name = "LockTimeoutError"
  }
}

export class LockManager {
  private readonly lockFilePath: string
  private readonly agentId: string
  private readonly lockTimeout: number
  private readonly heartbeatInterval: number = 5000
  private heartbeatTimer?: ReturnType<typeof setInterval>

  constructor(databasePath: string, agentId: string, lockTimeout: number = 10000) {
    this.lockFilePath = path.join(databasePath, ".mcp_write_lock")
    this.agentId = agentId
    this.lockTimeout = lockTimeout
  }

  async acquireWriteLock(): Promise<WriteLock> {
    const startTime = Date.now()

    while (Date.now() - startTime < this.lockTimeout) {
      try {
        const existingLock = await this.readLock()

        if (existingLock) {
          if (this.isLockStale(existingLock)) {
            // Stale lock, try to remove it
            try {
              await fs.unlink(this.lockFilePath)
            } catch {
              // Ignore if someone else already removed it
            }
          } else {
            const timeRemaining = existingLock.timeout - (Date.now() - existingLock.timestamp)

            if (timeRemaining > 100) {
              await this.sleep(Math.min(100, timeRemaining))
              continue
            }
          }
        }

        const lock: WriteLock = {
          processId: process.pid,
          agentId: this.agentId,
          timestamp: Date.now(),
          heartbeat: Date.now(),
          timeout: this.lockTimeout,
        }

        try {
          await this.writeLock(lock)

          const verifyLock = await this.readLock()
          if (verifyLock && verifyLock.processId === process.pid && verifyLock.agentId === this.agentId) {
            this.startHeartbeat()
            return lock
          }
        } catch (error) {
          if ((error as ErrnoException).code !== "EEXIST") {
            throw error
          }
          // Lock file exists, continue waiting
        }
      } catch {
        if (Date.now() - startTime >= this.lockTimeout) {
          break
        }
        await this.sleep(50)
      }
    }

    const currentLock = await this.readLock()
    const holder = currentLock ? currentLock.agentId : "unknown"
    const timeRemaining = currentLock ? currentLock.timeout - (Date.now() - currentLock.timestamp) : 0

    throw new LockTimeoutError(holder, Math.max(0, timeRemaining))
  }

  async releaseLock(lock: WriteLock): Promise<void> {
    this.stopHeartbeat()

    try {
      const currentLock = await this.readLock()

      if (currentLock && currentLock.processId === lock.processId && currentLock.agentId === lock.agentId) {
        await fs.unlink(this.lockFilePath)
      }
    } catch {
      // Ignore errors during release
    }
  }

  private isLockStale(lock: WriteLock): boolean {
    if (Date.now() - lock.timestamp > lock.timeout) {
      return true
    }

    if (Date.now() - lock.heartbeat > this.heartbeatInterval * 2) {
      return true
    }

    try {
      process.kill(lock.processId, 0)
      return false
    } catch {
      return true
    }
  }

  private async readLock(): Promise<WriteLock | null> {
    try {
      const data = await fs.readFile(this.lockFilePath, "utf-8")
      return JSON.parse(data) as WriteLock
    } catch {
      return null
    }
  }

  private async writeLock(lock: WriteLock): Promise<void> {
    const dir = path.dirname(this.lockFilePath)
    await fs.mkdir(dir, { recursive: true })

    try {
      const flags = constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY
      const fd = await fs.open(this.lockFilePath, flags)

      try {
        await fd.write(JSON.stringify(lock, null, 2))
      } finally {
        await fd.close()
      }
    } catch (error) {
      if ((error as ErrnoException).code === "EEXIST") {
        throw error
      }
      await fs.writeFile(this.lockFilePath, JSON.stringify(lock, null, 2))
    }
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      // Handle heartbeat in async IIFE to avoid misuse warning
      void (async () => {
        try {
          const lock = await this.readLock()
          if (lock && lock.processId === process.pid && lock.agentId === this.agentId) {
            lock.heartbeat = Date.now()
            await fs.writeFile(this.lockFilePath, JSON.stringify(lock, null, 2))
          }
        } catch {
          // Ignore heartbeat errors
        }
      })()
    }, this.heartbeatInterval)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = undefined
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

export function detectMutation(cypher: string): boolean {
  const mutationPatterns = [
    /^\s*CREATE\s+/i,
    /^\s*MERGE\s+/i,
    /^\s*DELETE\s+/i,
    /^\s*SET\s+/i,
    /^\s*REMOVE\s+/i,
    /^\s*DROP\s+/i,
    /^\s*ALTER\s+/i,
    /^\s*COPY\s+/i,
    /\sMERGE\s+/i,
    /\sSET\s+/i,
    /\sDELETE\s+/i,
    /\sREMOVE\s+/i,
  ]

  return mutationPatterns.some((pattern) => pattern.test(cypher))
}
