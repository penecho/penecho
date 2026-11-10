// The Harness SDK accepts a subset of JSON Schema. Keep unsupported constraints
// verbatim as annotations for the model; MCP remains the execution validator.
const schemaKeys = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'oneOf', 'description', 'title', 'default', 'examples'])

export function harnessDocumentSchema(schema) {
  if (typeof schema === 'boolean') return { description: `Constraints: ${schema}` }
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema
  const output = {}, constraints = {}
  for (const [key, value] of Object.entries(schema)) {
    if (!schemaKeys.has(key) || (key === 'additionalProperties' && typeof value !== 'boolean') || (key === 'oneOf' && schema.type !== undefined)) {
      constraints[key] = value
    } else if (key === 'properties') {
      output[key] = Object.fromEntries(Object.entries(value).map(([name, node]) => [name, harnessDocumentSchema(node)]))
    } else if (key === 'items') {
      output[key] = harnessDocumentSchema(value)
    } else if (key === 'oneOf') {
      output[key] = value.map(harnessDocumentSchema)
    } else {
      // enum/const/default/examples are literal data, never schema children.
      output[key] = value
    }
  }
  if (Object.keys(constraints).length) {
    output.description = [output.description, `Constraints: ${JSON.stringify(constraints)}`].filter(Boolean).join('\n')
  }
  return output
}
