import * as fs from "fs/promises"
import * as path from "path"
import { Connection } from "kuzu"
import { createReadStream, createWriteStream } from "fs"
import { pipeline } from "stream/promises"
import { createGzip, createGunzip } from "zlib"

export interface BackupInfo {
  mainFile: string
  walFile?: string
  timestamp: Date
  size: number
}

/**
 * Check if a database file exists and get its info
 */
export async function getDatabaseInfo(dbPath: string): Promise<BackupInfo | null> {
  try {
    const stats = await fs.stat(dbPath)
    if (!stats.isFile() && !stats.isDirectory()) {
      return null
    }

    // Check for WAL file
    const walPath = `${dbPath}.wal`
    let walExists = false
    try {
      const walStats = await fs.stat(walPath)
      walExists = walStats.isFile()
    } catch {
      // WAL file doesn't exist
    }

    return {
      mainFile: dbPath,
      walFile: walExists ? walPath : undefined,
      timestamp: stats.mtime,
      size: stats.size,
    }
  } catch (error) {
    return null
  }
}

/**
 * Create a gzipped backup of the database files
 * Returns the path to the backup file
 */
export async function createBackup(dbPath: string, outputDir: string): Promise<string> {
  const info = await getDatabaseInfo(dbPath)
  if (!info) {
    throw new Error(`Database not found at ${dbPath}`)
  }

  // Create output directory if it doesn't exist
  await fs.mkdir(outputDir, { recursive: true })

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  const backupName = `kuzu-backup-${timestamp}.gz`
  const backupPath = path.join(outputDir, backupName)

  // For simplicity, we'll concatenate the files with a separator
  // Format: [4 bytes: main file size][main file data][wal file data if exists]
  const writeStream = createWriteStream(backupPath)
  const gzip = createGzip()

  // Pipe through gzip
  gzip.pipe(writeStream)

  // Read main database file
  const mainData = await fs.readFile(info.mainFile)

  // Write header with file info
  const header = JSON.stringify({
    mainFileName: path.basename(info.mainFile),
    mainFileSize: mainData.length,
    hasWal: !!info.walFile,
    walFileSize: 0,
    timestamp: info.timestamp,
  })

  // If WAL exists, read it
  let walData: Buffer | null = null
  if (info.walFile) {
    walData = await fs.readFile(info.walFile)
  }

  // Update header with WAL size
  const finalHeader = JSON.stringify({
    mainFileName: path.basename(info.mainFile),
    mainFileSize: mainData.length,
    hasWal: !!info.walFile,
    walFileSize: walData?.length || 0,
    timestamp: info.timestamp,
  })

  // Write header length (4 bytes)
  const headerBuffer = Buffer.from(finalHeader)
  const headerLengthBuffer = Buffer.allocUnsafe(4)
  headerLengthBuffer.writeUInt32BE(headerBuffer.length, 0)

  // Write to gzip stream
  gzip.write(headerLengthBuffer)
  gzip.write(headerBuffer)
  gzip.write(mainData)
  if (walData) {
    gzip.write(walData)
  }
  gzip.end()

  // Wait for writing to complete
  await new Promise((resolve, reject) => {
    writeStream.on("finish", resolve)
    writeStream.on("error", reject)
  })

  return backupPath
}

/**
 * Restore a database from a gzipped backup
 */
