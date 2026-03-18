# Blueprint Graph Builder Pass 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Branch node (`UK2Node_IfThenElse`) to the BlueprintGraphBuilder C++ plugin and fix the connection resolver to be role-aware, so that `branch.then` and `branch.else` wire to the correct exec output pins.

**Architecture:** One C++ file modified (`BlueprintGraphBuilderLibrary.cpp`). The Branch dispatch case follows the same Create/Finalize/ApplyParamsToNode pattern as existing nodes. The connection resolver gains an inline `Cast<UK2Node_IfThenElse>` block that maps the role string to `GetThenPin()`/`GetElsePin()`; all other nodes fall through to the existing `PN_Then` default. No TypeScript, Python, or MCP changes.

**Tech Stack:** C++17, UE4.27 editor APIs (BlueprintGraph, K2Node_IfThenElse, EdGraphSchema_K2).

**Spec:** `docs/superpowers/specs/2026-03-17-blueprint-graph-builder-pass4-design.md`

---

## File Map

**Modify (C++ plugin):**
- `D:/Unreal Projects/CodePlayground/Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BlueprintGraphBuilderLibrary.cpp`
  -- add Branch dispatch case (after CallFunction block, ~line 227); replace connection resolver source-pin logic (~lines 263-285)

**No other files change.** Header, Build.cs, TypeScript, Python -- all untouched.

---

## Task 1: Add Branch Dispatch Case

**Files:**
- Modify: `D:/Unreal Projects/CodePlayground/Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BlueprintGraphBuilderLibrary.cpp`

**Context:** The dispatch block is an if/else-if chain starting at line 153. The new `Branch` case goes after the `CallFunction` case (line 199-227), before the `else` unknown-type block at line 228. The pattern is identical to all other cases: CreateNode, Finalize, set SpawnedNode, call ApplyParamsToNode. `K2Node_IfThenElse.h` must be added to the includes at the top of the file.

- [ ] **Step 1: Add the include**

  Read the include block at the top of `BlueprintGraphBuilderLibrary.cpp` (lines 1-14). Add after `#include "K2Node_CallFunction.h"`:

  ```cpp
  #include "K2Node_IfThenElse.h"
  ```

- [ ] **Step 2: Add the Branch dispatch case**

  In the node type dispatch block, find the closing brace of the `CallFunction` case and the start of the `else` unknown-type block:

  ```cpp
        else
        {
            UE_LOG(LogTemp, Warning, TEXT("BuildBlueprintFromJSON: Unknown node type '%s', skipping"), *NodeType);
            continue;
        }
  ```

  Insert before it:

  ```cpp
        else if (NodeType == TEXT("Branch"))
        {
            FGraphNodeCreator<UK2Node_IfThenElse> Creator(*Graph);
            UK2Node_IfThenElse* BranchNode = Creator.CreateNode();
            Creator.Finalize();      // must precede ApplyParamsToNode -- Finalize calls AllocateDefaultPins
            SpawnedNode = BranchNode;
            ApplyParamsToNode(SpawnedNode, *NodeObj);
        }
  ```

- [ ] **Step 3: Verify the edit**

  Read back the dispatch block. Confirm:
  - `#include "K2Node_IfThenElse.h"` is present in the includes
  - The `Branch` else-if block appears after `CallFunction` and before the unknown-type `else`
  - `Creator.Finalize()` is called before `ApplyParamsToNode`
  - The unified position block (`if (SpawnedNode) { SpawnedNode->NodePosX = ... }`) is still present and unchanged after the dispatch chain

---

## Task 2: Fix the Connection Resolver

**Files:**
- Modify: `D:/Unreal Projects/CodePlayground/Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BlueprintGraphBuilderLibrary.cpp`

**Context:** The connection resolver is in Step 5 (~lines 246-287). Currently it:
1. Calls `FromStr.Split` / `ToStr.Split` without checking the return value
2. Ignores `FromPinRole` entirely (always uses `PN_Then`)
3. Has no null guard on the source pin

The new resolver must: guard the Split calls, normalize roles to lowercase, use an inline Cast to resolve Branch roles, fall through to `PN_Then` for other node types, and null-guard both source and target pins.

