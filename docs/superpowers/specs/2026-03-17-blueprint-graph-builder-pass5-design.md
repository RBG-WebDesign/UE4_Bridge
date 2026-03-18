# Blueprint Graph Builder Pass 5 Design Spec

**Date:** 2026-03-17
**Feature:** Sequence node + indexed exec output resolution

---

## Goal

Add `UK2Node_ExecutionSequence` (Sequence) to the BlueprintGraphBuilder C++ plugin.
Wire its N exec outputs using indexed pin resolution (`then_0`, `then_1`, ...).
Dynamically expand the node's output count when the JSON references indices beyond
the default 2. No TypeScript, Python, or MCP changes.

---

## Scope

**In scope:**
- Sequence node dispatch case in `BuildBlueprintFromJSON`
- Indexed source pin resolution in the connection resolver (`then_0`, `then_1`, etc.)
- Dynamic pin expansion via `AddInputPin()` when index exceeds current output count
- Inline Cast pattern (same as Branch)
- Error handling for malformed index strings

**Out of scope:**
- Data pin wiring
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

Header unchanged. Build.cs unchanged (`BlueprintGraph` already listed).

### Include required

```cpp
#include "K2Node_ExecutionSequence.h"
```

---

## Engine API Reference

From `K2Node_ExecutionSequence.h` and its `.cpp`:

| Method | Behavior |
|---|---|
| `AllocateDefaultPins()` | Creates 1 exec input + 2 exec outputs (`Then_0`, `Then_1`) |
| `GetThenPinGivenIndex(int32 Index)` | Returns `FindPin(GetPinNameGivenIndex(Index))` -- null if pin doesn't exist |
| `AddInputPin()` | Creates one new exec output with next sequential name |
| `GetPinNameGivenIndex(int32 Index)` | Returns `FName(FString::Printf("%s_%d", *PN_Then.ToString(), Index))` -- i.e. `"Then_0"`, `"Then_1"`, etc. |

Default state after `Finalize()`: node has `Then_0` and `Then_1`. To use `then_2`,
`AddInputPin()` must be called once. To use `then_5`, it must be called 4 times.

---

## Node Dispatch

Add a new `else if` block after the Branch case:

```cpp
else if (NodeType == TEXT("Sequence"))
{
    FGraphNodeCreator<UK2Node_ExecutionSequence> Creator(*Graph);
    UK2Node_ExecutionSequence* SeqNode = Creator.CreateNode();
    Creator.Finalize();      // MUST be before ApplyParamsToNode -- Finalize calls AllocateDefaultPins
    SpawnedNode = SeqNode;
    ApplyParamsToNode(SpawnedNode, *NodeObj);
}
```

Sequence has no meaningful params (no data input pins), so `ApplyParamsToNode` will
iterate pins but find no matches and return. This is harmless.

---

## Connection Resolver Changes

### Indexed output resolution (inline Cast)

After the existing Branch Cast block, add a Sequence Cast block:

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
                TEXT("BuildBlueprintFromJSON: Invalid Sequence role '%s' on node '%s' -- expected 'then_N'"),
                *FromPinRole, *FromNodeId);
            continue;
        }
        int32 Index = FCString::Atoi(*IndexStr);

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

This block goes between the Branch `if` and the `else` fallback to `PN_Then`.
The full resolution chain becomes:

```
if (Cast<UK2Node_IfThenElse>)      -- Branch: then/else
else if (Cast<UK2Node_ExecutionSequence>)  -- Sequence: then_0..then_N
else                                       -- All others: PN_Then
```

### Why `while` loop instead of counted expansion

`GetThenPinGivenIndex()` returns `nullptr` if the pin doesn't exist. A `while` loop
that calls `AddInputPin()` until the target index resolves is simpler and safer than
computing the exact number of calls needed. `AddInputPin()` internally calls
`GetUniquePinName()` which handles naming collisions. The loop is bounded by `Index`,
so a connection to `then_5` causes at most 4 iterations (from default 2 outputs to 6).

### Safety bound

To prevent runaway expansion from a typo like `then_9999`, add a cap:

