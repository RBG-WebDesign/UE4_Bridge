# Blueprint Graph Builder Pass 8 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `VariableGet` and `VariableSet` node types that read/write existing Blueprint variables by name.

**Architecture:** One C++ file modified. Two new includes, two new `else if` branches in the node dispatch loop. Property lookup on `GeneratedClass` with `SkeletonGeneratedClass` fallback. No connection resolver changes -- variable pins resolve through the existing `FindPinCaseInsensitive` fallback.

**Tech Stack:** C++17, UE4.27 editor APIs (EdGraph, K2Node_VariableGet, K2Node_VariableSet).

**Spec:** `docs/superpowers/specs/2026-03-17-blueprint-graph-builder-pass8-design.md`

---

## File Map

**Modify (one file only):**
- `D:/Unreal Projects/CodePlayground/Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BlueprintGraphBuilderLibrary.cpp`
  -- add includes for K2Node_VariableGet/Set, add two node type branches before the unknown-type fallback

**No other files change.** Header, Build.cs, TypeScript, Python -- untouched.

---

## Task 1: Add Includes

**Files:**
- Modify: `D:/Unreal Projects/CodePlayground/Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BlueprintGraphBuilderLibrary.cpp`

- [ ] **Step 1: Read the current includes**

  Read lines 1-17 of `BlueprintGraphBuilderLibrary.cpp`. Confirm the includes end at line 16 (Serialization/JsonSerializer.h) and that `FindPinCaseInsensitive` starts at line 18.

- [ ] **Step 2: Add the new includes**

  Insert after the existing includes (after the `#include "Serialization/JsonSerializer.h"` line):

  ```cpp
  #include "K2Node_VariableGet.h"
  #include "K2Node_VariableSet.h"
  ```

- [ ] **Step 3: Verify the edit**

  Read back lines 1-22. Confirm:
  - `K2Node_VariableGet.h` and `K2Node_VariableSet.h` are included
  - `FindPinCaseInsensitive` follows after a blank line
  - No duplicate includes

---

## Task 2: Add VariableGet and VariableSet Node Branches

**Files:**
- Modify: `D:/Unreal Projects/CodePlayground/Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BlueprintGraphBuilderLibrary.cpp`

**Context:** The node dispatch loop has branches for BeginPlay, PrintString, Delay, CallFunction, Branch, and Sequence. The final `else` clause (around line 279) handles unknown types. The new branches go between the Sequence branch and this `else`.

- [ ] **Step 1: Find the insertion point**

  Read the node dispatch area (approximately lines 270-285). Locate the Sequence closing brace and the `else` unknown-type fallback:

  ```cpp
      else if (NodeType == TEXT("Sequence"))
      {
          // ...
      }
      else
      {
          UE_LOG(LogTemp, Warning, TEXT("BuildBlueprintFromJSON: Unknown node type '%s', skipping"), *NodeType);
          continue;
      }
  ```

- [ ] **Step 2: Insert VariableGet branch**

  Between the Sequence closing brace and the `else` unknown-type block, insert:

  ```cpp
        else if (NodeType == TEXT("VariableGet"))
        {
            FString VariableName;
            (*NodeObj)->TryGetStringField(TEXT("variable"), VariableName);
            if (VariableName.IsEmpty())
            {
                UE_LOG(LogTemp, Error, TEXT("BuildBlueprintFromJSON: VariableGet node missing 'variable' field"));
                continue;
            }

            FProperty* Property = nullptr;
            if (Blueprint->GeneratedClass)
            {
                Property = Blueprint->GeneratedClass->FindPropertyByName(FName(*VariableName));
            }
            if (!Property && Blueprint->SkeletonGeneratedClass)
            {
                Property = Blueprint->SkeletonGeneratedClass->FindPropertyByName(FName(*VariableName));
            }
            if (!Property)
            {
                UE_LOG(LogTemp, Error,
                    TEXT("BuildBlueprintFromJSON: Variable '%s' not found on Blueprint"),
                    *VariableName);
                continue;
            }

            FGraphNodeCreator<UK2Node_VariableGet> Creator(*Graph);
            UK2Node_VariableGet* VarGetNode = Creator.CreateNode();
            VarGetNode->VariableReference.SetFromField<FProperty>(Property, false);
            Creator.Finalize();
            SpawnedNode = VarGetNode;
        }
  ```

- [ ] **Step 3: Insert VariableSet branch**

  Immediately after VariableGet, before the `else` unknown-type block:

  ```cpp
        else if (NodeType == TEXT("VariableSet"))
        {
            FString VariableName;
            (*NodeObj)->TryGetStringField(TEXT("variable"), VariableName);
            if (VariableName.IsEmpty())
            {
                UE_LOG(LogTemp, Error, TEXT("BuildBlueprintFromJSON: VariableSet node missing 'variable' field"));
                continue;
            }

            FProperty* Property = nullptr;
            if (Blueprint->GeneratedClass)
            {
                Property = Blueprint->GeneratedClass->FindPropertyByName(FName(*VariableName));
            }
            if (!Property && Blueprint->SkeletonGeneratedClass)
            {
                Property = Blueprint->SkeletonGeneratedClass->FindPropertyByName(FName(*VariableName));
            }
            if (!Property)
            {
                UE_LOG(LogTemp, Error,
                    TEXT("BuildBlueprintFromJSON: Variable '%s' not found on Blueprint"),
                    *VariableName);
                continue;
            }

            FGraphNodeCreator<UK2Node_VariableSet> Creator(*Graph);
            UK2Node_VariableSet* VarSetNode = Creator.CreateNode();
            VarSetNode->VariableReference.SetFromField<FProperty>(Property, false);
            Creator.Finalize();
            SpawnedNode = VarSetNode;
            ApplyParamsToNode(SpawnedNode, *NodeObj);
        }
  ```

