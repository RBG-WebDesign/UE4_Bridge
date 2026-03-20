# Animation Blueprint Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Animation Blueprints from JSON, targeting UE4's FirstPerson_AnimBP as the v1 reference implementation.

**Architecture:** C++ builder inside the existing BlueprintGraphBuilder plugin. Follows the BT Builder pattern (parse -> validate -> build -> compile) with Widget Builder's asset creation flow. Event graph delegated to existing BlueprintGraphBuilder.

**Tech Stack:** UE4.27 C++ (AnimGraph module, Persona module), JSON parsing via UE4's FJsonObject.

**Spec:** `docs/superpowers/specs/2026-03-19-anim-blueprint-builder-design.md`

**Spec Pass to Plan Task Mapping:**

| Spec Pass | Plan Tasks | Scope |
|-----------|-----------|-------|
| Pass 1: Asset creation | Tasks 1, 4 | Skeleton, factory, empty AnimBP |
| Pass 2: Variables | Task 5 | Bool variables on AnimInstance |
| Pass 3: AnimGraph pipeline | Task 6 | StateMachine + Slot + Root wiring |
| Pass 4: States | Task 7 | States with SequencePlayer + entry wiring |
| Pass 5: Bool transitions | Task 8 | Transitions with bool_variable conditions |
| Pass 6: TimeRemaining | Task 9 | Automatic rule transitions + blend times |
| Pass 7: Event graph | Task 10 | Event graph delegation + compile |
| Pass 8: Integration test | Tasks 11-13 | E2E test, MCP tool, docs |

Tasks 2-3 (Parser, Validator) are infrastructure that the spec assumes implicitly.

---

## File Map

All files under `ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/`:

| File | Responsibility |
|------|---------------|
| `Public/AnimBlueprintBuilderLibrary.h` | Public API: 3 UFUNCTIONs (Build, Rebuild, Validate) |
| `Private/AnimBlueprintBuilder/AnimBlueprintBuilderLibrary.cpp` | Dispatcher to FAnimBPBuilder |
| `Private/AnimBlueprintBuilder/ABPBuildSpec.h` | Data structures: specs + build context |
| `Private/AnimBlueprintBuilder/ABPBuilder.h` | Orchestrator: 6-step pipeline |
| `Private/AnimBlueprintBuilder/ABPBuilder.cpp` | Pipeline implementation |
| `Private/AnimBlueprintBuilder/ABPAssetFactory.h` | AnimBP asset creation via UAnimBlueprintFactory |
| `Private/AnimBlueprintBuilder/ABPAssetFactory.cpp` | Skeleton resolution, factory config, asset creation |
| `Private/AnimBlueprintBuilder/ABPJsonParser.h` | JSON string -> FAnimBPBuildSpec |
| `Private/AnimBlueprintBuilder/ABPJsonParser.cpp` | Recursive JSON parsing |
| `Private/AnimBlueprintBuilder/ABPValidator.h` | Spec validation (10 rules) |
| `Private/AnimBlueprintBuilder/ABPValidator.cpp` | Validation implementation |
| `Private/AnimBlueprintBuilder/ABPNodeRegistry.h` | AnimGraph node type registry |
| `Private/AnimBlueprintBuilder/ABPNodeRegistry.cpp` | Type lookups, defaults |
| `Private/AnimBlueprintBuilder/ABPAnimGraphBuilder.h` | Builds AnimGraph pipeline (SM + Slot + Root) |
| `Private/AnimBlueprintBuilder/ABPAnimGraphBuilder.cpp` | AnimGraph node creation + pose pin wiring |
| `Private/AnimBlueprintBuilder/ABPStateMachineBuilder.h` | Builds states, transitions, conditions |
| `Private/AnimBlueprintBuilder/ABPStateMachineBuilder.cpp` | State machine internals |
| `Private/AnimBlueprintBuilder/ABPVariableBuilder.h` | Adds bool variables to AnimInstance |
| `Private/AnimBlueprintBuilder/ABPVariableBuilder.cpp` | Variable creation via FBlueprintEditorUtils |

---

### Task 1: Module Dependencies + Public API Skeleton

**Files:**
- Modify: `BlueprintGraphBuilder.Build.cs`
- Create: `Public/AnimBlueprintBuilderLibrary.h`
- Create: `Private/AnimBlueprintBuilder/AnimBlueprintBuilderLibrary.cpp`
- Create: `Private/AnimBlueprintBuilder/ABPBuildSpec.h`
- Create: `Private/AnimBlueprintBuilder/ABPBuilder.h`
- Create: `Private/AnimBlueprintBuilder/ABPBuilder.cpp`

- [ ] **Step 1: Add module dependencies to Build.cs**

Add `AnimGraph` and `AnimGraphRuntime` to the main `PrivateDependencyModuleNames` block. Add `Persona` inside the `if (Target.bBuildEditor)` block.

```csharp
// In the main PrivateDependencyModuleNames.AddRange:
"AnimGraph",
"AnimGraphRuntime",

// In the bBuildEditor block:
PrivateDependencyModuleNames.Add("Persona");
```

- [ ] **Step 2: Create ABPBuildSpec.h with data structures**

