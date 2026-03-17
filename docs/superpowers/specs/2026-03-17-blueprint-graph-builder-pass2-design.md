# Blueprint Graph Builder -- Pass 2 Design Spec

Date: 2026-03-17

## Overview

Pass 2 extends the `BlueprintGraphBuilder` C++ plugin with two new node types:
`Delay` (hardcoded to `UKismetSystemLibrary::Delay`) and `CallFunction` (dynamic
lookup of any function on `UKismetSystemLibrary` by name). Together they unlock
timed execution chains and reusable function dispatch from JSON.

The MCP tool `blueprint_build_from_json` and the Python bridge are unchanged.
Only the C++ dispatch table and the TypeScript Zod schema gain new capability.

## Goals (Pass 2)

- Add `Delay` as a first-class node type: hardcoded to `UKismetSystemLibrary::Delay`,
  no `"function"` field required in JSON
- Add `CallFunction` as a dynamic node type: resolves any function on
  `UKismetSystemLibrary` by the `"function"` field value
- Both node types guard against null function pointers (log + `continue`)
- Normalize the existing `PrintString` null-function guard from `return` to `continue`
  (consistency fix -- Pass 1 shipped with `return`, which exits the entire function
  rather than skipping the node). This fix is NOT a separate line-level patch -- it
  is structurally absorbed by the auto-positioning refactor. When the per-case
  `NodePosX`/`NodePosY` assignments inside the `PrintString` block are removed and
  replaced by the unified `if (SpawnedNode)` post-spawn block, the `return` inside
  the `PrintString` null guard must become `continue` as part of that same edit.
  There is no standalone `return -> continue` diff to apply independently.
- Sequential auto-positioning: nodes spaced 300 units apart on the X axis by
  spawn index, Y=0 for all
- Prove: 4-node QTE-style graph (BeginPlay -> PrintString -> Delay -> PrintString)
  compiles and executes

## Non-Goals (Pass 2)

- Data pin injection (InString text, Delay duration override) -- deferred to Pass 3
- Class-name resolution (CallFunction is scoped to UKismetSystemLibrary only)
- Branch/sequence nodes (requires data pin wiring)
- Success path input capture
- Any Python listener changes
- Any new MCP routes

---

## Node Type Taxonomy After Pass 2

| Category  | Types          | Lookup strategy                                    |
|-----------|----------------|----------------------------------------------------|
| Event     | BeginPlay      | Hardcoded to AActor::ReceiveBeginPlay              |
| Flow      | Delay          | Hardcoded to UKismetSystemLibrary::Delay           |
| Execution | PrintString    | Hardcoded to UKismetSystemLibrary::PrintString (dedicated case, retained for JSON backwards compatibility with Pass 1) |
| Execution | CallFunction   | FindFunctionByName on UKismetSystemLibrary (additive -- does NOT replace PrintString) |

`PrintString` retains its own `if` branch in the C++ dispatch. `CallFunction` is a
separate `else if` branch that handles the generic case. A JSON node with
`"type": "PrintString"` still works exactly as it did in Pass 1. A JSON node with
`"type": "CallFunction", "function": "PrintString"` resolves via the new dynamic path
and produces the same graph node. Both coexist.

---

## C++ Changes (`BlueprintGraphBuilderLibrary.cpp`)

### Auto-positioning

Replace the hardcoded `NodePosX = 0` / `NodePosX = 300` per-type with an index
counter. Steps:

1. **Remove** the `NodePosX` and `NodePosY` assignments inside the `BeginPlay`
   and `PrintString` dispatch blocks (the existing per-case hardcoded values).
2. **Add** a single `int32 NodeIndex = 0;` before the node spawn loop.
3. **After each successful spawn** (when `SpawnedNode != nullptr`, immediately
   before `NodeMap.Add(NodeId, SpawnedNode)`), assign position and increment.
   Note: the existing code assigns `NodePosX` *before* `Creator.Finalize()`.
   The unified block assigns position *after* `Finalize()` (since `SpawnedNode`
   is set after `Finalize()` inside each dispatch case). Both orderings are safe
   in UE4.27 -- `Finalize()` adds the node to the graph but does not lock
   position. The ordering change is intentional.

```cpp
if (SpawnedNode)
{
    SpawnedNode->NodePosX = NodeIndex * 300;
    SpawnedNode->NodePosY = 0;
    NodeIndex++;
    NodeMap.Add(NodeId, SpawnedNode);
}
```

