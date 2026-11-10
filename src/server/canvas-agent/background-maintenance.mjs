/** One delayed, serial owner for best-effort work. Never await this on a request. */
export class BackgroundMaintenance {
  constructor({ tasks = [], intervalMs = 60_000, initialDelayMs = 60_000, logger = null } = {}) {
    this.tasks = tasks
    this.intervalMs = Math.max(1000, intervalMs)
    this.initialDelayMs = Math.max(1000, initialDelayMs)
    this.logger = logger
    this.timer = null
    this.running = null
    this.closed = false
    this.started = false
    this.controller = new AbortController()
    this.results = {}
    this.nextRuns = new Map()
  }

  start() {
    if (this.started || this.closed) return
    this.started = true
    this.schedule(this.initialDelayMs)
  }

  schedule(delay) {
    if (this.closed) return
    this.timer = setTimeout(async () => {
      this.timer = null
      await this.runOnce({ scheduled:true })
      const next = Math.min(...this.tasks.map(task=>this.nextRuns.get(task.name) || Date.now()+this.intervalMs))
      this.schedule(Math.max(1000,Math.min(this.intervalMs,next-Date.now())))
    }, delay)
    this.timer.unref?.()
  }

  runOnce({ scheduled = false } = {}) {
    if (this.closed) return Promise.resolve()
    if (this.running) return this.running
    this.running = (async () => {
      for (const task of this.tasks) {
        if (this.closed) break
        if (scheduled && (this.nextRuns.get(task.name)||0)>Date.now()) continue
        const startedAt = Date.now()
        try {
          const result = await task.run({ signal:this.controller.signal })
          this.results[task.name] = { at:Date.now(), durationMs:Date.now() - startedAt, result }
          this.nextRuns.set(task.name,Date.now()+(result?.pending ? 1000 : this.intervalMs))
        } catch (error) {
          const code = String(error?.code || error?.name || 'maintenance_failed').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)
          this.results[task.name] = { at:Date.now(), durationMs:Date.now() - startedAt, error:code }
          this.nextRuns.set(task.name,Date.now()+this.intervalMs)
          try { this.logger?.({ task:task.name, errorCode:code }) } catch { /* housekeeping cannot fail through logging */ }
        }
        await new Promise(resolve => setImmediate(resolve))
      }
    })().finally(() => { this.running = null })
    return this.running
  }

  snapshot() { return { running:Boolean(this.running), tasks:{ ...this.results } } }

  async close() {
    this.closed = true
    this.controller.abort()
    clearTimeout(this.timer)
    this.timer = null
    await this.running
  }
}