```cpp
if (Index < 0 || Index > 99)
{
    UE_LOG(LogTemp, Warning,
        TEXT("BuildBlueprintFromJSON: Sequence index %d out of range on node '%s' -- max 99"),
        Index, *FromNodeId);
    continue;
}
```

This goes before the `while` loop. 99 is far beyond any sane use case.

---

## JSON Shape

### Basic 3-step sequence

```json
{
  "nodes": [
    { "id": "begin", "type": "BeginPlay" },
    { "id": "seq",   "type": "Sequence" },
    { "id": "a",     "type": "CallFunction", "function": "PrintString",
      "params": { "InString": "Step A" } },
    { "id": "b",     "type": "CallFunction", "function": "PrintString",
      "params": { "InString": "Step B" } },
    { "id": "c",     "type": "CallFunction", "function": "PrintString",
      "params": { "InString": "Step C" } }
  ],
  "connections": [
    { "from": "begin.exec",   "to": "seq.exec" },
    { "from": "seq.then_0",   "to": "a.exec" },
    { "from": "seq.then_1",   "to": "b.exec" },
    { "from": "seq.then_2",   "to": "c.exec" }
  ]
}
```

Note: `then_2` exceeds the default 2 outputs. The resolver will call `AddInputPin()`
once to create `Then_2` before wiring.

### Sequence + Branch combo

```json
{
  "nodes": [
    { "id": "begin",  "type": "BeginPlay" },
    { "id": "seq",    "type": "Sequence" },
    { "id": "greet",  "type": "CallFunction", "function": "PrintString",
      "params": { "InString": "Hello" } },
    { "id": "branch", "type": "Branch", "params": { "Condition": true } },
    { "id": "yes",    "type": "CallFunction", "function": "PrintString",
      "params": { "InString": "Yes path" } },
    { "id": "no",     "type": "CallFunction", "function": "PrintString",
      "params": { "InString": "No path" } }
  ],
  "connections": [
    { "from": "begin.exec",   "to": "seq.exec" },
    { "from": "seq.then_0",   "to": "greet.exec" },
    { "from": "seq.then_1",   "to": "branch.exec" },
    { "from": "branch.then",  "to": "yes.exec" },
    { "from": "branch.else",  "to": "no.exec" }
  ]
}
```

---

## Error Handling

| Situation | Behavior |
|---|---|
| `"from": "seq.then_0"` | GetThenPinGivenIndex(0), wire output 0 |
| `"from": "seq.then_5"` | Expand to 6 outputs, wire output 5 |
| `"from": "seq.then_100"` | Warning: index out of range (max 99), skip |
| `"from": "seq.then_-1"` | Warning: index out of range, skip |
| `"from": "seq.then_abc"` | Warning: non-numeric index, skip |
| `"from": "seq.exec"` | Warning: invalid role for Sequence output, skip |
| `"from": "seq.else"` | Warning: invalid role for Sequence output, skip |
| Sequence with no connections | Node created with default 2 outputs, nothing wired |

---

## Test Plan

### Case 1: Basic 3-step sequence

Build: BeginPlay -> Sequence -> 3 PrintString nodes (Step A, Step B, Step C).
Expected: All three print in order. `Then_2` is dynamically added.

### Case 2: Default 2 outputs only

Build: BeginPlay -> Sequence -> 2 PrintString nodes (then_0, then_1).
Expected: Both print. No dynamic expansion needed.

### Case 3: Sequence + Branch combo

Build: BeginPlay -> Sequence -> [PrintString "Hello", Branch -> yes/no].
Expected: "Hello" prints, then Branch fires the correct path.

### Case 4: Invalid role on Sequence output

Connection: `"from": "seq.exec", "to": "a.exec"`.
Expected: Warning in Output Log. Connection skipped. No crash.

### Case 5: Non-numeric index

Connection: `"from": "seq.then_abc", "to": "a.exec"`.
Expected: Warning in Output Log. Connection skipped. No crash.

---

## Not in This Pass

- Data pin connections
- Target pin role resolution
- Timer/latent action nodes
- Select node
- Any TypeScript or Python changes
