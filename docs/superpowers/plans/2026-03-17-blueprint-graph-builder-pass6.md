# Blueprint Graph Builder Pass 6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add data pin wiring to the BlueprintGraphBuilder C++ plugin so that any two pins can be connected by name, not just exec-to-exec.

**Architecture:** One C++ file modified. Three additive changes: (1) add `FindPinCaseInsensitive` static helper, (2) extend the source resolver's default fallback to handle `exec` alias and data pins, (3) replace the fixed target `PN_Execute` lookup with an exec/data branch. Direction validation added after null guards. No new node types, no JSON schema changes.

**Tech Stack:** C++17, UE4.27 editor APIs (EdGraph, EdGraphSchema_K2).

**Spec:** `docs/superpowers/specs/2026-03-17-blueprint-graph-builder-pass6-design.md`

---

## File Map

**Modify (one file only):**
- `D:/Unreal Projects/CodePlayground/Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BlueprintGraphBuilderLibrary.cpp`
  -- add `FindPinCaseInsensitive` before `ApplyParamsToNode`, extend source resolver, replace fixed target resolver, add direction guards before `MakeLinkTo`

**No other files change.** Header, Build.cs, TypeScript, Python -- untouched.

---

## Task 1: Add FindPinCaseInsensitive Helper

**Files:**
- Modify: `D:/Unreal Projects/CodePlayground/Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BlueprintGraphBuilderLibrary.cpp`

This helper is used by both the source and target resolver in Task 2 and Task 3. It must exist before either of those edits.

- [ ] **Step 1: Read the current file header**

  Read lines 1-20 of `BlueprintGraphBuilderLibrary.cpp`. Confirm the includes end around line 15 and that the next thing is `void UBlueprintGraphBuilderLibrary::ApplyParamsToNode(...)` (line 17).

- [ ] **Step 2: Insert the helper**

  Insert this block between the includes and `ApplyParamsToNode`. It must be a file-scope static function -- no class, no UFUNCTION macro:

  ```cpp
  static UEdGraphPin* FindPinCaseInsensitive(UEdGraphNode* Node, const FString& Name)
  {
      if (!Node)
      {
          return nullptr;
      }
      for (UEdGraphPin* Pin : Node->Pins)
      {
          if (Pin && Pin->PinName.ToString().Equals(Name, ESearchCase::IgnoreCase))
          {
              return Pin;
          }
      }
      return nullptr;
  }
  ```

  **Critical:** Use `Pin->PinName.ToString()`, not `Pin->GetName()`. `GetName()` returns the UObject's internal auto-generated name (e.g., `K2Node_CallFunction_0_Pin_1`), not the semantic pin name. `PinName` is the semantic name (`ReturnValue`, `InString`, `X`). `ApplyParamsToNode` on line 35 uses `Pin->PinName.ToString()` for the same reason -- follow the same pattern.

- [ ] **Step 3: Verify the edit**

  Read back lines 16-35. Confirm:
  - `FindPinCaseInsensitive` appears as a file-scope static before `ApplyParamsToNode`
  - Uses `Pin->PinName.ToString()`
  - `ApplyParamsToNode` signature immediately follows and is unchanged

---

## Task 2: Extend the Source Pin Resolver

**Files:**
- Modify: `D:/Unreal Projects/CodePlayground/Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BlueprintGraphBuilderLibrary.cpp`

**Context:** The source resolver is an if/else chain starting around line 313. Its current final branch is:

```cpp
else
{
    // All other node types: default exec output
    SourcePin = (*FromNodePtr)->FindPin(UEdGraphSchema_K2::PN_Then);
}
```

This `else` needs to become two branches: an `else if` for `exec` alias, and a new `else` for data pins.

- [ ] **Step 1: Find the current default fallback**

  Read the source resolver block (approximately lines 310-390). Locate the final `else` clause after the Sequence block:

  ```cpp
          else
          {
              // All other node types: default exec output
              SourcePin = (*FromNodePtr)->FindPin(UEdGraphSchema_K2::PN_Then);
          }
  ```

- [ ] **Step 2: Replace the default fallback**

  Replace that `else` block with:

  ```cpp
          else if (FromPinRole == TEXT("exec"))
          {
              // "exec" is an alias for the default exec output pin
              SourcePin = (*FromNodePtr)->FindPin(UEdGraphSchema_K2::PN_Then);
          }
          else
          {
              // Data pin -- resolve by name, case-insensitive
              SourcePin = FindPinCaseInsensitive(*FromNodePtr, FromPinRole);
          }
  ```

