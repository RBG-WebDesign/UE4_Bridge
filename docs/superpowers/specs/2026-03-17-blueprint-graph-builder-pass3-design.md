# Blueprint Graph Builder -- Pass 3 Design Spec

Date: 2026-03-17

## Overview

Pass 3 adds pin default value injection to the `BlueprintGraphBuilder` C++ plugin.
After each node is spawned, the JSON node's optional `"params"` object is read and
each key is matched against the node's pin list by `PinName`. Matching pins get their
`DefaultValue` set to the JSON value, formatted as a string appropriate for the
pin type.

The MCP tool `blueprint_build_from_json` gains a `params` field on node objects in its
Zod schema. No Python listener changes. No new MCP routes. No new C++ functions on the
public API -- `ApplyParamsToNode` is a private static helper.

## Goals (Pass 3)

- Inject string pin values: `"InString": "PRESS E!"` sets the PrintString text
- Inject float/int pin values: `"Duration": 3.0` sets the Delay duration
- Inject bool pin values: `"NewDuration": true` or similar
- Skip nodes with no `"params"` key with zero cost (early return)
- Log every applied value at `LogTemp` Log level for debugging
- Log a warning for unsupported JSON value types (objects, arrays, null) and skip them
- Update the TypeScript Zod schema to accept `params` on node objects
- Prove: QTE JSON with `"PRESS E!"` and `"FAILED!"` text variation and a 3.0s delay

## Non-Goals (Pass 3)

- Object reference pins (asset paths, actor pointers) -- requires asset resolution, deferred to Pass 4+
- Struct pins (FVector, FLinearColor, etc.) -- requires compound string format, deferred
- Array pins -- requires index-addressed injection, deferred
- Enum pins -- requires name-to-value lookup, deferred
- Pins on nodes other than those spawned in the same `BuildBlueprintFromJSON` call
- Class-name resolution for `CallFunction` beyond `UKismetSystemLibrary` (still Pass 4)

---

## JSON Schema

### Extended node object

A node object may now include an optional `"params"` key whose value is a flat object
mapping pin names to scalar values:

```json
{
  "id": "prompt",
  "type": "CallFunction",
  "function": "PrintString",
  "params": {
    "InString": "PRESS E!",
    "Duration": 3.0
  }
}
```

Keys in `"params"` are matched case-sensitively against `UEdGraphPin::PinName`. If a
key has no matching pin, it is silently ignored (no error -- some param keys may be
intent annotations rather than literal pin names, and strict matching is not worth
a hard failure here).

### PrintString params example

```json
{
  "id": "prompt",
  "type": "CallFunction",
  "function": "PrintString",
  "params": {
    "InString": "PRESS E!",
    "bPrintToLog": false,
    "Duration": 2.0
  }
}
```

Pin names on `UKismetSystemLibrary::PrintString` in UE4.27:
- `InString` -- the text to print (string)
- `bPrintToLog` -- also log to output log (bool)
- `Duration` -- how long the message stays on screen (float)
- `TextColor` -- a struct pin, will be skipped with a warning
- `WorldContextObject` -- an object pin, will be skipped with a warning

### Delay params example

```json
{
  "id": "window",
  "type": "Delay",
  "params": {
    "Duration": 3.0
  }
}
```

Pin names on `UKismetSystemLibrary::Delay` in UE4.27:
- `Duration` -- the delay time in seconds (float)
- `WorldContextObject` -- an object pin, will be skipped with a warning

---

## ApplyParamsToNode

### Declaration (`.h`)

`ApplyParamsToNode` is a private static helper. It does not need `UFUNCTION` -- it is
never called from Blueprint or Python. Add it to the private section of
`UBlueprintGraphBuilderLibrary` in `BlueprintGraphBuilderLibrary.h`:

```cpp
private:
    static void ApplyParamsToNode(
        UEdGraphNode* Node,
        const TSharedPtr<FJsonObject>& NodeObj
    );
```

### Implementation (`.cpp`)

