import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi'
import { z } from 'zod'

// One zod instance, extended with .openapi() so the schemas that validate
// requests also generate the OpenAPI document (src/config/openapi.ts).
extendZodWithOpenApi(z)

// The type name zod 3 reported as "received" in its messages.
function receivedType(input: unknown) {
  if (input === null) return 'null'
  if (Array.isArray(input)) return 'array'
  if (input instanceof Date) return 'date'
  if (typeof input === 'number' && Number.isNaN(input)) return 'nan'
  return typeof input
}

const quote = (value: unknown) => (typeof value === 'string' ? `'${value}'` : String(value))

// Zod 4 words its default messages differently. Keep the zod 3 wording the
// sandbox's 400 responses have always used (e.g. "Required",
// "Unrecognized key(s) in object: 'x'"). Messages a schema sets itself win.
z.config({
  customError: issue => {
    switch (issue.code) {
      case 'invalid_type': {
        if (issue.input === undefined) return 'Required'
        if (issue.expected === 'int') return 'Expected integer, received float'
        // zod 3 called a record an object.
        const expected = issue.expected === 'record' ? 'object' : issue.expected
        return `Expected ${expected}, received ${receivedType(issue.input)}`
      }
      case 'unrecognized_keys':
        return `Unrecognized key(s) in object: ${issue.keys.map(key => `'${key}'`).join(', ')}`
      case 'invalid_value': {
        const type = (issue.inst as { _zod?: { def?: { type?: string } } } | undefined)?._zod?.def?.type
        if (type === 'literal') return `Invalid literal value, expected ${JSON.stringify(issue.values[0])}`
        if (issue.input === undefined) return 'Required'
        const options = issue.values.map(quote).join(' | ')
        // zod 3 reported a value of the wrong type as an invalid type.
        if (typeof issue.input !== typeof issue.values[0])
          return `Expected ${options}, received ${receivedType(issue.input)}`
        return `Invalid enum value. Expected ${options}, received ${quote(issue.input)}`
      }
      case 'too_small': {
        const { exact, inclusive, minimum, origin } = issue
        if (origin === 'string')
          return `String must contain ${exact ? 'exactly' : inclusive ? 'at least' : 'over'} ${minimum} character(s)`
        if (origin === 'array')
          return `Array must contain ${exact ? 'exactly' : inclusive ? 'at least' : 'more than'} ${minimum} element(s)`
        if (origin === 'number' || origin === 'int')
          return `Number must be ${exact ? 'exactly equal to' : inclusive ? 'greater than or equal to' : 'greater than'} ${minimum}`
        return undefined
      }
      case 'too_big': {
        const { exact, inclusive, maximum, origin } = issue
        if (origin === 'string')
          return `String must contain ${exact ? 'exactly' : inclusive ? 'at most' : 'under'} ${maximum} character(s)`
        if (origin === 'array')
          return `Array must contain ${exact ? 'exactly' : inclusive ? 'at most' : 'less than'} ${maximum} element(s)`
        if (origin === 'number' || origin === 'int')
          return `Number must be ${exact ? 'exactly' : inclusive ? 'less than or equal to' : 'less than'} ${maximum}`
        return undefined
      }
      case 'invalid_union':
        return 'Invalid input'
      default:
        return undefined
    }
  },
})

export { z }
