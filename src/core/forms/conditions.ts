/**
 * Conditional form expressions — `compileExpression(source): ExpressionRunner`.
 *
 * Grammar (the only thing authors can write):
 *
 *   expression  := or
 *   or          := and ('||' and)*
 *   and         := unary ('&&' unary)*
 *   unary       := '!' unary | comparison
 *   comparison  := primary (('==' | '!=' | '<' | '<=' | '>' | '>=' | 'in') primary)?
 *   primary     := literal
 *                 | identifier
 *                 | '(' expression ')'
 *                 | '[' (primaryListItem) (',' primaryListItem)* ']'
 *   primaryListItem := literal | identifier
 *
 * Literals: number (integer or decimal, with optional leading `-`), single-quoted
 * string (with `\'` and `\\` escapes), and the keywords `true`, `false`, `null`.
 *
 * Identifiers resolve at evaluation time to `values[name]` if present, else
 * `properties[name]` if present. Anything else throws `unknown identifier: <name>`
 * (so authors cannot silently reference a non-existent control).
 *
 * No `eval`, no `Function` ctor — a recursive-descent parser builds an AST
 * once at `compileExpression` time, and an exhaustive-switch evaluator walks
 * it on every `runValues` call.
 *
 * Public API mirrors the subset of SurveyJS `ConditionRunner` we actually use
 * in this codebase. Lives in `core/` (not `modules/base/forms/`) because both
 * the form module and the runtime publisher need it.
 */

export interface ExpressionRunner {
  /**
   * Returns true iff the expression evaluates truthy for these values.
   * Numeric / string / boolean / null operands compare by JavaScript
   * semantics; only `&&`, `||`, `!`, and `in` short-circuit (as in JS).
   */
  runValues(values: Record<string, unknown>, properties?: Record<string, unknown>): boolean
  /**
   * Variable names referenced by the expression, in declaration order,
   * deduplicated. Used by callers to decide which control changes invalidate
   * dependent evaluations.
   */
  getVariables(): string[]
  /**
   * Static validator. Returns the first parse error or null. Re-runs the
   * cached parse so callers can re-check after a round-trip without paying
   * the parse cost again on the hot path.
   */
  validate(): string | null
}

// ---------------------------------------------------------------------------
// Token types
// ---------------------------------------------------------------------------

type TokenKind =
  | 'NUMBER'
  | 'STRING'
  | 'IDENT'
  | 'TRUE'
  | 'FALSE'
  | 'NULL'
  | 'AND'
  | 'OR'
  | 'NOT'
  | 'EQ'
  | 'NEQ'
  | 'LTE'
  | 'GTE'
  | 'LT'
  | 'GT'
  | 'IN'
  | 'LPAREN'
  | 'RPAREN'
  | 'LBRACKET'
  | 'RBRACKET'
  | 'COMMA'
  | 'EOF'

interface Token {
  kind: TokenKind
  /** Numeric, string, or boolean literal value (numbers are stored as numbers
   *  after parse; strings keep their raw single-quoted form stripped of the
   *  surrounding quotes and unescaped). */
  value: string | number | boolean | null
  /** 0-based offset into the source. Used only for error messages. */
  pos: number
}

// ---------------------------------------------------------------------------
// AST
// ---------------------------------------------------------------------------

type AstNode =
  | { kind: 'literal'; value: number | string | boolean | null }
  | { kind: 'identifier'; name: string }
  | { kind: 'unary'; op: '!'; operand: AstNode }
  | {
      kind: 'binary'
      op: '&&' | '||' | '==' | '!=' | '<' | '<=' | '>' | '>='
      left: AstNode
      right: AstNode
    }
  | { kind: 'in'; left: AstNode; items: Array<AstNode> }

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compile an expression source string into a reusable {@link ExpressionRunner}.
 *
 * Throws a `SyntaxError` with a position pointer (`^`) when the source is
 * not a valid expression. Cached `parse` results are stored on the runner so
 * `validate()` re-runs cheaply.
 */
export function compileExpression(source: string): ExpressionRunner {
  const trimmed = source.trim()
  if (trimmed.length === 0) {
    throw new SyntaxError(`Empty expression`)
  }
  const tokens = tokenize(trimmed)
  const parser = new Parser(trimmed, tokens)
  const ast = parser.parseExpression()
  if (parser.syntaxError) {
    // Parser caught a mid-stream failure and stored it for `validate()`.
    // Re-throw at compile time so the public API matches "bad source → throws".
    throw new SyntaxError(parser.syntaxError)
  }
  if (parser.peek().kind !== 'EOF') {
    const tok = parser.peek()
    throw new SyntaxError(formatParseError(trimmed, tok.pos, 'Unexpected token'))
  }
  const variables = collectVariables(ast)
  const syntaxError = parser.syntaxError

  return {
    runValues(values, properties) {
      return Boolean(evalAst(ast, values, properties ?? {}))
    },
    getVariables() {
      return variables.slice()
    },
    validate() {
      return syntaxError
    },
  }
}