```cpp
#pragma once

#include "CoreMinimal.h"

class UAnimBlueprint;
class USkeleton;
class UAnimStateNode;
class UAnimGraphNode_Base;
class UAnimationStateMachineGraph;

struct FAnimBPVariableSpec
{
    FString Name;
    FString Type;       // "bool" for v1
    FString Default;    // "true" or "false"
};

struct FAnimBPTransitionConditionSpec
{
    FString Type;       // "bool_variable" or "time_remaining"
    FString Variable;   // for bool_variable
    FString Value;      // "true" or "false" for bool_variable
    float Threshold = 0.1f; // for time_remaining
};

struct FAnimBPTransitionSpec
{
    FString From;       // state id
    FString To;         // state id
    float BlendTime = 0.2f;
    FAnimBPTransitionConditionSpec Condition;
};

struct FAnimBPStateSpec
{
    FString Id;
    FString Name;
    FString Animation;  // asset path to AnimSequence
    bool bLooping = true;
    bool bIsEntry = false;
};

struct FAnimBPAnimGraphNodeSpec
{
    FString Id;
    FString Type;       // "StateMachine" or "Slot"
    FString Name;
};

struct FAnimBPBuildSpec
{
    TArray<FAnimBPVariableSpec> Variables;
    TArray<FAnimBPAnimGraphNodeSpec> AnimGraphPipeline;
    TArray<FAnimBPStateSpec> States;
    TArray<FAnimBPTransitionSpec> Transitions;
    FString EventGraphJson;
};

struct FAnimBPBuildContext
{
    UAnimBlueprint* AnimBlueprint = nullptr;
    USkeleton* Skeleton = nullptr;
    const FAnimBPNodeRegistry* Registry = nullptr;
    UAnimationStateMachineGraph* StateMachineGraph = nullptr;
    TMap<FString, UAnimStateNode*> StateNodeMap;
    TMap<FString, UAnimGraphNode_Base*> AnimGraphNodeMap;
};
```

- [ ] **Step 3: Create ABPBuilder.h/.cpp with stub pipeline**

```cpp
// ABPBuilder.h
#pragma once

#include "CoreMinimal.h"

class UAnimBlueprint;

class FAnimBPNodeRegistry;

class FAnimBPBuilder
{
public:
    FString Build(
        const FString& PackagePath,
        const FString& AssetName,
        const FString& SkeletonPath,
        const FString& JsonString
    );

    FString Rebuild(UAnimBlueprint* AnimBP, const FString& JsonString);

    FString Validate(const FString& JsonString);

private:
    FAnimBPNodeRegistry Registry;
};
```

```cpp
// ABPBuilder.cpp
#include "ABPBuilder.h"
#include "ABPBuildSpec.h"
#include "ABPNodeRegistry.h"

FString FAnimBPBuilder::Build(
    const FString& PackagePath,
    const FString& AssetName,
    const FString& SkeletonPath,
    const FString& JsonString)
{
    // TODO: Implement pipeline passes 1-8
    return TEXT("[AnimBPBuilder] not yet implemented");
}

FString FAnimBPBuilder::Rebuild(UAnimBlueprint* AnimBP, const FString& JsonString)
{
    return TEXT("[AnimBPBuilder] Rebuild not yet implemented");
}

FString FAnimBPBuilder::Validate(const FString& JsonString)
{
    return TEXT("[AnimBPBuilder] Validate not yet implemented");
}
```

- [ ] **Step 4: Create public library header + dispatcher**

```cpp
// Public/AnimBlueprintBuilderLibrary.h
#pragma once

#include "CoreMinimal.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "AnimBlueprintBuilderLibrary.generated.h"

class UAnimBlueprint;

UCLASS()
class BLUEPRINTGRAPHBUILDER_API UAnimBlueprintBuilderLibrary : public UBlueprintFunctionLibrary
{
    GENERATED_BODY()

public:
    UFUNCTION(BlueprintCallable, CallInEditor, Category="BlueprintGraphBuilder")
    static FString BuildAnimBlueprintFromJSON(
        const FString& PackagePath,
        const FString& AssetName,
        const FString& SkeletonPath,
        const FString& JsonString
    );

    UFUNCTION(BlueprintCallable, CallInEditor, Category="BlueprintGraphBuilder")
    static FString RebuildAnimBlueprintFromJSON(
        UAnimBlueprint* AnimBlueprint,
        const FString& JsonString
    );

    UFUNCTION(BlueprintCallable, CallInEditor, Category="BlueprintGraphBuilder")
    static FString ValidateAnimBlueprintJSON(
        const FString& JsonString
    );
};
```

```cpp
// Private/AnimBlueprintBuilder/AnimBlueprintBuilderLibrary.cpp
#include "AnimBlueprintBuilderLibrary.h"
#include "AnimBlueprintBuilder/ABPBuilder.h"
#include "Animation/AnimBlueprint.h"

FString UAnimBlueprintBuilderLibrary::BuildAnimBlueprintFromJSON(
    const FString& PackagePath,
    const FString& AssetName,
    const FString& SkeletonPath,
    const FString& JsonString)
{
    UE_LOG(LogTemp, Log, TEXT("[AnimBPBuilder] BuildAnimBlueprintFromJSON called"));
    FAnimBPBuilder Builder;
    return Builder.Build(PackagePath, AssetName, SkeletonPath, JsonString);
}

FString UAnimBlueprintBuilderLibrary::RebuildAnimBlueprintFromJSON(
    UAnimBlueprint* AnimBlueprint,
    const FString& JsonString)
{
    UE_LOG(LogTemp, Log, TEXT("[AnimBPBuilder] RebuildAnimBlueprintFromJSON called"));
    if (!AnimBlueprint) return TEXT("[AnimBPBuilder] AnimBlueprint is null");
    FAnimBPBuilder Builder;
    return Builder.Rebuild(AnimBlueprint, JsonString);
}

FString UAnimBlueprintBuilderLibrary::ValidateAnimBlueprintJSON(
    const FString& JsonString)
{
    FAnimBPBuilder Builder;
    return Builder.Validate(JsonString);
}
```

