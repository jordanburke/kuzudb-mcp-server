import express from "express"
import type { Request, Response, Application } from "express"
import multer from "multer"
import * as path from "path"
import * as fs from "fs/promises"
import { DatabaseManager } from "./server-core.js"
import { getWebUIHTML } from "./web-ui.js"
import { createSimpleArchive, restoreSimpleArchive, exportDatabase, getDatabaseInfo } from "./backup-utils.js"
import * as os from "os"

// Configure multer with increased limits and better handling
const multerConfig = {
  dest: os.tmpdir(),
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB max file size
    fieldSize: 500 * 1024 * 1024, // 500MB max field size
    fields: 50, // Increase max fields
    files: 3, // Max 3 files
    parts: 50, // Increase max parts
    headerPairs: 2000, // Increase header pairs limit
  },
  // Add file filter to validate uploads
  fileFilter: (_req: express.Request, file: globalThis.Express.Multer.File, cb: multer.FileFilterCallback) => {
    console.log(`[Multer] Receiving file: ${file.originalname}, type: ${file.mimetype}`)
    cb(null, true) // Accept all files
  },
}

const upload = multer(multerConfig)

// Configure multer for multiple files
const uploadMultiple = multer(multerConfig).fields([
  { name: "backup", maxCount: 1 },
  { name: "mainFile", maxCount: 1 },
  { name: "walFile", maxCount: 1 },
])

export interface WebServerOptions {
  port: number
  dbManager: DatabaseManager
  databasePath: string
  isReadOnly: boolean
  enableAuth?: boolean
  authUser?: string
  authPassword?: string
}

