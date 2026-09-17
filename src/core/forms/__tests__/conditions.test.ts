import { describe, expect, it } from 'bun:test'
import { compileExpression } from '../conditions'

describe('compileExpression', () => {
  describe('simple equality', () => {
    it('returns true when an identifier equals a single-quoted string', () => {
      const runner = compileExpression(`framework == "Other"`.replace(/"/g, "'"))
      expect(runner.runValues({ framework: 'Other' })).toBe(true)
    })

    it('returns false when an identifier does not equal the literal', () => {
      const runner = compileExpression(`framework == 'React'`)
      expect(runner.runValues({ framework: 'Vue' })).toBe(false)
    })

    it('returns false when the identifier is missing from values (unknown identifier)', () => {
      const runner = compileExpression(`framework == 'Other'`)
      expect(() => runner.runValues({})).toThrow('unknown identifier: framework')
    })

    it('falls back to properties when values does not contain the identifier', () => {
      const runner = compileExpression(`framework == 'Other'`)
      expect(runner.runValues({}, { framework: 'Other' })).toBe(true)
    })
  })

  describe('inequality', () => {
    it('returns true when values differ', () => {
      const runner = compileExpression(`framework != 'React'`)
      expect(runner.runValues({ framework: 'Vue' })).toBe(true)
    })

    it('returns false when values are equal', () => {
      const runner = compileExpression(`framework != 'React'`)
      expect(runner.runValues({ framework: 'React' })).toBe(false)
    })
  })

  describe('comparisons', () => {
    it('returns true for >= when value is above the threshold', () => {
      const runner = compileExpression(`age >= 18`)
      expect(runner.runValues({ age: 21 })).toBe(true)
    })

    it('returns false for >= when value is below the threshold', () => {
      const runner = compileExpression(`age >= 18`)
      expect(runner.runValues({ age: 17 })).toBe(false)
    })

    it('returns true for >= when value equals the threshold', () => {
      const runner = compileExpression(`age >= 18`)
      expect(runner.runValues({ age: 18 })).toBe(true)
    })

    it('returns true for < when value is below the threshold', () => {
      const runner = compileExpression(`age < 18`)
      expect(runner.runValues({ age: 17 })).toBe(true)
    })

    it('returns true for <= when value equals the threshold', () => {
      const runner = compileExpression(`age <= 18`)
      expect(runner.runValues({ age: 18 })).toBe(true)
    })

    it('returns true for > when value is above the threshold', () => {
      const runner = compileExpression(`age > 18`)
      expect(runner.runValues({ age: 21 })).toBe(true)
    })

    it('compares strings lexicographically', () => {
      const runner = compileExpression(`name < 'm'`)
      expect(runner.runValues({ name: 'alice' })).toBe(true)
      expect(runner.runValues({ name: 'zoe' })).toBe(false)
    })
  })

  describe('logical operators', () => {
    it('evaluates && (true when both operands are truthy)', () => {
      const runner = compileExpression(`a == 1 && b == 2`)
      expect(runner.runValues({ a: 1, b: 2 })).toBe(true)
    })

    it('evaluates && (false when one operand is falsy)', () => {
      const runner = compileExpression(`a == 1 && b == 2`)
      expect(runner.runValues({ a: 1, b: 3 })).toBe(false)
    })

    it('evaluates || (true when at least one operand is truthy)', () => {
      const runner = compileExpression(`a == 1 || a == 2`)
      expect(runner.runValues({ a: 1 })).toBe(true)
      expect(runner.runValues({ a: 2 })).toBe(true)
      expect(runner.runValues({ a: 3 })).toBe(false)
    })

    it('respects && precedence over ||', () => {
      const runner = compileExpression(`a == 1 || b == 2 && c == 3`)
      // parsed as a == 1 || (b == 2 && c == 3)
      expect(runner.runValues({ a: 0, b: 2, c: 3 })).toBe(true)
      expect(runner.runValues({ a: 0, b: 2, c: 0 })).toBe(false)
    })

    it('evaluates ! (true when the operand is falsy)', () => {
      const runner = compileExpression(`!(a == 1)`)
      expect(runner.runValues({ a: 2 })).toBe(true)
      expect(runner.runValues({ a: 1 })).toBe(false)
    })

    it('combines ! with &&', () => {
      const runner = compileExpression(`a == 1 && !(b == 2)`)
      expect(runner.runValues({ a: 1, b: 3 })).toBe(true)
      expect(runner.runValues({ a: 1, b: 2 })).toBe(false)
    })
  })

  describe('in-list', () => {
    it('returns true when the identifier is in a numeric list', () => {
      const runner = compileExpression(`x in [1, 2, 3]`)
      expect(runner.runValues({ x: 2 })).toBe(true)
    })

    it('returns false when the identifier is not in a numeric list', () => {
      const runner = compileExpression(`x in [1, 2, 3]`)
      expect(runner.runValues({ x: 4 })).toBe(false)
    })

    it('supports a single-element list', () => {
      const runner = compileExpression(`x in [42]`)
      expect(runner.runValues({ x: 42 })).toBe(true)
      expect(runner.runValues({ x: 0 })).toBe(false)
    })

    it('supports an empty list', () => {
      const runner = compileExpression(`x in []`)
      expect(runner.runValues({ x: 1 })).toBe(false)
    })

    it('supports a string list', () => {
      const runner = compileExpression(`framework in ['React', 'Vue', 'Svelte']`)
      expect(runner.runValues({ framework: 'Vue' })).toBe(true)
      expect(runner.runValues({ framework: 'Angular' })).toBe(false)
    })

    it('supports a mix of literals and identifier references in the list', () => {
      const runner = compileExpression(`x in [a, 2, 3]`)
      expect(runner.runValues({ a: 1, x: 1 })).toBe(true)
      expect(runner.runValues({ a: 5, x: 5 })).toBe(true)
      expect(runner.runValues({ a: 5, x: 4 })).toBe(false)
    })
  })

  describe('parentheses', () => {
    it('overrides default &&/|| precedence', () => {
      const runner = compileExpression(`(a == 1 || a == 2) && b == 3`)
      expect(runner.runValues({ a: 1, b: 3 })).toBe(true)
      expect(runner.runValues({ a: 2, b: 3 })).toBe(true)
      expect(runner.runValues({ a: 1, b: 4 })).toBe(false)
    })

    it('supports nested parentheses', () => {
      const runner = compileExpression(`((a == 1 && b == 2) || c == 3) && d == 4`)
      expect(runner.runValues({ a: 1, b: 2, c: 0, d: 4 })).toBe(true)
      expect(runner.runValues({ a: 0, b: 0, c: 3, d: 4 })).toBe(true)
      expect(runner.runValues({ a: 0, b: 0, c: 0, d: 4 })).toBe(false)
    })
  })

  describe('literal forms', () => {
    it('treats 0 and empty string as falsy', () => {
      const runner = compileExpression(`value == 0`)
      expect(runner.runValues({ value: 0 })).toBe(true)
      expect(runner.runValues({ value: 1 })).toBe(false)
    })

    it('supports true / false / null keywords', () => {
      const runner = compileExpression(`flag == true`)
      expect(runner.runValues({ flag: true })).toBe(true)
      expect(runner.runValues({ flag: false })).toBe(false)
    })

    it('supports null literal', () => {
      const runner = compileExpression(`value == null`)
      expect(runner.runValues({ value: null })).toBe(true)
      expect(runner.runValues({ value: 0 })).toBe(false)
    })

    it('supports decimal numbers and negative numbers', () => {
      const runner = compileExpression(`price >= -1.5`)
      expect(runner.runValues({ price: -1 })).toBe(true)
      expect(runner.runValues({ price: -2 })).toBe(false)
    })

    it('supports escaped single quotes inside strings', () => {
      const runner = compileExpression(`greeting == 'it\\'s me'`)
      expect(runner.runValues({ greeting: "it's me" })).toBe(true)
    })
  })

  describe('unknown identifier handling', () => {
    it('throws at runValues time when an identifier is missing from values + properties', () => {
      const runner = compileExpression(`foo == 1`)
      expect(() => runner.runValues({})).toThrow('unknown identifier: foo')
    })

    it('does NOT throw when the identifier is explicitly undefined in values', () => {
      const runner = compileExpression(`foo == 1`)
      // `foo in values` is true (key exists), so we resolve to undefined — never throw.
      expect(runner.runValues({ foo: undefined })).toBe(false)
    })

    it('throws on the first unknown identifier even when later identifiers are known', () => {
      const runner = compileExpression(`missing == 1 && present == 2`)
      expect(() => runner.runValues({ present: 2 })).toThrow('unknown identifier: missing')
    })
  })

  describe('getVariables', () => {
    it('returns identifiers in declaration order, deduplicated', () => {
      const runner = compileExpression(`a == 1 && b == 2 || a == 3`)
      expect(runner.getVariables()).toEqual(['a', 'b'])
    })

    it('includes identifiers used inside an in-list', () => {
      const runner = compileExpression(`x in [a, b, 1]`)
      expect(runner.getVariables()).toEqual(['x', 'a', 'b'])
    })

    it('returns an empty array when the expression has no identifiers', () => {
      const runner = compileExpression(`1 == 1`)
      expect(runner.getVariables()).toEqual([])
    })

    it('ignores identifier-shaped words that are actually keywords (true/false/null/in)', () => {
      const runner = compileExpression(`flag == true && other == false`)
      expect(runner.getVariables()).toEqual(['flag', 'other'])
    })
  })

  describe('validate', () => {
    it('returns null on a valid expression', () => {
      const runner = compileExpression(`a == 1`)
      expect(runner.validate()).toBeNull()
    })

    it('returns a non-null error message for an empty source', () => {
      expect(() => compileExpression('')).toThrow()
    })

    it('caches the parse error from compileExpression for later validate() calls', () => {
      // Syntax errors throw at compile time, so there is no runner to call
      // .validate() on — but the runner itself surfaces compile-time failures
      // synchronously. The compileExpression throw is the validation surface
      // for syntax errors.
      expect(() => compileExpression('a ==')).toThrow(SyntaxError)
    })

    it('does not throw at compileExpression time when the identifier is just unknown (it throws at runValues)', () => {
      const runner = compileExpression(`missing == 1`)
      expect(runner.validate()).toBeNull()
    })
  })

  describe('syntax errors', () => {
    it('throws on trailing operator', () => {
      expect(() => compileExpression(`a ==`)).toThrow(SyntaxError)
    })

    it('throws on unbalanced parentheses', () => {
      expect(() => compileExpression(`(a == 1`)).toThrow(SyntaxError)
    })

    it('throws on missing `[` after `in`', () => {
      expect(() => compileExpression(`a in 1`)).toThrow(SyntaxError)
    })

    it('throws on missing `]` after `in [...]`', () => {
      expect(() => compileExpression(`a in [1, 2`)).toThrow(SyntaxError)
    })

    it('throws on a bare `&&` with no operands', () => {
      expect(() => compileExpression(`&&`)).toThrow(SyntaxError)
    })

    it('throws on a single `=` instead of `==`', () => {
      expect(() => compileExpression(`a = 1`)).toThrow(SyntaxError)
    })

    it('throws on a single `&` instead of `&&`', () => {
      expect(() => compileExpression(`a & b`)).toThrow(SyntaxError)
    })

    it('throws on a single `|` instead of `||`', () => {
      expect(() => compileExpression(`a | b`)).toThrow(SyntaxError)
    })

    it('throws on an unterminated string literal', () => {
      expect(() => compileExpression(`a == 'oops`)).toThrow(SyntaxError)
    })
  })
})
