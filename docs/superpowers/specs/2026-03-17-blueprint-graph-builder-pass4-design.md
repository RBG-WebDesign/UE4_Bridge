# Blueprint Graph Builder Pass 4 Design Spec

**Date:** 2026-03-17
**Feature:** Branch node + role-aware exec wiring

---

## Goal

Add `UK2Node_IfThenElse` (Branch) to the BlueprintGraphBuilder C++ plugin. Wire
its two exec outputs (`then`, `else`) using role-aware pin resolution. Condition
is set via the existing `ApplyParamsToNode` param system. No TypeScript or Python
changes.

---

## Scope

**In scope:**
- Branch node dispatch case in `BuildBlueprintFromJSON`
- Role-aware source pin resolution in the connection resolver
- Inline Cast pattern -- no helper function
- Case-insensitive role comparison (ToLower)
- Guard for malformed `"node.role"` format (missing dot)
- Warning + skip for invalid roles on Branch output (including `branch.exec` as source)
- Warning + skip for null source pin on non-Branch fallback path
- Explicit documentation that `"then"` and `"else"` are the canonical `FName` string values of `PN_Then` and `PN_Else`

**Out of scope:**
- Data pin wiring (Condition driven by another node's output)
- Target pin role resolution (input is always `PN_Execute`)
- Generalized role-to-pin table
- Any TypeScript schema changes
- Any Python listener changes

---

## Architecture

### Files changed

One file only:

```
D:/Unreal Projects/CodePlayground/Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BlueprintGraphBuilderLibrary.cpp
```

Header unchanged (no new public API, no new UFUNCTION).

**Build.cs requires no changes.** `BlueprintGraph` is already listed in
`PrivateDependencyModuleNames` in the plugin's `.Build.cs` file. `K2Node_IfThenElse.h`
will resolve without adding any dependency.

### Include required

```cpp
#include "K2Node_IfThenElse.h"
```

---

## Node Dispatch

Add a new `else if` block in the node type dispatch loop, after the `CallFunction`
case:

```cpp
else if (NodeType == TEXT("Branch"))
{
    FGraphNodeCreator<UK2Node_IfThenElse> Creator(*Graph);
    UK2Node_IfThenElse* BranchNode = Creator.CreateNode();
    Creator.Finalize();      // MUST be before ApplyParamsToNode -- see Operation Order
    SpawnedNode = BranchNode;
    ApplyParamsToNode(SpawnedNode, *NodeObj);
}
```

`ApplyParamsToNode` handles `"Condition": true/false` via the existing `EJson::Boolean`
case in the switch. No special-casing needed. If `params` is absent,
`ApplyParamsToNode` returns early and `Condition` stays at UE4's default (false),
so the Else path fires.

---

## Connection Resolver Changes

### 1. Guard for missing dot

Replace the bare `FromStr.Split` / `ToStr.Split` calls with guarded versions that
skip the connection and log if the format is wrong:

```cpp
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
```

### 2. Case-normalize roles

```cpp
FromPinRole = FromPinRole.ToLower();
ToPinRole   = ToPinRole.ToLower();
```

Allows `"Then"`, `"ELSE"`, `"Exec"` etc.

### 3. Role-aware source pin resolution (inline Cast)

Replace the current hardcoded `FindPin(PN_Then)` call with:

```cpp
UEdGraphPin* SourcePin = nullptr;
if (UK2Node_IfThenElse* Branch = Cast<UK2Node_IfThenElse>(*FromNodePtr))
{
    // "then" and "else" are NOT arbitrary keywords -- they are the exact FName string
    // values of UEdGraphSchema_K2::PN_Then and PN_Else ("then", "else"). The role
    // strings in the JSON must match these canonical names.
    if (FromPinRole == TEXT("then"))
    {
        SourcePin = Branch->GetThenPin();
        // GetThenPin() calls check() internally -- cannot return null.
        // No null guard needed for this path.
    }
    else if (FromPinRole == TEXT("else"))
    {
        SourcePin = Branch->GetElsePin();
        // GetElsePin() calls check() internally -- cannot return null.
        // No null guard needed for this path.
    }
    else
    {
        // This includes "exec", "Condition", or any other invalid role on Branch output.
        UE_LOG(LogTemp, Warning,
            TEXT("BuildBlueprintFromJSON: Invalid role '%s' for Branch output on node '%s' -- expected 'then' or 'else'"),
            *FromPinRole, *FromNodeId);
        continue;
    }
}
else
{
    // All other node types: default exec output is PN_Then.
    SourcePin = (*FromNodePtr)->FindPin(UEdGraphSchema_K2::PN_Then);
    // FindPin can return null -- null guard below catches this.
}
```

### 4. Null guard after resolution

The null guard only applies to the `FindPin` path (non-Branch nodes). For Branch,
`GetThenPin()`/`GetElsePin()` use `check()` internally and cannot return null. The
`continue` in the Branch else-block above already handles the invalid-role case.
The guard is placed after the if/else block and covers the `FindPin` fallback:

```cpp
if (!SourcePin)
{
    UE_LOG(LogTemp, Warning,
        TEXT("BuildBlueprintFromJSON: Could not resolve source pin for node '%s' role '%s'"),
        *FromNodeId, *FromPinRole);
    continue;
}
```

### 5. Target pin (unchanged behavior, add null guard)

```cpp
UEdGraphPin* TargetPin = (*ToNodePtr)->FindPin(UEdGraphSchema_K2::PN_Execute);
if (!TargetPin)
{
    UE_LOG(LogTemp, Warning,
        TEXT("BuildBlueprintFromJSON: Could not find exec input pin on node '%s'"),
        *ToNodeId);
    continue;
}
```

---

## Operation Order (code ordering requirement)

For each node in the dispatch loop:

```
CreateNode() -> Finalize() -> ApplyParamsToNode() -> store in NodeMap
```

**`Finalize()` must be called before `ApplyParamsToNode()`.**

`Finalize()` internally calls `AllocateDefaultPins()`, which creates the node's
pin objects. `ApplyParamsToNode()` iterates `Node->Pins`. If the order is reversed,
`Node->Pins` is empty and `ApplyParamsToNode` silently does nothing -- no error,
no log, just wrong behavior. This ordering is not enforced by any compile-time
constraint; it must be maintained manually in each dispatch case.

Connections are wired after all nodes are created (separate loop over
`ConnectionsArray`), so `NodeMap` is fully populated before any `MakeLinkTo` call.

---

## JSON Shape

```json
{
  "nodes": [
    { "id": "begin",  "type": "BeginPlay" },
    { "id": "branch", "type": "Branch", "params": { "Condition": true } },
    { "id": "ok",     "type": "CallFunction", "function": "PrintString",
      "params": { "InString": "SUCCESS" } },
    { "id": "fail",   "type": "CallFunction", "function": "PrintString",
      "params": { "InString": "FAILED" } }
  ],
  "connections": [
    { "from": "begin.exec",  "to": "branch.exec" },
    { "from": "branch.then", "to": "ok.exec" },
    { "from": "branch.else", "to": "fail.exec" }
  ]
}
```

---

## Error Handling

| Situation | Behavior |
|---|---|
| `"from": "branch.then"` | GetThenPin(), wire Then path |
| `"from": "branch.else"` | GetElsePin(), wire Else path |
| `"from": "branch.exec"` | Warning: invalid role on Branch output, skip |
| `"from": "branch.Condition"` | Warning: invalid role on Branch output, skip |
| `"from": "branch.foo"` | Warning: invalid role on Branch output, skip |
| Missing dot in connection string | Warning: invalid format, skip |
| Null source pin (non-Branch FindPin returns null) | Warning, skip |
| Branch with no `params` | Condition defaults to false, Else fires |
| Branch with `"Condition": true` | Then fires |
| Branch with `"Condition": false` | Else fires |

---

## Test Plan

### Case 1: Condition true (happy path)

```json
{ "id": "branch", "type": "Branch", "params": { "Condition": true } }
```

Expected: Then wire connects. "SUCCESS" fires at runtime. Blueprint editor shows
Condition pin = true.

### Case 2: Condition false

```json
{ "id": "branch", "type": "Branch", "params": { "Condition": false } }
```

Expected: Else wire connects. "FAILED" fires at runtime.

### Case 3: Invalid role as source (branch.exec)

```json
{ "from": "branch.exec", "to": "ok.exec" }
```

Expected: Warning in Output Log: "Invalid role 'exec' for Branch output on node 'branch'".
No connection made. No crash.

### Case 4: Missing params (default behavior)

```json
{ "id": "branch", "type": "Branch" }
```

Expected: No `params`, so `ApplyParamsToNode` returns early. Condition stays at
UE4 default (false). Else fires. No error logged.

---

## Not in This Pass

- Sequence node (`UK2Node_ExecutionSequence`) -- then_0, then_1, then_N
- Select node
- Data pin connections (e.g. `nodeA.output` wired to `branch.Condition`)
- Target pin role resolution (input is always `PN_Execute` for all node types)
- Any TypeScript or Python changes