- [ ] **Step 5: Compile the plugin**

Build the UE4 project with the new files. Expected: compiles clean with stub implementations. The three UFUNCTIONs should appear in the Blueprint function library.

- [ ] **Step 6: Commit**

```bash
git add ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/BlueprintGraphBuilder.Build.cs
git add ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Public/AnimBlueprintBuilderLibrary.h
git add "ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/AnimBlueprintBuilder/*"
git commit -m "feat(abp-builder): scaffold AnimBP builder with public API and stub pipeline"
```

---

### Task 2: JSON Parser

**Files:**
- Create: `Private/AnimBlueprintBuilder/ABPJsonParser.h`
- Create: `Private/AnimBlueprintBuilder/ABPJsonParser.cpp`

- [ ] **Step 1: Create ABPJsonParser.h**

```cpp
#pragma once

#include "CoreMinimal.h"

struct FAnimBPBuildSpec;

class FAnimBPJsonParser
{
public:
    static FString Parse(const FString& JsonString, FAnimBPBuildSpec& OutSpec);
};
```

- [ ] **Step 2: Create ABPJsonParser.cpp**

Parse top-level sections: `variables`, `anim_graph.pipeline`, `state_machine.states`, `state_machine.transitions`, `event_graph`. Follow BTJsonParser pattern: recursive descent, return error string on first failure, empty string on success.

Key parsing rules:
- `variables`: array of objects with `name` (required), `type` (required, must be "bool" for v1), `default` (optional, defaults to "false")
- `anim_graph.pipeline`: array of objects with `id` (required), `type` (required), `name` (required)
- `state_machine.states`: array with `id`, `name`, `animation` (all required), `looping` (optional bool, default true), `is_entry` (optional bool, default false)
- `state_machine.transitions`: array with `from`, `to` (required state ids), `blend_time` (optional float, default 0.2), `condition` object with `type` (required)
- `condition.type == "bool_variable"`: requires `variable` (string) and `value` (bool)
- `condition.type == "time_remaining"`: requires `threshold` (float)
- `event_graph`: store as raw JSON string (not parsed further, forwarded to BlueprintGraphBuilder)

- [ ] **Step 3: Compile and verify**

Build. Parser should compile cleanly with no warnings.

- [ ] **Step 4: Commit**

```bash
git add "ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/AnimBlueprintBuilder/ABPJsonParser.*"
git commit -m "feat(abp-builder): add JSON parser for AnimBP build spec"
```

---

### Task 3: Validator

**Files:**
- Create: `Private/AnimBlueprintBuilder/ABPValidator.h`
- Create: `Private/AnimBlueprintBuilder/ABPValidator.cpp`

- [ ] **Step 1: Create ABPValidator.h**

```cpp
#pragma once

#include "CoreMinimal.h"

struct FAnimBPBuildSpec;

class FAnimBPValidator
{
public:
    static TArray<FString> Validate(const FAnimBPBuildSpec& Spec);
};
```

- [ ] **Step 2: Implement 10 validation rules**

See spec for full rule list. Accumulate all errors (do not stop at first). Key rules:
1. Exactly one state with `bIsEntry == true`
2. All state IDs unique
3. All transition `from`/`to` reference existing state IDs
4. Animation paths must be loadable via `LoadObject<UAnimSequence>(nullptr, *Path)` -- attempt load during validation and report error if null
5. Variables referenced in conditions exist in the variables array
6. Pipeline contains exactly one `StateMachine` node
7. `time_remaining` conditions only on transitions from non-looping states
8. `blend_time >= 0`
9. Variable types must be "bool"
10. Pipeline node IDs unique

- [ ] **Step 3: Compile and verify**

- [ ] **Step 4: Commit**

```bash
git add "ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/AnimBlueprintBuilder/ABPValidator.*"
git commit -m "feat(abp-builder): add validator with 10 rules"
```

---

### Task 4: Asset Factory

**Files:**
- Create: `Private/AnimBlueprintBuilder/ABPAssetFactory.h`
- Create: `Private/AnimBlueprintBuilder/ABPAssetFactory.cpp`

- [ ] **Step 1: Create ABPAssetFactory.h**

```cpp
#pragma once

#include "CoreMinimal.h"

class UAnimBlueprint;
class USkeleton;

class FAnimBPAssetFactory
{
public:
    static UAnimBlueprint* Create(
        const FString& PackagePath,
        const FString& AssetName,
        USkeleton* Skeleton,
        FString& OutError
    );

    static USkeleton* ResolveSkeleton(const FString& SkeletonPath, FString& OutError);
};
```

- [ ] **Step 2: Implement asset creation**