export function createWebServer(options: WebServerOptions): Application {
  const app = express()

  // Add logging middleware for debugging
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`)
    if (req.method === "POST") {
      console.log("Content-Type:", req.headers["content-type"])
      console.log("Content-Length:", req.headers["content-length"])
      const sizeMB = parseInt(req.headers["content-length"] || "0") / (1024 * 1024)
      console.log(`Upload size: ${sizeMB.toFixed(2)} MB`)
    }
    next()
  })

  // Add body parsing middleware with increased limits
  app.use(express.json({ limit: "500mb" }))
  app.use(express.urlencoded({ extended: true, limit: "500mb" }))

  // Increase server timeout for large uploads
  app.use((req, res, next) => {
    // Set timeout to 5 minutes for uploads
    if (req.method === "POST" && req.path === "/api/restore") {
      req.setTimeout(5 * 60 * 1000) // 5 minutes
      res.setTimeout(5 * 60 * 1000)
    }
    next()
  })

  // Basic auth middleware if enabled
  if (options.enableAuth && options.authUser && options.authPassword) {
    app.use((req, res, next) => {
      const authHeader = req.headers.authorization
      if (!authHeader) {
        res.setHeader("WWW-Authenticate", 'Basic realm="Kuzu Database Manager"')
        return res.status(401).send("Authentication required")
      }

      const auth = Buffer.from(authHeader.split(" ")[1], "base64").toString()
      const [user, pass] = auth.split(":")

      if (user === options.authUser && pass === options.authPassword) {
        next()
      } else {
        res.setHeader("WWW-Authenticate", 'Basic realm="Kuzu Database Manager"')
        return res.status(401).send("Invalid credentials")
      }
    })
  }

  // CORS headers for API endpoints
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*")
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization")
    res.header("Access-Control-Max-Age", "86400")

    // Handle preflight requests
    if (req.method === "OPTIONS") {
      return res.sendStatus(204)
    }
    next()
  })

  // Serve the web UI
  app.get("/", (req: Request, res: Response) => {
    res.redirect("/admin")
  })

  app.get("/admin", (req: Request, res: Response) => {
    const html = getWebUIHTML({
      databasePath: options.databasePath,
      isReadOnly: options.isReadOnly,
      version: "0.11.10", // TODO: Get from package.json
    })
    res.send(html)
  })

  // Health check endpoint
  app.get("/health", (req: Request, res: Response) => {
    res.json({
      status: "healthy",
      service: "kuzudb-web-manager",
      database: options.databasePath,
      readonly: options.isReadOnly,
      timestamp: new Date().toISOString(),
    })
  })

  // Test POST endpoint - accepts any data
  app.post("/api/test", express.raw({ type: "*/*", limit: "100mb" }), (req: Request, res: Response) => {
    console.log("[/api/test] POST request received")
    const bodySize = (req.body as Buffer)?.length || 0
    console.log("[/api/test] Body size:", bodySize)
    console.log("[/api/test] Headers:", req.headers)

    res.json({
      success: true,
      message: "Test POST successful",
      bodySize,
      headers: req.headers,
      timestamp: new Date().toISOString(),
    })
  })

  // Simple echo endpoint for testing
  app.post("/api/echo", (req: Request, res: Response) => {
    console.log("[/api/echo] Request received")
    res.json({
      success: true,
      message: "Echo successful",
      body: req.body as unknown,
      query: req.query,
      timestamp: new Date().toISOString(),
    })
  })

  // Simple single file upload endpoint (fallback for problematic browsers)
  app.post("/api/upload-single", upload.single("file"), (req: Request, res: Response) => {
    void (async () => {
      console.log("[/api/upload-single] Request received")

      if (options.isReadOnly) {
        return res.status(403).json({ error: "Database is in read-only mode" })
      }

      const file = req.file
      const fileType = (req.body as { type?: string }).type // 'main' or 'wal'

      if (!file) {
        return res.status(400).json({ error: "No file uploaded" })
      }

      console.log(`[/api/upload-single] Received ${fileType} file: ${file.originalname}, size: ${file.size}`)

      try {
        const targetPath = fileType === "wal" ? `${options.databasePath}.wal` : options.databasePath

        // Copy uploaded file to database location
        const fileData = await fs.readFile(file.path)
        await fs.writeFile(targetPath, fileData)
        console.log(`[/api/upload-single] Wrote ${fileType} file to: ${targetPath}`)

        // Clean up temp file
        await fs.unlink(file.path).catch(() => {})

        res.json({
          success: true,
          message: `${fileType} file uploaded successfully`,
          type: fileType as string,
          size: file.size,
        })
      } catch (error) {
        console.error("[/api/upload-single] Error:", error)

        // Clean up temp file
        await fs.unlink(file.path).catch(() => {})

        res.status(500).json({ error: "Failed to save file: " + (error as Error).message })
      }
    })()
  })

  // Database info endpoint
  app.get("/api/info", (req: Request, res: Response) => {
    void (async () => {
      try {
        const info = await getDatabaseInfo(options.databasePath)
        res.json({
          ...info,
          isReadOnly: options.isReadOnly,
          connected: !!options.dbManager.conn,
        })
      } catch (error) {
        console.error("Error getting database info:", error)
        res.status(500).json({ error: "Failed to get database info" })
      }
    })()
  })

  // Download backup endpoint
  app.get("/api/backup", (req: Request, res: Response) => {
    void (async () => {
      try {
        // Create a simple archive in memory
        const archive = await createSimpleArchive(options.databasePath)

        // Set headers for download
        const filename = `kuzu-backup-${new Date().toISOString().slice(0, 10)}.kuzu`
        res.setHeader("Content-Type", "application/octet-stream")
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`)
        res.setHeader("Content-Length", archive.length.toString())

        // Send the archive
        res.send(archive)
      } catch (error) {
        console.error("Error creating backup:", error)
        res.status(500).json({ error: "Failed to create backup" })
      }
    })()
  })

  // Restore backup endpoint - handles both backup archives and raw database files
  app.post("/api/restore", (req: Request, res: Response, _next) => {
    console.log("[/api/restore] Request received")
    console.log("[/api/restore] Headers:", req.headers)

    if (options.isReadOnly) {
      return res.status(403).json({ error: "Database is in read-only mode" })
    }

    // Use multer to handle the upload
    uploadMultiple(req, res, (err) => {
      void (async () => {
        if (err) {
          console.error("[/api/restore] Multer error:", err)
          const multerErr = err as multer.MulterError & { field?: string; storageErrors?: unknown }
          console.error("Error details:", {
            code: multerErr.code,
            field: multerErr.field,
            storageErrors: multerErr.storageErrors,
          })

          // Handle specific multer errors
          if (multerErr.code === "LIMIT_FILE_SIZE") {
            return res.status(413).json({ error: "File too large. Maximum size is 500MB." })
          }
          if (multerErr.code === "LIMIT_FILE_COUNT") {
            return res.status(400).json({ error: "Too many files. Maximum 3 files allowed." })
          }
          if (multerErr.code === "LIMIT_UNEXPECTED_FILE") {
            return res.status(400).json({ error: "Unexpected file field: " + multerErr.field })
          }

          return res.status(500).json({ error: "Upload failed: " + (err as Error).message })
        }

        console.log("[/api/restore] Files uploaded successfully")
        const files = req.files as { [fieldname: string]: globalThis.Express.Multer.File[] }

        // Check what type of upload this is
        const backupFile = files.backup?.[0]
        const mainFile = files.mainFile?.[0]
        const walFile = files.walFile?.[0]

        if (!backupFile && !mainFile) {
          return res.status(400).json({ error: "No files uploaded" })
        }

        const tempFiles: string[] = []

        try {
          if (backupFile) {
            // Handle backup archive restore
            console.log("Restoring from backup archive:", backupFile.originalname)
            tempFiles.push(backupFile.path)

            // Read the uploaded file
            const archive = await fs.readFile(backupFile.path)

            // Create a temporary path for restoration
            const tempPath = path.join(os.tmpdir(), `kuzu-restore-${Date.now()}`)

            // Restore to temporary location first
            await restoreSimpleArchive(archive, tempPath)

            // Move restored files to actual location
            const mainData = await fs.readFile(tempPath)
            await fs.writeFile(options.databasePath, mainData)

            // Check for WAL file
            try {
              const walData = await fs.readFile(`${tempPath}.wal`)
              await fs.writeFile(`${options.databasePath}.wal`, walData)
            } catch {
              // WAL file might not exist
            }

            // Clean up temp files
            await fs.unlink(tempPath).catch(() => {})
            await fs.unlink(`${tempPath}.wal`).catch(() => {})
          } else if (mainFile) {
            // Handle raw database files
            console.log("Restoring from raw database files:", mainFile.originalname)
            tempFiles.push(mainFile.path)
            if (walFile) {
              tempFiles.push(walFile.path)
            }

            // Copy main database file
            const mainData = await fs.readFile(mainFile.path)
            await fs.writeFile(options.databasePath, mainData)
            console.log(`Wrote main database file: ${options.databasePath}`)

            // Copy WAL file if provided
            if (walFile) {
              const walData = await fs.readFile(walFile.path)
              await fs.writeFile(`${options.databasePath}.wal`, walData)
              console.log(`Wrote WAL file: ${options.databasePath}.wal`)
            } else {
              // Try to remove existing WAL file if no new one provided
              await fs.unlink(`${options.databasePath}.wal`).catch(() => {
                console.log("No existing WAL file to remove")
              })
            }
          }

          // Clean up all temp files
          for (const tempFile of tempFiles) {
            await fs.unlink(tempFile).catch(() => {})
          }

          res.json({
            success: true,
            message: "Database restored successfully. You may need to restart the server for changes to take effect.",
          })
        } catch (error) {
          console.error("Error restoring database:", error)

          // Clean up uploaded files
          for (const tempFile of tempFiles) {
            await fs.unlink(tempFile).catch(() => {})
          }

          res.status(500).json({ error: "Failed to restore database: " + (error as Error).message })
        }
      })()
    })
  })

  // Export database using Kuzu's EXPORT DATABASE
  app.get("/api/export", (req: Request, res: Response) => {
    void (async () => {
      try {
        const exportDir = path.join(os.tmpdir(), `kuzu-export-${Date.now()}`)

        // Export database
        await exportDatabase(options.dbManager.conn, exportDir)

        // TODO: Create a ZIP of the exported files
        // For now, we'll just return a message
        res.json({
          success: true,
          message: "Export functionality coming soon. Use EXPORT DATABASE command directly for now.",
          exportPath: exportDir,
        })

        // Clean up export directory after some time
        setTimeout(() => {
          void (async () => {
            try {
              await fs.rm(exportDir, { recursive: true, force: true })
            } catch {
              // Ignore cleanup errors
            }
          })()
        }, 60000) // Clean up after 1 minute
      } catch (error) {
        console.error("Error exporting database:", error)
        res.status(500).json({ error: "Failed to export database: " + (error as Error).message })
      }
    })()
  })

  // Import database using Kuzu's IMPORT DATABASE
  app.post("/api/import", upload.single("export"), (req: Request, res: Response) => {
    void (async () => {
      if (options.isReadOnly) {
        return res.status(403).json({ error: "Database is in read-only mode" })
      }

      const file = req.file
      if (!file) {
        return res.status(400).json({ error: "No file uploaded" })
      }

      try {
        // TODO: Extract ZIP file and import
        // For now, return a message
        res.json({
          success: false,
          message: "Import functionality coming soon. Use IMPORT DATABASE command directly for now.",
        })

        // Clean up uploaded file
        await fs.unlink(file.path).catch(() => {})
      } catch (error) {
        console.error("Error importing database:", error)

        // Clean up uploaded file
        await fs.unlink(file.path).catch(() => {})

        res.status(500).json({ error: "Failed to import database: " + (error as Error).message })
      }
    })()
  })

  return app
}

