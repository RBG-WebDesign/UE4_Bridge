# Blueprint Graph Builder Pass 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Sequence node (`UK2Node_ExecutionSequence`) to the BlueprintGraphBuilder C++ plugin and extend the connection resolver to handle indexed exec outputs (`then_0`, `then_1`, ..., `then_N`), dynamically expanding the node when indices exceed the default 2 outputs.

**Architecture:** One C++ file modified (`BlueprintGraphBuilderLibrary.cpp`). The Sequence dispatch case follows the same Create/Finalize/ApplyParamsToNode pattern as existing nodes. The connection resolver gains an inline `Cast<UK2Node_ExecutionSequence>` block that parses `then_N`, expands the node if needed via `AddInputPin()`, and resolves the pin via `GetThenPinGivenIndex(Index)`. No TypeScript, Python, or MCP changes.

**Tech Stack:** C++17, UE4.27 editor APIs (BlueprintGraph, K2Node_ExecutionSequence).

**Spec:** `docs/superpowers/specs/2026-03-17-blueprint-graph-builder-pass5-design.md`

---

## File Map

**Modify (C++ plugin):**
- `D:/Unreal Projects/CodePlayground/Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BlueprintGraphBuilderLibrary.cpp`
  -- add include, add Sequence dispatch case (after Branch block), extend connection resolver with Sequence Cast block

**No other files change.** Header, Build.cs, TypeScript, Python -- all untouched.

---

## Task 1: Add Sequence Dispatch Case

**Files:**
- Modify: `D:/Unreal Projects/CodePlayground/Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BlueprintGraphBuilderLibrary.cpp`

**Context:** The dispatch block is an if/else-if chain. The new `Sequence` case goes after the `Branch` case (lines 229-236), before the `else` unknown-type block at line 237.

- [ ] **Step 1: Add the include**

  Read the include block at the top of `BlueprintGraphBuilderLibrary.cpp` (lines 1-14). Add after `#include "K2Node_IfThenElse.h"`:

  ```cpp
  #include "K2Node_ExecutionSequence.h"
  ```

- [ ] **Step 2: Add the Sequence dispatch case**

  In the node type dispatch block, find the closing brace of the `Branch` case and the start of the `else` unknown-type block:

  ```cpp
        else
        {
            UE_LOG(LogTemp, Warning, TEXT("BuildBlueprintFromJSON: Unknown node type '%s', skipping"), *NodeType);
            continue;
        }
  ```

  Insert before it:

  ```cpp
        else if (NodeType == TEXT("Sequence"))
        {
            FGraphNodeCreator<UK2Node_ExecutionSequence> Creator(*Graph);
            UK2Node_ExecutionSequence* SeqNode = Creator.CreateNode();
            Creator.Finalize();      // must precede ApplyParamsToNode -- Finalize calls AllocateDefaultPins
            SpawnedNode = SeqNode;
            ApplyParamsToNode(SpawnedNode, *NodeObj);
        }
  ```

- [ ] **Step 3: Verify the edit**

  Read back the dispatch block. Confirm:
  - `#include "K2Node_ExecutionSequence.h"` is present in the includes
  - The `Sequence` else-if block appears after `Branch` and before the unknown-type `else`
  - `Creator.Finalize()` is called before `ApplyParamsToNode`
  - The unified position block (`if (SpawnedNode) { SpawnedNode->NodePosX = ... }`) is still present and unchanged after the dispatch chain

---

## Task 2: Add Sequence Resolution to Connection Resolver

**Files:**
- Modify: `D:/Unreal Projects/CodePlayground/Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BlueprintGraphBuilderLibrary.cpp`

**Context:** The connection resolver's source pin resolution is an if/else chain:
1. `Cast<UK2Node_IfThenElse>` -- Branch: then/else
2. `else` -- all others: `FindPin(PN_Then)`

The Sequence block goes between these two, creating a 3-way chain:
1. Branch
2. Sequence
3. Default fallback