- [ ] **Step 1: Replace the Split calls with guarded versions**

  Find this block in the resolver (around line 258-265):

  ```cpp
            FString FromStr, ToStr;
            (*ConnObj)->TryGetStringField(TEXT("from"), FromStr);
            (*ConnObj)->TryGetStringField(TEXT("to"), ToStr);

            // Parse "nodeId.pinRole"
            FString FromNodeId, FromPinRole, ToNodeId, ToPinRole;
            FromStr.Split(TEXT("."), &FromNodeId, &FromPinRole);
            ToStr.Split(TEXT("."), &ToNodeId, &ToPinRole);
  ```

  Replace with:

  ```cpp
            FString FromStr, ToStr;
            (*ConnObj)->TryGetStringField(TEXT("from"), FromStr);
            (*ConnObj)->TryGetStringField(TEXT("to"), ToStr);

            // Parse "nodeId.role" -- guard against missing dot
            FString FromNodeId, FromPinRole;
            if (!FromStr.Split(TEXT("."), &FromNodeId, &FromPinRole))
            {
                UE_LOG(LogTemp, Warning,
                    TEXT("BuildBlueprintFromJSON: Invalid connection format '%s' -- expected 'nodeId.role'"),
                    *FromStr);
                continue;
            }
            FString ToNodeId, ToPinRole;
            if (!ToStr.Split(TEXT("."), &ToNodeId, &ToPinRole))
            {
                UE_LOG(LogTemp, Warning,
                    TEXT("BuildBlueprintFromJSON: Invalid connection format '%s' -- expected 'nodeId.role'"),
                    *ToStr);
                continue;
            }

            // Case-normalize roles so "Then", "ELSE", "Exec" etc. all work
            FromPinRole = FromPinRole.ToLower();
            ToPinRole   = ToPinRole.ToLower();
  ```

- [ ] **Step 2: Replace the source pin lookup with role-aware resolution**

  Find this block (around line 275-277):

  ```cpp
            // For exec connections: source uses PN_Then (output), target uses PN_Execute (input)
            UEdGraphPin* SourcePin = (*FromNodePtr)->FindPin(UEdGraphSchema_K2::PN_Then);
            UEdGraphPin* TargetPin = (*ToNodePtr)->FindPin(UEdGraphSchema_K2::PN_Execute);
  ```

  Replace with:

  ```cpp
            // Resolve source exec output pin -- role-aware for Branch, default PN_Then for others.
            // "then" and "else" are the canonical FName string values of PN_Then/PN_Else.
            UEdGraphPin* SourcePin = nullptr;
            if (UK2Node_IfThenElse* Branch = Cast<UK2Node_IfThenElse>(*FromNodePtr))
            {
                if (FromPinRole == TEXT("then"))
                {
                    SourcePin = Branch->GetThenPin();
                    // GetThenPin() calls check() internally -- cannot return null
                }
                else if (FromPinRole == TEXT("else"))
                {
                    SourcePin = Branch->GetElsePin();
                    // GetElsePin() calls check() internally -- cannot return null
                }
                else
                {
                    // "exec", "Condition", or any other invalid role on a Branch output
                    UE_LOG(LogTemp, Warning,
                        TEXT("BuildBlueprintFromJSON: Invalid role '%s' for Branch output on node '%s' -- expected 'then' or 'else'"),
                        *FromPinRole, *FromNodeId);
                    continue;
                }
            }
            else
            {
                // All other node types: default exec output
                SourcePin = (*FromNodePtr)->FindPin(UEdGraphSchema_K2::PN_Then);
            }

            if (!SourcePin)
            {
                UE_LOG(LogTemp, Warning,
                    TEXT("BuildBlueprintFromJSON: Could not resolve source pin for node '%s' role '%s'"),
                    *FromNodeId, *FromPinRole);
                continue;
            }

            UEdGraphPin* TargetPin = (*ToNodePtr)->FindPin(UEdGraphSchema_K2::PN_Execute);
  ```

- [ ] **Step 3: Add null guard on target pin**

  Find the existing null guard block (around line 279):

  ```cpp
            if (!SourcePin || !TargetPin)
            {
                UE_LOG(LogTemp, Warning, TEXT("BuildBlueprintFromJSON: Could not find exec pins for connection %s -> %s"), *FromStr, *ToStr);
                continue;
            }
  ```

  Replace with (split into separate guards with specific messages):

  ```cpp
            if (!TargetPin)
            {
                UE_LOG(LogTemp, Warning,
                    TEXT("BuildBlueprintFromJSON: Could not find exec input pin on node '%s'"),
                    *ToNodeId);
                continue;
            }
  ```

  The source pin null guard was added in Step 2. This step adds only the target pin guard.

- [ ] **Step 4: Verify the full resolver block**

  Read back the Step 5 connection resolver. Confirm in order:
  1. Guarded `FromStr.Split` with Warning + continue on failure
  2. Guarded `ToStr.Split` with Warning + continue on failure
  3. `FromPinRole = FromPinRole.ToLower()` and `ToPinRole = ToPinRole.ToLower()`
  4. `Cast<UK2Node_IfThenElse>` block mapping `"then"` to `GetThenPin()`, `"else"` to `GetElsePin()`, anything else to Warning + continue
  5. `else` block using `FindPin(PN_Then)` for non-Branch nodes
  6. Null guard on `SourcePin` (Warning + continue)
  7. `FindPin(PN_Execute)` for target pin
  8. Null guard on `TargetPin` (Warning + continue)
  9. `SourcePin->MakeLinkTo(TargetPin)` unchanged