- [ ] **Step 3: Verify the full source resolver chain**

  Read back the source resolver block. Confirm in order:
  1. `Cast<UK2Node_IfThenElse>` -- Branch: then/else (unchanged)
  2. `Cast<UK2Node_ExecutionSequence>` -- Sequence: then_N (unchanged)
  3. **NEW** `else if (FromPinRole == TEXT("exec"))` -- `FindPin(PN_Then)`
  4. **NEW** `else` -- `FindPinCaseInsensitive(*FromNodePtr, FromPinRole)`
  5. Null guard on `SourcePin` (unchanged, still below)

---

## Task 3: Extend the Target Pin Resolver and Add Direction Guards

**Files:**
- Modify: `D:/Unreal Projects/CodePlayground/Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BlueprintGraphBuilderLibrary.cpp`

**Context:** The target resolver is a single line around line 390:

```cpp
UEdGraphPin* TargetPin = (*ToNodePtr)->FindPin(UEdGraphSchema_K2::PN_Execute);
```

It must become an if/else block. After both null guards pass, direction validation must be added before `MakeLinkTo`.

- [ ] **Step 1: Find the current target pin line**

  Read the area from the `SourcePin` null guard through `MakeLinkTo`. Locate:

  ```cpp
              UEdGraphPin* TargetPin = (*ToNodePtr)->FindPin(UEdGraphSchema_K2::PN_Execute);
  ```

- [ ] **Step 2: Replace with the exec/data branch**

  Replace that single line with:

  ```cpp
              // --- TARGET PIN RESOLUTION ---
              UEdGraphPin* TargetPin = nullptr;

              if (ToPinRole == TEXT("exec"))
              {
                  // "exec" is an alias for the default exec input pin
                  TargetPin = (*ToNodePtr)->FindPin(UEdGraphSchema_K2::PN_Execute);
              }
              else
              {
                  // Data pin -- resolve by name, case-insensitive
                  TargetPin = FindPinCaseInsensitive(*ToNodePtr, ToPinRole);
              }
  ```

- [ ] **Step 3: Add direction guards after the TargetPin null guard**

  The `TargetPin` null guard already exists and is unchanged. After it, locate the `MakeLinkTo` call:

  ```cpp
              SourcePin->MakeLinkTo(TargetPin);
  ```

  Insert direction guards immediately before it:

  ```cpp
              if (SourcePin->Direction != EGPD_Output)
              {
                  UE_LOG(LogTemp, Warning,
                      TEXT("BuildBlueprintFromJSON: Source pin '%s' on node '%s' is not an output pin -- skipping"),
                      *FromPinRole, *FromNodeId);
                  continue;
              }

              if (TargetPin->Direction != EGPD_Input)
              {
                  UE_LOG(LogTemp, Warning,
                      TEXT("BuildBlueprintFromJSON: Target pin '%s' on node '%s' is not an input pin -- skipping"),
                      *ToPinRole, *ToNodeId);
                  continue;
              }

              SourcePin->MakeLinkTo(TargetPin);
  ```

  `EGPD_Output` and `EGPD_Input` are from `EdGraph/EdGraphPin.h` which is already transitively included. No new include needed.

- [ ] **Step 4: Verify the full connection resolver tail**

  Read back from the `SourcePin` null guard through end of the connection loop. Confirm in order:
  1. `SourcePin` null guard -- unchanged
  2. `TargetPin = nullptr` declaration
  3. `if (ToPinRole == "exec")` -> `FindPin(PN_Execute)`
  4. `else` -> `FindPinCaseInsensitive`
  5. `TargetPin` null guard -- unchanged
  6. `SourcePin->Direction != EGPD_Output` guard -- **NEW**
  7. `TargetPin->Direction != EGPD_Input` guard -- **NEW**
  8. `SourcePin->MakeLinkTo(TargetPin)` -- unchanged

---

## Task 4: Compile and Smoke Test

**Context:** UE4.27 must be open with `CodePlayground` loaded. No Live Coding available -- rebuild via Build.bat and restart UE4.

- [ ] **Step 1: Rebuild**

  Run from a terminal (do not run inside UE4):

  ```bash
  "D:/UE/UE_4.27/Engine/Build/BatchFiles/Build.bat" CodePlaygroundEditor Win64 Development \
    -Project="D:/Unreal Projects/CodePlayground/CodePlayground.uproject" \
    -WaitMutex -FromMsBuild
  ```

  Expected: build succeeds, zero errors. `FindPinCaseInsensitive` is a static function with no new headers needed -- `UEdGraphPin` is already included via `EdGraph/EdGraph.h`. `ESearchCase::IgnoreCase` is in `Misc/CString.h` (already included transitively). `EGPD_Output`/`EGPD_Input` are in `EdGraph/EdGraphPin.h` (also already included).

  Restart UE4 after build.