```cpp
#include "ABPAssetFactory.h"
#include "Animation/AnimBlueprint.h"
#include "Animation/AnimInstance.h"
#include "Animation/Skeleton.h"
#include "Factories/AnimBlueprintFactory.h"
#include "AssetToolsModule.h"
#include "AssetRegistryModule.h"

USkeleton* FAnimBPAssetFactory::ResolveSkeleton(const FString& SkeletonPath, FString& OutError)
{
    USkeleton* Skeleton = LoadObject<USkeleton>(nullptr, *SkeletonPath);
    if (!Skeleton)
    {
        OutError = FString::Printf(TEXT("[AnimBPAssetFactory] skeleton not found: %s"), *SkeletonPath);
    }
    return Skeleton;
}

UAnimBlueprint* FAnimBPAssetFactory::Create(
    const FString& PackagePath,
    const FString& AssetName,
    USkeleton* Skeleton,
    FString& OutError)
{
    if (!Skeleton)
    {
        OutError = TEXT("[AnimBPAssetFactory] skeleton is null");
        return nullptr;
    }

    // Check if asset already exists (use AssetRegistry, not FindObject, to catch unloaded assets)
    FString FullPath = PackagePath / AssetName;
    FAssetRegistryModule& RegistryModule = FModuleManager::LoadModuleChecked<FAssetRegistryModule>("AssetRegistry");
    FString ObjectPath = FullPath + TEXT(".") + AssetName;
    FAssetData ExistingAsset = RegistryModule.Get().GetAssetByObjectPath(FName(*ObjectPath));
    if (ExistingAsset.IsValid())
    {
        OutError = FString::Printf(TEXT("[AnimBPAssetFactory] asset already exists: %s"), *FullPath);
        return nullptr;
    }

    UAnimBlueprintFactory* Factory = NewObject<UAnimBlueprintFactory>();
    Factory->TargetSkeleton = Skeleton;
    Factory->ParentClass = UAnimInstance::StaticClass();

    FAssetToolsModule& AssetToolsModule = FModuleManager::LoadModuleChecked<FAssetToolsModule>("AssetTools");
    UObject* NewAsset = AssetToolsModule.Get().CreateAsset(AssetName, PackagePath, UAnimBlueprint::StaticClass(), Factory);

    UAnimBlueprint* AnimBP = Cast<UAnimBlueprint>(NewAsset);
    if (!AnimBP)
    {
        OutError = TEXT("[AnimBPAssetFactory] failed to create AnimBlueprint asset");
        return nullptr;
    }

    FAssetRegistryModule::AssetCreated(AnimBP);

    UE_LOG(LogTemp, Log, TEXT("[AnimBPAssetFactory] created AnimBP '%s' with skeleton '%s'"),
        *AnimBP->GetName(), *Skeleton->GetName());

    return AnimBP;
}
```

- [ ] **Step 3: Wire into ABPBuilder::Build step 3**

Update `ABPBuilder.cpp` to call `FAnimBPAssetFactory::ResolveSkeleton` and `FAnimBPAssetFactory::Create` in the Build path. The Rebuild path skips this and uses the passed-in AnimBlueprint.

- [ ] **Step 4: Compile and test**

Build the plugin. Call `BuildAnimBlueprintFromJSON` from Python with a valid skeleton path and empty JSON (should create the asset and return the "not yet implemented" error from later pipeline stages). Verify the AnimBP asset appears in the content browser with the correct skeleton.

- [ ] **Step 5: Commit**

```bash
git add "ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/AnimBlueprintBuilder/ABPAssetFactory.*"
git add "ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/AnimBlueprintBuilder/ABPBuilder.cpp"
git commit -m "feat(abp-builder): add asset factory with skeleton resolution"
```

---

### Task 5: Variable Builder

**Files:**
- Create: `Private/AnimBlueprintBuilder/ABPVariableBuilder.h`
- Create: `Private/AnimBlueprintBuilder/ABPVariableBuilder.cpp`

- [ ] **Step 1: Create ABPVariableBuilder**

```cpp
// ABPVariableBuilder.h
#pragma once

#include "CoreMinimal.h"

class UAnimBlueprint;
struct FAnimBPVariableSpec;

class FAnimBPVariableBuilder
{
public:
    static FString AddVariables(
        UAnimBlueprint* AnimBP,
        const TArray<FAnimBPVariableSpec>& Variables
    );
};
```

- [ ] **Step 2: Implement variable creation**

Use `FBlueprintEditorUtils::AddMemberVariable` to add bool variables to the AnimBlueprint. Set default values. The AnimBP must be compiled after variables are added for them to appear in the My Blueprint panel.

```cpp
#include "ABPVariableBuilder.h"
#include "ABPBuildSpec.h"
#include "Animation/AnimBlueprint.h"
#include "Kismet2/BlueprintEditorUtils.h"
#include "EdGraphSchema_K2.h"

FString FAnimBPVariableBuilder::AddVariables(
    UAnimBlueprint* AnimBP,
    const TArray<FAnimBPVariableSpec>& Variables)
{
    if (!AnimBP) return TEXT("[ABPVariableBuilder] AnimBP is null");

    for (const FAnimBPVariableSpec& Var : Variables)
    {
        // Check if variable already exists
        if (FBlueprintEditorUtils::FindMemberVariableGuidByName(AnimBP, FName(*Var.Name)).IsValid())
        {
            continue; // Skip existing variables (for Rebuild path)
        }

        FEdGraphPinType PinType;
        if (Var.Type == TEXT("bool"))
        {
            PinType.PinCategory = UEdGraphSchema_K2::PC_Boolean;
        }
        else
        {
            return FString::Printf(TEXT("[ABPVariableBuilder] unsupported variable type '%s' for '%s'"),
                *Var.Type, *Var.Name);
        }

        bool bSuccess = FBlueprintEditorUtils::AddMemberVariable(AnimBP, FName(*Var.Name), PinType);
        if (!bSuccess)
        {
            return FString::Printf(TEXT("[ABPVariableBuilder] failed to add variable '%s'"), *Var.Name);
        }

        UE_LOG(LogTemp, Log, TEXT("[ABPVariableBuilder] added %s variable '%s'"), *Var.Type, *Var.Name);
    }

    return FString();
}
```

- [ ] **Step 3: Wire into ABPBuilder pipeline step 4**

After asset creation, call `FAnimBPVariableBuilder::AddVariables`, then compile the AnimBP to make variables available for later steps.