export async function restoreBackup(backupPath: string, targetDbPath: string): Promise<void> {
  // Check if backup file exists
  const backupStats = await fs.stat(backupPath)
  if (!backupStats.isFile()) {
    throw new Error(`Backup file not found: ${backupPath}`)
  }

  // Read and decompress the backup
  const readStream = createReadStream(backupPath)
  const gunzip = createGunzip()

  const chunks: Buffer[] = []
  await pipeline(readStream, gunzip, async function* (source) {
    for await (const chunk of source) {
      chunks.push(chunk)
    }
  })

  const data = Buffer.concat(chunks)

  // Read header length
  const headerLength = data.readUInt32BE(0)
  const headerData = data.subarray(4, 4 + headerLength)
  const header = JSON.parse(headerData.toString())

  // Extract files
  let offset = 4 + headerLength
  const mainData = data.subarray(offset, offset + header.mainFileSize)
  offset += header.mainFileSize

  let walData: Buffer | null = null
  if (header.hasWal && header.walFileSize > 0) {
    walData = data.subarray(offset, offset + header.walFileSize)
  }

  // Write files to target location
  await fs.writeFile(targetDbPath, mainData)
  if (walData) {
    await fs.writeFile(`${targetDbPath}.wal`, walData)
  }
}

/**
 * Export database using Kuzu's EXPORT DATABASE command
 */
export async function exportDatabase(conn: Connection, exportPath: string): Promise<void> {
  await fs.mkdir(exportPath, { recursive: true })

  const query = `EXPORT DATABASE '${exportPath}'`
  const result = await conn.query(query)

  // Wait for export to complete
  await result.getAll()
}

/**
 * Import database using Kuzu's IMPORT DATABASE command
 */
export async function importDatabase(conn: Connection, importPath: string): Promise<void> {
  // Check if export files exist
  const files = ["schema.cypher", "copy.cypher"]
  for (const file of files) {
    const filePath = path.join(importPath, file)
    try {
      await fs.access(filePath)
    } catch {
      throw new Error(`Required export file not found: ${file}`)
    }
  }

  const query = `IMPORT DATABASE '${importPath}'`
  const result = await conn.query(query)

  // Wait for import to complete
  await result.getAll()
}

/**
 * Create a simple ZIP-like archive of database files in memory
 * Returns a Buffer containing both files
 */
export async function createSimpleArchive(dbPath: string): Promise<Buffer> {
  const info = await getDatabaseInfo(dbPath)
  if (!info) {
    throw new Error(`Database not found at ${dbPath}`)
  }

  // Read files
  const mainData = await fs.readFile(info.mainFile)
  const walData = info.walFile ? await fs.readFile(info.walFile) : null

  // Create a simple format:
  // [4 bytes: header length][header JSON][main file][wal file if exists]
  const header = {
    mainFileName: path.basename(info.mainFile),
    mainFileSize: mainData.length,
    hasWal: !!walData,
    walFileSize: walData?.length || 0,
    timestamp: info.timestamp.toISOString(),
  }

  const headerJson = JSON.stringify(header)
  const headerBuffer = Buffer.from(headerJson)

  // Allocate buffer for entire archive
  const totalSize = 4 + headerBuffer.length + mainData.length + (walData?.length || 0)
  const archive = Buffer.allocUnsafe(totalSize)

  // Write header length
  archive.writeUInt32BE(headerBuffer.length, 0)

  // Write header
  headerBuffer.copy(archive, 4)

  // Write main file
  mainData.copy(archive, 4 + headerBuffer.length)

  // Write WAL file if exists
  if (walData) {
    walData.copy(archive, 4 + headerBuffer.length + mainData.length)
  }

  return archive
}

/**
 * Restore from a simple archive Buffer
 */
export async function restoreSimpleArchive(archive: Buffer, targetDbPath: string): Promise<void> {
  // Read header length
  const headerLength = archive.readUInt32BE(0)

  // Read header
  const headerJson = archive.subarray(4, 4 + headerLength).toString()
  const header = JSON.parse(headerJson)

  // Extract main file
  let offset = 4 + headerLength
  const mainData = archive.subarray(offset, offset + header.mainFileSize)
  await fs.writeFile(targetDbPath, mainData)

  // Extract WAL file if exists
  if (header.hasWal && header.walFileSize > 0) {
    offset += header.mainFileSize
    const walData = archive.subarray(offset, offset + header.walFileSize)
    await fs.writeFile(`${targetDbPath}.wal`, walData)
  }
}
