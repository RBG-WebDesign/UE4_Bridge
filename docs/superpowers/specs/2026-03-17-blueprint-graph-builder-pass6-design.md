# Blueprint Graph Builder Pass 6 -- Data Pin Wiring

**Date:** 2026-03-17
**Status:** Draft

---

## Goal

Extend the connection resolver to support data pin connections in addition to exec connections.

After Pass 6, a connection like:

```json
{ "from": "nodeA.ReturnValue", "to": "nodeB.InString" }
```

works identically to an exec connection. The same `"connections"` array handles both. No JSON schema changes.

---

## Scope

### In scope

- `FindPinCaseInsensitive` static helper
- Source pin resolver extended: exec alias, data fallback
- Target pin resolver extended: exec alias, data fallback
- Mixed exec + data graphs
- Case-insensitive matching on all pin names

### Out of scope

- Function lookup expansion (reserved for Pass 7)
- Class discovery, instance methods, Target pin auto-wiring
- Data type validation (UE handles type errors internally at compile time)
- JSON schema changes

---

## Decision Log

### Pin naming convention

Use real UE pin names (e.g., `ReturnValue`, `InString`, `X`), matched case-insensitively. No translation layer. The moment you invent aliases like `"output"` or `"input"`, you need mapping tables that break on unusual nodes. Raw pin names map 1:1 to UE with zero maintenance.

### `exec` as a reserved alias

`exec` is a human-friendly alias for the execution pins (`PN_Then` on source, `PN_Execute` on target). Branch and Sequence keep their own special handling (`then`/`else`, `then_N`). Everything else resolves by raw pin name. The rule: exec is a keyword, everything else is a real pin name.

### Option A (inline extension) over Option B (extract helpers)

The resolver is still in shape-discovery mode -- Branch, Sequence, now data. Extracting `ResolveSourcePin`/`ResolveTargetPin` now risks locking in the wrong abstraction before Pass 7 clarifies what the final shape needs to be. Inline extension fits the existing Cast chain pattern and keeps the diff small.

---

## Files Changed

```
D:/Unreal Projects/CodePlayground/Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BlueprintGraphBuilderLibrary.cpp
```

No other files change. Header, Build.cs, TypeScript, Python -- untouched.

---

## JSON Format

Unchanged from prior passes:

```json
{
  "from": "nodeId.pinName",
  "to":   "nodeId.pinName"
}
```

### Pin name rules

| Role | Meaning |
|---|---|
| `exec` | Execution pin (source: `PN_Then`, target: `PN_Execute`) |
| `then` | Branch true output |
| `else` | Branch false output |
| `then_N` | Sequence output at 0-based index N |
| anything else | Real UE pin name, matched case-insensitively |

---

## New Helper

Add as a file-scope static function near the top of `BlueprintGraphBuilderLibrary.cpp`, after the includes and before `ApplyParamsToNode`:

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

`Pin->PinName` is the semantic display name (`ReturnValue`, `InString`, `X`, etc.) -- the same field used in `ApplyParamsToNode` at `Pin->PinName.ToString()`. Do not use `Pin->GetName()`, which returns the UObject's auto-generated internal name (e.g., `K2Node_CallFunction_0_Pin_1`), not the pin's semantic name.

**Note on casing:** The resolver applies `FromPinRole.ToLower()` / `ToPinRole.ToLower()` before reaching this helper, so data roles arrive already lowercased (e.g., `"returnvalue"`, `"invec"`). The `ESearchCase::IgnoreCase` flag in this helper is belt-and-suspenders -- it also means JSON callers who bypass the resolver directly (or future callers) get correct behavior regardless of casing. Test 2 below proves end-to-end round-trip tolerance for lowercase input, which is what callers actually produce after `ToLower()`.

---

## Resolver Changes

The connection resolver sits in Step 5 of `BuildBlueprintFromJSON`. The existing structure:

1. Guard: `FromStr.Split` / `ToStr.Split`
2. `FromPinRole.ToLower()` / `ToPinRole.ToLower()`
3. Source: `Cast<UK2Node_IfThenElse>` (Branch)
4. Source: `Cast<UK2Node_ExecutionSequence>` (Sequence)
5. Source: else -- `FindPin(PN_Then)`
6. Null guard on `SourcePin`
7. Target: `FindPin(PN_Execute)` (fixed)
8. Null guard on `TargetPin`
9. `SourcePin->MakeLinkTo(TargetPin)`

After Pass 6:

1. Guard: `FromStr.Split` / `ToStr.Split` -- unchanged
2. `FromPinRole.ToLower()` / `ToPinRole.ToLower()` -- unchanged
3. Source: `Cast<UK2Node_IfThenElse>` -- unchanged
4. Source: `Cast<UK2Node_ExecutionSequence>` -- unchanged
5. Source: `else if (FromPinRole == "exec")` -- **NEW** -- `PN_Then`
6. Source: `else` data fallback -- **CHANGED** -- `FindPinCaseInsensitive`
7. Null guard on `SourcePin` -- unchanged
8. Target: `if (ToPinRole == "exec")` -- **NEW** -- `PN_Execute`
9. Target: `else` data fallback -- **NEW** -- `FindPinCaseInsensitive`
10. Null guard on `TargetPin` -- unchanged
11. `SourcePin->MakeLinkTo(TargetPin)` -- unchanged

### Source side after Pass 6

```cpp
// --- SOURCE PIN RESOLUTION ---
UEdGraphPin* SourcePin = nullptr;

if (UK2Node_IfThenElse* Branch = Cast<UK2Node_IfThenElse>(*FromNodePtr))
{
    if (FromPinRole == TEXT("then"))
    {
        SourcePin = Branch->GetThenPin();
    }
    else if (FromPinRole == TEXT("else"))
    {
        SourcePin = Branch->GetElsePin();
    }
    else
    {
        UE_LOG(LogTemp, Warning,
            TEXT("BuildBlueprintFromJSON: Invalid role '%s' for Branch output on node '%s' -- expected 'then' or 'else'"),
            *FromPinRole, *FromNodeId);
        continue;
    }
}
else if (UK2Node_ExecutionSequence* Seq = Cast<UK2Node_ExecutionSequence>(*FromNodePtr))
{
    if (FromPinRole.StartsWith(TEXT("then_")))
    {
        FString IndexStr = FromPinRole.RightChop(5);
        if (!IndexStr.IsNumeric())
        {
            UE_LOG(LogTemp, Warning,
                TEXT("BuildBlueprintFromJSON: Invalid Sequence role '%s' on node '%s' -- expected 'then_N'"),
                *FromPinRole, *FromNodeId);
            continue;
        }
        int32 Index = FCString::Atoi(*IndexStr);
        if (Index < 0 || Index > 99)
        {
            UE_LOG(LogTemp, Warning,
                TEXT("BuildBlueprintFromJSON: Sequence index %d out of range on node '%s' -- max 99"),
                Index, *FromNodeId);
            continue;
        }
        int32 SafeGuard = 0;
        while (!Seq->GetThenPinGivenIndex(Index) && SafeGuard < 128)
        {
            Seq->AddInputPin();
            SafeGuard++;
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

### Target side after Pass 6

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

---

## Null Guards

The existing null guards on `SourcePin` and `TargetPin` remain. They now cover both exec and data resolution failures:

```cpp
if (!SourcePin)
{
    UE_LOG(LogTemp, Warning,
        TEXT("BuildBlueprintFromJSON: Could not resolve source pin '%s' on node '%s'"),
        *FromPinRole, *FromNodeId);
    continue;
}