- [ ] **Step 4: Compile and test**

Build, call from Python. Verify variables appear in the AnimBP's My Blueprint panel after compilation.

- [ ] **Step 5: Commit**

```bash
git add "ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/AnimBlueprintBuilder/ABPVariableBuilder.*"
git add "ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/AnimBlueprintBuilder/ABPBuilder.cpp"
git commit -m "feat(abp-builder): add variable builder for bool AnimInstance vars"
```

---

### Task 6: Node Registry + AnimGraph Builder

**Files:**
- Create: `Private/AnimBlueprintBuilder/ABPNodeRegistry.h`
- Create: `Private/AnimBlueprintBuilder/ABPNodeRegistry.cpp`
- Create: `Private/AnimBlueprintBuilder/ABPAnimGraphBuilder.h`
- Create: `Private/AnimBlueprintBuilder/ABPAnimGraphBuilder.cpp`

- [ ] **Step 1: Create ABPNodeRegistry**

Registry for v1 AnimGraph node types: `StateMachine` and `Slot`. Maps type strings to UClass pointers and provides defaults.

```cpp
// ABPNodeRegistry.h
#pragma once

#include "CoreMinimal.h"

class UAnimGraphNode_Base;

class FAnimBPNodeRegistry
{
public:
    FAnimBPNodeRegistry();

    bool IsKnownPipelineType(const FString& Type) const;
    TSubclassOf<UAnimGraphNode_Base> GetPipelineNodeClass(const FString& Type) const;

private:
    TMap<FString, TSubclassOf<UAnimGraphNode_Base>> PipelineTypes;
    void RegisterTypes();
};
```

```cpp
// ABPNodeRegistry.cpp
#include "ABPNodeRegistry.h"
// These are AnimGraph module public headers (NOT engine Animation/ headers)
#include "AnimGraphNode_StateMachine.h"
#include "AnimGraphNode_Slot.h"

FAnimBPNodeRegistry::FAnimBPNodeRegistry()
{
    RegisterTypes();
}

void FAnimBPNodeRegistry::RegisterTypes()
{
    PipelineTypes.Add(TEXT("StateMachine"), UAnimGraphNode_StateMachine::StaticClass());
    PipelineTypes.Add(TEXT("Slot"), UAnimGraphNode_Slot::StaticClass());
}

bool FAnimBPNodeRegistry::IsKnownPipelineType(const FString& Type) const
{
    return PipelineTypes.Contains(Type);
}

TSubclassOf<UAnimGraphNode_Base> FAnimBPNodeRegistry::GetPipelineNodeClass(const FString& Type) const
{
    const auto* Found = PipelineTypes.Find(Type);
    return Found ? *Found : nullptr;
}
```

- [ ] **Step 2: Create ABPAnimGraphBuilder**

Builds the AnimGraph pipeline: creates nodes, sets properties, wires pose pins.

```cpp
// ABPAnimGraphBuilder.h
#pragma once

#include "CoreMinimal.h"

struct FAnimBPBuildSpec;
struct FAnimBPBuildContext;

class FAnimBPAnimGraphBuilder
{
public:
    static FString Build(const FAnimBPBuildSpec& Spec, FAnimBPBuildContext& Ctx);
};
```

Implementation must:
1. Find the AnimGraph (first graph in `AnimBP->FunctionGraphs` with AnimationGraphSchema)
2. Find the existing `UAnimGraphNode_Root` in the AnimGraph
3. Create pipeline nodes in order (StateMachine, Slot)
4. Set Slot node's `SlotNodeName` to the `name` from spec
5. Wire pose pins: StateMachine["Pose"] -> Slot["Source"], Slot["Result"] -> Root["Result"]
6. For StateMachine node, call `GetStateMachineGraph()` to get/create the state machine graph, store in context
7. Position nodes with reasonable spacing (X increments of 300)

Pin wiring helper:
```cpp
static UEdGraphPin* FindPinByName(UEdGraphNode* Node, const FString& PinName, EEdGraphPinDirection Dir)
{
    for (UEdGraphPin* Pin : Node->Pins)
    {
        if (Pin->PinName.ToString() == PinName && Pin->Direction == Dir)
            return Pin;
    }
    return nullptr;
}
```

- [ ] **Step 3: Wire into ABPBuilder pipeline step 5**

After variables, call `FAnimBPAnimGraphBuilder::Build`.

- [ ] **Step 4: Compile and test**

Build, call from Python with a JSON that has `anim_graph.pipeline` with StateMachine and Slot. Open the AnimBP in editor and verify the AnimGraph shows three connected nodes (StateMachine -> Slot -> Output Pose).

- [ ] **Step 5: Commit**

```bash
git add "ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/AnimBlueprintBuilder/ABPNodeRegistry.*"
git add "ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/AnimBlueprintBuilder/ABPAnimGraphBuilder.*"
git add "ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/AnimBlueprintBuilder/ABPBuilder.cpp"
git commit -m "feat(abp-builder): add AnimGraph pipeline builder with SM + Slot + Root wiring"
```

---

### Task 7: State Machine Builder (States)

**Files:**
- Create: `Private/AnimBlueprintBuilder/ABPStateMachineBuilder.h`
- Create: `Private/AnimBlueprintBuilder/ABPStateMachineBuilder.cpp`

- [ ] **Step 1: Create ABPStateMachineBuilder**

