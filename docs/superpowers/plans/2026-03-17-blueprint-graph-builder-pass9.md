# Blueprint Graph Builder Pass 9 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `ForLoop` and `ForEachLoop` node types so graphs can iterate.

**Architecture:** One C++ file modified. ForLoop and ForEachLoop are macro instances in UE4 -- they use `UK2Node_MacroInstance` with `SetMacroGraph()` pointing to engine-provided macro Blueprints. The exact macro graph asset path must be discovered via prototyping before implementation.

**Tech Stack:** C++17, UE4.27 editor APIs (K2Node_MacroInstance).

**Spec:** `docs/superpowers/specs/2026-03-17-blueprint-graph-builder-pass9-design.md`

---

## File Map

**Modify (one file only):**
- `D:/Unreal Projects/CodePlayground/Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BlueprintGraphBuilderLibrary.cpp`
  -- add K2Node_MacroInstance include, add ForLoop and ForEachLoop branches in the node dispatch loop

**No other files change.**

---

## Task 1: Prototype -- Discover ForLoop Spawn Mechanism

**This task must be completed before any C++ changes.** The exact spawn mechanism for loop nodes is uncertain and must be discovered empirically.

- [ ] **Step 1: Inspect an existing ForLoop node**

  Manually place a ForLoop node in a Blueprint in the UE4 editor. Then via `python_proxy`:

  ```python
  import unreal
  bp = unreal.load_object(None, "/Game/BP_TestGraph.BP_TestGraph")
  graph = bp.ubergraph_pages[0] if len(bp.ubergraph_pages) > 0 else None
  if graph:
      for node in graph.nodes:
          class_name = type(node).__name__
          node_name = node.get_name()
          print(f"{class_name}: {node_name}")
          if "Macro" in class_name or "Loop" in class_name or "ForLoop" in node_name.lower():
              print(f"  ** MATCH ** class={class_name}")
              # Try to get the macro graph reference
              if hasattr(node, 'get_macro_graph'):
                  mg = node.get_macro_graph()
                  print(f"  MacroGraph: {mg.get_path_name() if mg else 'None'}")
              for pin in node.pins:
                  print(f"  Pin: {pin.pin_name} dir={'Out' if pin.direction == unreal.EdGraphPinDirection.EGPD_OUTPUT else 'In'}")
  ```

  Record:
  - The node's C++ class (expected: `K2Node_MacroInstance`)
  - The macro graph asset path (e.g., `/Engine/Transient.ForLoop`)
  - All pin names and directions

- [ ] **Step 2: Attempt programmatic spawn**

  Via `python_proxy`, try spawning a ForLoop via the discovered mechanism:

  ```python
  import unreal
  bp = unreal.load_object(None, "/Game/BP_TestGraph.BP_TestGraph")
  graph = bp.ubergraph_pages[0]

  # Try loading the macro graph directly
  macro_graph = unreal.load_object(None, "<path from Step 1>")
  print(f"Macro graph: {macro_graph}")

  # If that fails, try finding it through the macro library
  # This step determines the exact C++ API needed
  ```

- [ ] **Step 3: Document findings**

  Record the exact:
  - Include needed (expected: `K2Node_MacroInstance.h`)
  - Asset path for ForLoop macro graph
  - Asset path for ForEachLoop macro graph
  - Pin names (confirm against Step 1)
  - Any special setup required after `SetMacroGraph`

---

## Task 2: Add ForLoop and ForEachLoop Node Branches

**Files:**
- Modify: `D:/Unreal Projects/CodePlayground/Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BlueprintGraphBuilderLibrary.cpp`

**Depends on:** Task 1 findings. The code below uses placeholder paths that must be replaced with the discovered values.

- [ ] **Step 1: Add the include**

  Add after the existing includes:

  ```cpp
  #include "K2Node_MacroInstance.h"
  ```

- [ ] **Step 2: Insert ForLoop branch**

  After the VariableSet branch (from Pass 8) and before the `else` unknown-type block:

  ```cpp
        else if (NodeType == TEXT("ForLoop"))
        {
            // ForLoop is a macro instance -- load the engine-provided macro graph
            UEdGraph* MacroGraph = LoadObject<UEdGraph>(nullptr,
                TEXT("<DISCOVERED_PATH_FROM_TASK_1>"));
            if (!MacroGraph)
            {
                UE_LOG(LogTemp, Error, TEXT("BuildBlueprintFromJSON: ForLoop macro graph not found"));
                continue;
            }

            FGraphNodeCreator<UK2Node_MacroInstance> Creator(*Graph);
            UK2Node_MacroInstance* MacroNode = Creator.CreateNode();
            MacroNode->SetMacroGraph(MacroGraph);
            Creator.Finalize();
            SpawnedNode = MacroNode;
            ApplyParamsToNode(SpawnedNode, *NodeObj);
        }
  ```

