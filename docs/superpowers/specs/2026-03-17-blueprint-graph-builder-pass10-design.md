# Blueprint Graph Builder Pass 10 -- Member Function Calls

**Date:** 2026-03-17
**Status:** Draft

---

## Goal

Extend `CallFunction` to resolve non-static member functions on the Blueprint's parent class hierarchy, not just static `BlueprintFunctionLibrary` functions.

After Pass 10:

```json
{"id": "getLoc", "type": "CallFunction", "function": "GetActorLocation"}
```

resolves `GetActorLocation` on `AActor` (the typical parent class) and auto-wires the self pin.

---

## Scope

### In scope

- Extend function resolution: walk `Blueprint->ParentClass` and its supers after BlueprintFunctionLibrary scan
- Self pin auto-connection (implicit, handled by UE when function owner matches Blueprint parent)
- Optional `"target"` field on CallFunction for future explicit target wiring

### Out of scope

- Calling functions on other object references (requires object pin wiring -- future pass)
- Interface functions
- Event dispatchers
- Async/latent member functions (already handled by UE's latent action system if the node supports it)
- Pure vs impure distinction (UE handles this automatically based on FUNC_BlueprintPure flag)

---

## Decision Log

### Resolution order

The function lookup becomes a two-phase scan:

1. **Phase 1 (existing):** Iterate all `UBlueprintFunctionLibrary` subclasses, find by name
2. **Phase 2 (new):** Walk `Blueprint->ParentClass` up through `GetSuperClass()`, find by name

Phase 1 runs first because library functions are the common case and the existing behavior. Phase 2 only runs if Phase 1 finds nothing.

### Self pin behavior

When `UK2Node_CallFunction::SetFromFunction()` is called with a member function (e.g., `AActor::GetActorLocation`), UE4 automatically:

1. Creates a `self` input pin
2. In the context of the owning Blueprint, the self pin auto-connects to the implicit `this`
3. No explicit wiring needed in the JSON connections

This means `GetActorLocation` "just works" without a target pin connection -- UE infers that `self` is the Blueprint's owning actor.

### Optional target field

The `"target"` field is reserved but not implemented in Pass 10. When present, it would name another node whose output connects to the function's self/target pin. This enables calling functions on other objects:

```json
{"id": "call", "type": "CallFunction", "function": "GetActorLocation", "target": "otherActorRef"}
```

For Pass 10, omitting `"target"` means "call on self". Including it logs a warning that target wiring is not yet supported.

---

## Files Changed

```
D:/Unreal Projects/CodePlayground/Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BlueprintGraphBuilderLibrary.cpp
```

No other files change. No new includes needed -- `Blueprint->ParentClass` is already accessible via the existing `UBlueprint` include.

---

## Code Changes

### Modify the CallFunction branch

The existing function resolution loop:

```cpp
UFunction* Func = nullptr;
for (TObjectIterator<UClass> ClassIt; ClassIt; ++ClassIt)
{
    if (!ClassIt->IsChildOf(UBlueprintFunctionLibrary::StaticClass()))
    {
        continue;
    }
    UFunction* Candidate = ClassIt->FindFunctionByName(*FunctionName);
    if (Candidate && Candidate->HasAnyFunctionFlags(FUNC_BlueprintCallable | FUNC_BlueprintPure))
    {
        Func = Candidate;
        break;
    }
}
```

Becomes:

```cpp
UFunction* Func = nullptr;

// Phase 1: BlueprintFunctionLibrary subclasses (static/pure library functions)
for (TObjectIterator<UClass> ClassIt; ClassIt; ++ClassIt)
{
    if (!ClassIt->IsChildOf(UBlueprintFunctionLibrary::StaticClass()))
    {
        continue;
    }
    UFunction* Candidate = ClassIt->FindFunctionByName(*FunctionName);
    if (Candidate && Candidate->HasAnyFunctionFlags(FUNC_BlueprintCallable | FUNC_BlueprintPure))
    {
        Func = Candidate;
        UE_LOG(LogTemp, Log, TEXT("BuildBlueprintFromJSON: Resolved function '%s' on %s (library)"),
            *FunctionName, *ClassIt->GetName());
        break;
    }
}

// Phase 2: Blueprint parent class hierarchy (member functions)
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

The rest of the CallFunction branch (null check, `SetFromFunction`, `Finalize`, `ApplyParamsToNode`) remains unchanged.

---

## Connection Behavior

Member functions behave identically to library functions for connection purposes:

| Pin | Example (GetActorLocation) |
|---|---|
| self | Auto-connected by UE, not in JSON |
| ReturnValue | `{"from": "getLoc.ReturnValue", "to": "break.InVec"}` |
| exec (if impure) | `{"from": "getLoc.exec", "to": "next.exec"}` |

Pure member functions (like `GetActorLocation`) have no exec pins. Impure member functions (like `SetActorLocation`) have exec in/out.

---

## Test Plan

### Test 1 -- GetActorLocation (pure member function)

```python
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
        {"from": "toStr.ReturnValue",  "to": "print.InString"}
    ]
}
```

Note: The UE internal function name is `K2_GetActorLocation`, not `GetActorLocation`. The Blueprint-facing name may differ. Prototype via `python_proxy` to confirm the exact function name.

Expected: prints the actor's X position. The self pin auto-connects.

### Test 2 -- SetActorLocation (impure member function)

```python
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
```

Expected: actor moves to (100, 200, 300), prints "Moved".

### Test 3 -- Function not found anywhere

```python
graph_data = {
    "nodes": [
        {"id": "call", "type": "CallFunction", "function": "TotallyFakeFunction"}
    ],
    "connections": []
}
```

Expected: error: `function 'TotallyFakeFunction' not found in any BlueprintFunctionLibrary or parent class`. Node skipped. No crash.

---

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Function name mismatch (K2_ prefix) | Prototype to discover exact names; document common mappings |
| Self pin not auto-connecting | Verify via Blueprint editor after build; may need explicit `SetFromFunction` with correct outer class |
| Performance of class hierarchy walk | Parent chain is typically 3-5 classes deep (Actor -> Pawn -> Character); negligible cost |
| Ambiguous function names (same name on library and member) | Phase 1 wins; library functions take priority. This matches editor behavior where library functions shadow member functions |

---

## What This Unlocks

After Pass 10: graphs can call any Blueprint-callable function -- both static library functions and member functions on the owning actor/class. This covers `GetActorLocation`, `SetActorLocation`, `GetComponentByClass`, `Destroy`, and the full `AActor` API.

Combined with Passes 1-9: execution flow, branching, sequencing, function calls (static + member), data wiring, variables, and loops. The graph builder can now express most common Blueprint patterns.
