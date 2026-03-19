# Blueprint Graph Builder Pass 9 -- ForLoop and ForEachLoop

**Date:** 2026-03-17
**Status:** Draft

---

## Goal

Add `ForLoop` and `ForEachLoop` node types so graphs can iterate.

After Pass 9:

```json
{"id": "loop", "type": "ForLoop", "params": {"FirstIndex": 0, "LastIndex": 3}}
```

spawns the engine's built-in ForLoop macro and wires it into the graph.

---

## Scope

### In scope

- `ForLoop` node type via `UK2Node_MacroInstance` referencing the engine ForLoop macro
- `ForEachLoop` node type via `UK2Node_MacroInstance` referencing the engine ForEachLoop macro
- Pin name mapping for connection resolver compatibility

### Out of scope

- WhileLoop (no built-in K2 node in UE4.27 -- requires custom macro)
- Custom macro instances (generic macro spawning)
- ForEachLoopWithBreak (future pass if needed)
- Array construction (use params or variable set)

---

## Decision Log

### Macro instance vs direct K2 node

ForLoop and ForEachLoop in UE4 are not standalone K2 node classes. They are macro instances (`UK2Node_MacroInstance`) that reference built-in engine macro Blueprints:

- ForLoop: `/Engine/Transient.ForLoop` or resolved via `UK2Node_MacroInstance::SetMacroGraph()`
- ForEachLoop: similarly a macro graph

The exact macro asset path needs discovery via `python_proxy` prototyping before implementation. The standard approach:

```cpp
UEdGraph* MacroGraph = LoadObject<UEdGraph>(nullptr, TEXT("/Engine/...path..."));
MacroNode->SetMacroGraph(MacroGraph);
```

### Alternative: FBlueprintActionDatabase

If the macro graph path approach fails, the alternative is to use UE4's action database to find and spawn the node the same way the Blueprint editor's context menu does. This is more complex but guaranteed to match editor behavior.

### Pin names

ForLoop pins (discovered via editor inspection):

| Pin | Direction | Type |
|---|---|---|
| `Execute` | Input | Exec |
| `FirstIndex` | Input | Int |
| `LastIndex` | Input | Int |
| `LoopBody` | Output | Exec |
| `Index` | Output | Int |
| `Completed` | Output | Exec |

ForEachLoop pins:

| Pin | Direction | Type |
|---|---|---|
| `Execute` | Input | Exec |
| `Array` | Input | Array (wildcard) |
| `LoopBody` | Output | Exec |
| `Array Element` | Output | Wildcard |
| `Array Index` | Output | Int |
| `Completed` | Output | Exec |

All resolve through existing `FindPinCaseInsensitive`. The exec alias (`"exec"`) maps to `Execute` (input) and `PN_Then` (output) -- but `LoopBody` and `Completed` are named exec outputs, not `PN_Then`. They resolve through the data pin fallback path since they're named pins.

---

## Files Changed

```
D:/Unreal Projects/CodePlayground/Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BlueprintGraphBuilderLibrary.cpp
```

No other files change.

---

## JSON Format

### ForLoop

```json
{
    "id": "loop",
    "type": "ForLoop",
    "params": {"FirstIndex": 0, "LastIndex": 3}
}
```

### ForEachLoop

```json
{
    "id": "forEach",
    "type": "ForEachLoop"
}
```

### Connection examples

```json
{"from": "begin.exec",    "to": "loop.exec"},
{"from": "loop.LoopBody", "to": "print.exec"},
{"from": "loop.Index",    "to": "toStr.InInt"},
{"from": "loop.Completed","to": "done.exec"}
```

---

## Prototyping Required

Before writing the C++ implementation, run this via `python_proxy` to discover the macro graph path:

```python
import unreal
# Find the ForLoop macro graph
for obj in unreal.EditorAssetLibrary.list_assets("/Engine/", recursive=True):
    if "ForLoop" in obj:
        print(obj)
```

Or inspect an existing ForLoop node in a Blueprint:

```python
import unreal
# Open a BP with a ForLoop, iterate nodes
bp = unreal.load_object(None, "/Game/SomeTestBP.SomeTestBP")
graph = bp.ubergraph_pages[0] if bp.ubergraph_pages else None
for node in graph.nodes:
    print(type(node).__name__, node.get_name())
```

The exact spawn mechanism may be:
1. `UK2Node_MacroInstance` + `SetMacroGraph()` with an engine macro asset
2. Direct `UK2Node_ForEachElementInEnum` or similar specialized node
3. Spawning via `FBlueprintActionDatabase`

The prototyping step determines which path to take.

---

## Code Changes (Pending Prototype)

### New includes (conditional on approach)

```cpp
#include "K2Node_MacroInstance.h"
```

### New node type branch (sketch -- exact implementation depends on prototype)

```cpp
else if (NodeType == TEXT("ForLoop"))
{
    // Load the engine ForLoop macro graph
    UEdGraph* MacroGraph = LoadObject<UEdGraph>(nullptr, TEXT("<path from prototype>"));
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

---

## Test Plan

### Test 1 -- ForLoop printing 0 to 3

```python
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
```

Expected: prints 0, 1, 2, 3, then "Done".

### Test 2 -- ForEachLoop (deferred until ForLoop works)

Array iteration test. Requires an array variable (from Pass 8) or a MakeArray node.

---

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Macro graph asset path unknown | Prototype via `python_proxy` first |
| `SetMacroGraph` may not allocate pins before `Finalize` | Check pin count after Finalize; if zero, try alternative spawn path |
| ForLoop might be a latent node requiring special handling | Test compile after spawn; latent nodes are valid in event graphs |

---

## What This Unlocks

After Pass 9: execution flow, function calls, data wiring, variables, and **iteration**. Combined with Pass 8's variables, graphs can now loop over ranges and accumulate state.