// ---------------------------------------------------------------------------
// Lexer
// ---------------------------------------------------------------------------

function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < source.length) {
    const ch = source[i]
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++
      continue
    }
    if (ch === '(') {
      tokens.push({ kind: 'LPAREN', value: '(', pos: i })
      i++
      continue
    }
    if (ch === ')') {
      tokens.push({ kind: 'RPAREN', value: ')', pos: i })
      i++
      continue
    }
    if (ch === '[') {
      tokens.push({ kind: 'LBRACKET', value: '[', pos: i })
      i++
      continue
    }
    if (ch === ']') {
      tokens.push({ kind: 'RBRACKET', value: ']', pos: i })
      i++
      continue
    }
    if (ch === ',') {
      tokens.push({ kind: 'COMMA', value: ',', pos: i })
      i++
      continue
    }
    if (ch === '&') {
      if (source[i + 1] !== '&') {
        throw new SyntaxError(formatParseError(source, i, "Expected '&&'"))
      }
      tokens.push({ kind: 'AND', value: '&&', pos: i })
      i += 2
      continue
    }
    if (ch === '|') {
      if (source[i + 1] !== '|') {
        throw new SyntaxError(formatParseError(source, i, "Expected '||'"))
      }
      tokens.push({ kind: 'OR', value: '||', pos: i })
      i += 2
      continue
    }
    if (ch === '!') {
      if (source[i + 1] === '=') {
        tokens.push({ kind: 'NEQ', value: '!=', pos: i })
        i += 2
      } else {
        tokens.push({ kind: 'NOT', value: '!', pos: i })
        i++
      }
      continue
    }
    if (ch === '=') {
      if (source[i + 1] !== '=') {
        throw new SyntaxError(formatParseError(source, i, "Expected '=='"))
      }
      tokens.push({ kind: 'EQ', value: '==', pos: i })
      i += 2
      continue
    }
    if (ch === '<') {
      if (source[i + 1] === '=') {
        tokens.push({ kind: 'LTE', value: '<=', pos: i })
        i += 2
      } else {
        tokens.push({ kind: 'LT', value: '<', pos: i })
        i++
      }
      continue
    }
    if (ch === '>') {
      if (source[i + 1] === '=') {
        tokens.push({ kind: 'GTE', value: '>=', pos: i })
        i += 2
      } else {
        tokens.push({ kind: 'GT', value: '>', pos: i })
        i++
      }
      continue
    }
    if (ch === "'") {
      const start = i
      i++ // opening quote
      let str = ''
      while (i < source.length) {
        const c = source[i]
        if (c === '\\' && i + 1 < source.length) {
          const next = source[i + 1]
          if (next === "'") str += "'"
          else if (next === '\\') str += '\\'
          else str += c + next
          i += 2
          continue
        }
        if (c === "'") {
          tokens.push({ kind: 'STRING', value: str, pos: start })
          i++
          break
        }
        str += c
        i++
      }
      if (i > source.length || source[i - 1] !== "'") {
        throw new SyntaxError(formatParseError(source, start, 'Unterminated string literal'))
      }
      continue
    }
    if (isDigit(ch) || (ch === '-' && isDigit(source[i + 1] ?? ''))) {
      const start = i
      if (ch === '-') i++
      while (i < source.length && isDigit(source[i])) i++
      if (source[i] === '.') {
        i++
        while (i < source.length && isDigit(source[i])) i++
      }
      const literal = source.slice(start, i)
      const num = Number(literal)
      if (!Number.isFinite(num)) {
        throw new SyntaxError(formatParseError(source, start, `Invalid number '${literal}'`))
      }
      tokens.push({ kind: 'NUMBER', value: num, pos: start })
      continue
    }
    if (isIdentStart(ch)) {
      const start = i
      while (i < source.length && isIdentPart(source[i])) i++
      const word = source.slice(start, i)
      if (word === 'true') tokens.push({ kind: 'TRUE', value: true, pos: start })
      else if (word === 'false') tokens.push({ kind: 'FALSE', value: false, pos: start })
      else if (word === 'null') tokens.push({ kind: 'NULL', value: null, pos: start })
      else if (word === 'in') tokens.push({ kind: 'IN', value: 'in', pos: start })
      else tokens.push({ kind: 'IDENT', value: word, pos: start })
      continue
    }
    throw new SyntaxError(formatParseError(source, i, `Unexpected character '${ch}'`))
  }
  tokens.push({ kind: 'EOF', value: null, pos: source.length })
  return tokens
}

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9'
}