export function startWebServer(options: WebServerOptions): void {
  console.error(`[startWebServer] Called with port ${options.port}`)

  try {
    const app = createWebServer(options)
    console.error(`[startWebServer] Created Express app`)

    // Start the server directly
    const server = app.listen(options.port, "0.0.0.0")
    console.error(`[startWebServer] Called app.listen, server is:`, typeof server)

    if (server) {
      // Increase timeouts for large uploads
      server.timeout = 5 * 60 * 1000 // 5 minutes
      server.keepAliveTimeout = 5 * 60 * 1000 // 5 minutes
      server.headersTimeout = 6 * 60 * 1000 // 6 minutes

      // Increase max header size for large multipart uploads
      server.maxHeadersCount = 0 // Unlimited

      server.on("listening", () => {
        console.error(`✓ Web UI running on http://localhost:${options.port}/admin`)
        if (options.enableAuth) {
          console.error("  Authentication enabled")
        }
      })

      server.on("error", (err) => {
        console.error(`[startWebServer] Server error:`, err)
      })

      // Handle connection errors
      server.on("connection", (socket) => {
        socket.setTimeout(5 * 60 * 1000) // 5 minutes
        socket.on("error", (err) => {
          console.error("[Socket error]:", err.code)
        })
      })
    }
  } catch (error) {
    console.error(`Error starting web server:`, error)
    throw error
  }
}
