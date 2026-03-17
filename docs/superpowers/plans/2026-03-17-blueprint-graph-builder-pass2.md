# Blueprint Graph Builder Pass 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the BlueprintGraphBuilder C++ plugin with `Delay` and `CallFunction` node types, refactor auto-positioning, and update the TypeScript MCP tool schema -- proving a 4-node QTE-style exec chain.

**Architecture:** Two new `else if` dispatch cases added to the existing node spawn loop in `BuildBlueprintFromJSON`. Per-node hardcoded positions replaced by a single unified post-spawn block keyed by spawn index. TypeScript Zod schema and handler type cast updated to pass `"function"` through to C++. No Python listener changes. No new MCP routes.

**Tech Stack:** C++17, UE4.27 editor APIs (BlueprintGraph, KismetCompiler, KismetSystemLibrary), TypeScript (strict mode, Zod).

**Spec:** `docs/superpowers/specs/2026-03-17-blueprint-graph-builder-pass2-design.md`

---

## File Map

**Modify (C++ plugin):**
- `D:/Unreal Projects/CodePlayground/Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BlueprintGraphBuilderLibrary.cpp`
  -- add Delay + CallFunction dispatch cases, refactor auto-positioning, normalize PrintString guard

**Modify (MCP server):**
- `D:/UE/UE_Bridge/mcp-server/src/tools/blueprints.ts`
  -- update tool description, add `function` to Zod schema, update handler type cast

---

## Task 1: Refactor Auto-Positioning + Fix PrintString Guard

**Files:**
- Modify: `D:/Unreal Projects/CodePlayground/Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BlueprintGraphBuilderLibrary.cpp`

**Context:** The existing code has `NodePosX` hardcoded per dispatch case (BeginPlay=0, PrintString=300). Pass 2 needs to position N nodes without per-case hardcoding. The refactor introduces `int32 NodeIndex = 0` before the spawn loop and a unified `if (SpawnedNode)` block after each dispatch case that assigns position, increments the counter, and adds to NodeMap. As part of this structural change, the `PrintString` null guard changes from `return` (exits the whole function) to `continue` (skips the node) -- this is NOT a separate patch, it happens as part of the same edit since the dispatch block structure is being rewritten.