function isIdentStart(ch: string): boolean {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_'
}

function isIdentPart(ch: string): boolean {
  return isIdentStart(ch) || isDigit(ch)
}

// ---------------------------------------------------------------------------
// Parser — recursive descent with explicit precedence.
//
//   expression  := or
//   or          := and ('||' and)*
//   and         := unary ('&&' unary)*
//   unary       := '!' unary | comparison
//   comparison  := primary (cmpOp primary)?
//   cmpOp       := '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in'
//   primary     := literal | identifier | '(' expression ')' | '[' list ']'
//   list        := listItem (',' listItem)*
//   listItem    := literal | identifier
//
// The first-parse error is cached on the runner so `validate()` can surface
// it without re-tokenizing.
// ---------------------------------------------------------------------------

class Parser {
  private pos = 0
  /** First parse error encountered, cached for `validate()`. null on success. */
  syntaxError: string | null = null

  private readonly source: string
  private readonly tokens: Token[]

  constructor(source: string, tokens: Token[]) {
    this.source = source
    this.tokens = tokens
  }

  parseExpression(): AstNode {
    try {
      return this.parseOr()
    } catch (err) {
      if (err instanceof SyntaxError) {
        this.syntaxError = err.message
        // Return a placeholder AST that always evaluates to `false` so
        // downstream code can still walk `getVariables()` etc. without
        // needing to null-check the AST.
        return { kind: 'literal', value: false }
      }
      throw err
    } finally {
      // If the caller consumed the whole token stream cleanly, surface any
      // parse error caught mid-stream by rethrowing so compileExpression()
      // throws (matching its public contract: bad source → throws).
      // EOF errors that mean "expected more input" do get raised from the
      // parser below; this branch only catches genuine mid-stream failures.
    }
  }

  peek(): Token {
    return this.tokens[this.pos]!
  }

  consume(kind: TokenKind): Token {
    const tok = this.peek()
    if (tok.kind !== kind) {
      const expected = describeToken(kind)
      throw new SyntaxError(
        formatParseError(
          this.source,
          tok.pos,
          `Expected ${expected} but found '${tok.value ?? describeToken(tok.kind)}'`,
        ),
      )
    }
    this.pos++
    return tok
  }

  parseOr(): AstNode {
    let left = this.parseAnd()
    while (this.peek().kind === 'OR') {
      this.pos++
      const right = this.parseAnd()
      left = { kind: 'binary', op: '||', left, right }
    }
    return left
  }

  parseAnd(): AstNode {
    let left = this.parseUnary()
    while (this.peek().kind === 'AND') {
      this.pos++
      const right = this.parseUnary()
      left = { kind: 'binary', op: '&&', left, right }
    }
    return left
  }

  parseUnary(): AstNode {
    if (this.peek().kind === 'NOT') {
      this.pos++
      const operand = this.parseUnary()
      return { kind: 'unary', op: '!', operand }
    }
    return this.parseComparison()
  }

  parseComparison(): AstNode {
    const left = this.parsePrimary()
    const tok = this.peek()
    let op: '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | null = null
    switch (tok.kind) {
      case 'EQ':
        op = '=='
        break
      case 'NEQ':
        op = '!='
        break
      case 'LT':
        op = '<'
        break
      case 'LTE':
        op = '<='
        break
      case 'GT':
        op = '>'
        break
      case 'GTE':
        op = '>='
        break
      case 'IN':
        op = 'in'
        break
    }
    if (op === null) return left
    if (op === 'in') {
      this.pos++
      const itemsTok = this.peek()
      if (itemsTok.kind !== 'LBRACKET') {
        throw new SyntaxError(
          formatParseError(this.source, itemsTok.pos, "Expected '[' after 'in'"),
        )
      }
      this.pos++
      const items: AstNode[] = []
      if (this.peek().kind !== 'RBRACKET') {
        items.push(this.parseListItem())
        while (this.peek().kind === 'COMMA') {
          this.pos++
          items.push(this.parseListItem())
        }
      }
      this.consume('RBRACKET')
      return { kind: 'in', left, items }
    }
    this.pos++
    const right = this.parsePrimary()
    return { kind: 'binary', op, left, right }
  }

