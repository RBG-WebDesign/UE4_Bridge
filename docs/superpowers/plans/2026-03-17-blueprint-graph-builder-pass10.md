# Blueprint Graph Builder Pass 10 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `CallFunction` to resolve member functions on the Blueprint's parent class hierarchy, not just static `BlueprintFunctionLibrary` functions.

**Architecture:** One C++ file modified. The existing CallFunction branch gets a Phase 2 lookup that walks `Blueprint->ParentClass` and its supers after the existing BlueprintFunctionLibrary scan finds nothing. No new node types, no new includes, no JSON schema changes.

**Tech Stack:** C++17, UE4.27 editor APIs.

**Spec:** `docs/superpowers/specs/2026-03-17-blueprint-graph-builder-pass10-design.md`

---

## File Map

**Modify (one file only):**
- `D:/Unreal Projects/CodePlayground/Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BlueprintGraphBuilderLibrary.cpp`
  -- extend the CallFunction branch's function resolution loop with a Phase 2 parent class walk

**No other files change.** No new includes needed -- `Blueprint->ParentClass` is already accessible.

---

## Task 1: Prototype -- Discover Member Function Names

**This task validates that member functions resolve correctly before modifying C++ code.**

- [ ] **Step 1: Find the exact function name for GetActorLocation**

  Via `python_proxy`:

  ```python
  import unreal
  actor_class = unreal.Actor.static_class()
  # List all Blueprint-callable functions on AActor
  for func_name in dir(actor_class):
      if 'location' in func_name.lower():
          print(func_name)
  ```

  Also check via C++ naming convention -- UE4 often prefixes with `K2_`:
  - `K2_GetActorLocation` (Blueprint-callable wrapper)
  - `GetActorLocation` (C++ only, not Blueprint-exposed)
  - `K2_SetActorLocation`

  Record the exact function names that have `FUNC_BlueprintCallable` or `FUNC_BlueprintPure`.

- [ ] **Step 2: Verify SetFromFunction works with member functions**

  Via `python_proxy`, manually spawn a CallFunction node for a member function:

  ```python
  import unreal
  actor_class = unreal.Actor.static_class()
  func = actor_class.find_function("K2_GetActorLocation")
  print(f"Function: {func}, flags: {func.function_flags if func else 'N/A'}")
  ```

  Confirm the function exists and is Blueprint-callable.

---

## Task 2: Extend CallFunction Resolution

**Files:**
- Modify: `D:/Unreal Projects/CodePlayground/Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BlueprintGraphBuilderLibrary.cpp`

**Context:** The CallFunction branch (around line 218) has a function resolution loop that iterates `TObjectIterator<UClass>` filtering for `BlueprintFunctionLibrary` subclasses. After this loop, if `Func` is still null, it logs an error.

- [ ] **Step 1: Read the current CallFunction resolution**

  Read lines 218-262. Locate the end of the Phase 1 loop (the `break` after finding a function) and the null check:

  ```cpp
  if (!Func)
  {
      UE_LOG(LogTemp, Error, TEXT("BuildBlueprintFromJSON: function '%s' not found in any BlueprintFunctionLibrary"), *FunctionName);
      continue;
  }
  ```

- [ ] **Step 2: Insert Phase 2 before the null check**

  Between the Phase 1 loop's closing brace and the `if (!Func)` null check, insert:

  ```cpp
            // Phase 2: Blueprint parent class hierarchy (member functions on self)
            if (!Func && Blueprint->ParentClass)
            {
                for (UClass* Class = Blueprint->ParentClass; Class; Class = Class->GetSuperClass())
                {
                    UFunction* Candidate = Class->FindFunctionByName(*FunctionName);
                    if (Candidate && Candidate->HasAnyFunctionFlags(FUNC_BlueprintCallable | FUNC_BlueprintPure))
                    {
                        Func = Candidate;
                        UE_LOG(LogTemp, Log, TEXT("BuildBlueprintFromJSON: Resolved function '%s' on %s (member)"),
                            *FunctionName, *Class->GetName());
                        break;
                    }
                }
            }
  ```

- [ ] **Step 3: Update the error message**

  Change the error message to reflect that both lookup phases were tried:

  ```cpp
  if (!Func)
  {
      UE_LOG(LogTemp, Error,
          TEXT("BuildBlueprintFromJSON: function '%s' not found in any BlueprintFunctionLibrary or parent class"),
          *FunctionName);
      continue;
  }
  ```

- [ ] **Step 4: Verify the full CallFunction block**

  Read back the entire CallFunction branch. Confirm in order:
  1. Function name extraction and validation (unchanged)
  2. Phase 1: BlueprintFunctionLibrary scan (unchanged)
  3. **NEW** Phase 2: Parent class hierarchy walk
  4. Null check with **UPDATED** error message
  5. FGraphNodeCreator / SetFromFunction / Finalize / ApplyParamsToNode (unchanged)