- [ ] **Step 1: Edit the spawn loop in `BlueprintGraphBuilderLibrary.cpp`**

  Replace the node spawn loop **lines 57-124 inclusive** (from the `// --- Step 4: Spawn nodes ---` comment through the closing `}` of the `for` loop, which includes the `NodeMap.Add(NodeId, SpawnedNode);` statement at line 123 and the loop's closing `}` at line 124). The key changes are:
  - Add `int32 NodeIndex = 0;` before the loop
  - Remove `NodePosX`/`NodePosY` assignments from inside BeginPlay and PrintString blocks
  - Change PrintString null guard from `return` to `continue`
  - Replace `NodeMap.Add(NodeId, SpawnedNode);` at the end with the unified `if (SpawnedNode)` block

  ```cpp
      // --- Step 4: Spawn nodes ---
      const TArray<TSharedPtr<FJsonValue>>* NodesArray = nullptr;
      if (!RootObject->TryGetArrayField(TEXT("nodes"), NodesArray))
      {
          UE_LOG(LogTemp, Error, TEXT("BuildBlueprintFromJSON: Missing 'nodes' array"));
          return;
      }

      TMap<FString, UEdGraphNode*> NodeMap;
      int32 NodeIndex = 0;

      for (const TSharedPtr<FJsonValue>& NodeValue : *NodesArray)
      {
          const TSharedPtr<FJsonObject>* NodeObj = nullptr;
          if (!NodeValue->TryGetObject(NodeObj))
          {
              continue;
          }

          FString NodeId, NodeType;
          (*NodeObj)->TryGetStringField(TEXT("id"), NodeId);
          (*NodeObj)->TryGetStringField(TEXT("type"), NodeType);

          if (NodeId.IsEmpty() || NodeType.IsEmpty())
          {
              UE_LOG(LogTemp, Warning, TEXT("BuildBlueprintFromJSON: Skipping node with missing id or type"));
              continue;
          }

          UEdGraphNode* SpawnedNode = nullptr;

          if (NodeType == TEXT("BeginPlay"))
          {
              FGraphNodeCreator<UK2Node_Event> Creator(*Graph);
              UK2Node_Event* EventNode = Creator.CreateNode();
              EventNode->EventReference.SetExternalMember(
                  FName(TEXT("ReceiveBeginPlay")),
                  AActor::StaticClass()
              );
              EventNode->bOverrideFunction = true;
              Creator.Finalize();
              SpawnedNode = EventNode;
          }
          else if (NodeType == TEXT("PrintString"))
          {
              UFunction* Func = UKismetSystemLibrary::StaticClass()->FindFunctionByName(TEXT("PrintString"));
              if (!Func)
              {
                  UE_LOG(LogTemp, Error, TEXT("BuildBlueprintFromJSON: PrintString function not found"));
                  continue;
              }
              FGraphNodeCreator<UK2Node_CallFunction> Creator(*Graph);
              UK2Node_CallFunction* CallNode = Creator.CreateNode();
              CallNode->SetFromFunction(Func);
              Creator.Finalize();
              SpawnedNode = CallNode;
          }
          else
          {
              UE_LOG(LogTemp, Warning, TEXT("BuildBlueprintFromJSON: Unknown node type '%s', skipping"), *NodeType);
              continue;
          }

          // Position is assigned after Finalize() -- this is intentional and safe.
          // Finalize() adds the node to the graph but does not lock position in UE4.27.
          // The existing code set NodePosX before Finalize(); this unified block runs after.
          if (SpawnedNode)
          {
              SpawnedNode->NodePosX = NodeIndex * 300;
              SpawnedNode->NodePosY = 0;
              NodeIndex++;
              NodeMap.Add(NodeId, SpawnedNode);
          }
      }
  ```

- [ ] **Step 2: Verify the edit visually**

  Read the file back and confirm:
  - `NodePosX = 0` and `NodePosY = 0` are gone from the BeginPlay block
  - `NodePosX = 300` and `NodePosY = 0` are gone from the PrintString block
  - PrintString guard says `continue;` not `return;`
  - `NodeMap.Add` is only inside the `if (SpawnedNode)` block, not at the old end-of-loop position
  - `int32 NodeIndex = 0;` appears before the loop

- [ ] **Step 3: Compile via UE4 editor**

  Open `D:/Unreal Projects/CodePlayground/CodePlayground.uproject` in UE4.27 and let it compile. Or use Live Coding (Ctrl+Alt+F11 in editor).

  Expected: zero compiler errors. If errors appear, check the edit against the code above character by character.

- [ ] **Step 4: Smoke test -- 2-node graph still works**

  Run **directly in UE4's Python console** (not via the MCP `python_proxy` tool -- the MCP schema does not yet support Delay/CallFunction until Task 4). In the UE4 Output Log, click the Python tab and paste:

  ```python
  import unreal, json
  bp = unreal.load_object(None, "/Game/BP_TestGraph.BP_TestGraph")
  graph_data = {
      "nodes": [
          {"id": "start", "type": "BeginPlay"},
          {"id": "print", "type": "PrintString"}
      ],
      "connections": [{"from": "start.exec", "to": "print.exec"}]
  }
  unreal.BlueprintGraphBuilderLibrary.build_blueprint_from_json(bp, json.dumps(graph_data), True)
  print("done")
  ```

  Expected: "done" printed. Blueprint editor shows BeginPlay at x=0 and PrintString at x=300. No Kismet compile errors.

- [ ] **Step 5: Commit**

  ```bash
  cd "D:/Unreal Projects/CodePlayground"
  git add Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BlueprintGraphBuilderLibrary.cpp
  git commit -m "refactor: auto-positioning + normalize PrintString null guard"
  ```

  If CodePlayground is not a git repo, skip the commit -- the file change is still in place.

---

## Task 2: Add Delay Node Type

**Files:**
- Modify: `D:/Unreal Projects/CodePlayground/Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BlueprintGraphBuilderLibrary.cpp`

**Context:** `Delay` is a hardcoded dispatch case (no `"function"` field in JSON). It resolves `UKismetSystemLibrary::Delay` by name -- the same pattern used for PrintString. The null guard uses `continue` (consistent with the refactored loop from Task 1). The default Delay duration (1.0s) comes from the node's default pin value; no data pin injection yet.

- [ ] **Step 1: Add the Delay dispatch case**

  In `BlueprintGraphBuilderLibrary.cpp`, insert the following `else if` block **between** the `PrintString` block and the `else` (unknown type) block:

  ```cpp
          else if (NodeType == TEXT("Delay"))
          {
              // TEXT("Delay") is a bare string -- consistent with how PrintString is looked up.
              // The null guard below catches any future rename at runtime.
              UFunction* Func = UKismetSystemLibrary::StaticClass()
                  ->FindFunctionByName(TEXT("Delay"));
              if (!Func)
              {
                  UE_LOG(LogTemp, Error, TEXT("BuildBlueprintFromJSON: Delay function not found on UKismetSystemLibrary"));
                  continue;
              }
              FGraphNodeCreator<UK2Node_CallFunction> Creator(*Graph);
              UK2Node_CallFunction* CallNode = Creator.CreateNode();
              CallNode->SetFromFunction(Func);
              Creator.Finalize();
              SpawnedNode = CallNode;
          }
  ```

  The full dispatch order after this edit: `BeginPlay` -> `PrintString` -> `Delay` -> `else`.

- [ ] **Step 2: Compile**

  Recompile (editor auto-detects change or use Live Coding). Expected: zero errors.

- [ ] **Step 3: Test Delay alone**

  Run **directly in UE4's Python console** (not via MCP):

  ```python
  import unreal, json
  bp = unreal.load_object(None, "/Game/BP_TestGraph.BP_TestGraph")
  graph_data = {
      "nodes": [
          {"id": "start", "type": "BeginPlay"},
          {"id": "wait",  "type": "Delay"}
      ],
      "connections": [{"from": "start.exec", "to": "wait.exec"}]
  }
  unreal.BlueprintGraphBuilderLibrary.build_blueprint_from_json(bp, json.dumps(graph_data), True)
  print("done")
  ```

  Expected: "done". Blueprint editor shows BeginPlay at x=0, Delay node at x=300, exec wire between them. Blueprint compiles.

- [ ] **Step 4: Commit**

  ```bash
  git add Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BlueprintGraphBuilderLibrary.cpp
  git commit -m "feat: add Delay node type to BlueprintGraphBuilder"
  ```

---

## Task 3: Add CallFunction Node Type

**Files:**
- Modify: `D:/Unreal Projects/CodePlayground/Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BlueprintGraphBuilderLibrary.cpp`

**Context:** `CallFunction` is the dynamic dispatch case. It reads the `"function"` field from the JSON node object, trims whitespace, and resolves it via `FindFunctionByName` on `UKismetSystemLibrary`. Includes: empty-field guard, pre-resolution log, and null-function guard. No post-`Finalize()` guard is added -- once `!Func` is confirmed non-null and `SetFromFunction` is called, the node is valid. A `GetTargetFunction()` check after `Finalize()` is NOT used here because `Finalize()` already added the node to the graph; firing `continue` at that point would leave an orphaned node in `Graph->Nodes` without a `NodeMap` entry, causing Kismet compile errors.

- [ ] **Step 1: Add the CallFunction dispatch case**

  Insert the following `else if` block **between** the `Delay` block and the `else` (unknown type) block:

  ```cpp
          else if (NodeType == TEXT("CallFunction"))
          {
              FString FunctionName;
              (*NodeObj)->TryGetStringField(TEXT("function"), FunctionName);
              FunctionName.TrimStartAndEndInline();

              if (FunctionName.IsEmpty())
              {
                  UE_LOG(LogTemp, Error, TEXT("BuildBlueprintFromJSON: CallFunction node missing 'function' field"));
                  continue;
              }

              UE_LOG(LogTemp, Log, TEXT("BuildBlueprintFromJSON: resolving function '%s'"), *FunctionName);

              UFunction* Func = UKismetSystemLibrary::StaticClass()
                  ->FindFunctionByName(*FunctionName);
              if (!Func)
              {
                  UE_LOG(LogTemp, Error, TEXT("BuildBlueprintFromJSON: function '%s' not found on UKismetSystemLibrary"), *FunctionName);
                  continue;
              }

              FGraphNodeCreator<UK2Node_CallFunction> Creator(*Graph);
              UK2Node_CallFunction* CallNode = Creator.CreateNode();
              CallNode->SetFromFunction(Func);
              Creator.Finalize();
              SpawnedNode = CallNode;
          }
  ```

  Full dispatch order after this edit: `BeginPlay` -> `PrintString` -> `Delay` -> `CallFunction` -> `else`.

- [ ] **Step 2: Compile**

  Recompile. Expected: zero errors.

- [ ] **Step 3: Test CallFunction with PrintString**

  Run **directly in UE4's Python console** (not via MCP):

  ```python
  import unreal, json
  bp = unreal.load_object(None, "/Game/BP_TestGraph.BP_TestGraph")
  graph_data = {
      "nodes": [
          {"id": "start", "type": "BeginPlay"},
          {"id": "call",  "type": "CallFunction", "function": "PrintString"}
      ],
      "connections": [{"from": "start.exec", "to": "call.exec"}]
  }
  unreal.BlueprintGraphBuilderLibrary.build_blueprint_from_json(bp, json.dumps(graph_data), True)
  print("done")
  ```

  Expected: "done". UE4 Output Log shows `BuildBlueprintFromJSON: resolving function 'PrintString'`. Blueprint editor shows a PrintString node at x=300. Blueprint compiles.

- [ ] **Step 4: Test CallFunction with unknown function (negative test)**

  Run **directly in UE4's Python console** (not via MCP):

  ```python
  import unreal, json
  bp = unreal.load_object(None, "/Game/BP_TestGraph.BP_TestGraph")
  graph_data = {
      "nodes": [
          {"id": "start", "type": "BeginPlay"},
          {"id": "bad",   "type": "CallFunction", "function": "NonExistentFunction"}
      ],
      "connections": [{"from": "start.exec", "to": "bad.exec"}]
  }
  unreal.BlueprintGraphBuilderLibrary.build_blueprint_from_json(bp, json.dumps(graph_data), True)
  print("done")
  ```

  Expected: "done" (no Python exception). UE4 Output Log shows "function 'NonExistentFunction' not found on UKismetSystemLibrary". Blueprint editor shows only BeginPlay (the bad node was skipped). Blueprint compiles.

- [ ] **Step 5: Test CallFunction with missing function field (negative test)**

  Run **directly in UE4's Python console** (not via MCP):

  ```python
  import unreal, json
  bp = unreal.load_object(None, "/Game/BP_TestGraph.BP_TestGraph")
  graph_data = {
      "nodes": [
          {"id": "start", "type": "BeginPlay"},
          {"id": "bad",   "type": "CallFunction"}
      ],
      "connections": []
  }
  unreal.BlueprintGraphBuilderLibrary.build_blueprint_from_json(bp, json.dumps(graph_data), True)
  print("done")
  ```

  Expected: "done". Log shows "CallFunction node missing 'function' field". Only BeginPlay in graph.

- [ ] **Step 6: Commit**

  ```bash
  git add Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BlueprintGraphBuilderLibrary.cpp
  git commit -m "feat: add CallFunction node type to BlueprintGraphBuilder"
  ```

---

## Task 4: Update TypeScript MCP Tool

**Files:**
- Modify: `D:/UE/UE_Bridge/mcp-server/src/tools/blueprints.ts` (lines 169-226)

**Context:** Three changes to the `blueprint_build_from_json` tool definition:
1. Description string: replace "Pass 1: BeginPlay, PrintString" with updated list
2. Zod schema: add `function` as optional field on node objects
3. Handler type cast: add `function?: string` to the node array element type

None of these changes affect the handler logic -- `JSON.stringify(graph)` already serializes any field present on the node object, including `"function"`, and C++ reads it via `TryGetStringField`.

- [ ] **Step 1: Update the tool description string**

  In `blueprints.ts`, find (around line 171-173):
  ```typescript
        "Builds a Blueprint event graph from a JSON node/connection description. " +
        "Supported node types (Pass 1): BeginPlay, PrintString. " +
        "Connections use 'nodeId.exec' format for exec pin wiring.",
  ```

  Replace with:
  ```typescript
        "Builds a Blueprint event graph from a JSON node/connection description. " +
        "Supported node types: BeginPlay, PrintString, Delay, CallFunction. " +
        "Connections use 'nodeId.exec' format for exec pin wiring.",
  ```

- [ ] **Step 2: Add `function` to the Zod schema**

  Find the node object schema (around line 181-184):
  ```typescript
            z.object({
              id: z.string().describe("Unique node identifier"),
              type: z.string().describe("Node type: BeginPlay or PrintString"),
            })
  ```

  Replace with:
  ```typescript
            z.object({
              id: z.string().describe("Unique node identifier"),
              type: z.string().describe("Node type: BeginPlay | PrintString | Delay | CallFunction"),
              function: z.string().optional().describe("Required when type is CallFunction -- function name on UKismetSystemLibrary"),
            })
  ```

- [ ] **Step 3: Update the handler type cast**

  Find (around line 196-200):
  ```typescript
        const { blueprint_path, graph, clear_existing } = params as {
          blueprint_path: string;
          graph: { nodes: Array<{ id: string; type: string }>; connections: Array<{ from: string; to: string }> };
          clear_existing: boolean;
        };
  ```

  Replace with:
  ```typescript
        const { blueprint_path, graph, clear_existing } = params as {
          blueprint_path: string;
          graph: { nodes: Array<{ id: string; type: string; function?: string }>; connections: Array<{ from: string; to: string }> };
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
  git add mcp-server/src/tools/blueprints.ts mcp-server/dist/
  git commit -m "feat: update blueprint_build_from_json schema for Delay + CallFunction"
  ```

---

## Task 5: QTE End-to-End Test

**Context:** Full pipeline proof -- MCP tool -> TypeScript -> python_proxy -> C++ -> Blueprint graph. Uses the QTE demo JSON from the spec. Requires UE4 running with the listener active and the MCP server rebuilt from Task 4.

- [ ] **Step 1: Confirm the new MCP tool is available**

  Call the `help` MCP tool. Look for `blueprint_build_from_json` in the output. Its description should now read "Supported node types: BeginPlay, PrintString, Delay, CallFunction." If it still says "Pass 1", the MCP server was not rebuilt -- run `npm run build` again.

- [ ] **Step 2: Call blueprint_build_from_json via MCP**

  Use the `blueprint_build_from_json` MCP tool (not python_proxy) with:

  ```json
  {
    "blueprint_path": "/Game/BP_TestGraph.BP_TestGraph",
    "graph": {
      "nodes": [
        { "id": "begin",  "type": "BeginPlay" },
        { "id": "prompt", "type": "CallFunction", "function": "PrintString" },
        { "id": "window", "type": "Delay" },
        { "id": "fail",   "type": "CallFunction", "function": "PrintString" }
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

  Expected response: `success: true`, output includes `"blueprint_build_from_json: done"`.

- [ ] **Step 3: Verify in Blueprint editor**

  Open `BP_TestGraph` in UE4. Event graph should show:
  - BeginPlay at x=0
  - PrintString (CallFunction) at x=300
  - Delay at x=600
  - PrintString (CallFunction) at x=900
  - Exec wires connecting all four left-to-right
  - Blueprint compiles with no Kismet errors

  UE4 Output Log should show:
  - `BuildBlueprintFromJSON: resolving function 'PrintString'` (twice)
  - `BuildBlueprintFromJSON: Done. 4 nodes spawned.`

- [ ] **Step 4: Test Play**

  Drag `BP_TestGraph` from the Content Browser into the level (if not already there). Hit Play. Expected:
  - Default PrintString text appears on screen
  - ~1 second pause (Delay default duration)
  - Default PrintString text appears again

  Both messages will be the same default text -- this is expected. Text variation requires data pin injection (Pass 3).

- [ ] **Step 5: Final commit (C++ plugin only)**

  The TypeScript changes were already committed in Task 4. Only commit C++ changes if any fixups were made during QTE testing. If no files changed since Task 4, this step is a no-op -- verify with `git status` in both repos.

  If C++ fixups were made during testing:
  ```bash
  cd "D:/Unreal Projects/CodePlayground"
  git add Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BlueprintGraphBuilderLibrary.cpp
  git commit -m "fix: QTE test fixups in BlueprintGraphBuilder Pass 2"
  ```

---

## Troubleshooting Reference

| Symptom | Cause | Fix |
|---------|-------|-----|
| "Delay function not found" in Output Log | UKismetSystemLibrary::Delay name mismatch | Verify with `python_proxy`: `print(dir(unreal.KismetSystemLibrary))` -- look for `delay` |
| CallFunction node in graph but exec pins missing | `SetFromFunction` resolved but node schema didn't populate | Check Output Log for Kismet warnings at compile time; try a known-good function like `PrintString` to isolate |
| CallFunction node appears but has no exec pins | Function found but `SetFromFunction` didn't populate pins | Check UE4 Output Log for any Kismet warnings during `Creator.Finalize()` |
| TypeScript error: "Property 'function' does not exist" | Handler type cast not updated | Re-check Step 3 of Task 4 -- both the Zod schema AND the cast need updating |
| MCP tool description still says "Pass 1" | `npm run build` not run after edit | Run `npm run build` from `D:/UE/UE_Bridge` |
| 4 nodes appear but connections missing | `PN_Then`/`PN_Execute` pin lookup failed on new node types | Check Output Log for "Could not find exec pins" -- Delay and CallFunction nodes do expose these pins in UE4.27 |
