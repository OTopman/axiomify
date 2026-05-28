/**
 * Directed type graph for IR schemas.
 *
 * Builds a dependency DAG from an IRSchema's type registry, enabling:
 *   - topological sort for emission ordering (Kahn's algorithm)
 *   - cycle detection (iterative DFS)
 *   - reachability analysis (dead type elimination)
 *   - dependency impact analysis
 *   - incremental updates (add/remove types without full rebuild)
 *   - serialization (for caching across builds)
 *   - automatic cycle breaking with lazy-ref annotations
 */
import type { IRSchema, IRType, IRTypeRef } from './types';

/** An edge in the type graph: `from` depends on `to`. */
export interface TypeEdge {
  from: string;
  to: string;
  relation: 'field' | 'array-items' | 'union-member' | 'intersection-member' |
            'map-value' | 'tuple-element' | 'additional-properties' | 'generic-param';
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

/** Serialized form for caching. */
export interface SerializedTypeGraph {
  nodes: Array<{ id: string; typeKind: string }>;
  edges: TypeEdge[];
}

/** Diff between two type graphs. */
export interface TypeGraphDiff {
  addedNodes: string[];
  removedNodes: string[];
  addedEdges: TypeEdge[];
  removedEdges: TypeEdge[];
  modifiedNodes: string[];
}

export class TypeGraph {
  private readonly _nodes = new Map<string, TypeNode>();
  private readonly _edges: TypeEdge[] = [];
  /** Set of edges that were broken to resolve cycles (annotated as lazy refs). */
  private readonly _brokenEdges = new Set<string>();

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
      // Skip broken edges (cycle-resolved lazy refs)
      if (this._brokenEdges.has(`${edge.from}->${edge.to}`)) continue;
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

  /**
   * Automatically detect and break all cycles by marking back-edges as lazy
   * references. After calling this, `topologicalSort()` will succeed.
   *
   * Returns the cycles that were broken for diagnostic purposes.
   */
  breakCycles(): CycleInfo[] {
    const cycles = this.detectCycles();

    for (const cycle of cycles) {
      const { from, to } = cycle.breakEdge;
      const key = `${from}->${to}`;
      if (!this._brokenEdges.has(key)) {
        this._brokenEdges.add(key);

        // Remove from dependency sets so topological sort works
        const fromNode = this._nodes.get(from);
        if (fromNode) fromNode.dependsOn.delete(to);
        const toNode = this._nodes.get(to);
        if (toNode) toNode.dependedBy.delete(from);

        // Annotate the type's metadata so generators know this is a lazy ref
        if (fromNode?.type.metadata) {
          const lazyRefs = (fromNode.type.metadata['_lazyRefs'] as string[] | undefined) ?? [];
          lazyRefs.push(to);
          fromNode.type.metadata['_lazyRefs'] = lazyRefs;
        } else if (fromNode?.type) {
          fromNode.type.metadata = { _lazyRefs: [to] };
        }
      }
    }

    return cycles;
  }