- [ ] **Step 4: Verify the full dispatch chain**

  Read back the dispatch area. Confirm in order:
  1. BeginPlay
  2. PrintString
  3. Delay
  4. CallFunction
  5. Branch
  6. Sequence
  7. **NEW** VariableGet
  8. **NEW** VariableSet
  9. else (unknown type)

---

## Task 3: Compile and Smoke Test

**Context:** UE4.27 must be open with `CodePlayground` loaded. Rebuild via Build.bat and restart UE4.

- [ ] **Step 1: Rebuild**

  ```bash
  "D:/UE/UE_4.27/Engine/Build/BatchFiles/Build.bat" CodePlaygroundEditor Win64 Development \
    -Project="D:/Unreal Projects/CodePlayground/CodePlayground.uproject" \
    -WaitMutex -FromMsBuild
  ```

  Expected: build succeeds, zero errors. `UK2Node_VariableGet` and `UK2Node_VariableSet` are standard K2 node types in UE4.27.

  Restart UE4 after build.

- [ ] **Step 2: Create test variable**

  Via `python_proxy` MCP tool, create a float variable on BP_TestGraph:

  ```python
  import unreal
  bp = unreal.load_object(None, "/Game/BP_TestGraph.BP_TestGraph")
  # Add a float variable named MyFloat
  # The exact API may need discovery -- try:
  unreal.BlueprintEditorLibrary.add_member_variable(bp, "MyFloat", unreal.EdGraphPinType())
  ```

  If the Python API for variable creation is unavailable, create `MyFloat` (Float type) manually in the Blueprint editor Variables panel.

- [ ] **Step 3: Smoke test -- Set and Get variable**

  Via `python_proxy` MCP tool:

  ```python
  import unreal, json
  bp = unreal.load_object(None, "/Game/BP_TestGraph.BP_TestGraph")
  graph_data = {
      "nodes": [
          {"id": "begin", "type": "BeginPlay"},
          {"id": "set",   "type": "VariableSet", "variable": "MyFloat",
           "params": {"MyFloat": 42.0}},
          {"id": "get",   "type": "VariableGet", "variable": "MyFloat"},
          {"id": "toStr", "type": "CallFunction", "function": "Conv_FloatToString"},
          {"id": "print", "type": "CallFunction", "function": "PrintString"}
      ],
      "connections": [
          {"from": "begin.exec",       "to": "set.exec"},
          {"from": "set.exec",         "to": "print.exec"},
          {"from": "get.MyFloat",      "to": "toStr.InFloat"},
          {"from": "toStr.ReturnValue","to": "print.InString"}
      ]
  }
  unreal.BlueprintGraphBuilderLibrary.build_blueprint_from_json(bp, json.dumps(graph_data), True)
  print("done")
  ```

  Open `BP_TestGraph`. Confirm:
  - 5 nodes present: BeginPlay, Set MyFloat, Get MyFloat, Conv_FloatToString, PrintString
  - Exec wires: BeginPlay -> Set MyFloat -> PrintString
  - Data wires: Get MyFloat -> Conv_FloatToString -> PrintString.InString

  Hit Play. Expected: `42.0` prints on screen.

- [ ] **Step 4: Smoke test -- Variable not found**

  ```python
  import unreal, json
  bp = unreal.load_object(None, "/Game/BP_TestGraph.BP_TestGraph")
  graph_data = {
      "nodes": [
          {"id": "get", "type": "VariableGet", "variable": "NonExistentVar"}
      ],
      "connections": []
  }
  unreal.BlueprintGraphBuilderLibrary.build_blueprint_from_json(bp, json.dumps(graph_data), True)
  print("done")
  ```

  Expected: error in Output Log: `Variable 'NonExistentVar' not found on Blueprint`. Node skipped. No crash.

- [ ] **Step 5: Commit**

  ```bash
  cd "D:/Unreal Projects/CodePlayground"
  git add Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BlueprintGraphBuilderLibrary.cpp
  git commit -m "feat: add VariableGet and VariableSet node types to BlueprintGraphBuilder"
  ```

---

## Task 4: End-to-End Test via MCP

- [ ] **Step 1: Call blueprint_build_from_json via MCP**

  Use the `blueprint_build_from_json` MCP tool with the same graph from Task 3 Step 3.

  Expected response: `success: true`.

- [ ] **Step 2: Verify in Blueprint editor and Play**

  Open `BP_TestGraph`. Confirm variable nodes and wires are present. Hit Play. `42.0` prints.

---

## Troubleshooting Reference

| Symptom | Cause | Fix |
|---|---|---|
| `Variable 'X' not found on Blueprint` | Variable doesn't exist or Blueprint not compiled | Create variable first, then compile Blueprint before building graph |
| Node spawns but no pins visible | `SetFromField` called before `Finalize` | Ensure `SetFromField` is called before `Creator.Finalize()` |
| Node spawns but pin name doesn't match variable name | UE uses internal pin naming | Dump pins via python_proxy to discover actual pin names |
| `SkeletonGeneratedClass` is null | Blueprint in bad state | Compile the Blueprint manually first |
| Linker error on K2Node_VariableGet | Missing module dependency | Add `BlueprintGraph` to Build.cs module dependencies |
