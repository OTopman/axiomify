/**
 * Symbol table for IR schemas — fast name→IRType resolution, hierarchical
 * scope tracking, collision detection, import tracking, and deduplication.
 *
 * Supports:
 *   - Hierarchical scopes (global → service → namespace → type)
 *   - Import tracking across federated schemas
 *   - Collision resolution strategies
 *   - Batch registration from schema
 *   - Reserved word detection per target language
 */
import type { IRType, IREndpoint, IRSecurityScheme, IRSchema, IREventContract } from './types';

export interface Symbol {
  name: string;
  kind: 'type' | 'endpoint' | 'security-scheme' | 'event';
  node: IRType | IREndpoint | IRSecurityScheme | IREventContract;
  source?: string;
  /** Scope path (e.g. "global.users"). */
  scope?: string;
  /** Whether this symbol was imported from another schema/service. */
  imported?: boolean;
  /** Original name before collision resolution. */
  originalName?: string;
}

/** Collision resolution strategy. */
export type CollisionStrategy =
  | 'error'     // Throw on duplicate (default)
  | 'suffix'    // Append numeric suffix (e.g. User2)
  | 'prefix'    // Prefix with scope (e.g. UsersUser)
  | 'overwrite' // Replace existing
  | 'skip';     // Keep existing, ignore new

/** A hierarchical scope node. */
export interface ScopeNode {
  name: string;
  parent: string | null;
  symbols: Set<string>;
  children: Set<string>;
}

/** Reserved words per target language — used for collision avoidance. */
const RESERVED_WORDS: Record<string, Set<string>> = {
  typescript: new Set([
    'abstract', 'any', 'as', 'async', 'await', 'boolean', 'break', 'case',
    'catch', 'class', 'const', 'continue', 'debugger', 'declare', 'default',
    'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally',
    'for', 'from', 'function', 'get', 'if', 'implements', 'import', 'in',
    'instanceof', 'interface', 'is', 'keyof', 'let', 'module', 'namespace',
    'never', 'new', 'null', 'number', 'object', 'of', 'package', 'private',
    'protected', 'public', 'readonly', 'require', 'return', 'set', 'static',
    'string', 'super', 'switch', 'symbol', 'this', 'throw', 'true', 'try',
    'type', 'typeof', 'undefined', 'unique', 'unknown', 'var', 'void',
    'while', 'with', 'yield',
  ]),
  python: new Set([
    'False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await',
    'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except',
    'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is',
    'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try',
    'while', 'with', 'yield', 'int', 'float', 'str', 'bool', 'list',
    'dict', 'set', 'tuple', 'type',
  ]),
  go: new Set([
    'break', 'case', 'chan', 'const', 'continue', 'default', 'defer',
    'else', 'fallthrough', 'for', 'func', 'go', 'goto', 'if', 'import',
    'interface', 'map', 'package', 'range', 'return', 'select', 'struct',
    'switch', 'type', 'var', 'string', 'int', 'bool', 'error',
    'int8', 'int16', 'int32', 'int64', 'uint', 'uint8', 'uint16',
    'uint32', 'uint64', 'float32', 'float64', 'byte', 'rune',
  ]),
  kotlin: new Set([
    'abstract', 'actual', 'annotation', 'as', 'break', 'by', 'catch',
    'class', 'companion', 'const', 'constructor', 'continue', 'crossinline',
    'data', 'delegate', 'do', 'dynamic', 'else', 'enum', 'expect',
    'external', 'false', 'final', 'finally', 'for', 'fun', 'get', 'if',
    'import', 'in', 'infix', 'init', 'inline', 'inner', 'interface',
    'internal', 'is', 'it', 'lateinit', 'noinline', 'null', 'object',
    'open', 'operator', 'out', 'override', 'package', 'private',
    'protected', 'public', 'reified', 'return', 'sealed', 'set', 'super',
    'suspend', 'this', 'throw', 'true', 'try', 'typealias', 'val', 'var',
    'vararg', 'when', 'where', 'while',
  ]),
  swift: new Set([
    'Any', 'Bool', 'Double', 'Float', 'Int', 'String', 'Type', 'as',
    'associatedtype', 'break', 'case', 'catch', 'class', 'continue',
    'default', 'defer', 'deinit', 'do', 'else', 'enum', 'extension',
    'false', 'fileprivate', 'for', 'func', 'guard', 'if', 'import', 'in',
    'init', 'inout', 'internal', 'is', 'let', 'nil', 'open', 'operator',
    'override', 'precedencegroup', 'private', 'protocol', 'public',
    'repeat', 'rethrows', 'return', 'self', 'Self', 'static', 'struct',
    'subscript', 'super', 'switch', 'throw', 'throws', 'true', 'try',
    'typealias', 'var', 'where', 'while',
  ]),
  dart: new Set([
    'abstract', 'as', 'assert', 'async', 'await', 'break', 'case',
    'catch', 'class', 'const', 'continue', 'covariant', 'default',
    'deferred', 'do', 'dynamic', 'else', 'enum', 'export', 'extends',
    'extension', 'external', 'factory', 'false', 'final', 'finally',
    'for', 'Function', 'get', 'hide', 'if', 'implements', 'import', 'in',
    'interface', 'is', 'late', 'library', 'mixin', 'new', 'null', 'on',
    'operator', 'part', 'required', 'rethrow', 'return', 'sealed', 'set',
    'show', 'static', 'super', 'switch', 'sync', 'this', 'throw', 'true',
    'try', 'typedef', 'var', 'void', 'when', 'while', 'with', 'yield',
    'int', 'double', 'bool', 'String', 'List', 'Map', 'Set',
  ]),
};