if (!TargetPin)
{
    UE_LOG(LogTemp, Warning,
        TEXT("BuildBlueprintFromJSON: Could not resolve target pin '%s' on node '%s'"),
        *ToPinRole, *ToNodeId);
    continue;
}
```

The data fallback branches do not add their own `continue` before the null guard -- the null guard below catches both cases. This keeps the fallthrough path identical whether the pin was found or not.

---

## Behavior Reference

| Connection | SourcePin resolution | TargetPin resolution |
|---|---|---|
| `node.exec -> node.exec` | `PN_Then` | `PN_Execute` |
| `node.ReturnValue -> node.InString` | `FindPinCaseInsensitive("ReturnValue")` | `FindPinCaseInsensitive("InString")` |
| `node.returnvalue -> node.instring` | same (case-insensitive) | same |
| `branch.then -> node.exec` | `GetThenPin()` | `PN_Execute` |
| `seq.then_2 -> node.exec` | `GetThenPinGivenIndex(2)` | `PN_Execute` |
| `node.FakePin -> node.exec` | null (warning + skip) | -- |
| `node.exec -> node.FakePin` | `PN_Then` | null (warning + skip) |
| `branch.then -> node.FakePin` | `GetThenPin()` (non-null) | null (warning + skip) |

---

## Test Plan

All smoke tests run via `python_proxy` through MCP. No new Blueprint asset is needed -- reuse `BP_TestGraph`.

### Test 1 -- Pure data chain

```python
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
        {"from": "begin.exec",          "to": "print.exec"},
        {"from": "make.ReturnValue",     "to": "break.InVec"},
        {"from": "break.X",              "to": "toStr.InFloat"},
        {"from": "toStr.ReturnValue",    "to": "print.InString"}
    ]
}
```

Expected: prints `"10.0"` (X component of the vector). Exec chain runs BeginPlay -> PrintString. Data chain routes through MakeVector -> BreakVector -> Conv_FloatToString -> PrintString.InString.

### Test 2 -- Case-insensitive lookup

Same graph as Test 1 but with lowercase pin names:

```json
{"from": "make.returnvalue", "to": "break.invec"},
{"from": "break.x",          "to": "toStr.infloat"},
{"from": "toStr.returnvalue", "to": "print.instring"}
```

Expected: identical result to Test 1. Proves case-insensitive matching.

### Test 3 -- Mixed exec + data (Sequence fan-out)

```python
graph_data = {
    "nodes": [
        {"id": "begin", "type": "BeginPlay"},
        {"id": "seq",   "type": "Sequence"},
        {"id": "print0","type": "CallFunction", "function": "PrintString",
         "params": {"InString": "Start"}},
        {"id": "make",  "type": "CallFunction", "function": "MakeVector",
         "params": {"X": 42.0, "Y": 0.0, "Z": 0.0}},
        {"id": "break", "type": "CallFunction", "function": "BreakVector"},
        {"id": "toStr", "type": "CallFunction", "function": "Conv_FloatToString"},
        {"id": "print1","type": "CallFunction", "function": "PrintString"}
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
```

Expected: "Start" prints, then "42.0" prints. Exec and data flow combined.

### Test 4 -- Invalid pin name

```python
graph_data = {
    "nodes": [
        {"id": "begin", "type": "BeginPlay"},
        {"id": "print", "type": "CallFunction", "function": "PrintString"}
    ],
    "connections": [
        {"from": "begin.exec",  "to": "print.exec"},
        {"from": "begin.FakeOutputPin", "to": "print.InString"}
    ]
}
```

Expected: warning in Output Log for `FakeOutputPin` not found. Connection skipped. Graph compiles. "Hello" prints (default value). No crash.

### Test 5 -- MCP end-to-end

Run the Test 1 graph through `blueprint_build_from_json` via MCP tool (not python_proxy). Expected: `success: true`, same visual result.

---

## What This Unlocks

After Pass 6, the system supports:

- Arbitrary execution flow (Passes 1-5)
- Arbitrary data flow between any two pins on any supported node (Pass 6)
- Mixed exec + data graphs in a single `"connections"` array

The next natural pass is function resolution expansion (Pass 7): resolving functions on any class, not just `UKismetSystemLibrary`, and auto-wiring Target/WorldContext pins.
