/**
 * Symbol table for IR schemas — fast name→IRType resolution, scope tracking,
 * collision detection, and deduplication utilities.
 */
import type { IRType, IREndpoint, IRSecurityScheme, IRSchema } from './types';

export interface Symbol {
  name: string;
  kind: 'type' | 'endpoint' | 'security-scheme';
  node: IRType | IREndpoint | IRSecurityScheme;
  source?: string;
}

export class SymbolTable {
  private readonly _symbols = new Map<string, Symbol>();
  private readonly _scopes = new Map<string, Set<string>>();

  static fromSchema(schema: IRSchema): SymbolTable {
    const table = new SymbolTable();
    for (const [id, type] of schema.types) table.registerType(id, type);
    for (const ep of schema.endpoints) table.registerEndpoint(ep);
    for (const [name, scheme] of schema.securitySchemes) {
      table.register({ name, kind: 'security-scheme', node: scheme });
    }
    return table;
  }

  registerType(name: string, type: IRType, source?: string): void {
    this.register({ name, kind: 'type', node: type, source });
  }

  registerEndpoint(endpoint: IREndpoint, source?: string): void {
    this.register({ name: endpoint.operationId, kind: 'endpoint', node: endpoint, source });
  }

  register(symbol: Symbol): void {
    if (this._symbols.has(symbol.name)) {
      const existing = this._symbols.get(symbol.name)!;
      throw new Error(
        `[SymbolTable] Duplicate symbol "${symbol.name}" ` +
        `(${symbol.kind} vs ${existing.kind}).` +
        (symbol.source ? ` New: ${symbol.source}.` : '') +
        (existing.source ? ` Existing: ${existing.source}.` : ''),
      );
    }
    this._symbols.set(symbol.name, symbol);
  }

  resolve(name: string): Symbol | undefined {
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
  get size(): number { return this._symbols.size; }
  get names(): string[] { return [...this._symbols.keys()]; }

  addToScope(scopeName: string, symbolName: string): void {
    if (!this._scopes.has(scopeName)) this._scopes.set(scopeName, new Set());
    this._scopes.get(scopeName)!.add(symbolName);
  }

  getScope(scopeName: string): Set<string> {
    return this._scopes.get(scopeName) ?? new Set();
  }

  get scopeNames(): string[] { return [...this._scopes.keys()]; }

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
    symbol.name = newName;
    this._symbols.set(newName, symbol);
    for (const [, scope] of this._scopes) {
      if (scope.has(oldName)) { scope.delete(oldName); scope.add(newName); }
    }
  }
}