```cpp
// ABPStateMachineBuilder.h
#pragma once

#include "CoreMinimal.h"

struct FAnimBPBuildSpec;
struct FAnimBPBuildContext;

class FAnimBPStateMachineBuilder
{
public:
    // Phase 1: Create states with SequencePlayer nodes
    static FString BuildStates(const FAnimBPBuildSpec& Spec, FAnimBPBuildContext& Ctx);

    // Phase 2: Create transitions with conditions
    static FString BuildTransitions(const FAnimBPBuildSpec& Spec, FAnimBPBuildContext& Ctx);
};
```

- [ ] **Step 2: Implement BuildStates**

For each state in `Spec.States`:
1. Create `UAnimStateNode` in `Ctx.StateMachineGraph`
2. Call `AllocateDefaultPins()`
3. Set `Node->GetBoundGraph()` or create `UAnimationStateGraph` for the state
4. Inside the state graph: create `UAnimGraphNode_SequencePlayer`
5. Load the AnimSequence via `LoadObject<UAnimSequence>(nullptr, *Animation)`
6. Set `SequencePlayer.Node.Sequence` and `SequencePlayer.Node.bLoopAnimation`
7. Wire SequencePlayer output to the state's `UAnimGraphNode_StateResult` input
8. Store in `Ctx.StateNodeMap[StateId] = StateNode`
9. For the entry state (`bIsEntry == true`): wire `StateMachineGraph->EntryNode` output pin to the entry state's input pin
10. Position state nodes in a grid layout

- [ ] **Step 3: Wire into ABPBuilder after AnimGraph build**

Call `FAnimBPStateMachineBuilder::BuildStates` after `FAnimBPAnimGraphBuilder::Build`.

- [ ] **Step 4: Compile and test**

Build, call from Python with states defined. Open the AnimBP's state machine and verify:
- 5 states visible with correct names
- Each state has an animation assigned
- Entry arrow points to FPP_Idle
- Looping flags correct

- [ ] **Step 5: Commit**

```bash
git add "ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/AnimBlueprintBuilder/ABPStateMachineBuilder.*"
git add "ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/AnimBlueprintBuilder/ABPBuilder.cpp"
git commit -m "feat(abp-builder): add state machine builder with states and sequence players"
```

---

### Task 8: Transitions with Bool Variable Conditions

**Files:**
- Modify: `Private/AnimBlueprintBuilder/ABPStateMachineBuilder.cpp`

- [ ] **Step 1: Implement BuildTransitions**

For each transition in `Spec.Transitions`:
1. Look up `from` and `to` state nodes in `Ctx.StateNodeMap`
2. Create `UAnimStateTransitionNode` in `Ctx.StateMachineGraph`
3. Call `AllocateDefaultPins()`
4. Wire: `FromState.OutputPin -> Transition.InputPin`, `Transition.OutputPin -> ToState.InputPin`
5. Set `Transition->CrossfadeDuration = BlendTime`

For `bool_variable` conditions:
6. Get the transition's bound graph (`UAnimationTransitionGraph`)
7. Find the `UAnimGraphNode_TransitionResult` in the transition graph
8. Create a `UK2Node_VariableGet` for the AnimInstance bool variable. **Important:** The variable must already exist in the AnimInstance generated class (added in Task 5 and compiled). The variable getter resolves against `self` context (the AnimInstance), so the AnimBP must have been compiled at least once after variable creation.
9. Wire the bool output pin to `TransitionResult.bCanEnterTransition` input
10. For `value: false`: insert a NOT node between getter and result

- [ ] **Step 2: Wire into ABPBuilder after BuildStates**

Call `FAnimBPStateMachineBuilder::BuildTransitions`.

- [ ] **Step 3: Compile and test**

Build, call with transitions defined. Open state machine editor and verify:
- Transition arrows between correct states
- Double-click a transition to see the condition graph
- Bool variable getter wired to transition result

- [ ] **Step 4: Commit**

```bash
git add "ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/AnimBlueprintBuilder/ABPStateMachineBuilder.cpp"
git add "ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/AnimBlueprintBuilder/ABPBuilder.cpp"
git commit -m "feat(abp-builder): add transitions with bool variable conditions"
```

---

### Task 9: TimeRemaining Conditions + Blend Times

**Files:**
- Modify: `Private/AnimBlueprintBuilder/ABPStateMachineBuilder.cpp`

- [ ] **Step 1: Add time_remaining handling**

For transitions with `condition.type == "time_remaining"`:
- Do NOT build a condition graph. Instead, set properties on the `UAnimStateTransitionNode`:

```cpp
TransitionNode->bAutomaticRuleBasedOnSequencePlayerInState = true;
TransitionNode->AutomaticRuleTriggerTime = Condition.Threshold;
```

This uses UE4's built-in automatic transition rule which fires when the source state's sequence player has less than `AutomaticRuleTriggerTime` seconds remaining.

- [ ] **Step 2: Compile and test**

Build, call with the full FirstPerson state machine JSON (5 states, 7 transitions). Open in editor and verify:
- JumpStart->JumpLoop transition shows "Automatic Rule" in the transition details
- JumpEnd->Idle transition shows "Automatic Rule"
- Blend times are set correctly on all transitions

- [ ] **Step 3: Commit**

```bash
git add "ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/AnimBlueprintBuilder/ABPStateMachineBuilder.cpp"
git commit -m "feat(abp-builder): add time_remaining auto-transitions and blend times"
```

---

### Task 10: Event Graph Delegation + Final Compile

**Files:**
- Modify: `Private/AnimBlueprintBuilder/ABPBuilder.cpp`

- [ ] **Step 1: Implement event graph forwarding**