`NodeIndex` advances only on successful spawns. Skipped nodes (unknown type,
null function pointer, missing field) do not advance the counter, so successfully
spawned nodes are always evenly spaced with no gaps in positioning.

### Delay dispatch case

```cpp
else if (NodeType == TEXT("Delay"))
{
    // TEXT("Delay") is a bare string rather than GET_FUNCTION_NAME_CHECKED because
    // UKismetSystemLibrary does not expose Delay via a checked macro in UE4.27.
    // The null guard below catches any rename at runtime. This is consistent with
    // how PrintString is looked up in the existing code.
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

No JSON fields beyond `"type": "Delay"` are consumed. Delay duration is
whatever the node's default pin value is (1.0s in UE4.27). Duration override
is a Pass 3 concern (requires data pin injection).

### CallFunction dispatch case

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

Logs the function name before resolution -- this is the key signal for
debugging when a function silently fails.

---

## TypeScript Changes (`mcp-server/src/tools/blueprints.ts`)

### 1. Update the tool description string

Change the existing description (currently says "Pass 1: BeginPlay, PrintString"):

```typescript
description:
  "Builds a Blueprint event graph from a JSON node/connection description. " +
  "Supported node types: BeginPlay, PrintString, Delay, CallFunction. " +
  "Connections use 'nodeId.exec' format for exec pin wiring.",
```

### 2. Add `function` to the Zod schema

```typescript
nodes: z.array(
  z.object({
    id: z.string().describe("Unique node identifier"),
    type: z.string().describe("Node type: BeginPlay | PrintString | Delay | CallFunction"),
    function: z.string().optional().describe("Required when type is CallFunction -- function name on UKismetSystemLibrary"),
  })
),
```

### 3. Update the handler type cast

The handler contains an explicit `params as { ... }` cast. Add `function?: string`
to the node object shape inside that cast:

```typescript
graph: {
  nodes: Array<{ id: string; type: string; function?: string }>;
  connections: Array<{ from: string; to: string }>;
};
```

No other handler logic changes are needed. `JSON.stringify(graph)` already serializes
the `function` field if present, and the C++ function reads it via `TryGetStringField`.

---

## QTE Demo JSON (Pass 2 milestone proof)

```json
{
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
}
```

**What this proves:**
- Dynamic `CallFunction` node resolution works
- `Delay` node spawns and wires correctly
- Multiple instances of the same function type work
- 4-node exec chain compiles without Kismet errors
- Auto-positioning renders a readable left-to-right graph

**Known limitation:** Both `PrintString` calls print the default string (empty
or engine default) because data pin injection is not implemented yet. This is
expected. The test validates execution flow and timing, not UI text variation.

**Connection format note:** The pin role string (the part after `.` in `"begin.exec"`)
is currently ignored by the C++ connection wiring code. For all exec connections, the
code unconditionally searches for `PN_Then` on the source node and `PN_Execute` on the
target node. The role string exists in the JSON format as a reserved field for Pass 3+
when data pin wiring will require distinguishing pin roles. Do not write dispatch logic
based on the role string value in this pass.

---

## Execution Flow at Runtime

```
Event BeginPlay
  -> PrintString (default text -- simulates "PRESS E!" prompt)
  -> Delay (1.0s default duration -- simulates QTE window)
  -> PrintString (default text -- simulates "FAILED" result)
```

If the Blueprint is placed in the level and Play is pressed, the default
PrintString text appears twice in the viewport with a 1-second gap between them.

---

## Validation Criteria (Pass 2 complete when)

- Plugin compiles without errors after adding the two new dispatch cases
- Python call succeeds with the QTE demo JSON above (no exceptions)
- Blueprint event graph contains 4 nodes in left-to-right order
- Delay node is visible between the two PrintString nodes
- Blueprint compiles without Kismet errors
- Play in editor shows PrintString output, then a pause, then PrintString again

---

## Roadmap

### Pass 3 (next)

- Data pin injection via `"params": { "InString": "PRESS E!" }` in JSON
- Delay duration override via `"params": { "Duration": 3.0 }`
- Makes QTE text variation real

### Pass 4

- Class field on CallFunction: `"class": "KismetSystemLibrary"` -- full Option B
- Unlocks functions outside UKismetSystemLibrary (e.g., UQTELibrary)

### Pass 5

- Branch/sequence nodes (requires data pin wiring infrastructure from Pass 3)
- Success path: input event -> override Delay -> OnQTESuccess PrintString
