import { constants, DatabaseSync } from 'node:sqlite'

const MAX_INPUT_CHARS = 20_000
const MAX_COLUMNS = 100
const MAX_CELL_CHARS = 10_000
const MAX_RESULT_CHARS = 50_000
const ALLOWED_FUNCTIONS = new Set([
  'abs', 'avg', 'coalesce', 'count', 'date', 'datetime', 'glob', 'ifnull', 'instr', 'json_extract', 'json_type', 'json_valid',
  'julianday', 'length', 'like', 'likely', 'likelihood', 'lower', 'max', 'min', 'nullif', 'round', 'sqlite_version',
  'substr', 'substring', 'sum', 'time', 'total', 'trim', 'ltrim', 'rtrim', 'typeof', 'unixepoch', 'unlikely', 'upper',
])
const ALLOWED_ACTIONS = new Set([constants.SQLITE_SELECT, constants.SQLITE_READ, constants.SQLITE_RECURSIVE])

function boundedString(value, limit = MAX_CELL_CHARS) {
  const source = String(value ?? '')
  return source.length > limit ? `${source.slice(0, limit)}…` : source
}

function normalizedCell(value) {
  if (typeof value === 'bigint') return value.toString()
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return `<blob ${value.byteLength} bytes>`
  if (typeof value === 'string') return boundedString(value)
  if (value === null || typeof value === 'number') return value
  return boundedString(value)
}

function authorizer(action, _first, second) {
  if (ALLOWED_ACTIONS.has(action)) return constants.SQLITE_OK
  if (action === constants.SQLITE_FUNCTION && ALLOWED_FUNCTIONS.has(String(second || '').toLowerCase())) return constants.SQLITE_OK
  return constants.SQLITE_DENY
}

function run(input) {
  if (!input || typeof input.path !== 'string' || !input.path || typeof input.query !== 'string' || input.query.length > 8_000) {
    throw new Error('SQLite reader input is invalid.')
  }
  const database = new DatabaseSync(input.path, { readOnly:true, allowExtension:false })
  try {
    database.enableLoadExtension(false)
    if (typeof database.enableDefensive === 'function') database.enableDefensive(true)
    database.exec('PRAGMA hard_heap_limit = 33554432; PRAGMA cache_size = -4096; PRAGMA temp_store = MEMORY; PRAGMA query_only = ON; PRAGMA trusted_schema = OFF; PRAGMA busy_timeout = 1000;')
    if (typeof database.setAuthorizer === 'function') database.setAuthorizer(authorizer)
    const limit = Math.max(1, Math.min(200, Number(input.limit) || 100))
    const boundedQuery = /^(?:select|with)\b/i.test(input.query) ? `SELECT * FROM (${input.query}) AS penecho_read LIMIT ${limit}` : input.query
    const rows = []
    let resultChars = 2
    for (const row of database.prepare(boundedQuery).iterate()) {
      const normalized = {}
      for (const [key, value] of Object.entries(row).slice(0, MAX_COLUMNS)) normalized[boundedString(key, 200)] = normalizedCell(value)
      const rowChars = JSON.stringify(normalized).length
      if (resultChars + rowChars > MAX_RESULT_CHARS) {
        rows.push({ truncated:'Result reached the 50,000-character reader limit.' })
        break
      }
      rows.push(normalized)
      resultChars += rowChars
      if (rows.length >= limit) break
    }
    return rows
  } finally {
    database.close()
  }
}

let source = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  source += chunk
  if (source.length > MAX_INPUT_CHARS) {
    process.stdout.write(JSON.stringify({ ok:false, error:'SQLite reader input is too large.' }))
    process.exit(2)
  }
})
process.stdin.on('end', () => {
  try {
    process.stdout.write(JSON.stringify({ ok:true, rows:run(JSON.parse(source)) }))
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok:false, error:boundedString(error?.message || error, 2_000) }))
  }
})