---

## Task 3: Compile and Smoke Test

**Context:** UE4.27 must be open with `CodePlayground` loaded. Use Live Coding
(Ctrl+Alt+F11) or close and reopen the project after editing. All smoke tests run
directly in UE4's Python console (Output Log > Python tab), not via MCP.

- [ ] **Step 1: Compile**

  Trigger Live Coding (Ctrl+Alt+F11 in the UE4 editor) or rebuild from Visual Studio.
  Expected: zero compiler errors. If `K2Node_IfThenElse.h` cannot be found, verify
  `BlueprintGraph` is in `PrivateDependencyModuleNames` in the `.Build.cs` file (it
  already is from prior passes -- this is a sanity check only).

- [ ] **Step 2: Smoke test -- Condition true (Then path)**

  Run in UE4 Python console:

  ```python
  import unreal, json
  bp = unreal.load_object(None, "/Game/BP_TestGraph.BP_TestGraph")
  graph_data = {
      "nodes": [
          {"id": "begin",  "type": "BeginPlay"},
          {"id": "branch", "type": "Branch", "params": {"Condition": True}},
          {"id": "ok",     "type": "CallFunction", "function": "PrintString",
           "params": {"InString": "SUCCESS"}},
          {"id": "fail",   "type": "CallFunction", "function": "PrintString",
           "params": {"InString": "FAILED"}}
      ],
      "connections": [
          {"from": "begin.exec",  "to": "branch.exec"},
          {"from": "branch.then", "to": "ok.exec"},
          {"from": "branch.else", "to": "fail.exec"}
      ]
  }
  unreal.BlueprintGraphBuilderLibrary.build_blueprint_from_json(bp, json.dumps(graph_data), True)
  print("done")
  ```

  Expected Output Log entries:
  - `ApplyParamsToNode: Setting pin Condition = true`
  - `BuildBlueprintFromJSON: Done. 4 nodes spawned.`

  Open `BP_TestGraph` in the Blueprint editor. Confirm:
  - Branch node present with `Condition` pin showing `true`
  - Then output wired to SUCCESS PrintString
  - Else output wired to FAILED PrintString

  Hit Play. Confirm "SUCCESS" appears on screen. "FAILED" must NOT appear.

- [ ] **Step 3: Smoke test -- Condition false (Else path)**

  Run in UE4 Python console (change `Condition` to `False`):

  ```python
  import unreal, json
  bp = unreal.load_object(None, "/Game/BP_TestGraph.BP_TestGraph")
  graph_data = {
      "nodes": [
          {"id": "begin",  "type": "BeginPlay"},
          {"id": "branch", "type": "Branch", "params": {"Condition": False}},
          {"id": "ok",     "type": "CallFunction", "function": "PrintString",
           "params": {"InString": "SUCCESS"}},
          {"id": "fail",   "type": "CallFunction", "function": "PrintString",
           "params": {"InString": "FAILED"}}
      ],
      "connections": [
          {"from": "begin.exec",  "to": "branch.exec"},
          {"from": "branch.then", "to": "ok.exec"},
          {"from": "branch.else", "to": "fail.exec"}
      ]
  }
  unreal.BlueprintGraphBuilderLibrary.build_blueprint_from_json(bp, json.dumps(graph_data), True)
  print("done")
  ```

  Hit Play. Confirm "FAILED" appears. "SUCCESS" must NOT appear.

- [ ] **Step 4: Smoke test -- missing params (default false)**

  Run in UE4 Python console (no params on branch):

  ```python
  import unreal, json
  bp = unreal.load_object(None, "/Game/BP_TestGraph.BP_TestGraph")
  graph_data = {
      "nodes": [
          {"id": "begin",  "type": "BeginPlay"},
          {"id": "branch", "type": "Branch"},
          {"id": "ok",     "type": "CallFunction", "function": "PrintString",
           "params": {"InString": "SUCCESS"}},
          {"id": "fail",   "type": "CallFunction", "function": "PrintString",
           "params": {"InString": "FAILED"}}
      ],
      "connections": [
          {"from": "begin.exec",  "to": "branch.exec"},
          {"from": "branch.then", "to": "ok.exec"},
          {"from": "branch.else", "to": "fail.exec"}
      ]
  }
  unreal.BlueprintGraphBuilderLibrary.build_blueprint_from_json(bp, json.dumps(graph_data), True)
  print("done")
  ```

  Expected: No `ApplyParamsToNode` log lines (params absent, early return). Condition
  defaults to false. Hit Play -- "FAILED" appears. No errors in Output Log.

