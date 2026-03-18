# Blueprint Graph Builder Pass 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add pin default value injection to the `BlueprintGraphBuilder` C++ plugin. After each node is spawned, read the optional `"params"` object from the JSON node and set matching pin `DefaultValue` fields by `PinName`. Update the TypeScript MCP tool schema to accept `params` on node objects.

**Architecture:** One new private static helper function `ApplyParamsToNode` added to the C++ library. Called from all four dispatch cases (BeginPlay, PrintString, Delay, CallFunction) after `Creator.Finalize()`. No new dispatch cases. No new MCP routes. No Python listener changes. TypeScript Zod schema gains `params` as optional `z.record(z.union([z.string(), z.number(), z.boolean()]))`.

**Tech Stack:** C++17, UE4.27 editor APIs (BlueprintGraph, FJsonObject, EJson), TypeScript (strict mode, Zod).

**Spec:** `docs/superpowers/specs/2026-03-17-blueprint-graph-builder-pass3-design.md`

---

## File Map

**Modify (C++ plugin):**
- `D:/Unreal Projects/CodePlayground/Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Public/BlueprintGraphBuilderLibrary.h`
  -- add private static declaration for `ApplyParamsToNode`
- `D:/Unreal Projects/CodePlayground/Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BlueprintGraphBuilderLibrary.cpp`
  -- implement `ApplyParamsToNode`, call it from all four dispatch cases

**Modify (MCP server):**
- `D:/UE/UE_Bridge/mcp-server/src/tools/blueprints.ts`
  -- add `params` to Zod schema and handler type cast, update tool description

---

## Task 1: Add ApplyParamsToNode

**Files:**
- Modify: `D:/Unreal Projects/CodePlayground/Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Public/BlueprintGraphBuilderLibrary.h`
- Modify: `D:/Unreal Projects/CodePlayground/Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BlueprintGraphBuilderLibrary.cpp`

**Context:** `ApplyParamsToNode` is a private static helper -- no `UFUNCTION`, no Blueprint
exposure. It must be called **after** `Creator.Finalize()` in each dispatch case because
`Node->Pins` is populated by `Finalize()`. Calling it before `Finalize()` would silently
do nothing. The `NodeObj` parameter is a `const TSharedPtr<FJsonObject>&` -- the same
pointer that each dispatch case already dereferences as `*NodeObj`. Pass it directly.

- [ ] **Step 1: Declare ApplyParamsToNode in the header**

  Read `BlueprintGraphBuilderLibrary.h`. Add a `private:` section after the `public:`
  section with the declaration:

  ```cpp
  private:
      static void ApplyParamsToNode(
          UEdGraphNode* Node,
          const TSharedPtr<FJsonObject>& NodeObj
      );
  ```

  The full class body after this edit has `public:` with `BuildBlueprintFromJSON` and
  `private:` with `ApplyParamsToNode`. No other changes to the header.

- [ ] **Step 2: Implement ApplyParamsToNode in the .cpp**

  Add the following function definition to `BlueprintGraphBuilderLibrary.cpp`, placed
  **before** `BuildBlueprintFromJSON` (so it does not need a forward declaration):

  ```cpp
  void UBlueprintGraphBuilderLibrary::ApplyParamsToNode(
      UEdGraphNode* Node,
      const TSharedPtr<FJsonObject>& NodeObj)
  {
      const TSharedPtr<FJsonObject>* ParamsObjPtr = nullptr;
      if (!NodeObj->TryGetObjectField(TEXT("params"), ParamsObjPtr))
      {
          return;
      }
      const TSharedPtr<FJsonObject>& ParamsObj = *ParamsObjPtr;

      for (UEdGraphPin* Pin : Node->Pins)
      {
          const FString PinName = Pin->PinName.ToString();

          if (!ParamsObj->HasField(PinName))
          {
              continue;
          }

          const TSharedPtr<FJsonValue>& Value = ParamsObj->Values[PinName];

          switch (Value->Type)
          {
              case EJson::String:
                  Pin->DefaultValue = Value->AsString();
                  break;

              case EJson::Number:
                  Pin->DefaultValue = FString::SanitizeFloat(Value->AsNumber());
                  break;

              case EJson::Boolean:
                  Pin->DefaultValue = Value->AsBool() ? TEXT("true") : TEXT("false");
                  break;

              default:
                  UE_LOG(LogTemp, Warning,
                      TEXT("ApplyParamsToNode: pin '%s' skipped -- unsupported JSON value type"),
                      *PinName);
                  continue;
          }

          UE_LOG(LogTemp, Log,
              TEXT("ApplyParamsToNode: Setting pin %s = %s"),
              *PinName, *Pin->DefaultValue);
      }
  }
  ```