- [ ] **Step 1: Insert the Sequence Cast block**

  Find the `else` block that falls through to `PN_Then` for non-Branch nodes:

  ```cpp
            else
            {
                // All other node types: default exec output
                SourcePin = (*FromNodePtr)->FindPin(UEdGraphSchema_K2::PN_Then);
            }
  ```

  Insert before it (after the Branch block's closing brace):

  ```cpp
            else if (UK2Node_ExecutionSequence* Seq = Cast<UK2Node_ExecutionSequence>(*FromNodePtr))
            {
                // Expected format: "then_N" where N is a 0-based index.
                // FromPinRole is already lowercased at this point.
                if (FromPinRole.StartsWith(TEXT("then_")))
                {
                    FString IndexStr = FromPinRole.RightChop(5);  // chop "then_"
                    if (!IndexStr.IsNumeric())
                    {
                        UE_LOG(LogTemp, Warning,
                            TEXT("BuildBlueprintFromJSON: Invalid Sequence index '%s' on node '%s' -- expected 'then_N'"),
                            *FromPinRole, *FromNodeId);
                        continue;
                    }
                    int32 Index = FCString::Atoi(*IndexStr);

                    if (Index < 0 || Index > 99)
                    {
                        UE_LOG(LogTemp, Warning,
                            TEXT("BuildBlueprintFromJSON: Sequence index %d out of range on node '%s' -- max 99"),
                            Index, *FromNodeId);
                        continue;
                    }

                    // Expand the node if needed -- default has Then_0 and Then_1
                    while (!Seq->GetThenPinGivenIndex(Index))
                    {
                        Seq->AddInputPin();
                    }

                    SourcePin = Seq->GetThenPinGivenIndex(Index);
                }
                else
                {
                    UE_LOG(LogTemp, Warning,
                        TEXT("BuildBlueprintFromJSON: Invalid role '%s' for Sequence output on node '%s' -- expected 'then_N'"),
                        *FromPinRole, *FromNodeId);
                    continue;
                }
            }
  ```

- [ ] **Step 2: Verify the full resolver chain**

  Read back the Step 5 connection resolver. Confirm in order:
  1. Guarded `FromStr.Split` and `ToStr.Split` (unchanged from Pass 4)
  2. `FromPinRole.ToLower()` and `ToPinRole.ToLower()` (unchanged)
  3. `Cast<UK2Node_IfThenElse>` block -- Branch: then/else (unchanged)
  4. **NEW:** `Cast<UK2Node_ExecutionSequence>` block -- Sequence: then_0..then_N with:
     - `StartsWith("then_")` check
     - `IsNumeric()` guard on index string
     - Range guard (0-99)
     - `while` expansion loop
     - `GetThenPinGivenIndex(Index)` resolution
  5. `else` block using `FindPin(PN_Then)` for all other node types (unchanged)
  6. Null guard on `SourcePin` (unchanged)
  7. `FindPin(PN_Execute)` for target pin (unchanged)
  8. Null guard on `TargetPin` (unchanged)
  9. `SourcePin->MakeLinkTo(TargetPin)` (unchanged)

---

## Task 3: Compile and Smoke Test

**Context:** UE4.27 must be open with `CodePlayground` loaded. Use Live Coding
(Ctrl+Alt+F11) or close and reopen the project after editing. All smoke tests run
via python_proxy through MCP.

- [ ] **Step 1: Compile**

  Trigger Live Coding (Ctrl+Alt+F11 in the UE4 editor) or rebuild from Visual Studio.
  Expected: zero compiler errors. `K2Node_ExecutionSequence.h` is in the `BlueprintGraph`
  module which is already a dependency.

- [ ] **Step 2: Smoke test -- Basic 3-step sequence**

  Run via python_proxy:

  ```python
  import unreal, json
  bp = unreal.load_object(None, "/Game/BP_TestGraph.BP_TestGraph")
  graph_data = {
      "nodes": [
          {"id": "begin", "type": "BeginPlay"},
          {"id": "seq",   "type": "Sequence"},
          {"id": "a",     "type": "CallFunction", "function": "PrintString",
           "params": {"InString": "Step A"}},
          {"id": "b",     "type": "CallFunction", "function": "PrintString",
           "params": {"InString": "Step B"}},
          {"id": "c",     "type": "CallFunction", "function": "PrintString",
           "params": {"InString": "Step C"}}
      ],
      "connections": [
          {"from": "begin.exec",  "to": "seq.exec"},
          {"from": "seq.then_0",  "to": "a.exec"},
          {"from": "seq.then_1",  "to": "b.exec"},
          {"from": "seq.then_2",  "to": "c.exec"}
      ]
  }
  unreal.BlueprintGraphBuilderLibrary.build_blueprint_from_json(bp, json.dumps(graph_data), True)
  print("done")
  ```

  Open `BP_TestGraph` in the Blueprint editor. Confirm:
  - Sequence node present with 3 outputs (Then 0, Then 1, Then 2)
  - Each output wired to its PrintString node
  - BeginPlay wired to Sequence exec input

  Hit Play. Confirm all three print on screen: "Step A", "Step B", "Step C".

- [ ] **Step 3: Smoke test -- Default 2 outputs only**

  Run via python_proxy:

  ```python
  import unreal, json
  bp = unreal.load_object(None, "/Game/BP_TestGraph.BP_TestGraph")
  graph_data = {
      "nodes": [
          {"id": "begin", "type": "BeginPlay"},
          {"id": "seq",   "type": "Sequence"},
          {"id": "a",     "type": "CallFunction", "function": "PrintString",
           "params": {"InString": "First"}},
          {"id": "b",     "type": "CallFunction", "function": "PrintString",
           "params": {"InString": "Second"}}
      ],
      "connections": [
          {"from": "begin.exec",  "to": "seq.exec"},
          {"from": "seq.then_0",  "to": "a.exec"},
          {"from": "seq.then_1",  "to": "b.exec"}
      ]
  }
  unreal.BlueprintGraphBuilderLibrary.build_blueprint_from_json(bp, json.dumps(graph_data), True)
  print("done")
  ```

  Expected: "First" and "Second" print. No dynamic expansion needed (default 2 outputs).

- [ ] **Step 4: Smoke test -- Sequence + Branch combo**

  Run via python_proxy:

  ```python
  import unreal, json
  bp = unreal.load_object(None, "/Game/BP_TestGraph.BP_TestGraph")
  graph_data = {
      "nodes": [
          {"id": "begin",  "type": "BeginPlay"},
          {"id": "seq",    "type": "Sequence"},
          {"id": "greet",  "type": "CallFunction", "function": "PrintString",
           "params": {"InString": "Hello"}},
          {"id": "branch", "type": "Branch", "params": {"Condition": True}},
          {"id": "yes",    "type": "CallFunction", "function": "PrintString",
           "params": {"InString": "Yes path"}},
          {"id": "no",     "type": "CallFunction", "function": "PrintString",
           "params": {"InString": "No path"}}
      ],
      "connections": [
          {"from": "begin.exec",   "to": "seq.exec"},
          {"from": "seq.then_0",   "to": "greet.exec"},
          {"from": "seq.then_1",   "to": "branch.exec"},
          {"from": "branch.then",  "to": "yes.exec"},
          {"from": "branch.else",  "to": "no.exec"}
      ]
  }
  unreal.BlueprintGraphBuilderLibrary.build_blueprint_from_json(bp, json.dumps(graph_data), True)
  print("done")
  ```

  Hit Play. Expected: "Hello" and "Yes path" print. "No path" does not.

- [ ] **Step 5: Smoke test -- Invalid role on Sequence output**

  Run via python_proxy:

  ```python
  import unreal, json
  bp = unreal.load_object(None, "/Game/BP_TestGraph.BP_TestGraph")
  graph_data = {
      "nodes": [
          {"id": "begin", "type": "BeginPlay"},
          {"id": "seq",   "type": "Sequence"},
          {"id": "a",     "type": "CallFunction", "function": "PrintString",
           "params": {"InString": "Reached"}}
      ],
      "connections": [
          {"from": "begin.exec",  "to": "seq.exec"},
          {"from": "seq.exec",    "to": "a.exec"}
      ]
  }
  unreal.BlueprintGraphBuilderLibrary.build_blueprint_from_json(bp, json.dumps(graph_data), True)
  print("done")
  ```

  Expected: Warning in Output Log about invalid role 'exec' for Sequence output.
  Connection skipped. Graph builds. No crash. Hit Play -- nothing prints.

- [ ] **Step 6: Commit**

  ```bash
  cd "D:/Unreal Projects/CodePlayground"
  git add Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BlueprintGraphBuilderLibrary.cpp
  git commit -m "feat: add Sequence node + indexed exec output resolution to BlueprintGraphBuilder"
  ```

---

## Task 4: End-to-End Test via MCP

**Context:** Tests the full pipeline: MCP tool -> TypeScript -> python_proxy -> C++.
No new schema changes needed -- `"Sequence"` passes through as a type string, and
`"then_0"` etc. pass through as connection roles.

- [ ] **Step 1: Call blueprint_build_from_json via MCP with 3-step sequence**

  Use the `blueprint_build_from_json` MCP tool:

  ```json
  {
    "blueprint_path": "/Game/BP_TestGraph.BP_TestGraph",
    "graph": {
      "nodes": [
        { "id": "begin", "type": "BeginPlay" },
        { "id": "seq",   "type": "Sequence" },
        { "id": "a",     "type": "CallFunction", "function": "PrintString",
          "params": { "InString": "MCP Step A" } },
        { "id": "b",     "type": "CallFunction", "function": "PrintString",
          "params": { "InString": "MCP Step B" } },
        { "id": "c",     "type": "CallFunction", "function": "PrintString",
          "params": { "InString": "MCP Step C" } }
      ],
      "connections": [
        { "from": "begin.exec",  "to": "seq.exec" },
        { "from": "seq.then_0",  "to": "a.exec" },
        { "from": "seq.then_1",  "to": "b.exec" },
        { "from": "seq.then_2",  "to": "c.exec" }
      ]
    },
    "clear_existing": true
  }
  ```

  Expected response: `success: true`.

- [ ] **Step 2: Verify in Blueprint editor and Play**

  Open `BP_TestGraph`. Confirm:
  - 5 nodes present
  - Sequence has 3 outputs wired to 3 PrintString nodes
  - BeginPlay wired to Sequence

  Hit Play. "MCP Step A", "MCP Step B", "MCP Step C" all appear.

- [ ] **Step 3: Final commit (UE_Bridge side)**

  ```bash
  cd D:/UE/UE_Bridge
  git add docs/superpowers/specs/2026-03-17-blueprint-graph-builder-pass5-design.md
  git add docs/superpowers/plans/2026-03-17-blueprint-graph-builder-pass5.md
  git commit -m "docs: add Pass 5 spec and plan for Sequence node"
  ```

---

## Troubleshooting Reference

| Symptom | Cause | Fix |
|---|---|---|
| Only 2 of 3 steps fire | `then_2` not expanded -- `AddInputPin()` not called | Verify `while` loop logic |
| All steps fire but wrong order | Pin naming mismatch | Check `GetPinNameGivenIndex` returns `Then_N` format |
| Crash on `AddInputPin()` | Called before `Finalize()` | Confirm dispatch case calls `Creator.Finalize()` first |
| "Invalid Sequence index" warning for valid index | `IsNumeric()` failing on parsed string | Check `RightChop(5)` is correct (5 = length of "then_") |
| `K2Node_ExecutionSequence.h` not found | Include path wrong | Verify `#include "K2Node_ExecutionSequence.h"` (no subdirectory) |
| Sequence node appears but no outputs wired | Resolver not hitting Sequence Cast | Check Cast chain order: Branch -> Sequence -> default |
| Branch still works but Sequence doesn't | Sequence Cast block inserted in wrong position | Must be `else if` after Branch block |
| `GetThenPinGivenIndex` returns null after expansion | `AddInputPin` naming doesn't match `GetPinNameGivenIndex` | Both use same internal naming -- if this happens, dump pin names for debugging |
