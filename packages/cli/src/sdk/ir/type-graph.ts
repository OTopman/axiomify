/**
 * Directed type graph for IR schemas.
 *
 * Builds a dependency DAG from an IRSchema's type registry, enabling:
 *   - topological sort for emission ordering (Kahn's algorithm)
 *   - cycle detection (iterative DFS)
 *   - reachability analysis (dead type elimination)
 *   - dependency impact analysis
 */
import type { IRSchema, IRType, IRTypeRef } from './types';

/** An edge in the type graph: `from` depends on `to`. */
export interface TypeEdge {
  from: string;
  to: string;
  relation: 'field' | 'array-items' | 'union-member' | 'intersection-member' |
            'map-value' | 'tuple-element' | 'additional-properties';
}

/** A node in the type graph. */
export interface TypeNode {
  id: string;
  type: IRType;
  dependsOn: Set<string>;
  dependedBy: Set<string>;
}

/** Result of cycle detection. */
export interface CycleInfo {
  path: string[];
  breakEdge: TypeEdge;
}

export class TypeGraph {
  private readonly _nodes = new Map<string, TypeNode>();
  private readonly _edges: TypeEdge[] = [];

  /** Build the graph from an IR schema's type registry. */
  static fromSchema(schema: IRSchema): TypeGraph {
    const graph = new TypeGraph();

    for (const [id, type] of schema.types) {
      graph._nodes.set(id, {
        id,
        type,
        dependsOn: new Set(),
        dependedBy: new Set(),
      });
    }

    for (const [id, type] of schema.types) {
      const refs = TypeGraph._extractRefs(type);
      for (const ref of refs) {
        if (ref.targetId && schema.types.has(ref.targetId)) {
          graph._addEdge(id, ref.targetId, ref.relation);
        }
      }
    }

    return graph;
  }

  get nodes(): ReadonlyMap<string, TypeNode> {
    return this._nodes;
  }

  get edges(): readonly TypeEdge[] {
    return this._edges;
  }

  getNode(id: string): TypeNode | undefined {
    return this._nodes.get(id);
  }

  /**
   * Topological sort using Kahn's algorithm. Returns type IDs in dependency
   * order — types with no dependencies first. Mirrors the approach in
   * core's `_resolveModuleDeps`.
   */
  topologicalSort(): string[] {
    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>();

    for (const id of this._nodes.keys()) {
      inDegree.set(id, 0);
      adj.set(id, []);
    }

    for (const edge of this._edges) {
      adj.get(edge.to)!.push(edge.from);
      inDegree.set(edge.from, (inDegree.get(edge.from) ?? 0) + 1);
    }

    const queue: string[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }

    const sorted: string[] = [];
    while (queue.length > 0) {
      const id = queue.shift()!;
      sorted.push(id);
      for (const dependent of adj.get(id) ?? []) {
        const d = (inDegree.get(dependent) ?? 1) - 1;
        inDegree.set(dependent, d);
        if (d === 0) queue.push(dependent);
      }
    }

    if (sorted.length !== this._nodes.size) {
      const remaining = [...this._nodes.keys()].filter(
        (id) => (inDegree.get(id) ?? 0) > 0,
      );
      throw new Error(
        `[TypeGraph] Circular dependency among types: [${remaining.join(', ')}]. ` +
        `Run detectCycles() to get details.`,
      );
    }

    return sorted;
  }

  /** Detect all simple cycles using iterative DFS. */
  detectCycles(): CycleInfo[] {
    const cycles: CycleInfo[] = [];
    const visited = new Set<string>();
    const inStack = new Set<string>();

    for (const id of this._nodes.keys()) {
      if (visited.has(id)) continue;

      const stack: { id: string; childIndex: number }[] = [
        { id, childIndex: 0 },
      ];
      visited.add(id);
      inStack.add(id);

      while (stack.length > 0) {
        const frame = stack[stack.length - 1];
        const node = this._nodes.get(frame.id)!;
        const deps = [...node.dependsOn];

        if (frame.childIndex < deps.length) {
          const dep = deps[frame.childIndex++];
          if (inStack.has(dep)) {
            const path = [dep];
            for (let i = stack.length - 1; i >= 0; i--) {
              path.unshift(stack[i].id);
              if (stack[i].id === dep) break;
            }
            cycles.push({
              path,
              breakEdge: { from: frame.id, to: dep, relation: 'field' },
            });
          } else if (!visited.has(dep)) {
            visited.add(dep);
            inStack.add(dep);
            stack.push({ id: dep, childIndex: 0 });
          }
        } else {
          inStack.delete(frame.id);
          stack.pop();
        }
      }
    }

    return cycles;
  }

  /** Find all type IDs reachable from the given roots (BFS). */
  reachableFrom(rootIds: string[]): Set<string> {
    const reachable = new Set<string>();
    const queue = [...rootIds];

    while (queue.length > 0) {
      const id = queue.shift()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      const node = this._nodes.get(id);
      if (node) {
        for (const dep of node.dependsOn) {
          if (!reachable.has(dep)) queue.push(dep);
        }
      }
    }

    return reachable;
  }

  /** Impact analysis: all types that transitively depend on the given type. */
  impactOf(typeId: string): Set<string> {
    const impacted = new Set<string>();
    const queue = [typeId];

    while (queue.length > 0) {
      const id = queue.shift()!;
      if (impacted.has(id)) continue;
      impacted.add(id);
      const node = this._nodes.get(id);
      if (node) {
        for (const dep of node.dependedBy) {
          if (!impacted.has(dep)) queue.push(dep);
        }
      }
    }

    impacted.delete(typeId);
    return impacted;
  }

  private _addEdge(from: string, to: string, relation: TypeEdge['relation']): void {
    this._edges.push({ from, to, relation });
    this._nodes.get(from)?.dependsOn.add(to);
    this._nodes.get(to)?.dependedBy.add(from);
  }

  private static _extractRefs(
    type: IRType,
  ): Array<{ targetId: string | undefined; relation: TypeEdge['relation'] }> {
    const refs: Array<{ targetId: string | undefined; relation: TypeEdge['relation'] }> = [];

    const resolveRef = (ref: IRTypeRef | undefined, relation: TypeEdge['relation']) => {
      if (!ref) return;
      if (ref.ref) refs.push({ targetId: ref.ref, relation });
      if (ref.inline) refs.push(...TypeGraph._extractRefs(ref.inline));
    };

    switch (type.kind) {
      case 'object':
        for (const field of type.fields) resolveRef(field.type, 'field');
        if (typeof type.additionalProperties === 'object') {
          resolveRef(type.additionalProperties, 'additional-properties');
        }
        break;
      case 'array':
        resolveRef(type.items, 'array-items');
        break;
      case 'union':
        for (const m of type.members) resolveRef(m, 'union-member');
        break;
      case 'intersection':
        for (const m of type.members) resolveRef(m, 'intersection-member');
        break;
      case 'map':
        resolveRef(type.valueType, 'map-value');
        break;
      case 'tuple':
        for (const el of type.elements) resolveRef(el, 'tuple-element');
        break;
      case 'scalar':
      case 'enum':
      case 'literal':
        break;
    }

    return refs;
  }
}