- [ ] **Step 3: Call ApplyParamsToNode from all dispatch cases**

  In `BuildBlueprintFromJSON`, add `ApplyParamsToNode(SpawnedNode, *NodeObj);` to each
  of the four dispatch cases, immediately after `Creator.Finalize(); SpawnedNode = ...;`
  and before the closing `}` of the case block.

  **BeginPlay case** -- add after `SpawnedNode = EventNode;`:
  ```cpp
  Creator.Finalize();
  SpawnedNode = EventNode;
  ApplyParamsToNode(SpawnedNode, *NodeObj);
  ```

  **PrintString case** -- add after `SpawnedNode = CallNode;`:
  ```cpp
  Creator.Finalize();
  SpawnedNode = CallNode;
  ApplyParamsToNode(SpawnedNode, *NodeObj);
  ```

  **Delay case** -- add after `SpawnedNode = CallNode;`:
  ```cpp
  Creator.Finalize();
  SpawnedNode = CallNode;
  ApplyParamsToNode(SpawnedNode, *NodeObj);
  ```

  **CallFunction case** -- add after `SpawnedNode = CallNode;`:
  ```cpp
  Creator.Finalize();
  SpawnedNode = CallNode;
  ApplyParamsToNode(SpawnedNode, *NodeObj);
  ```

  The unified positioning block (`if (SpawnedNode) { SpawnedNode->NodePosX = ... }`)
  comes after all four cases and is NOT changed.

- [ ] **Step 4: Verify the edit**

  Read back the .cpp and .h files and confirm:
  - `ApplyParamsToNode` declaration present in `private:` section of the header
  - `ApplyParamsToNode` implementation is above `BuildBlueprintFromJSON` in the .cpp
  - All four dispatch cases call `ApplyParamsToNode(SpawnedNode, *NodeObj)` after
    `SpawnedNode = ...;`
  - The unified positioning `if (SpawnedNode)` block is still present and unchanged

- [ ] **Step 5: Compile via UE4 editor**

  Open `D:/Unreal Projects/CodePlayground/CodePlayground.uproject` in UE4.27 and let
  it compile. Or use Live Coding (Ctrl+Alt+F11 in editor).

  Expected: zero compiler errors. If `ParamsObj->Values[PinName]` causes a compile
  error because `Values` is not public in your UE4.27 build, replace it with
  `ParamsObj->GetField<EJson::None>(PinName)` -- both access paths are valid in UE4.27
  but some engine configurations expose `Values` differently.

- [ ] **Step 6: Smoke test -- params applied to a single PrintString node**

  Run **directly in UE4's Python console** (not via MCP -- the MCP schema does not yet
  accept `params` until Task 2):

  ```python
  import unreal, json
  bp = unreal.load_object(None, "/Game/BP_TestGraph.BP_TestGraph")
  graph_data = {
      "nodes": [
          {"id": "start", "type": "BeginPlay"},
          {"id": "print", "type": "PrintString", "params": {"InString": "hello from params"}}
      ],
      "connections": [{"from": "start.exec", "to": "print.exec"}]
  }
  unreal.BlueprintGraphBuilderLibrary.build_blueprint_from_json(bp, json.dumps(graph_data), True)
  print("done")
  ```

  Expected: "done". UE4 Output Log shows
  `ApplyParamsToNode: Setting pin InString = hello from params`. Open `BP_TestGraph` in
  the Blueprint editor -- the PrintString node's `InString` pin should show
  "hello from params" as its default value. Blueprint compiles.