---

## Task 3: Compile and Smoke Test

- [ ] **Step 1: Rebuild**

  ```bash
  "D:/UE/UE_4.27/Engine/Build/BatchFiles/Build.bat" CodePlaygroundEditor Win64 Development \
    -Project="D:/Unreal Projects/CodePlayground/CodePlayground.uproject" \
    -WaitMutex -FromMsBuild
  ```

  Expected: build succeeds, zero errors. No new includes needed.

  Restart UE4 after build.

- [ ] **Step 2: Smoke test -- GetActorLocation (pure member function)**

  Via `python_proxy`:

  ```python
  import unreal, json
  bp = unreal.load_object(None, "/Game/BP_TestGraph.BP_TestGraph")
  graph_data = {
      "nodes": [
          {"id": "begin",  "type": "BeginPlay"},
          {"id": "getLoc", "type": "CallFunction", "function": "K2_GetActorLocation"},
          {"id": "break",  "type": "CallFunction", "function": "BreakVector"},
          {"id": "toStr",  "type": "CallFunction", "function": "Conv_FloatToString"},
          {"id": "print",  "type": "CallFunction", "function": "PrintString"}
      ],
      "connections": [
          {"from": "begin.exec",        "to": "print.exec"},
          {"from": "getLoc.ReturnValue", "to": "break.InVec"},
          {"from": "break.X",           "to": "toStr.InFloat"},
          {"from": "toStr.ReturnValue", "to": "print.InString"}
      ]
  }
  unreal.BlueprintGraphBuilderLibrary.build_blueprint_from_json(bp, json.dumps(graph_data), True)
  print("done")
  ```

  Open `BP_TestGraph`. Confirm:
  - GetActorLocation node present with self pin (auto-connected)
  - Data wires: ReturnValue -> BreakVector -> X -> Conv_FloatToString -> PrintString

  Hit Play. Expected: prints the actor's X position (some float value).

- [ ] **Step 3: Smoke test -- SetActorLocation (impure member function)**

  ```python
  import unreal, json
  bp = unreal.load_object(None, "/Game/BP_TestGraph.BP_TestGraph")
  graph_data = {
      "nodes": [
          {"id": "begin",  "type": "BeginPlay"},
          {"id": "make",   "type": "CallFunction", "function": "MakeVector",
           "params": {"X": 100.0, "Y": 200.0, "Z": 300.0}},
          {"id": "setLoc", "type": "CallFunction", "function": "K2_SetActorLocation"},
          {"id": "print",  "type": "CallFunction", "function": "PrintString",
           "params": {"InString": "Moved"}}
      ],
      "connections": [
          {"from": "begin.exec",       "to": "setLoc.exec"},
          {"from": "setLoc.exec",      "to": "print.exec"},
          {"from": "make.ReturnValue", "to": "setLoc.NewLocation"}
      ]
  }
  unreal.BlueprintGraphBuilderLibrary.build_blueprint_from_json(bp, json.dumps(graph_data), True)
  print("done")
  ```

  Expected: actor moves to (100, 200, 300), prints "Moved". The `NewLocation` pin name may need adjustment based on Task 1 findings.

- [ ] **Step 4: Smoke test -- Library function still works**

  Run any previous pass's test (e.g., MakeVector -> BreakVector chain) to confirm Phase 1 resolution is unaffected.

- [ ] **Step 5: Commit**

  ```bash
  cd "D:/Unreal Projects/CodePlayground"
  git add Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BlueprintGraphBuilderLibrary.cpp
  git commit -m "feat: add member function resolution to CallFunction in BlueprintGraphBuilder"
  ```

---

## Task 4: End-to-End Test via MCP

- [ ] **Step 1: Call blueprint_build_from_json via MCP**

  Use the `blueprint_build_from_json` MCP tool with the GetActorLocation graph from Task 3.

  Expected response: `success: true`.

- [ ] **Step 2: Verify and Play**

  Open `BP_TestGraph`. Confirm self pin auto-connects. Hit Play. Prints X position.

---

## Troubleshooting Reference

| Symptom | Cause | Fix |
|---|---|---|
| `function 'GetActorLocation' not found` | Wrong name -- UE uses K2_ prefix | Use `K2_GetActorLocation` |
| Self pin not connected | `SetFromFunction` with wrong class context | The function's outer class must match the Blueprint's parent chain |
| Phase 1 returns wrong function | Name collision between library and member function | Phase 1 (library) takes priority by design; use the full K2_ name if needed |
| Compile succeeds but node shows error in editor | Function not Blueprint-callable | Check `FUNC_BlueprintCallable` flag; some C++ functions are not exposed |
| Performance regression from class hierarchy walk | Walk hits many classes | Parent chain is typically 3-5 deep; not a concern |