If `Spec.EventGraphJson` is non-empty, find the AnimBP's event graph (the UEdGraph with K2 schema) and forward the JSON to the existing `UBlueprintGraphBuilderLibrary::BuildBlueprintFromJSON`. This requires getting the AnimBP as a UBlueprint (which it is -- UAnimBlueprint extends UBlueprint).

```cpp
if (!Spec.EventGraphJson.IsEmpty())
{
    // AnimBlueprint IS a UBlueprint, so BlueprintGraphBuilder can operate on it
    FString EventError = UBlueprintGraphBuilderLibrary::BuildBlueprintFromJSON(
        AnimBP, Spec.EventGraphJson);
    if (!EventError.IsEmpty())
    {
        return FString::Printf(TEXT("[AnimBPBuilder] event graph error: %s"), *EventError);
    }
}
```

- [ ] **Step 2: Add final compile step**

```cpp
FKismetEditorUtilities::CompileBlueprint(AnimBP);
AnimBP->MarkPackageDirty();
```

- [ ] **Step 3: Complete the full pipeline in ABPBuilder::Build**

Replace the stub with the complete method. This is the final form:

```cpp
FString FAnimBPBuilder::Build(
    const FString& PackagePath, const FString& AssetName,
    const FString& SkeletonPath, const FString& JsonString)
{
    // 1. PARSE
    FAnimBPBuildSpec Spec;
    FString ParseError = FAnimBPJsonParser::Parse(JsonString, Spec);
    if (!ParseError.IsEmpty()) return ParseError;

    // 2. VALIDATE
    TArray<FString> Errors = FAnimBPValidator::Validate(Spec);
    if (Errors.Num() > 0) return FString::Join(Errors, TEXT("\n"));

    // 3. CREATE ASSET
    FString SkeletonError;
    USkeleton* Skeleton = FAnimBPAssetFactory::ResolveSkeleton(SkeletonPath, SkeletonError);
    if (!Skeleton) return SkeletonError;

    FString AssetError;
    UAnimBlueprint* AnimBP = FAnimBPAssetFactory::Create(PackagePath, AssetName, Skeleton, AssetError);
    if (!AnimBP) return AssetError;

    // 4. VARIABLES + intermediate compile
    FString VarError = FAnimBPVariableBuilder::AddVariables(AnimBP, Spec.Variables);
    if (!VarError.IsEmpty()) return VarError;
    FKismetEditorUtilities::CompileBlueprint(AnimBP);

    // 5. BUILD CONTEXT
    FAnimBPBuildContext Ctx;
    Ctx.AnimBlueprint = AnimBP;
    Ctx.Skeleton = Skeleton;
    Ctx.Registry = &Registry;

    // 6. ANIM GRAPH pipeline
    FString GraphError = FAnimBPAnimGraphBuilder::Build(Spec, Ctx);
    if (!GraphError.IsEmpty()) return GraphError;

    // 7. STATES
    FString StateError = FAnimBPStateMachineBuilder::BuildStates(Spec, Ctx);
    if (!StateError.IsEmpty()) return StateError;

    // 8. TRANSITIONS
    FString TransError = FAnimBPStateMachineBuilder::BuildTransitions(Spec, Ctx);
    if (!TransError.IsEmpty()) return TransError;

    // 9. EVENT GRAPH (delegate to BlueprintGraphBuilder)
    if (!Spec.EventGraphJson.IsEmpty())
    {
        FString EventError = UBlueprintGraphBuilderLibrary::BuildBlueprintFromJSON(
            AnimBP, Spec.EventGraphJson);
        if (!EventError.IsEmpty())
            return FString::Printf(TEXT("[AnimBPBuilder] event graph: %s"), *EventError);
    }

    // 10. FINAL COMPILE
    FKismetEditorUtilities::CompileBlueprint(AnimBP);
    AnimBP->MarkPackageDirty();

    UE_LOG(LogTemp, Log, TEXT("[AnimBPBuilder] built AnimBP '%s'"), *AnimBP->GetName());
    return FString();
}
```

- [ ] **Step 4: Wire Validate() and Rebuild()**

```cpp
FString FAnimBPBuilder::Validate(const FString& JsonString)
{
    FAnimBPBuildSpec Spec;
    FString ParseError = FAnimBPJsonParser::Parse(JsonString, Spec);
    if (!ParseError.IsEmpty()) return ParseError;

    TArray<FString> Errors = FAnimBPValidator::Validate(Spec);
    if (Errors.Num() > 0) return FString::Join(Errors, TEXT("\n"));

    return FString(); // Valid
}

FString FAnimBPBuilder::Rebuild(UAnimBlueprint* AnimBP, const FString& JsonString)
{
    if (!AnimBP) return TEXT("[AnimBPBuilder] AnimBlueprint is null");

    // Parse + validate
    FAnimBPBuildSpec Spec;
    FString ParseError = FAnimBPJsonParser::Parse(JsonString, Spec);
    if (!ParseError.IsEmpty()) return ParseError;

    TArray<FString> Errors = FAnimBPValidator::Validate(Spec);
    if (Errors.Num() > 0) return FString::Join(Errors, TEXT("\n"));

    // Variables (add missing only, skip existing)
    FString VarError = FAnimBPVariableBuilder::AddVariables(AnimBP, Spec.Variables);
    if (!VarError.IsEmpty()) return VarError;
    FKismetEditorUtilities::CompileBlueprint(AnimBP);

    // Build context
    FAnimBPBuildContext Ctx;
    Ctx.AnimBlueprint = AnimBP;
    Ctx.Skeleton = AnimBP->TargetSkeleton;
    Ctx.Registry = &Registry;

    // TODO: Clear existing AnimGraph and state machine nodes before rebuilding
    // For v1, Rebuild assumes a clean AnimBP (no existing graph nodes to clear)

    // Same build steps as Build (6-10)
    FString GraphError = FAnimBPAnimGraphBuilder::Build(Spec, Ctx);
    if (!GraphError.IsEmpty()) return GraphError;

    FString StateError = FAnimBPStateMachineBuilder::BuildStates(Spec, Ctx);
    if (!StateError.IsEmpty()) return StateError;

    FString TransError = FAnimBPStateMachineBuilder::BuildTransitions(Spec, Ctx);
    if (!TransError.IsEmpty()) return TransError;

    if (!Spec.EventGraphJson.IsEmpty())
    {
        FString EventError = UBlueprintGraphBuilderLibrary::BuildBlueprintFromJSON(
            AnimBP, Spec.EventGraphJson);
        if (!EventError.IsEmpty())
            return FString::Printf(TEXT("[AnimBPBuilder] event graph: %s"), *EventError);
    }

    FKismetEditorUtilities::CompileBlueprint(AnimBP);
    AnimBP->MarkPackageDirty();

    return FString();
}
```

