# Blueprint Graph Builder Pass 11 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `blueprint_build_from_description` MCP tool that takes a structured description using pattern templates and generates the low-level JSON graph internally.

**Architecture:** TypeScript only. New tool in `mcp-server/src/tools/blueprints.ts`. New `patterns/` directory with template functions. Calls existing `blueprint_build_from_json` via the UnrealClient. No C++ or Python changes.

**Tech Stack:** TypeScript, Zod schemas, existing MCP tool infrastructure.

**Spec:** `docs/superpowers/specs/2026-03-17-blueprint-graph-builder-pass11-design.md`

---

## File Map

**New files:**
- `mcp-server/src/patterns/index.ts` -- pattern registry and merger
- `mcp-server/src/patterns/common.ts` -- common graph patterns (print_value, get_actor_location, etc.)

**Modify:**
- `mcp-server/src/tools/blueprints.ts` -- add `blueprint_build_from_description` tool
- `mcp-server/src/index.ts` -- register new tool (if not auto-discovered)

**No C++ or Python changes.**

---

## Task 1: Design the Pattern System

- [ ] **Step 1: Define the pattern interface**

  Each pattern is a function that takes parameters and returns a graph fragment:

  ```typescript
  interface GraphFragment {
      nodes: NodeDefinition[];
      connections: ConnectionDefinition[];
      // Exposed pins that downstream patterns can wire to
      exposedPins: { [alias: string]: string }; // e.g., {"value": "break.X"}
  }

  interface PatternDefinition {
      name: string;
      description: string;
      params: z.ZodSchema;
      generate: (params: any, context: PatternContext) => GraphFragment;
  }

  interface PatternContext {
      idPrefix: string;        // unique prefix to avoid node ID collisions
      previousExposedPins: { [alias: string]: string }; // from prior steps
  }
  ```

- [ ] **Step 2: Define the merge algorithm**

  The merger takes an array of `GraphFragment` objects and produces a single graph:

  1. Concatenate all `nodes` arrays
  2. Concatenate all `connections` arrays
  3. Auto-wire exec chain: connect the last exec-output of step N to the first exec-input of step N+1
  4. Return the merged graph JSON

  The exec auto-wiring is the key ergonomic win -- users don't need to manually wire BeginPlay -> Step1 -> Step2 -> etc.

---

## Task 2: Implement Core Patterns

**Files:**
- New: `mcp-server/src/patterns/index.ts`
- New: `mcp-server/src/patterns/common.ts`

- [ ] **Step 1: Create the pattern registry**

  `mcp-server/src/patterns/index.ts`:
  - Export a `PatternRegistry` map from name to `PatternDefinition`
  - Export a `resolvePattern(name, params, context)` function
  - Export a `mergeFragments(fragments)` function

- [ ] **Step 2: Implement initial patterns**

  `mcp-server/src/patterns/common.ts`:

  **on_begin_play** -- entry point:
  ```typescript
  {
      nodes: [{ id: `${prefix}_begin`, type: "BeginPlay" }],
      connections: [],
      exposedPins: { exec_out: `${prefix}_begin.exec` }
  }
  ```

  **print_string** -- print a literal string:
  ```typescript
  // params: { message: string }
  {
      nodes: [{ id: `${prefix}_print`, type: "CallFunction", function: "PrintString",
                params: { InString: params.message } }],
      connections: [],
      exposedPins: { exec_in: `${prefix}_print.exec`, exec_out: `${prefix}_print.exec` }
  }
  ```

  **print_float** -- convert float to string and print:
  ```typescript
  // params: { source_pin: string } -- e.g., "break.X"
  {
      nodes: [
          { id: `${prefix}_conv`, type: "CallFunction", function: "Conv_FloatToString" },
          { id: `${prefix}_print`, type: "CallFunction", function: "PrintString" }
      ],
      connections: [
          { from: params.source_pin, to: `${prefix}_conv.InFloat` },
          { from: `${prefix}_conv.ReturnValue`, to: `${prefix}_print.InString` }
      ],
      exposedPins: { exec_in: `${prefix}_print.exec`, exec_out: `${prefix}_print.exec` }
  }
  ```

  **get_actor_location** -- get self location and break into components:
  ```typescript
  {
      nodes: [
          { id: `${prefix}_getLoc`, type: "CallFunction", function: "K2_GetActorLocation" },
          { id: `${prefix}_break`, type: "CallFunction", function: "BreakVector" }
      ],
      connections: [
          { from: `${prefix}_getLoc.ReturnValue`, to: `${prefix}_break.InVec` }
      ],
      exposedPins: {
          x: `${prefix}_break.X`,
          y: `${prefix}_break.Y`,
          z: `${prefix}_break.Z`
      }
  }
  ```