export class SymbolTable {
  private readonly _symbols = new Map<string, Symbol>();
  private readonly _scopes = new Map<string, ScopeNode>();
  private readonly _imports = new Map<string, Set<string>>();
  private _collisionStrategy: CollisionStrategy = 'error';

  constructor(strategy?: CollisionStrategy) {
    if (strategy) this._collisionStrategy = strategy;
    // Create global scope
    this._scopes.set('global', {
      name: 'global',
      parent: null,
      symbols: new Set(),
      children: new Set(),
    });
  }

  /** Build from a schema, registering all types, endpoints, events, and security schemes. */
  static fromSchema(schema: IRSchema, strategy?: CollisionStrategy): SymbolTable {
    const table = new SymbolTable(strategy);
    for (const [id, type] of schema.types) table.registerType(id, type);
    for (const ep of schema.endpoints) table.registerEndpoint(ep);
    for (const [name, scheme] of schema.securitySchemes) {
      table.register({ name, kind: 'security-scheme', node: scheme });
    }
    if (schema.events) {
      for (const event of schema.events) {
        table.register({ name: event.name, kind: 'event', node: event });
      }
    }
    return table;
  }

  get collisionStrategy(): CollisionStrategy {
    return this._collisionStrategy;
  }

  set collisionStrategy(strategy: CollisionStrategy) {
    this._collisionStrategy = strategy;
  }

  registerType(name: string, type: IRType, source?: string): void {
    this.register({ name, kind: 'type', node: type, source });
  }

  registerEndpoint(endpoint: IREndpoint, source?: string): void {
    this.register({ name: endpoint.operationId, kind: 'endpoint', node: endpoint, source });
  }

  register(symbol: Symbol): void {
    if (this._symbols.has(symbol.name)) {
      switch (this._collisionStrategy) {
        case 'error': {
          const existing = this._symbols.get(symbol.name)!;
          throw new Error(
            `[SymbolTable] Duplicate symbol "${symbol.name}" ` +
            `(${symbol.kind} vs ${existing.kind}).` +
            (symbol.source ? ` New: ${symbol.source}.` : '') +
            (existing.source ? ` Existing: ${existing.source}.` : ''),
          );
        }
        case 'suffix': {
          const newName = this.uniqueName(symbol.name);
          symbol.originalName = symbol.name;
          symbol.name = newName;
          break;
        }
        case 'prefix': {
          const prefix = symbol.scope ?? 'Ns';
          const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
          const newName = this.uniqueName(capitalize(prefix) + symbol.name);
          symbol.originalName = symbol.name;
          symbol.name = newName;
          break;
        }
        case 'overwrite':
          // Fall through to registration
          break;
        case 'skip':
          return;
      }
    }
    this._symbols.set(symbol.name, symbol);

    // Add to scope
    const scopeName = symbol.scope ?? 'global';
    this._ensureScope(scopeName);
    this._scopes.get(scopeName)!.symbols.add(symbol.name);
  }

  resolve(name: string): Symbol | undefined {
    return this._symbols.get(name);
  }

  /** Resolve within a specific scope, walking up to parents. */
  resolveInScope(name: string, scopeName: string): Symbol | undefined {
    let currentScope: string | null = scopeName;
    while (currentScope) {
      const scope = this._scopes.get(currentScope);
      if (scope?.symbols.has(name)) {
        return this._symbols.get(name);
      }
      currentScope = scope?.parent ?? null;
    }
    return this._symbols.get(name);
  }

  has(name: string): boolean {
    return this._symbols.has(name);
  }

  ofKind(kind: Symbol['kind']): Symbol[] {
    return [...this._symbols.values()].filter((s) => s.kind === kind);
  }