- [ ] **Step 4: Compile and test**

Build, call with complete FirstPerson_AnimBP JSON (all sections). Verify the AnimBP compiles without errors and all graphs are populated.

- [ ] **Step 5: Commit**

```bash
git add "ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/AnimBlueprintBuilder/ABPBuilder.cpp"
git commit -m "feat(abp-builder): add event graph delegation and final compile step"
```

---

### Task 11: Integration Test -- FirstPerson_AnimBP Recreation

**Files:**
- Create: test JSON file or Python test script

- [ ] **Step 1: Create complete FirstPerson_AnimBP JSON**

Write the full JSON spec that recreates the FirstPerson_AnimBP: 2 bool variables, SM+Slot pipeline, 5 states with animations, 7 transitions (4 bool_variable + 3 time_remaining), event graph with BlueprintUpdateAnimation logic.

- [ ] **Step 2: Call BuildAnimBlueprintFromJSON from Python**

```python
import unreal

json_string = open("path/to/first_person_animbp.json").read()
result = unreal.AnimBlueprintBuilderLibrary.build_anim_blueprint_from_json(
    "/Game/Test",
    "TestAnimBP",
    "/Game/FirstPerson/Character/Mesh/SK_Mannequin_Arms_Skeleton",
    json_string
)
print(f"Result: {result}")
```

- [ ] **Step 3: Verify in editor**

Open the created AnimBP and verify:
- Skeleton is SK_Mannequin_Arms_Skeleton
- Variables: IsMoving (bool), bIsInAir (bool) visible in My Blueprint
- AnimGraph: StateMachine -> Slot("Arms") -> Output Pose
- State machine: 5 states, entry on FPP_Idle, correct animations
- Transitions: 7 transitions with correct conditions
- Event graph: BlueprintUpdateAnimation with pawn movement logic
- AnimBP compiles without errors

- [ ] **Step 4: Compare against reference**

Open the original FirstPerson_AnimBP side by side and verify structural equivalence: same states, same transitions, same variable logic.

- [ ] **Step 5: Commit**

```bash
git add unreal-plugin/Content/Python/tests/data/first_person_animbp.json
git commit -m "test(abp-builder): add FirstPerson_AnimBP integration test"
```

---

### Task 12: MCP Tool + Python Handler

**Files:**
- Modify: `unreal-plugin/Content/Python/mcp_bridge/handlers/blueprints.py`
- Modify: `unreal-plugin/Content/Python/mcp_bridge/router.py`
- Modify: `mcp-server/src/tools/blueprints.ts`
- Modify: `mcp-server/src/index.ts`

- [ ] **Step 1: Add Python handler**

Add `handle_anim_blueprint_build_from_json` handler in `handlers/blueprints.py`. Follows the same pattern as the existing `handle_blueprint_build_from_json`. Calls `unreal.AnimBlueprintBuilderLibrary.build_anim_blueprint_from_json()`.

- [ ] **Step 2: Register route**

Add `"anim_blueprint_build_from_json"` to `COMMAND_ROUTES` in `router.py`.

- [ ] **Step 3: Add TypeScript tool definition**

Add `anim_blueprint_build_from_json` tool in `tools/blueprints.ts` with Zod schema for `package_path`, `asset_name`, `skeleton_path`, `json_spec` parameters.

- [ ] **Step 4: Register as modifying command**

Add to `modifyingCommands` set in `index.ts`.

- [ ] **Step 5: Test end-to-end via MCP**

Call the tool through Claude Code's MCP bridge. Verify the AnimBP is created correctly.

- [ ] **Step 6: Commit**

```bash
git add unreal-plugin/Content/Python/mcp_bridge/handlers/blueprints.py
git add unreal-plugin/Content/Python/mcp_bridge/router.py
git add mcp-server/src/tools/blueprints.ts
git add mcp-server/src/index.ts
git commit -m "feat(abp-builder): add MCP tool for AnimBP building"
```

---

### Task 13: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add AnimBP Builder to Architecture section**

Add paragraph under BlueprintGraphBuilder C++ Plugin describing the AnimBP builder subsystem, its capabilities, and supported node types.

- [ ] **Step 2: Add to Active Workstreams table**

Add AnimBP Builder row with location, status, and spec path.

- [ ] **Step 3: Add to modifyingCommands list**

Document `anim_blueprint_build_from_json` as a modifying command.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add AnimBP Builder to architecture and workstreams"
```