- [ ] **Step 7: Smoke test -- node with no params (BeginPlay)**

  Run **directly in UE4's Python console**:

  ```python
  import unreal, json
  bp = unreal.load_object(None, "/Game/BP_TestGraph.BP_TestGraph")
  graph_data = {
      "nodes": [
          {"id": "start", "type": "BeginPlay"}
      ],
      "connections": []
  }
  unreal.BlueprintGraphBuilderLibrary.build_blueprint_from_json(bp, json.dumps(graph_data), True)
  print("done")
  ```

  Expected: "done". No `ApplyParamsToNode` log lines (early return on missing `params`).
  No errors.

- [ ] **Step 8: Smoke test -- Delay with Duration override**

  Run **directly in UE4's Python console**:

  ```python
  import unreal, json
  bp = unreal.load_object(None, "/Game/BP_TestGraph.BP_TestGraph")
  graph_data = {
      "nodes": [
          {"id": "start", "type": "BeginPlay"},
          {"id": "wait", "type": "Delay", "params": {"Duration": 3.0}}
      ],
      "connections": [{"from": "start.exec", "to": "wait.exec"}]
  }
  unreal.BlueprintGraphBuilderLibrary.build_blueprint_from_json(bp, json.dumps(graph_data), True)
  print("done")
  ```

  Expected: "done". Output Log shows `ApplyParamsToNode: Setting pin Duration = 3.000000`.
  Blueprint editor shows Delay node with Duration pin set to 3.0. Blueprint compiles.

- [ ] **Step 9: Commit**

  ```bash
  cd "D:/Unreal Projects/CodePlayground"
  git add Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Public/BlueprintGraphBuilderLibrary.h
  git add Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BlueprintGraphBuilderLibrary.cpp
  git commit -m "feat: add ApplyParamsToNode pin injection to BlueprintGraphBuilder"
  ```

  If CodePlayground is not a git repo, skip the commit -- the file change is still in place.

---

## Task 2: Update TypeScript MCP Tool

**Files:**
- Modify: `D:/UE/UE_Bridge/mcp-server/src/tools/blueprints.ts`

**Context:** Three changes to the `blueprint_build_from_json` tool definition:
1. Description string: add `params` mention
2. Zod schema: add `params` as optional `z.record(z.union([z.string(), z.number(), z.boolean()]))`
3. Handler type cast: add `params?: Record<string, string | number | boolean>` to node array element type

None of these changes affect handler logic -- `JSON.stringify(graph)` already serializes
any field present on the node object, including `"params"`, and C++ reads it via
`TryGetObjectField`.

- [ ] **Step 1: Update the tool description string**

  In `blueprints.ts`, find the description for `blueprint_build_from_json`. It currently
  reads (approximately):
  ```typescript
        "Builds a Blueprint event graph from a JSON node/connection description. " +
        "Supported node types: BeginPlay, PrintString, Delay, CallFunction. " +
        "Connections use 'nodeId.exec' format for exec pin wiring.",
  ```

  Replace with:
  ```typescript
        "Builds a Blueprint event graph from a JSON node/connection description. " +
        "Supported node types: BeginPlay, PrintString, Delay, CallFunction. " +
        "Node objects accept an optional 'params' key to set pin default values by PinName. " +
        "Connections use 'nodeId.exec' format for exec pin wiring.",
  ```

- [ ] **Step 2: Add `params` to the Zod schema**

  Find the node object schema (the `z.object({...})` inside the `nodes: z.array(...)` field).
  It currently has `id`, `type`, and `function`. Add `params`:

  ```typescript
            z.object({
              id: z.string().describe("Unique node identifier"),
              type: z.string().describe("Node type: BeginPlay | PrintString | Delay | CallFunction"),
              function: z.string().optional().describe("Required when type is CallFunction -- function name on UKismetSystemLibrary"),
              params: z.record(z.union([z.string(), z.number(), z.boolean()]))
                .optional()
                .describe("Pin default values keyed by PinName. Supports string, number, bool only."),
            })
  ```

