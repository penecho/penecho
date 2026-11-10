import { lstat, opendir, realpath, unlink } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'

export const AGENT_FILE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const DAY = 24 * 60 * 60 * 1000
const HASH = '[a-f0-9]{64}'
const objectFile = new RegExp(`^objects/[a-f0-9]{2}/${HASH}$`)
const requestFile = new RegExp(`^request-images/[a-f0-9]{2}/${HASH}$`)
const requestTemporary = new RegExp(`^request-images/[a-f0-9]{2}/${HASH}\\.[a-f0-9-]{36}\\.tmp$`)
const uploadTemporary = /^tmp\/[a-f0-9-]{36}$/

export function attachmentRetention(relativePath) {
  if (objectFile.test(relativePath) || requestFile.test(relativePath)) return AGENT_FILE_RETENTION_MS
  if (requestTemporary.test(relativePath) || uploadTemporary.test(relativePath)) return DAY
  return null
}

/** Private managed files only. Retains directory cursors rather than loading an entire tree. */
export class ManagedFileRetention {
  constructor({ root, policy, directoryAllowed = () => false, protectedFile = () => false, deleteFile = async path=>{await unlink(path);return true}, maxEntries = 64, maxDeletes = 16, budgetMs = 25, clock = Date.now }) {
    this.root = resolve(root)
    this.policy = policy
    this.directoryAllowed = directoryAllowed
    this.protectedFile = protectedFile
    this.deleteFile = deleteFile
    this.maxEntries = maxEntries
    this.maxDeletes = maxDeletes
    this.budgetMs = budgetMs
    this.clock = clock
    this.stack = []
    this.running = null
    this.closed = false
  }

  async validDirectory(path) {
    const info = await lstat(path)
    return info.isDirectory() && !info.isSymbolicLink() && await realpath(path) === path
  }

  runOnce({ signal } = {}) {
    if (this.closed || signal?.aborted) return Promise.resolve({ scanned:0, deleted:0, bytes:0 })
    if (this.running) return this.running
    this.running = this.sweep(signal).finally(() => { this.running = null })
    return this.running
  }

  async sweep(signal) {
    const result = { scanned:0, deleted:0, bytes:0, skipped:0 }, started = performance.now()
    try {
      if (!this.stack.length) {
        const rootInfo = await lstat(this.root)
        if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) return result
        // macOS /tmp and /var are OS symlinks; canonicalize parents, never a symlink managed root.
        this.root = await realpath(this.root)
      }
      if (!await this.validDirectory(this.root)) return result
      if (!this.stack.length) this.stack.push({ path:this.root, directory:await opendir(this.root, { bufferSize:16 }) })
      while (this.stack.length && result.scanned < this.maxEntries && result.deleted < this.maxDeletes && performance.now() - started < this.budgetMs && !this.closed && !signal?.aborted) {
        const current = this.stack.at(-1)
        if (!await this.validDirectory(current.path)) { await this.reset(); break }
        const entry = await current.directory.read()
        if (!entry) {
          await current.directory.close()
          this.stack.pop()
          continue
        }
        result.scanned++
        const path = join(current.path, entry.name), relativePath = path.slice(this.root.length + 1).split(sep).join('/')
        if (entry.isSymbolicLink()) { result.skipped++; continue }
        if (entry.isDirectory()) {
          if (this.directoryAllowed(relativePath) && await this.validDirectory(path)) this.stack.push({ path, directory:await opendir(path, { bufferSize:16 }) })
          continue
        }
        const retentionMs = this.policy(relativePath)
        if (retentionMs === null || retentionMs === undefined || !entry.isFile() || this.protectedFile(relativePath)) continue
        try {
          const info = await lstat(path)
          if (!info.isFile() || info.isSymbolicLink() || this.clock() - info.mtimeMs < retentionMs || await realpath(path) !== path) continue
          // Recheck after I/O: a request may have started or renewed a file while we yielded.
          if (this.closed || signal?.aborted || this.protectedFile(relativePath)) continue
          const latest = await lstat(path)
          if (!latest.isFile() || latest.ino !== info.ino || latest.mtimeMs !== info.mtimeMs || this.protectedFile(relativePath)) continue
          if (!await this.deleteFile(path,relativePath)) continue
          result.deleted++
          result.bytes += info.size
        } catch (error) {
          if (error?.code !== 'ENOENT') result.skipped++
        }
        await new Promise(resolve => setImmediate(resolve))
      }
    } catch (error) {
      await this.reset()
      if (error?.code !== 'ENOENT') throw error
    }
    return { ...result, pending:this.stack.length>0 }
  }

  async reset() {
    const handles = this.stack.splice(0)
    await Promise.allSettled(handles.map(item => item.directory.close()))
  }

  async close() {
    this.closed = true
    await this.running
    await this.reset()
  }
}