```cpp
void UBlueprintGraphBuilderLibrary::ApplyParamsToNode(
    UEdGraphNode* Node,
    const TSharedPtr<FJsonObject>& NodeObj)
{
    const TSharedPtr<FJsonObject>* ParamsObjPtr = nullptr;
    if (!NodeObj->TryGetObjectField(TEXT("params"), ParamsObjPtr))
    {
        return; // No params -- nothing to do.
    }
    const TSharedPtr<FJsonObject>& ParamsObj = *ParamsObjPtr;

    for (UEdGraphPin* Pin : Node->Pins)
    {
        const FString PinName = Pin->PinName.ToString();

        if (!ParamsObj->HasField(PinName))
        {
            continue;
        }

        const TSharedPtr<FJsonValue>& Value = ParamsObj->Values[PinName];

        switch (Value->Type)
        {
            case EJson::String:
                Pin->DefaultValue = Value->AsString();
                break;

            case EJson::Number:
                Pin->DefaultValue = FString::SanitizeFloat(Value->AsNumber());
                break;

            case EJson::Boolean:
                Pin->DefaultValue = Value->AsBool() ? TEXT("true") : TEXT("false");
                break;

            default:
                UE_LOG(LogTemp, Warning,
                    TEXT("ApplyParamsToNode: pin '%s' skipped -- unsupported JSON value type"),
                    *PinName);
                continue;
        }

        UE_LOG(LogTemp, Log,
            TEXT("ApplyParamsToNode: Setting pin %s = %s"),
            *PinName, *Pin->DefaultValue);
    }
}
```

### Pseudocode summary

```
ApplyParamsToNode(Node, NodeObj):
    ParamsObj = NodeObj["params"]  -- if missing, return immediately

    for each Pin in Node.Pins:
        PinName = Pin.PinName.ToString()
        if ParamsObj does not have PinName:
            continue

        Value = ParamsObj[PinName]

        if Value is String:
            Pin.DefaultValue = Value.AsString()
        elif Value is Number:
            Pin.DefaultValue = FString::SanitizeFloat(Value.AsNumber())
        elif Value is Boolean:
            Pin.DefaultValue = Value.AsBool() ? "true" : "false"
        else:
            log warning: "unsupported JSON value type for pin PinName"
            continue

        log: "Setting pin PinName = DefaultValue"
```

---

## Type Mapping Table

| JSON value type | `EJson` enum value | `Pin->DefaultValue` format | Example input | Example `DefaultValue` |
|-----------------|-------------------|---------------------------|---------------|----------------------|
| String          | `EJson::String`   | Verbatim string content   | `"PRESS E!"`  | `PRESS E!`           |
| Number          | `EJson::Number`   | `FString::SanitizeFloat`  | `3.0`         | `3.000000`           |
| Number (int)    | `EJson::Number`   | `FString::SanitizeFloat`  | `2`           | `2.000000`           |
| Boolean         | `EJson::Boolean`  | `"true"` or `"false"`     | `false`       | `false`              |
| Object          | `EJson::Object`   | (skipped, warning logged) | `{}`          | unchanged            |
| Array           | `EJson::Array`    | (skipped, warning logged) | `[]`          | unchanged            |
| Null            | `EJson::Null`     | (skipped, warning logged) | `null`        | unchanged            |

Note: UE4.27 stores all pin default values as strings internally. Booleans use lowercase
`"true"` / `"false"` (not `"True"` / `"False"`). Floats use `FString::SanitizeFloat`
which produces a fixed-precision decimal string (e.g. `3.000000`). If a function
expects a specific format and `SanitizeFloat` is wrong for it, that is out of scope
for Pass 3 -- the caller should pass a string param instead.

---

## Call Site

`ApplyParamsToNode` is called immediately after `Creator.Finalize()` and the
`SpawnedNode = CallNode;` (or `SpawnedNode = EventNode;`) assignment, inside each
dispatch case. It is called before the unified `if (SpawnedNode)` positioning block.

Call pattern for each case:

```cpp
Creator.Finalize();
SpawnedNode = CallNode;          // or EventNode for BeginPlay
ApplyParamsToNode(SpawnedNode, *NodeObj);
```