- [ ] **Step 3: Update the handler type cast**

  Find the `params as { ... }` cast in the handler. The node array element type currently
  has `id: string; type: string; function?: string`. Add `params`:

  ```typescript
        const { blueprint_path, graph, clear_existing } = params as {
          blueprint_path: string;
          graph: {
            nodes: Array<{
              id: string;
              type: string;
              function?: string;
              params?: Record<string, string | number | boolean>;
            }>;
            connections: Array<{ from: string; to: string }>;
          };
          clear_existing: boolean;
        };
  ```

- [ ] **Step 4: Build the MCP server**

  ```bash
  cd D:/UE/UE_Bridge && npm run build
  ```

  Expected: no TypeScript errors. `mcp-server/dist/index.js` updated.

- [ ] **Step 5: Commit**

  ```bash
  cd D:/UE/UE_Bridge
  git add mcp-server/src/tools/blueprints.ts
  git add node_modules/unreal-mcp-server/src/tools/blueprints.ts
  git add node_modules/unreal-mcp-server/dist/tools/blueprints.js
  git add node_modules/unreal-mcp-server/dist/tools/blueprints.js.map
  git add node_modules/unreal-mcp-server/dist/tools/blueprints.d.ts.map
  git commit -m "feat: add params field to blueprint_build_from_json Zod schema"
  ```

---

## Task 3: End-to-End Test

**Context:** Full pipeline proof -- MCP tool -> TypeScript -> python_proxy -> C++ ->
Blueprint graph with injected pin values. Requires UE4 running with the listener active
and the MCP server rebuilt from Task 2. Uses the QTE demo JSON from the spec with real
text variation.

- [ ] **Step 1: Confirm the updated MCP tool is available**

  Call the `help` MCP tool. Look for `blueprint_build_from_json` in the output. Its
  description should include `"optional 'params' key"`. If it does not, the MCP server
  was not rebuilt -- run `npm run build` again from `D:/UE/UE_Bridge`.

- [ ] **Step 2: Call blueprint_build_from_json via MCP with QTE params JSON**

  Use the `blueprint_build_from_json` MCP tool (not python_proxy) with:

  ```json
  {
    "blueprint_path": "/Game/BP_TestGraph.BP_TestGraph",
    "graph": {
      "nodes": [
        { "id": "begin", "type": "BeginPlay" },
        {
          "id": "prompt",
          "type": "CallFunction",
          "function": "PrintString",
          "params": { "InString": "PRESS E!", "Duration": 2.0 }
        },
        {
          "id": "window",
          "type": "Delay",
          "params": { "Duration": 3.0 }
        },
        {
          "id": "fail",
          "type": "CallFunction",
          "function": "PrintString",
          "params": { "InString": "FAILED!", "Duration": 2.0 }
        }
      ],
      "connections": [
        { "from": "begin.exec",  "to": "prompt.exec" },
        { "from": "prompt.exec", "to": "window.exec" },
        { "from": "window.exec", "to": "fail.exec" }
      ]
    },
    "clear_existing": true
  }
  ```

  Expected response: `success: true`.

- [ ] **Step 3: Verify pin values in Blueprint editor**

  Open `BP_TestGraph` in UE4. Event graph should show:
  - BeginPlay at x=0
  - PrintString (CallFunction "prompt") at x=300 -- `InString` pin shows "PRESS E!", Duration shows 2.0
  - Delay ("window") at x=600 -- Duration pin shows 3.0
  - PrintString (CallFunction "fail") at x=900 -- `InString` pin shows "FAILED!", Duration shows 2.0
  - Exec wires connecting all four left-to-right
  - Blueprint compiles with no Kismet errors

  UE4 Output Log should show:
  - `ApplyParamsToNode: Setting pin InString = PRESS E!`
  - `ApplyParamsToNode: Setting pin Duration = 2.000000` (for the first PrintString)
  - `ApplyParamsToNode: Setting pin Duration = 3.000000` (for Delay)
  - `ApplyParamsToNode: Setting pin InString = FAILED!`
  - `ApplyParamsToNode: Setting pin Duration = 2.000000` (for the second PrintString)
  - `BuildBlueprintFromJSON: Done. 4 nodes spawned.`