- [ ] **Step 2: Smoke test -- Pure data chain**

  Via `python_proxy` MCP tool:

  ```python
  import unreal, json
  bp = unreal.load_object(None, "/Game/BP_TestGraph.BP_TestGraph")
  graph_data = {
      "nodes": [
          {"id": "begin", "type": "BeginPlay"},
          {"id": "make",  "type": "CallFunction", "function": "MakeVector",
           "params": {"X": 10.0, "Y": 20.0, "Z": 30.0}},
          {"id": "break", "type": "CallFunction", "function": "BreakVector"},
          {"id": "toStr", "type": "CallFunction", "function": "Conv_FloatToString"},
          {"id": "print", "type": "CallFunction", "function": "PrintString"}
      ],
      "connections": [
          {"from": "begin.exec",       "to": "print.exec"},
          {"from": "make.ReturnValue", "to": "break.InVec"},
          {"from": "break.X",          "to": "toStr.InFloat"},
          {"from": "toStr.ReturnValue","to": "print.InString"}
      ]
  }
  unreal.BlueprintGraphBuilderLibrary.build_blueprint_from_json(bp, json.dumps(graph_data), True)
  print("done")
  ```

  Open `BP_TestGraph`. Confirm:
  - 5 nodes present: BeginPlay, MakeVector, BreakVector, Conv_FloatToString, PrintString
  - Data wires visible: MakeVector.ReturnValue -> BreakVector.InVec, BreakVector.X -> Conv_FloatToString.InFloat, Conv_FloatToString.ReturnValue -> PrintString.InString
  - Exec wire: BeginPlay -> PrintString (no exec through the data chain -- data nodes don't need exec to evaluate)

  Hit Play. Expected: `10.0` prints on screen.

- [ ] **Step 3: Smoke test -- Case-insensitive lookup**

  Same as Test 2 but with lowercase pin names:

  ```python
  import unreal, json
  bp = unreal.load_object(None, "/Game/BP_TestGraph.BP_TestGraph")
  graph_data = {
      "nodes": [
          {"id": "begin", "type": "BeginPlay"},
          {"id": "make",  "type": "CallFunction", "function": "MakeVector",
           "params": {"X": 10.0, "Y": 20.0, "Z": 30.0}},
          {"id": "break", "type": "CallFunction", "function": "BreakVector"},
          {"id": "toStr", "type": "CallFunction", "function": "Conv_FloatToString"},
          {"id": "print", "type": "CallFunction", "function": "PrintString"}
      ],
      "connections": [
          {"from": "begin.exec",        "to": "print.exec"},
          {"from": "make.returnvalue",  "to": "break.invec"},
          {"from": "break.x",           "to": "tostr.infloat"},
          {"from": "tostr.returnvalue", "to": "print.instring"}
      ]
  }
  unreal.BlueprintGraphBuilderLibrary.build_blueprint_from_json(bp, json.dumps(graph_data), True)
  print("done")
  ```

  Expected: identical result -- `10.0` prints. Proves the `ToLower` + `IgnoreCase` pipeline handles arbitrary caller casing.

- [ ] **Step 4: Smoke test -- Mixed exec + data with Sequence**

  ```python
  import unreal, json
  bp = unreal.load_object(None, "/Game/BP_TestGraph.BP_TestGraph")
  graph_data = {
      "nodes": [
          {"id": "begin",  "type": "BeginPlay"},
          {"id": "seq",    "type": "Sequence"},
          {"id": "print0", "type": "CallFunction", "function": "PrintString",
           "params": {"InString": "Start"}},
          {"id": "make",   "type": "CallFunction", "function": "MakeVector",
           "params": {"X": 42.0, "Y": 0.0, "Z": 0.0}},
          {"id": "break",  "type": "CallFunction", "function": "BreakVector"},
          {"id": "toStr",  "type": "CallFunction", "function": "Conv_FloatToString"},
          {"id": "print1", "type": "CallFunction", "function": "PrintString"}
      ],
      "connections": [
          {"from": "begin.exec",       "to": "seq.exec"},
          {"from": "seq.then_0",       "to": "print0.exec"},
          {"from": "seq.then_1",       "to": "make.exec"},
          {"from": "make.exec",        "to": "break.exec"},
          {"from": "break.exec",       "to": "toStr.exec"},
          {"from": "toStr.exec",       "to": "print1.exec"},
          {"from": "make.ReturnValue", "to": "break.InVec"},
          {"from": "break.X",          "to": "toStr.InFloat"},
          {"from": "toStr.ReturnValue","to": "print1.InString"}
      ]
  }
  unreal.BlueprintGraphBuilderLibrary.build_blueprint_from_json(bp, json.dumps(graph_data), True)
  print("done")
  ```

  Hit Play. Expected: "Start" prints, then "42.0" prints. Both exec flow (Sequence fan-out) and data flow (Vector -> Float -> String) working simultaneously.

- [ ] **Step 5: Smoke test -- Invalid pin name (graceful failure)**

  ```python
  import unreal, json
  bp = unreal.load_object(None, "/Game/BP_TestGraph.BP_TestGraph")
  graph_data = {
      "nodes": [
          {"id": "begin", "type": "BeginPlay"},
          {"id": "print", "type": "CallFunction", "function": "PrintString"}
      ],
      "connections": [
          {"from": "begin.exec",         "to": "print.exec"},
          {"from": "begin.FakeOutputPin","to": "print.InString"}
      ]
  }
  unreal.BlueprintGraphBuilderLibrary.build_blueprint_from_json(bp, json.dumps(graph_data), True)
  print("done")
  ```

  Expected: warning in Output Log: `Could not resolve source pin 'fakeoutputpin' on node 'begin'`. The invalid connection is skipped. Graph compiles. "Hello" prints (PrintString default value). No crash.

- [ ] **Step 6: Commit**

  ```bash
  cd "D:/Unreal Projects/CodePlayground"
  git add Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BlueprintGraphBuilderLibrary.cpp
  git commit -m "feat: add data pin wiring + case-insensitive pin resolution to BlueprintGraphBuilder"
  ```

---

## Task 5: End-to-End Test via MCP

**Context:** Tests the full pipeline: MCP tool -> TypeScript -> python_proxy -> C++. No schema changes needed -- data pin names pass through as connection role strings.

- [ ] **Step 1: Call blueprint_build_from_json via MCP**

  Use the `blueprint_build_from_json` MCP tool with this payload:

  ```json
  {
    "blueprint_path": "/Game/BP_TestGraph.BP_TestGraph",
    "graph": {
      "nodes": [
        { "id": "begin", "type": "BeginPlay" },
        { "id": "make",  "type": "CallFunction", "function": "MakeVector",
          "params": { "X": 10.0, "Y": 20.0, "Z": 30.0 } },
        { "id": "break", "type": "CallFunction", "function": "BreakVector" },
        { "id": "toStr", "type": "CallFunction", "function": "Conv_FloatToString" },
        { "id": "print", "type": "CallFunction", "function": "PrintString" }
      ],
      "connections": [
        { "from": "begin.exec",        "to": "print.exec" },
        { "from": "make.ReturnValue",  "to": "break.InVec" },
        { "from": "break.X",           "to": "toStr.InFloat" },
        { "from": "toStr.ReturnValue", "to": "print.InString" }
      ]
    },
    "clear_existing": true
  }
  ```

  Expected response: `success: true`.

- [ ] **Step 2: Verify in Blueprint editor and Play**

  Open `BP_TestGraph`. Confirm data wires are present. Hit Play. `10.0` prints.

- [ ] **Step 3: Final commit (UE_Bridge side)**

  ```bash
  cd D:/UE/UE_Bridge
  git add docs/superpowers/specs/2026-03-17-blueprint-graph-builder-pass6-design.md
  git add docs/superpowers/plans/2026-03-17-blueprint-graph-builder-pass6.md
  git commit -m "docs: add Pass 6 spec and plan for data pin wiring"
  ```

---

## Troubleshooting Reference

| Symptom | Cause | Fix |
|---|---|---|
| Data pins never connect, no warnings | `Pin->GetName()` used instead of `Pin->PinName.ToString()` | Check the helper -- must use `PinName` |
| Warning: `Could not resolve source pin 'returnvalue'` | `FindPinCaseInsensitive` not finding pin | Dump node pins via python_proxy: `for p in node.node_items(): print(p)` to see actual pin names |
| Direction guard fires on exec-to-exec | `PN_Then` or `PN_Execute` resolved wrong pin | Verify `FindPin(PN_Then)` is used for source exec, `FindPin(PN_Execute)` for target exec |
| `10.000000` prints instead of `10.0` | `Conv_FloatToString` output format | This is UE's float-to-string behavior; expected output may vary slightly by UE version |
| Exec connections broken after this pass | Target resolver `else` branch hit for `exec` role | `ToPinRole` must equal exactly `"exec"` after `ToLower()` -- check the lowercase comparison |
| Build error: `ESearchCase not found` | Include missing | `ESearchCase` is in `Misc/CString.h` which is included via `Engine.h` transitively. If error persists, add `#include "Misc/CString.h"` explicitly |