- [ ] **Step 3: Insert ForEachLoop branch**

  Same pattern with the ForEachLoop macro graph path:

  ```cpp
        else if (NodeType == TEXT("ForEachLoop"))
        {
            UEdGraph* MacroGraph = LoadObject<UEdGraph>(nullptr,
                TEXT("<DISCOVERED_PATH_FROM_TASK_1>"));
            if (!MacroGraph)
            {
                UE_LOG(LogTemp, Error, TEXT("BuildBlueprintFromJSON: ForEachLoop macro graph not found"));
                continue;
            }

            FGraphNodeCreator<UK2Node_MacroInstance> Creator(*Graph);
            UK2Node_MacroInstance* MacroNode = Creator.CreateNode();
            MacroNode->SetMacroGraph(MacroGraph);
            Creator.Finalize();
            SpawnedNode = MacroNode;
            ApplyParamsToNode(SpawnedNode, *NodeObj);
        }
  ```

- [ ] **Step 4: Verify the dispatch chain**

  Confirm the node type order:
  1. BeginPlay, PrintString, Delay, CallFunction, Branch, Sequence
  2. VariableGet, VariableSet (Pass 8)
  3. **NEW** ForLoop, ForEachLoop
  4. else (unknown type)

---

## Task 3: Compile and Smoke Test

- [ ] **Step 1: Rebuild**

  ```bash
  "D:/UE/UE_4.27/Engine/Build/BatchFiles/Build.bat" CodePlaygroundEditor Win64 Development \
    -Project="D:/Unreal Projects/CodePlayground/CodePlayground.uproject" \
    -WaitMutex -FromMsBuild
  ```

  Restart UE4 after build.

- [ ] **Step 2: Smoke test -- ForLoop 0 to 3**

  Via `python_proxy`:

  ```python
  import unreal, json
  bp = unreal.load_object(None, "/Game/BP_TestGraph.BP_TestGraph")
  graph_data = {
      "nodes": [
          {"id": "begin", "type": "BeginPlay"},
          {"id": "loop",  "type": "ForLoop",
           "params": {"FirstIndex": 0, "LastIndex": 3}},
          {"id": "toStr", "type": "CallFunction", "function": "Conv_IntToString"},
          {"id": "print", "type": "CallFunction", "function": "PrintString"},
          {"id": "done",  "type": "CallFunction", "function": "PrintString",
           "params": {"InString": "Done"}}
      ],
      "connections": [
          {"from": "begin.exec",       "to": "loop.exec"},
          {"from": "loop.LoopBody",    "to": "print.exec"},
          {"from": "loop.Index",       "to": "toStr.InInt"},
          {"from": "toStr.ReturnValue","to": "print.InString"},
          {"from": "loop.Completed",   "to": "done.exec"}
      ]
  }
  unreal.BlueprintGraphBuilderLibrary.build_blueprint_from_json(bp, json.dumps(graph_data), True)
  print("done")
  ```

  Open `BP_TestGraph`. Confirm:
  - ForLoop node visible with FirstIndex=0, LastIndex=3
  - LoopBody exec -> PrintString, Completed exec -> PrintString("Done")
  - Index data -> Conv_IntToString -> PrintString.InString

  Hit Play. Expected: prints 0, 1, 2, 3, then "Done".

- [ ] **Step 3: Smoke test -- Pin name verification**

  If pin names from Task 1 differ from expected (e.g., `Loop Body` instead of `LoopBody`), update the test connections to use the actual pin names. The `FindPinCaseInsensitive` helper handles casing but not space differences.

- [ ] **Step 4: Commit**

  ```bash
  cd "D:/Unreal Projects/CodePlayground"
  git add Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BlueprintGraphBuilderLibrary.cpp
  git commit -m "feat: add ForLoop and ForEachLoop node types to BlueprintGraphBuilder"
  ```

---

## Task 4: End-to-End Test via MCP

- [ ] **Step 1: Call blueprint_build_from_json via MCP**

  Use the `blueprint_build_from_json` MCP tool with the ForLoop graph from Task 3.

  Expected response: `success: true`.

- [ ] **Step 2: Verify and Play**

  Open `BP_TestGraph`. Confirm loop structure. Hit Play. 0, 1, 2, 3, "Done" prints.

---

## Troubleshooting Reference

| Symptom | Cause | Fix |
|---|---|---|
| `ForLoop macro graph not found` | Wrong asset path | Re-run Task 1 prototype; path may include package name |
| Node spawns but no pins | `SetMacroGraph` not called before `Finalize` | Ensure order: CreateNode -> SetMacroGraph -> Finalize |
| Pin names don't match | Spaces in pin names (e.g., `Loop Body`) | Use exact pin names from Task 1; FindPinCaseInsensitive handles case but not spaces |
| Compile error: `UK2Node_MacroInstance` not found | Missing include or module dependency | Add include; if linker error, add `BlueprintGraph` to Build.cs |
| ForEachLoop needs array input | No array source in test | Defer ForEachLoop test until array variables are available |