- [ ] **Step 4: Test Play**

  Drag `BP_TestGraph` from the Content Browser into the level (if not already there).
  Hit Play. Expected:
  - "PRESS E!" appears on screen for ~2 seconds
  - 3-second pause (Delay)
  - "FAILED!" appears on screen for ~2 seconds

  Both messages are distinct -- this confirms string pin injection works end-to-end.

- [ ] **Step 5: Negative test -- unsupported param type**

  Use the `blueprint_build_from_json` MCP tool with a node that has an object-valued
  param (should be skipped with a warning, not crash):

  ```json
  {
    "blueprint_path": "/Game/BP_TestGraph.BP_TestGraph",
    "graph": {
      "nodes": [
        { "id": "begin", "type": "BeginPlay" },
        {
          "id": "print",
          "type": "PrintString",
          "params": { "InString": "valid string" }
        }
      ],
      "connections": [
        { "from": "begin.exec", "to": "print.exec" }
      ]
    },
    "clear_existing": true
  }
  ```

  Note: this test only exercises the MCP path with valid scalar types (Zod validates
  the input before it reaches C++, so an object-valued param would be rejected at the
  TypeScript layer). To test the C++ warning path directly, use python_proxy to call
  `build_blueprint_from_json` with raw JSON containing `"InString": {"nested": "obj"}` --
  this bypasses Zod and reaches the `default:` case in the switch statement.

  Expected for the MCP call above: `success: true`. "valid string" appears in the
  `InString` pin. No errors or warnings about unsupported types.

- [ ] **Step 6: Final commit**

  The C++ and TypeScript changes were already committed in Tasks 1 and 2. Only commit
  if any fixups were made during QTE testing. Verify with `git status` in both repos.

  If C++ fixups were made during testing:
  ```bash
  cd "D:/Unreal Projects/CodePlayground"
  git add Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Public/BlueprintGraphBuilderLibrary.h
  git add Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BlueprintGraphBuilderLibrary.cpp
  git commit -m "fix: QTE test fixups in BlueprintGraphBuilder Pass 3"
  ```

  If TypeScript fixups were made during testing:
  ```bash
  cd D:/UE/UE_Bridge
  git add mcp-server/src/tools/blueprints.ts
  git commit -m "fix: QTE test fixups in blueprint_build_from_json params schema"
  ```

---

## Troubleshooting Reference

| Symptom | Cause | Fix |
|---------|-------|-----|
| `ApplyParamsToNode` log lines never appear | Called before `Finalize()`, pin array is empty | Verify the call is after `Creator.Finalize(); SpawnedNode = ...;` in each case |
| Pin value visible in Output Log but not in Blueprint editor | Blueprint editor not refreshed | Close and reopen the Blueprint asset, or call `blueprint_compile` |
| `ParamsObj->Values[PinName]` compile error | `Values` not accessible in this UE4.27 build config | Replace with `ParamsObj->GetField<EJson::None>(PinName)` |
| Duration pin shows `3.000000` but Delay runtime is still 1s | Pin name mismatch -- UE4 may use `Duration` or a different internal name | Check Output Log for "Setting pin Duration" -- if not present, the pin name is wrong. Use python_proxy to inspect the Delay node's pins: `[p.pin_name for p in node.pins]` |
| InString shows empty string despite param being set | Pin name is `InString` but the actual pin uses a different casing | Check with python_proxy as above. UE4.27 pin names are case-sensitive |
| TypeScript error: "Property 'params' does not exist" | Handler type cast not updated | Re-check Step 3 of Task 2 -- both the Zod schema AND the cast need updating |
| MCP tool rejects `params` input | Zod schema not updated or `npm run build` not run | Re-run `npm run build` from `D:/UE/UE_Bridge`, then reload MCP server |
| Blueprint compile error after pin injection | `DefaultValue` string is in wrong format for the pin type | Float pins expect `FString::SanitizeFloat` output format. Check the Kismet error message for the expected format |
| `"params"` key present but no pins matched | Pin names in JSON do not match `Pin->PinName` | Add a temporary log before the `HasField` check to print all `PinName` values, identify the correct names, update the JSON |
