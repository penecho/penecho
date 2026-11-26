import { createHash } from 'node:crypto'

// Small helpers shared by the Canvas engine and the PenEcho runner for Lines.
export const MAX_TOOL_RESULT_CHARS = 400_000

export function hash(value) {
  return createHash('sha256').update(String(value)).digest('hex')
}

export function boundedText(value, limit = MAX_TOOL_RESULT_CHARS) {
  const text = String(value ?? '')
  return text.length > limit ? `${text.slice(0, limit)}\n…[truncated]` : text
}

export function textOutput() {
  return {
    schema:{ type:'string' },
    render(_args, value) {
      return [{ type:'text', text:boundedText(value) }]
    },
  }
}