- [ ] **Step 3: Verify patterns compile**

  ```bash
  npm run build
  ```

---

## Task 3: Implement the MCP Tool

**Files:**
- Modify: `mcp-server/src/tools/blueprints.ts`

- [ ] **Step 1: Read the current blueprints.ts**

  Understand the existing tool definitions and how `blueprint_build_from_json` is structured.

- [ ] **Step 2: Add the blueprint_build_from_description tool**

  ```typescript
  {
      name: "blueprint_build_from_description",
      description: "Build a Blueprint graph from high-level pattern templates. " +
          "Each step references a named pattern with optional parameters. " +
          "Exec flow is auto-wired between steps.",
      schema: z.object({
          blueprint_path: z.string().describe("Asset path to the target Blueprint"),
          steps: z.array(z.object({
              pattern: z.string().describe("Pattern name (e.g., 'on_begin_play', 'print_string')"),
              params: z.record(z.any()).optional().describe("Pattern-specific parameters")
          })).describe("Ordered list of pattern steps"),
          clear_existing: z.boolean().default(true).describe("Clear existing graph before building")
      }),
      handler: async (params) => {
          // 1. Resolve each step into a GraphFragment
          // 2. Merge fragments into a single graph
          // 3. Call blueprint_build_from_json via the client
          // 4. Return the result
      }
  }
  ```

- [ ] **Step 3: Wire the tool into index.ts if needed**

  Check if tools in `blueprints.ts` are auto-registered or need manual registration in `index.ts`.

- [ ] **Step 4: Build and verify**

  ```bash
  npm run build
  ```

---

## Task 4: Test

- [ ] **Step 1: Unit test -- pattern resolution**

  Add a test that verifies each pattern produces valid graph fragments with expected node counts and connection counts.

- [ ] **Step 2: Unit test -- fragment merger**

  Test that merging two fragments concatenates nodes/connections and auto-wires exec chain.

- [ ] **Step 3: Integration test -- print actor X position**

  Call `blueprint_build_from_description` via MCP:

  ```json
  {
      "blueprint_path": "/Game/BP_TestGraph.BP_TestGraph",
      "steps": [
          {"pattern": "on_begin_play"},
          {"pattern": "get_actor_location"},
          {"pattern": "print_float", "params": {"source_pin": "step1_break.X"}}
      ]
  }
  ```

  Expected: generates a graph that prints the actor's X position.

- [ ] **Step 4: Error test -- unknown pattern**

  ```json
  {
      "steps": [{"pattern": "nonexistent"}]
  }
  ```

  Expected: error listing available patterns.

- [ ] **Step 5: Commit**

  ```bash
  cd "D:/UE/UE_Bridge"
  git add mcp-server/src/patterns/ mcp-server/src/tools/blueprints.ts
  git commit -m "feat: add blueprint_build_from_description tool with pattern templates"
  ```

---

## Troubleshooting Reference

| Symptom | Cause | Fix |
|---|---|---|
| Pattern not found | Typo in pattern name | Check pattern registry; tool should list available patterns in error |
| Node ID collision | Two patterns use same ID prefix | Use step index as prefix (e.g., `step0_`, `step1_`) |
| Exec auto-wiring connects wrong pins | Pattern doesn't expose exec pins | Ensure every pattern declares `exec_in` and `exec_out` in `exposedPins` |
| `blueprint_build_from_json` fails downstream | Generated JSON has invalid structure | Log the generated JSON before sending; validate against known-good examples |
| Member functions not found | Pass 10 not yet implemented | Pass 11 depends on Pass 10 for `get_actor_location` pattern |