  /** Set of edges broken to resolve cycles. */
  get brokenEdges(): ReadonlySet<string> {
    return this._brokenEdges;
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

  // ─── Incremental Update ─────────────────────────────────────────────

  /**
   * Incrementally add a type and its edges to the graph without full rebuild.
   */
  addType(id: string, type: IRType, schema: IRSchema): void {
    // Remove old node if it exists (update scenario)
    this.removeType(id);

    this._nodes.set(id, {
      id,
      type,
      dependsOn: new Set(),
      dependedBy: new Set(),
    });

    const refs = TypeGraph._extractRefs(type);
    for (const ref of refs) {
      if (ref.targetId && schema.types.has(ref.targetId)) {
        this._addEdge(id, ref.targetId, ref.relation);
      }
    }

    // Re-check existing nodes that might now reference this type
    for (const [nodeId, node] of this._nodes) {
      if (nodeId === id) continue;
      const nodeRefs = TypeGraph._extractRefs(node.type);
      for (const ref of nodeRefs) {
        if (ref.targetId === id) {
          const existingEdge = this._edges.find(
            (e) => e.from === nodeId && e.to === id,
          );
          if (!existingEdge) {
            this._addEdge(nodeId, id, ref.relation);
          }
        }
      }
    }
  }

  /** Remove a type and all its edges from the graph. */
  removeType(id: string): void {
    const node = this._nodes.get(id);
    if (!node) return;

    // Remove edges from this node
    for (const depId of node.dependsOn) {
      const depNode = this._nodes.get(depId);
      if (depNode) depNode.dependedBy.delete(id);
    }
    for (const depId of node.dependedBy) {
      const depNode = this._nodes.get(depId);
      if (depNode) depNode.dependsOn.delete(id);
    }

    // Remove edges from the edge list
    for (let i = this._edges.length - 1; i >= 0; i--) {
      if (this._edges[i].from === id || this._edges[i].to === id) {
        this._edges.splice(i, 1);
      }
    }

    // Remove broken edge annotations
    for (const key of this._brokenEdges) {
      if (key.startsWith(`${id}->`) || key.endsWith(`->${id}`)) {
        this._brokenEdges.delete(key);
      }
    }

    this._nodes.delete(id);
  }

  /**
   * Return the set of type IDs that need recompilation because a given
   * set of types changed. This is the union of all impacted types.
   */
  dirtySetFrom(changedTypeIds: string[]): Set<string> {
    const dirty = new Set<string>();
    for (const id of changedTypeIds) {
      dirty.add(id);
      for (const impacted of this.impactOf(id)) {
        dirty.add(impacted);
      }
    }
    return dirty;
  }

  // ─── Diffing ────────────────────────────────────────────────────────

  /** Compute the structural diff between this graph and another. */
  diffFrom(other: TypeGraph): TypeGraphDiff {
    const addedNodes: string[] = [];
    const removedNodes: string[] = [];
    const modifiedNodes: string[] = [];
    const addedEdges: TypeEdge[] = [];
    const removedEdges: TypeEdge[] = [];

    // Nodes
    for (const id of this._nodes.keys()) {
      if (!other._nodes.has(id)) addedNodes.push(id);
    }
    for (const id of other._nodes.keys()) {
      if (!this._nodes.has(id)) removedNodes.push(id);
    }
    for (const id of this._nodes.keys()) {
      if (other._nodes.has(id)) {
        const thisNode = this._nodes.get(id)!;
        const otherNode = other._nodes.get(id)!;
        if (thisNode.type.kind !== otherNode.type.kind) {
          modifiedNodes.push(id);
        } else if (thisNode.dependsOn.size !== otherNode.dependsOn.size) {
          modifiedNodes.push(id);
        } else {
          for (const dep of thisNode.dependsOn) {
            if (!otherNode.dependsOn.has(dep)) {
              modifiedNodes.push(id);
              break;
            }
          }
        }
      }
    }

    // Edges
    const otherEdgeSet = new Set(
      other._edges.map((e) => `${e.from}->${e.to}:${e.relation}`),
    );
    const thisEdgeSet = new Set(
      this._edges.map((e) => `${e.from}->${e.to}:${e.relation}`),
    );
    for (const edge of this._edges) {
      const key = `${edge.from}->${edge.to}:${edge.relation}`;
      if (!otherEdgeSet.has(key)) addedEdges.push(edge);
    }
    for (const edge of other._edges) {
      const key = `${edge.from}->${edge.to}:${edge.relation}`;
      if (!thisEdgeSet.has(key)) removedEdges.push(edge);
    }

    return { addedNodes, removedNodes, addedEdges, removedEdges, modifiedNodes };
  }

  // ─── Serialization ──────────────────────────────────────────────────

  /** Serialize the graph structure for caching (excludes full type data). */
  serialize(): SerializedTypeGraph {
    const nodes = [...this._nodes.values()].map((n) => ({
      id: n.id,
      typeKind: n.type.kind,
    }));
    return { nodes, edges: [...this._edges] };
  }

  /** Restore a graph from serialized data + a schema with full types. */
  static deserialize(data: SerializedTypeGraph, schema: IRSchema): TypeGraph {
    const graph = new TypeGraph();
    for (const node of data.nodes) {
      const type = schema.types.get(node.id);
      if (type) {
        graph._nodes.set(node.id, {
          id: node.id,
          type,
          dependsOn: new Set(),
          dependedBy: new Set(),
        });
      }
    }
    for (const edge of data.edges) {
      if (graph._nodes.has(edge.from) && graph._nodes.has(edge.to)) {
        graph._addEdge(edge.from, edge.to, edge.relation);
      }
    }
    return graph;
  }

  // ─── Internal ───────────────────────────────────────────────────────

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
      // Type arguments (generics)
      if (ref.typeArguments) {
        for (const arg of ref.typeArguments) {
          resolveRef(arg, 'generic-param');
        }
      }
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
      case 'generic':
        resolveRef(type.baseType, 'generic-param');
        for (const tp of type.typeParameters) {
          if (tp.constraint) resolveRef(tp.constraint, 'generic-param');
          if (tp.defaultType) resolveRef(tp.defaultType, 'generic-param');
        }
        break;
      case 'scalar':
      case 'enum':
      case 'literal':
        break;
    }

    return refs;
  }
}