  get types(): Symbol[] { return this.ofKind('type'); }
  get endpoints(): Symbol[] { return this.ofKind('endpoint'); }
  get events(): Symbol[] { return this.ofKind('event'); }
  get size(): number { return this._symbols.size; }
  get names(): string[] { return [...this._symbols.keys()]; }

  // ─── Scope Management ─────────────────────────────────────────────

  /** Create a child scope under a parent scope. */
  createScope(name: string, parentName: string = 'global'): void {
    this._ensureScope(parentName);
    if (this._scopes.has(name)) return;
    this._scopes.set(name, {
      name,
      parent: parentName,
      symbols: new Set(),
      children: new Set(),
    });
    this._scopes.get(parentName)!.children.add(name);
  }

  addToScope(scopeName: string, symbolName: string): void {
    this._ensureScope(scopeName);
    this._scopes.get(scopeName)!.symbols.add(symbolName);
  }

  getScope(scopeName: string): Set<string> {
    return this._scopes.get(scopeName)?.symbols ?? new Set();
  }

  getScopeNode(scopeName: string): ScopeNode | undefined {
    return this._scopes.get(scopeName);
  }

  get scopeNames(): string[] { return [...this._scopes.keys()]; }

  /** Get all symbols visible in a scope (including inherited from parents). */
  visibleInScope(scopeName: string): Symbol[] {
    const visible = new Set<string>();
    let currentScope: string | null = scopeName;
    while (currentScope) {
      const scope = this._scopes.get(currentScope);
      if (scope) {
        for (const name of scope.symbols) visible.add(name);
      }
      currentScope = scope?.parent ?? null;
    }
    return [...visible]
      .map((name) => this._symbols.get(name))
      .filter((s): s is Symbol => !!s);
  }

  // ─── Import Tracking ──────────────────────────────────────────────

  /** Track that a symbol was imported from an external source. */
  trackImport(symbolName: string, sourceSchema: string): void {
    if (!this._imports.has(sourceSchema)) {
      this._imports.set(sourceSchema, new Set());
    }
    this._imports.get(sourceSchema)!.add(symbolName);
  }

  /** Get all imports grouped by source schema. */
  get imports(): ReadonlyMap<string, ReadonlySet<string>> {
    return this._imports;
  }

  /** Get all imported symbol names. */
  get importedNames(): string[] {
    const names: string[] = [];
    for (const set of this._imports.values()) {
      for (const name of set) names.push(name);
    }
    return names;
  }

  // ─── Reserved Word Detection ──────────────────────────────────────

  /** Check if a name collides with reserved words in a target language. */
  isReserved(name: string, language: string): boolean {
    return RESERVED_WORDS[language]?.has(name) ?? false;
  }

  /** Generate a safe name that avoids reserved words in the target language. */
  safeName(name: string, language: string): string {
    if (!this.isReserved(name, language)) return name;
    // Common escape strategies per language
    switch (language) {
      case 'python':
        return `${name}_`;
      case 'go':
        return `${name.charAt(0).toUpperCase()}${name.slice(1)}Value`;
      case 'kotlin':
        return `\`${name}\``;
      case 'swift':
        return `\`${name}\``;
      case 'dart':
        return `${name}\$`;
      case 'typescript':
      case 'javascript':
      default:
        return `${name}_`;
    }
  }

  // ─── Mutation ─────────────────────────────────────────────────────

  uniqueName(baseName: string): string {
    if (!this._symbols.has(baseName)) return baseName;
    let i = 2;
    while (this._symbols.has(`${baseName}${i}`)) i++;
    return `${baseName}${i}`;
  }

  rename(oldName: string, newName: string): void {
    const symbol = this._symbols.get(oldName);
    if (!symbol) throw new Error(`[SymbolTable] Cannot rename: "${oldName}" not found.`);
    if (this._symbols.has(newName)) {
      throw new Error(`[SymbolTable] Cannot rename "${oldName}" → "${newName}": target exists.`);
    }
    this._symbols.delete(oldName);
    symbol.originalName = symbol.originalName ?? oldName;
    symbol.name = newName;
    this._symbols.set(newName, symbol);
    for (const [, scope] of this._scopes) {
      if (scope.symbols.has(oldName)) { scope.symbols.delete(oldName); scope.symbols.add(newName); }
    }
  }

  /** Remove a symbol from the table. */
  remove(name: string): void {
    this._symbols.delete(name);
    for (const [, scope] of this._scopes) {
      scope.symbols.delete(name);
    }
  }

  // ─── Internal ─────────────────────────────────────────────────────

  private _ensureScope(name: string): void {
    if (!this._scopes.has(name)) {
      this._scopes.set(name, {
        name,
        parent: 'global',
        symbols: new Set(),
        children: new Set(),
      });
    }
  }
}
