/**
 * Pattern registry and graph fragment merger.
 *
 * Each pattern is a function that takes params and a context,
 * then returns a graph fragment (nodes + connections + exposed pins).
 */

export interface NodeDef {
  id: string;
  type: string;
  function?: string;
  variable?: string;
  params?: Record<string, string | number | boolean>;
}

export interface ConnectionDef {
  from: string;
  to: string;
}

export interface GraphFragment {
  nodes: NodeDef[];
  connections: ConnectionDef[];
  /** Pins exposed for downstream patterns to wire to. */
  exposedPins: Record<string, string>;
}

export interface PatternContext {
  /** Unique prefix for node IDs to avoid collisions between steps. */
  idPrefix: string;
  /** Exposed pins from all previous steps, keyed by "stepN_alias". */
  previousPins: Record<string, string>;
}

export type PatternFn = (
  params: Record<string, unknown>,
  ctx: PatternContext
) => GraphFragment;

// --- Registry ---

const registry = new Map<string, PatternFn>();

export function registerPattern(name: string, fn: PatternFn): void {
  registry.set(name, fn);
}

export function getPattern(name: string): PatternFn | undefined {
  return registry.get(name);
}

export function listPatterns(): string[] {
  return Array.from(registry.keys());
}

// --- Merger ---

export interface GraphJSON {
  nodes: NodeDef[];
  connections: ConnectionDef[];
}

export interface Step {
  pattern: string;
  params?: Record<string, unknown>;
}

/**
 * Resolve an array of steps into a single merged graph.
 * Auto-wires exec flow between steps: the exec_out of step N
 * connects to exec_in of step N+1.
 */
export function resolveSteps(steps: Step[]): GraphJSON {
  const allNodes: NodeDef[] = [];
  const allConnections: ConnectionDef[] = [];
  const previousPins: Record<string, string> = {};
  let lastExecOut: string | undefined;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const fn = registry.get(step.pattern);
    if (!fn) {
      const available = listPatterns().join(", ");
      throw new Error(
        `Unknown pattern '${step.pattern}'. Available: ${available}`
      );
    }

    const ctx: PatternContext = {
      idPrefix: `s${i}`,
      previousPins: { ...previousPins },
    };

    const fragment = fn(step.params ?? {}, ctx);

    allNodes.push(...fragment.nodes);
    allConnections.push(...fragment.connections);

    // Auto-wire exec chain between steps
    if (lastExecOut && fragment.exposedPins.exec_in) {
      allConnections.push({
        from: lastExecOut,
        to: fragment.exposedPins.exec_in,
      });
    }

    if (fragment.exposedPins.exec_out) {
      lastExecOut = fragment.exposedPins.exec_out;
    }

    // Accumulate exposed pins for downstream steps
    for (const [alias, pin] of Object.entries(fragment.exposedPins)) {
      previousPins[`step${i}_${alias}`] = pin;
    }
  }

  return { nodes: allNodes, connections: allConnections };
}
