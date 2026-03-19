# Blueprint Graph Builder Pass 8 -- Variable Get/Set Nodes

**Date:** 2026-03-17
**Status:** Draft

---

## Goal

Add `VariableGet` and `VariableSet` node types so graphs can read and write Blueprint variables by name.

After Pass 8:

```json
{"id": "getVar", "type": "VariableGet", "variable": "MyFloat"}
{"id": "setVar", "type": "VariableSet", "variable": "MyFloat"}
```

Both resolve against existing Blueprint variables. Pass 8 does not create variables -- they must already exist on the Blueprint (created manually or via `python_proxy`).

---

## Scope

### In scope

- `VariableGet` node type -- spawns `UK2Node_VariableGet`, looks up property by name
- `VariableSet` node type -- spawns `UK2Node_VariableSet`, same property lookup
- Property resolution on `Blueprint->GeneratedClass` with fallback to `Blueprint->SkeletonGeneratedClass`
- Case-insensitive variable name matching

### Out of scope

- Variable creation (use `python_proxy` or manual editor)
- Array/Map/Set variable types (basic scalar types only for now)
- Local variables (function graph scope)
- Variable categories or metadata

---

## Decision Log

### Property lookup: GeneratedClass vs SkeletonGeneratedClass

At graph-build time, the Blueprint may not be fully compiled. `GeneratedClass` exists after a successful compile, but `SkeletonGeneratedClass` always exists and contains the property layout. Resolution order:

1. Try `Blueprint->GeneratedClass->FindPropertyByName()`
2. If null, try `Blueprint->SkeletonGeneratedClass->FindPropertyByName()`
3. If both null, log error and skip

This covers both compiled and mid-edit states.

### SetFromProperty vs CreateVariable

`UK2Node_VariableGet` and `UK2Node_VariableSet` both have `SetPropertyReference()` which takes an `FMemberReference`. The simpler path is:

1. Find the `FProperty*` on the generated class
2. Create an `FMemberReference` from it
3. Call `VariableReference.SetFromField<FProperty>(Property, false)` on the node

The `false` parameter means "not a self context" -- but since these are Blueprint-owned variables accessed from within the same Blueprint, self context is implied.

### Case-insensitive variable name matching

Variable names in UE are `FName` which is case-preserving but case-insensitive for comparison. The lookup uses `FindPropertyByName(FName(*VariableName))` which inherits FName's case behavior. An additional `FName::Find` with `FNAME_Find` mode confirms the name exists before creating a potentially new FName entry.

---

## Files Changed

```
D:/Unreal Projects/CodePlayground/Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BlueprintGraphBuilderLibrary.cpp
```

No other files change. Header, Build.cs, TypeScript, Python -- untouched.

---

## JSON Format

### Node definition

```json
{"id": "getVar", "type": "VariableGet", "variable": "MyFloat"}
{"id": "setVar", "type": "VariableSet", "variable": "MyFloat"}
```

The `"variable"` field is required. It must match an existing Blueprint variable name (case-insensitive via FName).

### Connection examples

VariableGet has output data pins matching the variable type:

```json
{"from": "getVar.MyFloat", "to": "toStr.InFloat"}
```

VariableSet has exec pins and an input data pin:

```json
{"from": "begin.exec", "to": "setVar.exec"},
{"from": "someValue.ReturnValue", "to": "setVar.MyFloat"}
```

All pin wiring uses the existing `FindPinCaseInsensitive` fallback from Pass 6. No resolver changes needed.

---

## Code Changes

### New includes

```cpp
#include "K2Node_VariableGet.h"
#include "K2Node_VariableSet.h"
```

### New node type branches (in the dispatch loop)

After the `Sequence` branch and before the `else` unknown-type fallback:

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

Note: `ApplyParamsToNode` is called on VariableSet (to set the input pin default value via params) but not on VariableGet (output-only node, no settable defaults).

---

## Connection Behavior

| Node type | exec pins | data pins |
|---|---|---|
| VariableGet | none | output pin named after the variable |
| VariableSet | exec in + exec out | input pin named after the variable |

Both pin types resolve through the existing `FindPinCaseInsensitive` data fallback. No special-casing in the connection resolver.

---

## Test Plan

### Prerequisite: Create a float variable on BP_TestGraph

Via `python_proxy`:

```python
import unreal
bp = unreal.load_object(None, "/Game/BP_TestGraph.BP_TestGraph")
unreal.BlueprintEditorLibrary.add_member_variable(bp, "MyFloat", unreal.EdGraphPinType())
```

Or create `MyFloat` (Float type) manually in the Blueprint editor. The variable must exist before the graph build call.

### Test 1 -- Set and Get a variable

```python
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
```

Expected: prints `42.0`. Exec flow: BeginPlay -> Set MyFloat = 42 -> PrintString. Data flow: Get MyFloat -> Conv_FloatToString -> PrintString.InString.

### Test 2 -- Variable not found (graceful failure)

```python
graph_data = {
    "nodes": [
        {"id": "get", "type": "VariableGet", "variable": "NonExistentVar"}
    ],
    "connections": []
}
```

Expected: error in Output Log: `Variable 'NonExistentVar' not found on Blueprint`. Node is skipped. No crash.

---

## What This Unlocks

After Pass 8, graphs can read and write Blueprint state. Combined with Passes 1-6:

- Execution flow (BeginPlay, Branch, Sequence)
- Function calls (static library functions)
- Data wiring between any pins
- **Variable state** (get/set Blueprint member variables)

Pass 9 (Loops) adds iteration. Pass 10 (Member Functions) adds self/actor operations.