**BeginPlay:** `ApplyParamsToNode` is called but returns immediately (no `"params"`
key on a typical BeginPlay node). This is harmless and avoids a per-case guard.

**PrintString:** Called after `Creator.Finalize(); SpawnedNode = CallNode;`

**Delay:** Called after `Creator.Finalize(); SpawnedNode = CallNode;`

**CallFunction:** Called after `Creator.Finalize(); SpawnedNode = CallNode;`

The call site is always **after** `Finalize()`. This is required because `Pins` is
populated by `Finalize()` -- calling it before `Finalize()` would iterate an empty
pin array and do nothing.

---

## TypeScript Schema Change

### Zod schema (`mcp-server/src/tools/blueprints.ts`)

Add `params` as optional on the node object schema. The value is a record of scalar
types:

```typescript
z.object({
  id: z.string().describe("Unique node identifier"),
  type: z.string().describe("Node type: BeginPlay | PrintString | Delay | CallFunction"),
  function: z.string().optional().describe("Required when type is CallFunction -- function name on UKismetSystemLibrary"),
  params: z.record(z.union([z.string(), z.number(), z.boolean()]))
    .optional()
    .describe("Pin default values keyed by PinName. Supports string, number, bool only."),
})
```

### Handler type cast

Add `params?: Record<string, string | number | boolean>` to the node array element
type inside the existing `params as { ... }` cast:

```typescript
graph: {
  nodes: Array<{
    id: string;
    type: string;
    function?: string;
    params?: Record<string, string | number | boolean>;
  }>;
  connections: Array<{ from: string; to: string }>;
};
```

No handler logic changes are needed beyond the type cast. `JSON.stringify(graph)`
already serializes the `params` object if present, and C++ reads it via
`TryGetObjectField`.

---

## QTE Demo JSON (Pass 3 milestone proof)

```json
{
  "nodes": [
    { "id": "begin",  "type": "BeginPlay" },
    {
      "id": "prompt",
      "type": "CallFunction",
      "function": "PrintString",
      "params": { "InString": "PRESS E!", "Duration": 2.0 }
    },
    {
      "id": "window",
      "type": "Delay",
      "params": { "Duration": 3.0 }
    },
    {
      "id": "fail",
      "type": "CallFunction",
      "function": "PrintString",
      "params": { "InString": "FAILED!", "Duration": 2.0 }
    }
  ],
  "connections": [
    { "from": "begin.exec",  "to": "prompt.exec" },
    { "from": "prompt.exec", "to": "window.exec" },
    { "from": "window.exec", "to": "fail.exec" }
  ]
}
```

**What this proves:**
- String pin injection: "PRESS E!" and "FAILED!" appear as distinct text values
- Float pin injection: Duration 2.0 on PrintString, Duration 3.0 on Delay
- Multiple params per node work
- `"params"` absence on BeginPlay is handled gracefully
- Full QTE text variation is real -- no longer defaulting to empty strings

**Expected runtime behavior:**
- BeginPlay fires
- "PRESS E!" prints for 2 seconds
- 3-second pause (Delay)
- "FAILED!" prints for 2 seconds

---

## Validation Criteria (Pass 3 complete when)

- Plugin compiles without errors after adding `ApplyParamsToNode`
- `blueprint_build_from_json` MCP call with QTE JSON above returns `success: true`
- Blueprint editor shows pin default values set correctly on each node
- Blueprint compiles without Kismet errors
- Play in editor shows "PRESS E!" then a 3-second gap then "FAILED!"
- UE4 Output Log shows `ApplyParamsToNode: Setting pin InString = PRESS E!` (and others)

---

## Roadmap

### Pass 4 (next after Pass 3)

- `"class"` field on `CallFunction`: `"class": "KismetSystemLibrary"` -- full Option B
- Unlocks functions outside `UKismetSystemLibrary` (e.g., game-specific libraries)

### Pass 5

- Branch/sequence nodes (requires the data pin wiring infrastructure from Pass 3)
- Success path: input event -> override Delay -> `OnQTESuccess` PrintString