- [ ] **Step 5: Smoke test -- invalid role on Branch output**

  Run in UE4 Python console (use `branch.exec` as a source role, which is invalid):

  ```python
  import unreal, json
  bp = unreal.load_object(None, "/Game/BP_TestGraph.BP_TestGraph")
  graph_data = {
      "nodes": [
          {"id": "begin",  "type": "BeginPlay"},
          {"id": "branch", "type": "Branch", "params": {"Condition": True}},
          {"id": "ok",     "type": "CallFunction", "function": "PrintString",
           "params": {"InString": "SUCCESS"}}
      ],
      "connections": [
          {"from": "begin.exec",  "to": "branch.exec"},
          {"from": "branch.exec", "to": "ok.exec"}   # invalid: exec is an input, not output
      ]
  }
  unreal.BlueprintGraphBuilderLibrary.build_blueprint_from_json(bp, json.dumps(graph_data), True)
  print("done")
  ```

  Expected Output Log: Warning containing `Invalid role 'exec' for Branch output on node 'branch'`.
  The Blueprint builds successfully (the invalid connection is skipped). No crash.

- [ ] **Step 6: Commit**

  ```bash
  cd "D:/Unreal Projects/CodePlayground"
  git add Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BlueprintGraphBuilderLibrary.cpp
  git commit -m "feat: add Branch node + role-aware exec wiring to BlueprintGraphBuilder"
  ```

  If CodePlayground is not a git repo, skip -- the file change is still in place.

---

## Task 4: End-to-End Test via MCP

**Context:** This task tests the full pipeline: MCP tool -> TypeScript -> python_proxy
-> C++ -> Blueprint graph with branching. No new schema changes are needed -- the
Zod schema already accepts `"Branch"` as a type string and `"Condition"` as a param.
Requires UE4 running with the MCP listener active.

- [ ] **Step 1: Call blueprint_build_from_json via MCP with Condition true**

  Use the `blueprint_build_from_json` MCP tool:

  ```json
  {
    "blueprint_path": "/Game/BP_TestGraph.BP_TestGraph",
    "graph": {
      "nodes": [
        { "id": "begin",  "type": "BeginPlay" },
        { "id": "branch", "type": "Branch", "params": { "Condition": true } },
        { "id": "ok",     "type": "CallFunction", "function": "PrintString",
          "params": { "InString": "MCP SUCCESS" } },
        { "id": "fail",   "type": "CallFunction", "function": "PrintString",
          "params": { "InString": "MCP FAILED" } }
      ],
      "connections": [
        { "from": "begin.exec",  "to": "branch.exec" },
        { "from": "branch.then", "to": "ok.exec" },
        { "from": "branch.else", "to": "fail.exec" }
      ]
    },
    "clear_existing": true
  }
  ```

  Expected response: `success: true`.

- [ ] **Step 2: Verify in Blueprint editor and Play**

  Open `BP_TestGraph`. Confirm:
  - 4 nodes present, wired left-to-right
  - Branch Condition = true
  - Then wire -> "MCP SUCCESS" node
  - Else wire -> "MCP FAILED" node

  Hit Play. "MCP SUCCESS" appears. "MCP FAILED" does not.

- [ ] **Step 3: Final commit (UE_Bridge side)**

  ```bash
  cd D:/UE/UE_Bridge
  git add docs/superpowers/plans/2026-03-17-blueprint-graph-builder-pass4.md
  git commit -m "docs: add Pass 4 implementation plan for Branch node"
  ```

---

## Troubleshooting Reference

| Symptom | Cause | Fix |
|---|---|---|
| Both SUCCESS and FAILED fire | `branch.then` and `branch.else` both wired to same PN_Then | Verify Cast block is correct; check `GetThenPin`/`GetElsePin` accessors |
| Neither path fires | Condition pin not found by `ApplyParamsToNode` | Check Output Log for `ApplyParamsToNode: Setting pin Condition`; verify pin name with python_proxy |
| "Invalid role" warning for `branch.then` | Role not being lowercased before comparison | Verify `FromPinRole = FromPinRole.ToLower()` is present before the Cast block |
| `K2Node_IfThenElse.h` not found | Include path wrong or module missing | Verify `#include "K2Node_IfThenElse.h"` (no subdirectory); verify `BlueprintGraph` in Build.cs |
| `GetThenPin()` or `GetElsePin()` engine crash | Called before `Creator.Finalize()` | Confirm Finalize precedes ApplyParamsToNode and SpawnedNode assignment |
| Warning: "Invalid connection format" | Connection string missing `.` separator | Check JSON for malformed `"from"` or `"to"` values |
| Condition pin shows default but wrong path fires | Bool pin default in UE4 is false | Expected behavior -- no params means Else fires |