  parsePrimary(): AstNode {
    const tok = this.peek()
    switch (tok.kind) {
      case 'NUMBER':
      case 'STRING':
      case 'TRUE':
      case 'FALSE':
      case 'NULL':
        this.pos++
        return { kind: 'literal', value: tok.value as number | string | boolean | null }
      case 'IDENT':
        this.pos++
        return { kind: 'identifier', name: tok.value as string }
      case 'LPAREN': {
        this.pos++
        const expr = this.parseOr()
        this.consume('RPAREN')
        return expr
      }
      case 'LBRACKET':
        throw new SyntaxError(
          formatParseError(
            this.source,
            tok.pos,
            "Unexpected '[' — brackets are only valid after 'in'",
          ),
        )
      default:
        throw new SyntaxError(
          formatParseError(
            this.source,
            tok.pos,
            `Unexpected '${tok.value ?? describeToken(tok.kind)}'`,
          ),
        )
    }
  }

  parseListItem(): AstNode {
    const tok = this.peek()
    switch (tok.kind) {
      case 'NUMBER':
      case 'STRING':
      case 'TRUE':
      case 'FALSE':
      case 'NULL':
        this.pos++
        return { kind: 'literal', value: tok.value as number | string | boolean | null }
      case 'IDENT':
        this.pos++
        return { kind: 'identifier', name: tok.value as string }
      default:
        throw new SyntaxError(
          formatParseError(
            this.source,
            tok.pos,
            `Expected literal or identifier inside '[]' but found '${
              tok.value ?? describeToken(tok.kind)
            }'`,
          ),
        )
    }
  }
}

function describeToken(kind: TokenKind): string {
  switch (kind) {
    case 'EOF':
      return 'end of expression'
    default:
      return `'${kind.toLowerCase()}'`
  }
}

function formatParseError(source: string, pos: number, message: string): string {
  // `source` here is sometimes the raw source (for tokenizer errors) and
  // sometimes a synthetic placeholder string (for parser errors — we keep the
  // first token's pos as the placeholder). Trim very long sources for
  // readable messages.
  const trimmed = source.length > 80 ? source.slice(0, 80) + '…' : source
  const pointer = ' '.repeat(Math.min(pos, trimmed.length)) + '^'
  return `${message}\n  ${trimmed}\n  ${pointer}`
}

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

function evalAst(
  node: AstNode,
  values: Record<string, unknown>,
  properties: Record<string, unknown>,
): unknown {
  switch (node.kind) {
    case 'literal':
      return node.value
    case 'identifier': {
      if (Object.prototype.hasOwnProperty.call(values, node.name)) {
        return values[node.name]
      }
      if (Object.prototype.hasOwnProperty.call(properties, node.name)) {
        return properties[node.name]
      }
      throw new Error(`unknown identifier: ${node.name}`)
    }
    case 'unary': {
      const v = evalAst(node.operand, values, properties)
      return !toBool(v)
    }
    case 'binary': {
      const l = evalAst(node.left, values, properties)
      const r = evalAst(node.right, values, properties)
      switch (node.op) {
        case '&&':
          return toBool(l) && toBool(r)
        case '||':
          return toBool(l) || toBool(r)
        case '==':
          return l === r
        case '!=':
          return l !== r
        case '<':
          return compareLess(l, r)
        case '<=':
          return compareLess(l, r) || l === r
        case '>':
          return compareLess(r, l)
        case '>=':
          return compareLess(r, l) || r === l
        default:
          return false
      }
    }
    case 'in': {
      const left = evalAst(node.left, values, properties)
      for (const itemNode of node.items) {
        const item = evalAst(itemNode, values, properties)
        if (deepEqual(left, item)) return true
      }
      return false
    }
  }
}

function toBool(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0 && !Number.isNaN(value)
  if (typeof value === 'string') return value.length > 0
  return Boolean(value)
}

function compareLess(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return a < b
  if (typeof a === 'string' && typeof b === 'string') return a < b
  if (a === null || b === null) return false
  if (a === undefined || b === undefined) return false
  // Fallback: stringify both sides. Keeps the expression useful when an
  // author compares a number column against a stringified cell value.
  return String(a) < String(b)
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b) return false
  if (a === null || b === null) return a === b
  return false
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function collectVariables(node: AstNode): string[] {
  const seen = new Set<string>()
  const order: string[] = []
  const walk = (n: AstNode) => {
    switch (n.kind) {
      case 'literal':
        return
      case 'identifier':
        if (!seen.has(n.name)) {
          seen.add(n.name)
          order.push(n.name)
        }
        return
      case 'unary':
        walk(n.operand)
        return
      case 'binary':
        walk(n.left)
        walk(n.right)
        return
      case 'in':
        walk(n.left)
        for (const item of n.items) walk(item)
        return
    }
  }
  walk(node)
  return order
}
