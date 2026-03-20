# Behavior Tree Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build C++ Behavior Tree node graph builder that turns JSON into runtime BT nodes, wired with blackboard bindings, and synced to editor graph for visual inspection.

**Architecture:** JSON is parsed into `FBTBuildSpec`, validated against a node type registry and blackboard, then built as runtime UBT nodes in two phases (create + wire). Editor graph reconstruction is a post-build, editor-only derivation. Python integration calls the C++ builder after creating BT assets, with graceful degradation if plugin is not loaded.

**Tech Stack:** UE4.27 C++ (AIModule, BehaviorTreeEditor), Python (UE4 Python API), existing BlueprintGraphBuilder plugin

**Spec:** `docs/superpowers/specs/2026-03-19-behavior-tree-builder-design.md`

---

## File Map

### New C++ files (all under `ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/`)

| File | Responsibility |
|---|---|
| `Private/BehaviorTreeBuilder/BTBuildSpec.h` | `FBTNodeSpec`, `FBTBuildSpec`, `FBTBuildContext` structs |
| `Private/BehaviorTreeBuilder/BTNodeRegistry.h` | `FBTNodeRegistry` class declaration |
| `Private/BehaviorTreeBuilder/BTNodeRegistry.cpp` | Type registration, default params, BB key requirements, `ApplyParams()` |
| `Private/BehaviorTreeBuilder/BTJsonParser.h` | `FBTJsonParser` static parse interface |
| `Private/BehaviorTreeBuilder/BTJsonParser.cpp` | JSON string to `FBTBuildSpec` recursive parsing |
| `Private/BehaviorTreeBuilder/BTValidator.h` | `FBTValidator` static validate interface |
| `Private/BehaviorTreeBuilder/BTValidator.cpp` | 9 validation rules, error accumulation |
| `Private/BehaviorTreeBuilder/BTNodeFactory.h` | `FBTNodeFactory` static build interface |
| `Private/BehaviorTreeBuilder/BTNodeFactory.cpp` | Two-phase node creation + wiring |
| `Private/BehaviorTreeBuilder/BTEditorGraphSync.h` | `FBTEditorGraphSync` static sync interface |
| `Private/BehaviorTreeBuilder/BTEditorGraphSync.cpp` | Editor graph reconstruction from runtime tree |
| `Private/BehaviorTreeBuilder/BTBuilder.h` | `FBTBuilder` orchestrator class declaration |
| `Private/BehaviorTreeBuilder/BTBuilder.cpp` | Parse -> validate -> build -> commit -> sync pipeline |
| `Public/BehaviorTreeBuilderLibrary.h` | `UBehaviorTreeBuilderLibrary` UCLASS declaration |
| `Private/BehaviorTreeBuilderLibrary.cpp` | Thin wrapper calling `FBTBuilder::Build()` |

### Modified files

| File | Change |
|---|---|
| `ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/BlueprintGraphBuilder.Build.cs` (line 16-31) | Add `AIModule`, `GameplayTasks`; add `BehaviorTreeEditor` conditionally |
| `unreal-plugin/Content/Python/mcp_bridge/generation/ai_generator.py` (lines 69-102) | Add C++ builder call after BT asset creation |
| `unreal-plugin/Content/Python/mcp_bridge/generation/mechanics/enemy_patrol.py` (lines 73-91) | Upgrade `root` to new JSON schema with ids, decorators, correct params |
| `unreal-plugin/Content/Python/mcp_bridge/generation/spec_schema.py` (lines 120-123) | Update `BehaviorTreeSpec.root` docstring |
| `unreal-plugin/Content/Python/tests/test_mechanics.py` (lines 146-152) | Add BT root structure assertions |

---

## Task 1: Build.cs Dependencies

**Files:**
- Modify: `ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/BlueprintGraphBuilder.Build.cs:16-31`

- [ ] **Step 1: Add AIModule, GameplayTasks, and conditional BehaviorTreeEditor**

Replace lines 16-31 with:

```csharp
        PrivateDependencyModuleNames.AddRange(new string[]
        {
            "UnrealEd",
            "BlueprintGraph",
            "KismetCompiler",
            "Kismet",
            "GraphEditor",
            "Json",
            "JsonUtilities",
            "UMG",
            "UMGEditor",
            "Slate",
            "SlateCore",
            "MovieScene",
            "MovieSceneTracks",
            "AIModule",
            "GameplayTasks",
        });

        if (Target.bBuildEditor)
        {
            PrivateDependencyModuleNames.Add("BehaviorTreeEditor");
        }
```

- [ ] **Step 2: Commit**

```bash
git add ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/BlueprintGraphBuilder.Build.cs
git commit -m "feat(bt-builder): add AIModule, GameplayTasks, BehaviorTreeEditor deps"
```

---

## Task 2: BTBuildSpec Data Structures

**Files:**
- Create: `ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BehaviorTreeBuilder/BTBuildSpec.h`

- [ ] **Step 1: Create the spec structs header**

```cpp
#pragma once

#include "CoreMinimal.h"

class UBehaviorTree;
class UBlackboardData;
class UBTNode;
class FBTNodeRegistry;

struct FBTNodeSpec
{
	FString Id;
	FString Type;
	FString Name;
	TMap<FString, FString> Params;
	TArray<FBTNodeSpec> Children;
	TArray<FBTNodeSpec> Decorators;
	TArray<FBTNodeSpec> Services;  // parsed, ignored in MVP
};

struct FBTBuildSpec
{
	FBTNodeSpec Root;
};

struct FBTBuildContext
{
	UBehaviorTree* BehaviorTree = nullptr;
	UBlackboardData* Blackboard = nullptr;
	const FBTNodeRegistry* Registry = nullptr;
	TMap<FString, UBTNode*> NodeMap;  // Id -> created node instance
};
```

- [ ] **Step 2: Commit**

```bash
git add ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BehaviorTreeBuilder/BTBuildSpec.h
git commit -m "feat(bt-builder): add FBTNodeSpec, FBTBuildSpec, FBTBuildContext structs"
```

---

## Task 3: BTNodeRegistry

**Files:**
- Create: `ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BehaviorTreeBuilder/BTNodeRegistry.h`
- Create: `ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BehaviorTreeBuilder/BTNodeRegistry.cpp`

- [ ] **Step 1: Create registry header**

```cpp
#pragma once

#include "CoreMinimal.h"

class UBTCompositeNode;
class UBTTaskNode;
class UBTDecorator;
class UBTNode;
class UBlackboardData;

class FBTNodeRegistry
{
public:
	FBTNodeRegistry();

	bool IsComposite(const FString& Type) const;
	bool IsTask(const FString& Type) const;
	bool IsDecorator(const FString& Type) const;
	bool IsKnownType(const FString& Type) const;

	TSubclassOf<UBTCompositeNode> GetCompositeClass(const FString& Type) const;
	TSubclassOf<UBTTaskNode> GetTaskClass(const FString& Type) const;
	TSubclassOf<UBTDecorator> GetDecoratorClass(const FString& Type) const;

	const TMap<FString, FString>* GetDefaultParams(const FString& Type) const;
	const TMap<FString, TSet<FString>>* GetBBKeyRequirements(const FString& Type) const;

	/** Apply params to a created node. Handles BlackboardKeySelector resolution. */
	void ApplyParams(
		UBTNode* Node,
		const FString& Type,
		const TMap<FString, FString>& Params,
		UBlackboardData* Blackboard
	) const;

private:
	TMap<FString, TSubclassOf<UBTCompositeNode>> CompositeTypes;
	TMap<FString, TSubclassOf<UBTTaskNode>> TaskTypes;
	TMap<FString, TSubclassOf<UBTDecorator>> DecoratorTypes;

	TMap<FString, TMap<FString, FString>> DefaultParams;
	TMap<FString, TMap<FString, TSet<FString>>> BBKeyTypeRequirements;

	void RegisterTypes();
};
```

- [ ] **Step 2: Create registry implementation**

```cpp
#include "BTNodeRegistry.h"
#include "BehaviorTree/BTCompositeNode.h"
#include "BehaviorTree/BTTaskNode.h"
#include "BehaviorTree/BTDecorator.h"
#include "BehaviorTree/Composites/BTComposite_Selector.h"
#include "BehaviorTree/Composites/BTComposite_Sequence.h"
#include "BehaviorTree/Tasks/BTTask_MoveTo.h"
#include "BehaviorTree/Tasks/BTTask_Wait.h"
#include "BehaviorTree/Decorators/BTDecorator_Blackboard.h"
#include "BehaviorTree/BlackboardData.h"
#include "BehaviorTree/Blackboard/BlackboardKeyType_Object.h"
#include "BehaviorTree/Blackboard/BlackboardKeyType_Vector.h"

FBTNodeRegistry::FBTNodeRegistry()
{
	RegisterTypes();
}

void FBTNodeRegistry::RegisterTypes()
{
	// Composites
	CompositeTypes.Add(TEXT("Selector"), UBTComposite_Selector::StaticClass());
	CompositeTypes.Add(TEXT("Sequence"), UBTComposite_Sequence::StaticClass());

	// Tasks
	TaskTypes.Add(TEXT("MoveTo"), UBTTask_MoveTo::StaticClass());
	TaskTypes.Add(TEXT("Wait"), UBTTask_Wait::StaticClass());

	// Decorators
	DecoratorTypes.Add(TEXT("Blackboard"), UBTDecorator_Blackboard::StaticClass());

	// Default params
	{
		TMap<FString, FString> MoveToDefaults;
		MoveToDefaults.Add(TEXT("acceptable_radius"), TEXT("50.0"));
		DefaultParams.Add(TEXT("MoveTo"), MoveToDefaults);
	}
	{
		TMap<FString, FString> WaitDefaults;
		WaitDefaults.Add(TEXT("wait_time"), TEXT("5.0"));
		WaitDefaults.Add(TEXT("random_deviation"), TEXT("0.0"));
		DefaultParams.Add(TEXT("Wait"), WaitDefaults);
	}

	// BB key type requirements
	{
		TMap<FString, TSet<FString>> MoveToReqs;
		TSet<FString> MoveToKeyTypes;
		MoveToKeyTypes.Add(TEXT("Object"));
		MoveToKeyTypes.Add(TEXT("Vector"));
		MoveToReqs.Add(TEXT("blackboard_key"), MoveToKeyTypes);
		BBKeyTypeRequirements.Add(TEXT("MoveTo"), MoveToReqs);
	}
}

bool FBTNodeRegistry::IsComposite(const FString& Type) const
{
	return CompositeTypes.Contains(Type);
}

bool FBTNodeRegistry::IsTask(const FString& Type) const
{
	return TaskTypes.Contains(Type);
}

bool FBTNodeRegistry::IsDecorator(const FString& Type) const
{
	return DecoratorTypes.Contains(Type);
}

bool FBTNodeRegistry::IsKnownType(const FString& Type) const
{
	return IsComposite(Type) || IsTask(Type) || IsDecorator(Type);
}

TSubclassOf<UBTCompositeNode> FBTNodeRegistry::GetCompositeClass(const FString& Type) const
{
	const auto* Found = CompositeTypes.Find(Type);
	return Found ? *Found : nullptr;
}

TSubclassOf<UBTTaskNode> FBTNodeRegistry::GetTaskClass(const FString& Type) const
{
	const auto* Found = TaskTypes.Find(Type);
	return Found ? *Found : nullptr;
}

TSubclassOf<UBTDecorator> FBTNodeRegistry::GetDecoratorClass(const FString& Type) const
{
	const auto* Found = DecoratorTypes.Find(Type);
	return Found ? *Found : nullptr;
}

const TMap<FString, FString>* FBTNodeRegistry::GetDefaultParams(const FString& Type) const
{
	return DefaultParams.Find(Type);
}

const TMap<FString, TSet<FString>>* FBTNodeRegistry::GetBBKeyRequirements(const FString& Type) const
{
	return BBKeyTypeRequirements.Find(Type);
}

void FBTNodeRegistry::ApplyParams(
	UBTNode* Node,
	const FString& Type,
	const TMap<FString, FString>& Params,
	UBlackboardData* Blackboard) const
{
	if (!Node) return;

	// Merge defaults with explicit params (explicit wins)
	TMap<FString, FString> Merged;
	const TMap<FString, FString>* Defaults = GetDefaultParams(Type);
	if (Defaults)
	{
		Merged = *Defaults;
	}
	for (const auto& Pair : Params)
	{
		Merged.Add(Pair.Key, Pair.Value);
	}

	if (Type == TEXT("MoveTo"))
	{
		UBTTask_MoveTo* MoveToNode = Cast<UBTTask_MoveTo>(Node);
		if (!MoveToNode) return;

		if (const FString* KeyName = Merged.Find(TEXT("blackboard_key")))
		{
			MoveToNode->BlackboardKey.SelectedKeyName = FName(**KeyName);
			if (Blackboard)
			{
				MoveToNode->BlackboardKey.ResolveSelectedKey(*Blackboard);
			}
		}
		if (const FString* Radius = Merged.Find(TEXT("acceptable_radius")))
		{
			MoveToNode->AcceptableRadius = FCString::Atof(**Radius);
		}
	}
	else if (Type == TEXT("Wait"))
	{
		UBTTask_Wait* WaitNode = Cast<UBTTask_Wait>(Node);
		if (!WaitNode) return;

		if (const FString* Time = Merged.Find(TEXT("wait_time")))
		{
			WaitNode->WaitTime = FCString::Atof(**Time);
		}
		if (const FString* Dev = Merged.Find(TEXT("random_deviation")))
		{
			WaitNode->RandomDeviation = FCString::Atof(**Dev);
		}
	}
	else if (Type == TEXT("Blackboard"))
	{
		UBTDecorator_Blackboard* BBDec = Cast<UBTDecorator_Blackboard>(Node);
		if (!BBDec) return;

		if (const FString* KeyName = Merged.Find(TEXT("blackboard_key")))
		{
			BBDec->BlackboardKey.SelectedKeyName = FName(**KeyName);
			if (Blackboard)
			{
				BBDec->BlackboardKey.ResolveSelectedKey(*Blackboard);
			}
		}
		if (const FString* Condition = Merged.Find(TEXT("condition")))
		{
			if (*Condition == TEXT("IsSet"))
			{
				BBDec->BasicOperation = EBasicKeyOperation::Set;
			}
			else if (*Condition == TEXT("IsNotSet"))
			{
				BBDec->BasicOperation = EBasicKeyOperation::NotSet;
			}
		}
	}
}
```

**UE4.27 API notes for the implementer:**
- `UBTTask_MoveTo::BlackboardKey` is a `FBlackboardKeySelector`. Setting `SelectedKeyName` then calling `ResolveSelectedKey(*BB)` binds it to the actual BB entry.
- `UBTTask_Wait::WaitTime` and `RandomDeviation` are public floats.
- `UBTDecorator_Blackboard::BlackboardKey` is also a `FBlackboardKeySelector`. `BasicOperation` is `EBasicKeyOperation::Type`.
- If any of these property names differ in your UE4.27 build, check the class headers in `Engine/Source/Runtime/AIModule/Classes/BehaviorTree/`.

- [ ] **Step 3: Commit**

```bash
git add ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BehaviorTreeBuilder/BTNodeRegistry.h
git add ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BehaviorTreeBuilder/BTNodeRegistry.cpp
git commit -m "feat(bt-builder): add BTNodeRegistry with MVP type maps and param application"
```

---

## Task 4: BTJsonParser

**Files:**
- Create: `ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BehaviorTreeBuilder/BTJsonParser.h`
- Create: `ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BehaviorTreeBuilder/BTJsonParser.cpp`

- [ ] **Step 1: Create parser header**

```cpp
#pragma once

#include "CoreMinimal.h"

struct FBTBuildSpec;

class FBTJsonParser
{
public:
	/** Parse JSON string into FBTBuildSpec. Returns empty string on success, error on failure. */
	static FString Parse(const FString& JsonString, FBTBuildSpec& OutSpec);
};
```

- [ ] **Step 2: Create parser implementation**

```cpp
#include "BTJsonParser.h"
#include "BTBuildSpec.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"

static FString ParseNode(const TSharedPtr<FJsonObject>& NodeObj, FBTNodeSpec& OutNode, const FString& Path)
{
	if (!NodeObj.IsValid())
	{
		return FString::Printf(TEXT("[BTJsonParser] null node at %s"), *Path);
	}

	// id (required)
	if (!NodeObj->TryGetStringField(TEXT("id"), OutNode.Id) || OutNode.Id.IsEmpty())
	{
		return FString::Printf(TEXT("[BTJsonParser] missing or empty 'id' at %s"), *Path);
	}

	// type (required)
	if (!NodeObj->TryGetStringField(TEXT("type"), OutNode.Type) || OutNode.Type.IsEmpty())
	{
		return FString::Printf(TEXT("[BTJsonParser] missing or empty 'type' at %s/%s"), *Path, *OutNode.Id);
	}

	// name (optional)
	NodeObj->TryGetStringField(TEXT("name"), OutNode.Name);

	// params (optional)
	const TSharedPtr<FJsonObject>* ParamsObj = nullptr;
	if (NodeObj->TryGetObjectField(TEXT("params"), ParamsObj) && ParamsObj->IsValid())
	{
		for (const auto& Pair : (*ParamsObj)->Values)
		{
			FString Value;
			if (Pair.Value->TryGetString(Value))
			{
				OutNode.Params.Add(Pair.Key, Value);
			}
			else
			{
				// Convert numbers and booleans to string
				double NumVal;
				if (Pair.Value->TryGetNumber(NumVal))
				{
					OutNode.Params.Add(Pair.Key, FString::SanitizeFloat(NumVal));
				}
				else
				{
					bool BoolVal;
					if (Pair.Value->TryGetBool(BoolVal))
					{
						OutNode.Params.Add(Pair.Key, BoolVal ? TEXT("true") : TEXT("false"));
					}
				}
			}
		}
	}

	FString NodePath = FString::Printf(TEXT("%s/%s"), *Path, *OutNode.Id);

	// children (optional)
	const TArray<TSharedPtr<FJsonValue>>* ChildrenArr = nullptr;
	if (NodeObj->TryGetArrayField(TEXT("children"), ChildrenArr))
	{
		for (int32 i = 0; i < ChildrenArr->Num(); ++i)
		{
			const TSharedPtr<FJsonObject>* ChildObj = nullptr;
			if (!(*ChildrenArr)[i]->TryGetObject(ChildObj))
			{
				return FString::Printf(TEXT("[BTJsonParser] child %d is not an object at %s"), i, *NodePath);
			}
			FBTNodeSpec ChildSpec;
			FString ChildError = ParseNode(*ChildObj, ChildSpec, NodePath);
			if (!ChildError.IsEmpty()) return ChildError;
			OutNode.Children.Add(MoveTemp(ChildSpec));
		}
	}

	// decorators (optional)
	const TArray<TSharedPtr<FJsonValue>>* DecoratorsArr = nullptr;
	if (NodeObj->TryGetArrayField(TEXT("decorators"), DecoratorsArr))
	{
		for (int32 i = 0; i < DecoratorsArr->Num(); ++i)
		{
			const TSharedPtr<FJsonObject>* DecObj = nullptr;
			if (!(*DecoratorsArr)[i]->TryGetObject(DecObj))
			{
				return FString::Printf(TEXT("[BTJsonParser] decorator %d is not an object at %s"), i, *NodePath);
			}
			FBTNodeSpec DecSpec;
			FString DecError = ParseNode(*DecObj, DecSpec, NodePath + TEXT("/decorators"));
			if (!DecError.IsEmpty()) return DecError;
			OutNode.Decorators.Add(MoveTemp(DecSpec));
		}
	}

	// services (optional, parsed but ignored in MVP)
	const TArray<TSharedPtr<FJsonValue>>* ServicesArr = nullptr;
	if (NodeObj->TryGetArrayField(TEXT("services"), ServicesArr))
	{
		for (int32 i = 0; i < ServicesArr->Num(); ++i)
		{
			const TSharedPtr<FJsonObject>* SvcObj = nullptr;
			if (!(*ServicesArr)[i]->TryGetObject(SvcObj))
			{
				continue;  // services are best-effort in MVP
			}
			FBTNodeSpec SvcSpec;
			ParseNode(*SvcObj, SvcSpec, NodePath + TEXT("/services"));
			OutNode.Services.Add(MoveTemp(SvcSpec));
		}
	}

	return FString();
}

FString FBTJsonParser::Parse(const FString& JsonString, FBTBuildSpec& OutSpec)
{
	TSharedPtr<FJsonObject> RootObj;
	TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(JsonString);

	if (!FJsonSerializer::Deserialize(Reader, RootObj) || !RootObj.IsValid())
	{
		return TEXT("[BTJsonParser] failed to parse JSON");
	}

	const TSharedPtr<FJsonObject>* RootNodeObj = nullptr;
	if (!RootObj->TryGetObjectField(TEXT("root"), RootNodeObj))
	{
		return TEXT("[BTJsonParser] missing 'root' field");
	}

	return ParseNode(*RootNodeObj, OutSpec.Root, TEXT("root"));
}
```

**Implementation note:** Params are stored as `TMap<FString, FString>`. Numeric values (like `acceptable_radius: 100.0`) are converted to string at parse time and parsed back to float in `ApplyParams()`. This keeps the spec struct simple and avoids variant types.

- [ ] **Step 3: Commit**

```bash
git add ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BehaviorTreeBuilder/BTJsonParser.h
git add ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BehaviorTreeBuilder/BTJsonParser.cpp
git commit -m "feat(bt-builder): add BTJsonParser for JSON to FBTBuildSpec conversion"
```

---

## Task 5: BTValidator

**Files:**
- Create: `ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BehaviorTreeBuilder/BTValidator.h`
- Create: `ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BehaviorTreeBuilder/BTValidator.cpp`

- [ ] **Step 1: Create validator header**

```cpp
#pragma once

#include "CoreMinimal.h"

struct FBTBuildSpec;
struct FBTNodeSpec;
class FBTNodeRegistry;
class UBlackboardData;

class FBTValidator
{
public:
	/** Validate spec against registry and blackboard. Returns accumulated errors. */
	static TArray<FString> Validate(
		const FBTBuildSpec& Spec,
		const FBTNodeRegistry& Registry,
		UBlackboardData* Blackboard
	);

private:
	static void ValidateNode(
		const FBTNodeSpec& Node,
		const FBTNodeRegistry& Registry,
		UBlackboardData* Blackboard,
		TSet<FString>& SeenIds,
		const FString& Path,
		TArray<FString>& OutErrors
	);
};
```

- [ ] **Step 2: Create validator implementation**

Implements all 9 validation rules from the spec. Accumulates errors (does not fail-fast).

```cpp
#include "BTValidator.h"
#include "BTBuildSpec.h"
#include "BTNodeRegistry.h"
#include "BehaviorTree/BlackboardData.h"
#include "BehaviorTree/Blackboard/BlackboardKeyType_Object.h"
#include "BehaviorTree/Blackboard/BlackboardKeyType_Vector.h"

static FString GetBBKeyTypeName(UBlackboardData* BB, const FString& KeyName)
{
	if (!BB) return FString();

	for (const FBlackboardEntry& Entry : BB->Keys)
	{
		if (Entry.EntryName.ToString() == KeyName && Entry.KeyType)
		{
			// Extract type name from class name: "BlackboardKeyType_Object" -> "Object"
			FString ClassName = Entry.KeyType->GetClass()->GetName();
			FString TypeName;
			if (ClassName.Split(TEXT("BlackboardKeyType_"), nullptr, &TypeName))
			{
				return TypeName;
			}
			return ClassName;
		}
	}
	return FString();
}

static bool BBKeyExists(UBlackboardData* BB, const FString& KeyName)
{
	if (!BB) return false;
	for (const FBlackboardEntry& Entry : BB->Keys)
	{
		if (Entry.EntryName.ToString() == KeyName) return true;
	}
	// Check parent blackboard
	if (BB->Parent)
	{
		return BBKeyExists(BB->Parent, KeyName);
	}
	return false;
}

TArray<FString> FBTValidator::Validate(
	const FBTBuildSpec& Spec,
	const FBTNodeRegistry& Registry,
	UBlackboardData* Blackboard)
{
	TArray<FString> Errors;
	TSet<FString> SeenIds;

	// Rule 1: Root must exist
	if (Spec.Root.Type.IsEmpty())
	{
		Errors.Add(TEXT("[BTValidator] root node has no type"));
		return Errors;
	}

	// Rule 1: Root must be composite
	if (!Registry.IsComposite(Spec.Root.Type))
	{
		Errors.Add(FString::Printf(TEXT("[BTValidator] root type '%s' is not a composite"), *Spec.Root.Type));
	}

	ValidateNode(Spec.Root, Registry, Blackboard, SeenIds, TEXT("root"), Errors);

	return Errors;
}

void FBTValidator::ValidateNode(
	const FBTNodeSpec& Node,
	const FBTNodeRegistry& Registry,
	UBlackboardData* Blackboard,
	TSet<FString>& SeenIds,
	const FString& Path,
	TArray<FString>& OutErrors)
{
	FString NodePath = FString::Printf(TEXT("%s/%s"), *Path, *Node.Id);

	// Rule 7: Unique IDs
	if (Node.Id.IsEmpty())
	{
		OutErrors.Add(FString::Printf(TEXT("[BTValidator] node at %s has empty id"), *Path));
	}
	else if (SeenIds.Contains(Node.Id))
	{
		OutErrors.Add(FString::Printf(TEXT("[BTValidator] duplicate id '%s' at %s"), *Node.Id, *Path));
	}
	else
	{
		SeenIds.Add(Node.Id);
	}

	// Rule 9: Unknown type
	if (!Registry.IsKnownType(Node.Type))
	{
		OutErrors.Add(FString::Printf(TEXT("[BTValidator] unknown type '%s' at %s"), *Node.Type, *NodePath));
		return;  // cannot validate children/params of unknown type
	}

	// Rule 2: Composites must have at least one child
	if (Registry.IsComposite(Node.Type) && Node.Children.Num() == 0)
	{
		OutErrors.Add(FString::Printf(TEXT("[BTValidator] composite '%s' has no children at %s"), *Node.Id, *NodePath));
	}

	// Rule 3: Tasks cannot have children
	if (Registry.IsTask(Node.Type) && Node.Children.Num() > 0)
	{
		OutErrors.Add(FString::Printf(TEXT("[BTValidator] task '%s' has children at %s"), *Node.Id, *NodePath));
	}

	// Rule 4: Only decorator types in decorators array
	for (const FBTNodeSpec& Dec : Node.Decorators)
	{
		if (!Dec.Type.IsEmpty() && Registry.IsKnownType(Dec.Type) && !Registry.IsDecorator(Dec.Type))
		{
			OutErrors.Add(FString::Printf(TEXT("[BTValidator] '%s' in decorators is not a decorator type at %s"), *Dec.Type, *NodePath));
		}
	}

	// Rule 5 & 6: BB key validation
	if (const FString* KeyName = Node.Params.Find(TEXT("blackboard_key")))
	{
		if (Blackboard && !BBKeyExists(Blackboard, *KeyName))
		{
			OutErrors.Add(FString::Printf(TEXT("[BTValidator] blackboard key '%s' not found at %s"), **KeyName, *NodePath));
		}

		// Rule 6: BB key type compatibility
		if (Blackboard)
		{
			const TMap<FString, TSet<FString>>* Reqs = Registry.GetBBKeyRequirements(Node.Type);
			if (Reqs)
			{
				const TSet<FString>* AllowedTypes = Reqs->Find(TEXT("blackboard_key"));
				if (AllowedTypes)
				{
					FString ActualType = GetBBKeyTypeName(Blackboard, *KeyName);
					if (!ActualType.IsEmpty() && !AllowedTypes->Contains(ActualType))
					{
						OutErrors.Add(FString::Printf(
							TEXT("[BTValidator] BB key '%s' is type '%s', but '%s' requires one of: %s at %s"),
							**KeyName, *ActualType, *Node.Type,
							*FString::Join(AllowedTypes->Array(), TEXT(", ")),
							*NodePath
						));
					}
				}
			}
		}
	}

	// Rule 8: condition enum validation for Blackboard decorator
	if (Node.Type == TEXT("Blackboard"))
	{
		if (const FString* Condition = Node.Params.Find(TEXT("condition")))
		{
			if (*Condition != TEXT("IsSet") && *Condition != TEXT("IsNotSet"))
			{
				OutErrors.Add(FString::Printf(
					TEXT("[BTValidator] invalid condition '%s' at %s (must be 'IsSet' or 'IsNotSet')"),
					**Condition, *NodePath
				));
			}
		}
	}

	// Recurse into children
	for (const FBTNodeSpec& Child : Node.Children)
	{
		ValidateNode(Child, Registry, Blackboard, SeenIds, NodePath, OutErrors);
	}

	// Recurse into decorators
	for (const FBTNodeSpec& Dec : Node.Decorators)
	{
		ValidateNode(Dec, Registry, Blackboard, SeenIds, NodePath + TEXT("/decorators"), OutErrors);
	}
}
```

**UE4.27 API notes for the implementer:**
- `UBlackboardData::Keys` is a `TArray<FBlackboardEntry>`. Each entry has `EntryName` (FName) and `KeyType` (UBlackboardKeyType*).
- `UBlackboardData::Parent` links to a parent blackboard for inherited keys. Check parent chain when validating key existence.
- The `GetBBKeyTypeName` helper extracts the type from the class name. If UE4.27 exposes a better API for this, use it.

- [ ] **Step 3: Commit**

```bash
git add ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BehaviorTreeBuilder/BTValidator.h
git add ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BehaviorTreeBuilder/BTValidator.cpp
git commit -m "feat(bt-builder): add BTValidator with 9 validation rules"
```

---

## Task 6: BTNodeFactory

**Files:**
- Create: `ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BehaviorTreeBuilder/BTNodeFactory.h`
- Create: `ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BehaviorTreeBuilder/BTNodeFactory.cpp`

- [ ] **Step 1: Create factory header**

```cpp
#pragma once

#include "CoreMinimal.h"

struct FBTBuildSpec;
struct FBTBuildContext;

class FBTNodeFactory
{
public:
	/** Two-phase build: create all nodes, then wire them. Returns empty string on success. */
	static FString BuildTree(const FBTBuildSpec& Spec, FBTBuildContext& Ctx);
};
```

- [ ] **Step 2: Create factory implementation**

This is the core build logic. Two-phase: create all nodes first, then wire.

```cpp
#include "BTNodeFactory.h"
#include "BTBuildSpec.h"
#include "BTNodeRegistry.h"
#include "BehaviorTree/BehaviorTree.h"
#include "BehaviorTree/BTCompositeNode.h"
#include "BehaviorTree/BTTaskNode.h"
#include "BehaviorTree/BTDecorator.h"

// Phase A: Recursively create all nodes
static FString CreateNodes(
	const FBTNodeSpec& Spec,
	FBTBuildContext& Ctx)
{
	UBTNode* Node = nullptr;
	const FBTNodeRegistry* Registry = Ctx.Registry;

	if (Registry->IsComposite(Spec.Type))
	{
		TSubclassOf<UBTCompositeNode> NodeClass = Registry->GetCompositeClass(Spec.Type);
		Node = NewObject<UBTCompositeNode>(Ctx.BehaviorTree, NodeClass);
	}
	else if (Registry->IsTask(Spec.Type))
	{
		TSubclassOf<UBTTaskNode> NodeClass = Registry->GetTaskClass(Spec.Type);
		Node = NewObject<UBTTaskNode>(Ctx.BehaviorTree, NodeClass);
	}
	else if (Registry->IsDecorator(Spec.Type))
	{
		TSubclassOf<UBTDecorator> NodeClass = Registry->GetDecoratorClass(Spec.Type);
		Node = NewObject<UBTDecorator>(Ctx.BehaviorTree, NodeClass);
	}

	if (!Node)
	{
		return FString::Printf(TEXT("[BTNodeFactory] failed to create node '%s' (type: %s)"), *Spec.Id, *Spec.Type);
	}

	// Set display name
	if (!Spec.Name.IsEmpty())
	{
		Node->NodeName = Spec.Name;
	}

	// Apply params (handles BB key resolution)
	Registry->ApplyParams(Node, Spec.Type, Spec.Params, Ctx.Blackboard);

	// Initialize from asset (binds BB key selectors)
	Node->InitializeFromAsset(*Ctx.BehaviorTree);

	// Store in node map
	Ctx.NodeMap.Add(Spec.Id, Node);

	// Recurse into children
	for (const FBTNodeSpec& ChildSpec : Spec.Children)
	{
		FString Error = CreateNodes(ChildSpec, Ctx);
		if (!Error.IsEmpty()) return Error;
	}

	// Recurse into decorators
	for (const FBTNodeSpec& DecSpec : Spec.Decorators)
	{
		FString Error = CreateNodes(DecSpec, Ctx);
		if (!Error.IsEmpty()) return Error;
	}

	return FString();
}

// Phase B: Recursively wire nodes
static FString WireNodes(
	const FBTNodeSpec& Spec,
	FBTBuildContext& Ctx)
{
	UBTNode** FoundNode = Ctx.NodeMap.Find(Spec.Id);
	if (!FoundNode || !*FoundNode)
	{
		return FString::Printf(TEXT("[BTNodeFactory] node '%s' not found in NodeMap during wiring"), *Spec.Id);
	}

	UBTCompositeNode* Composite = Cast<UBTCompositeNode>(*FoundNode);
	if (!Composite)
	{
		// Task or decorator -- nothing to wire from here (children were validated away)
		return FString();
	}

	// Wire each child into the composite
	for (int32 i = 0; i < Spec.Children.Num(); ++i)
	{
		const FBTNodeSpec& ChildSpec = Spec.Children[i];

		UBTNode** ChildFound = Ctx.NodeMap.Find(ChildSpec.Id);
		if (!ChildFound || !*ChildFound)
		{
			return FString::Printf(TEXT("[BTNodeFactory] child '%s' not found during wiring"), *ChildSpec.Id);
		}

		FBTCompositeChild CompositeChild;
		CompositeChild.ChildComposite = Cast<UBTCompositeNode>(*ChildFound);
		CompositeChild.ChildTask = Cast<UBTTaskNode>(*ChildFound);

		// Attach decorators defined on this child
		for (const FBTNodeSpec& DecSpec : ChildSpec.Decorators)
		{
			UBTNode** DecFound = Ctx.NodeMap.Find(DecSpec.Id);
			if (DecFound && *DecFound)
			{
				UBTDecorator* Dec = Cast<UBTDecorator>(*DecFound);
				if (Dec)
				{
					CompositeChild.Decorators.Add(Dec);
				}
			}
		}

		Composite->Children.Add(CompositeChild);

		// Recurse to wire grandchildren
		FString Error = WireNodes(ChildSpec, Ctx);
		if (!Error.IsEmpty()) return Error;
	}

	return FString();
}

FString FBTNodeFactory::BuildTree(const FBTBuildSpec& Spec, FBTBuildContext& Ctx)
{
	// Phase A: Create all nodes
	FString CreateError = CreateNodes(Spec.Root, Ctx);
	if (!CreateError.IsEmpty()) return CreateError;

	// Phase B: Wire nodes
	FString WireError = WireNodes(Spec.Root, Ctx);
	if (!WireError.IsEmpty()) return WireError;

	return FString();
}
```

**Critical UE4 details for the implementer:**
- `NewObject<T>(Outer, Class)` -- the Outer must be the `UBehaviorTree*` so nodes are owned by the asset and get GC'd with it.
- `Node->InitializeFromAsset(*BT)` must be called AFTER `ApplyParams` sets `SelectedKeyName`, because `InitializeFromAsset` may internally resolve keys.
- `FBTCompositeChild` has `ChildComposite` (for composite children) and `ChildTask` (for task children). Only one should be set. Both can be null-checked after cast.
- `FBTCompositeChild::Decorators` is a `TArray<UBTDecorator*>`.
- Decorators on the composite itself (not on a specific child) would need different handling. In the enemy patrol BT, decorators are always on the child composites (the Sequences), so they flow through the `CompositeChild.Decorators` path from the parent Selector's perspective.

- [ ] **Step 3: Commit**

```bash
git add ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BehaviorTreeBuilder/BTNodeFactory.h
git add ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BehaviorTreeBuilder/BTNodeFactory.cpp
git commit -m "feat(bt-builder): add BTNodeFactory with two-phase create+wire build"
```

---

## Task 7: BTBuilder Orchestrator

**Files:**
- Create: `ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BehaviorTreeBuilder/BTBuilder.h`
- Create: `ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BehaviorTreeBuilder/BTBuilder.cpp`

- [ ] **Step 1: Create builder header**

```cpp
#pragma once

#include "CoreMinimal.h"
#include "BTNodeRegistry.h"

class UBehaviorTree;

class FBTBuilder
{
public:
	/** Build BT runtime tree from JSON. Returns empty string on success, error on failure. */
	FString Build(UBehaviorTree* BT, const FString& JsonString);

private:
	FBTNodeRegistry Registry;
};
```

- [ ] **Step 2: Create builder implementation**

```cpp
#include "BTBuilder.h"
#include "BTBuildSpec.h"
#include "BTJsonParser.h"
#include "BTValidator.h"
#include "BTNodeFactory.h"
#include "BehaviorTree/BehaviorTree.h"
#include "BehaviorTree/BTCompositeNode.h"

#if WITH_EDITOR
#include "BTEditorGraphSync.h"
#endif

FString FBTBuilder::Build(UBehaviorTree* BT, const FString& JsonString)
{
	if (!BT)
	{
		return TEXT("[BTBuilder] BehaviorTree is null");
	}

	// 1. Parse
	FBTBuildSpec Spec;
	FString ParseError = FBTJsonParser::Parse(JsonString, Spec);
	if (!ParseError.IsEmpty()) return ParseError;

	// 2. Validate
	UBlackboardData* BB = BT->BlackboardAsset;
	TArray<FString> Errors = FBTValidator::Validate(Spec, Registry, BB);
	if (Errors.Num() > 0)
	{
		return FString::Join(Errors, TEXT("\n"));
	}

	// 3. Build runtime tree (two-phase)
	FBTBuildContext Ctx;
	Ctx.BehaviorTree = BT;
	Ctx.Blackboard = BB;
	Ctx.Registry = &Registry;

	FString BuildError = FBTNodeFactory::BuildTree(Spec, Ctx);
	if (!BuildError.IsEmpty()) return BuildError;

	// 4. Commit: set RootNode (atomic -- only on full success)
	// Do NOT clear BT->RootNode before this point.
	UBTNode** RootFound = Ctx.NodeMap.Find(Spec.Root.Id);
	if (!RootFound || !*RootFound)
	{
		return TEXT("[BTBuilder] root node not found in NodeMap after build");
	}

	UBTCompositeNode* NewRoot = Cast<UBTCompositeNode>(*RootFound);
	if (!NewRoot)
	{
		return TEXT("[BTBuilder] root node is not a composite");
	}

	BT->RootNode = NewRoot;

	// 5. Sync editor graph (editor-only, non-fatal)
#if WITH_EDITOR
	FBTEditorGraphSync::Sync(BT);
#endif

	UE_LOG(LogTemp, Log, TEXT("[BTBuilder] built BT '%s' with %d nodes"),
		*BT->GetName(), Ctx.NodeMap.Num());

	return FString();
}
```

- [ ] **Step 3: Commit**

```bash
git add ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BehaviorTreeBuilder/BTBuilder.h
git add ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BehaviorTreeBuilder/BTBuilder.cpp
git commit -m "feat(bt-builder): add BTBuilder orchestrator (parse, validate, build, commit)"
```

---

## Task 8: BTEditorGraphSync

**Files:**
- Create: `ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BehaviorTreeBuilder/BTEditorGraphSync.h`
- Create: `ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BehaviorTreeBuilder/BTEditorGraphSync.cpp`

- [ ] **Step 1: Create editor sync header**

```cpp
#pragma once

#include "CoreMinimal.h"

class UBehaviorTree;

class FBTEditorGraphSync
{
public:
	/** Reconstruct editor graph from runtime tree. Non-fatal -- logs warnings on failure. */
	static void Sync(UBehaviorTree* BT);
};
```

- [ ] **Step 2: Create editor sync implementation**

Entire file is wrapped in `#if WITH_EDITOR`. Uses correct `UBTGraphNode_*` subclasses.

```cpp
#include "BTEditorGraphSync.h"

#if WITH_EDITOR

#include "BehaviorTree/BehaviorTree.h"
#include "BehaviorTree/BTCompositeNode.h"
#include "BehaviorTree/BTTaskNode.h"
#include "BehaviorTree/BTDecorator.h"
#include "BehaviorTreeGraphNode_Composite.h"
#include "BehaviorTreeGraphNode_Task.h"
#include "BehaviorTreeGraphNode_Decorator.h"
#include "BehaviorTreeGraph.h"
#include "EdGraphSchema_BehaviorTree.h"
#include "EdGraph/EdGraph.h"
#include "Kismet2/BlueprintEditorUtils.h"

static UBTGraphNode* CreateGraphNodeForRuntime(UBTNode* RuntimeNode, UBehaviorTreeGraph* BTGraph)
{
	UBTGraphNode* GraphNode = nullptr;

	if (Cast<UBTCompositeNode>(RuntimeNode))
	{
		GraphNode = NewObject<UBTGraphNode_Composite>(BTGraph);
	}
	else if (Cast<UBTTaskNode>(RuntimeNode))
	{
		GraphNode = NewObject<UBTGraphNode_Task>(BTGraph);
	}
	else if (Cast<UBTDecorator>(RuntimeNode))
	{
		GraphNode = NewObject<UBTGraphNode_Decorator>(BTGraph);
	}

	if (GraphNode)
	{
		GraphNode->NodeInstance = RuntimeNode;
		BTGraph->AddNode(GraphNode, /*bFromUI=*/false, /*bSelectNewNode=*/false);
		GraphNode->AllocateDefaultPins();
	}

	return GraphNode;
}

static void SyncComposite(
	UBTCompositeNode* Composite,
	UBTGraphNode* ParentGraphNode,
	UBehaviorTreeGraph* BTGraph)
{
	if (!Composite || !ParentGraphNode) return;

	for (const FBTCompositeChild& Child : Composite->Children)
	{
		UBTNode* ChildNode = Child.ChildComposite
			? static_cast<UBTNode*>(Child.ChildComposite)
			: static_cast<UBTNode*>(Child.ChildTask);

		if (!ChildNode) continue;

		UBTGraphNode* ChildGraphNode = CreateGraphNodeForRuntime(ChildNode, BTGraph);
		if (!ChildGraphNode) continue;

		// Connect parent output pin to child input pin
		if (ParentGraphNode->Pins.Num() > 0 && ChildGraphNode->Pins.Num() > 0)
		{
			// Parent's output pin (usually index 1) to child's input pin (index 0)
			UEdGraphPin* OutputPin = nullptr;
			for (UEdGraphPin* Pin : ParentGraphNode->Pins)
			{
				if (Pin->Direction == EGPD_Output)
				{
					OutputPin = Pin;
					break;
				}
			}
			UEdGraphPin* InputPin = nullptr;
			for (UEdGraphPin* Pin : ChildGraphNode->Pins)
			{
				if (Pin->Direction == EGPD_Input)
				{
					InputPin = Pin;
					break;
				}
			}
			if (OutputPin && InputPin)
			{
				OutputPin->MakeLinkTo(InputPin);
			}
		}

		// Add decorators as sub-nodes
		for (UBTDecorator* Dec : Child.Decorators)
		{
			if (!Dec) continue;
			UBTGraphNode* DecGraphNode = CreateGraphNodeForRuntime(Dec, BTGraph);
			if (DecGraphNode)
			{
				ChildGraphNode->AddSubNode(DecGraphNode, BTGraph);
			}
		}

		// Recurse if child is composite
		if (Child.ChildComposite)
		{
			SyncComposite(Child.ChildComposite, ChildGraphNode, BTGraph);
		}
	}
}

void FBTEditorGraphSync::Sync(UBehaviorTree* BT)
{
	if (!BT || !BT->RootNode)
	{
		UE_LOG(LogTemp, Warning, TEXT("[BTEditorGraphSync] BT or RootNode is null, skipping sync"));
		return;
	}

	// Get or create editor graph
	UBehaviorTreeGraph* BTGraph = Cast<UBehaviorTreeGraph>(BT->BTGraph);
	if (!BTGraph)
	{
		BTGraph = CastChecked<UBehaviorTreeGraph>(
			FBlueprintEditorUtils::CreateNewGraph(
				BT, TEXT("BehaviorTreeGraph"),
				UBehaviorTreeGraph::StaticClass(),
				UEdGraphSchema_BehaviorTree::StaticClass()
			)
		);
		BT->BTGraph = BTGraph;
	}

	// Clear existing graph nodes safely
	BTGraph->Modify();
	for (int32 i = BTGraph->Nodes.Num() - 1; i >= 0; --i)
	{
		if (BTGraph->Nodes[i])
		{
			BTGraph->RemoveNode(BTGraph->Nodes[i]);
		}
	}

	// Create root graph node
	UBTGraphNode* RootGraphNode = CreateGraphNodeForRuntime(BT->RootNode, BTGraph);
	if (!RootGraphNode)
	{
		UE_LOG(LogTemp, Warning, TEXT("[BTEditorGraphSync] failed to create root graph node"));
		return;
	}

	// Recursively sync the tree
	SyncComposite(BT->RootNode, RootGraphNode, BTGraph);

	// Finalize
	BTGraph->UpdateAsset();
	BT->MarkPackageDirty();

	UE_LOG(LogTemp, Log, TEXT("[BTEditorGraphSync] synced editor graph for '%s'"), *BT->GetName());
}

#else  // !WITH_EDITOR

void FBTEditorGraphSync::Sync(UBehaviorTree* BT)
{
	// No-op outside editor
}

#endif  // WITH_EDITOR
```

**UE4.27 API notes for the implementer:**
- The BT editor graph node classes (`UBTGraphNode_Composite`, `UBTGraphNode_Task`, `UBTGraphNode_Decorator`) are defined in the `BehaviorTreeEditor` module. The exact header names may vary. Common locations in UE4.27:
  - `Editor/BehaviorTreeEditor/Classes/BehaviorTreeGraphNode_Composite.h`
  - `Editor/BehaviorTreeEditor/Classes/BehaviorTreeGraphNode_Task.h`
  - `Editor/BehaviorTreeEditor/Classes/BehaviorTreeGraphNode_Decorator.h`
  - `Editor/BehaviorTreeEditor/Classes/BehaviorTreeGraph.h`
  - `Editor/BehaviorTreeEditor/Classes/EdGraphSchema_BehaviorTree.h`
- If these headers aren't found at those paths, search the engine source for the class names.
- `UBTGraphNode::AddSubNode()` is used to attach decorators as visual sub-nodes in the BT editor. If this method doesn't exist in 4.27, decorators may need to be attached differently (check `UBTGraphNode` header).
- `AllocateDefaultPins()` is called after `AddNode()` to create the input/output pins that `MakeLinkTo()` connects. Without this, pins will be empty and connections will silently fail.
- This entire file is non-fatal by design. If something goes wrong, log and continue. The runtime tree is already committed.

- [ ] **Step 3: Commit**

```bash
git add ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BehaviorTreeBuilder/BTEditorGraphSync.h
git add ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BehaviorTreeBuilder/BTEditorGraphSync.cpp
git commit -m "feat(bt-builder): add BTEditorGraphSync for editor graph reconstruction"
```

---

## Task 9: BehaviorTreeBuilderLibrary Public API

**Files:**
- Create: `ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Public/BehaviorTreeBuilderLibrary.h`
- Create: `ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BehaviorTreeBuilderLibrary.cpp`

- [ ] **Step 1: Create library header**

Follow the exact pattern of `WidgetBlueprintBuilderLibrary.h`:

```cpp
#pragma once

#include "CoreMinimal.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "BehaviorTreeBuilderLibrary.generated.h"

class UBehaviorTree;

UCLASS()
class BLUEPRINTGRAPHBUILDER_API UBehaviorTreeBuilderLibrary : public UBlueprintFunctionLibrary
{
	GENERATED_BODY()

public:
	/**
	 * Build a BehaviorTree node graph from JSON.
	 * The BehaviorTree must already exist and have its BlackboardAsset assigned.
	 * Returns empty string on success, error message on failure.
	 */
	UFUNCTION(BlueprintCallable, CallInEditor, Category="BlueprintGraphBuilder")
	static FString BuildBehaviorTreeFromJSON(
		UBehaviorTree* BehaviorTree,
		const FString& JsonString
	);
};
```

- [ ] **Step 2: Create library implementation**

```cpp
#include "BehaviorTreeBuilderLibrary.h"
#include "BehaviorTreeBuilder/BTBuilder.h"
#include "BehaviorTree/BehaviorTree.h"

FString UBehaviorTreeBuilderLibrary::BuildBehaviorTreeFromJSON(
	UBehaviorTree* BehaviorTree,
	const FString& JsonString)
{
	UE_LOG(LogTemp, Log, TEXT("[BehaviorTreeBuilder] BuildBehaviorTreeFromJSON called"));

	if (!BehaviorTree)
	{
		return TEXT("[BehaviorTreeBuilder] BehaviorTree is null");
	}

	FBTBuilder Builder;
	return Builder.Build(BehaviorTree, JsonString);
}
```

- [ ] **Step 3: Commit**

```bash
git add ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Public/BehaviorTreeBuilderLibrary.h
git add ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BehaviorTreeBuilderLibrary.cpp
git commit -m "feat(bt-builder): add BehaviorTreeBuilderLibrary public API"
```

---

## Task 10: Python Tests -- BT Root Structure Assertions

**Files:**
- Modify: `unreal-plugin/Content/Python/tests/test_mechanics.py:146-152`

- [ ] **Step 1: Write failing tests for new BT root schema**

Add these tests after the existing `test_enemy_patrol_adds_blackboard` (after line 152):

```python
def test_enemy_patrol_bt_root_has_id() -> None:
    from mcp_bridge.generation.mechanics.enemy_patrol import apply_enemy_patrol
    intent = _make_intent("enemies that patrol the level")
    spec = apply_enemy_patrol(intent, _make_spec())
    bt = spec.behavior_trees[0]
    assert "id" in bt.root, f"expected 'id' in BT root, got keys: {list(bt.root.keys())}"
    assert bt.root["id"], "BT root id must not be empty"
    _pass("enemy_patrol_bt_root_has_id")


def test_enemy_patrol_bt_root_has_decorators() -> None:
    from mcp_bridge.generation.mechanics.enemy_patrol import apply_enemy_patrol
    intent = _make_intent("enemies that patrol the level")
    spec = apply_enemy_patrol(intent, _make_spec())
    bt = spec.behavior_trees[0]
    # At least one child should have decorators
    has_decorators = any(
        len(child.get("decorators", [])) > 0
        for child in bt.root.get("children", [])
    )
    assert has_decorators, "expected at least one child with decorators in BT root"
    _pass("enemy_patrol_bt_root_has_decorators")


def test_enemy_patrol_bt_uses_correct_param_names() -> None:
    from mcp_bridge.generation.mechanics.enemy_patrol import apply_enemy_patrol
    intent = _make_intent("enemies that patrol the level")
    spec = apply_enemy_patrol(intent, _make_spec())
    bt = spec.behavior_trees[0]
    # Walk tree to find a MoveTo node and check param names
    def find_nodes(node, target_type):
        found = []
        if node.get("type") == target_type:
            found.append(node)
        for child in node.get("children", []):
            found.extend(find_nodes(child, target_type))
        return found

    move_nodes = find_nodes(bt.root, "MoveTo")
    assert len(move_nodes) > 0, "expected at least one MoveTo node"
    for node in move_nodes:
        params = node.get("params", {})
        assert "blackboard_key" in params, f"MoveTo missing 'blackboard_key', got: {list(params.keys())}"
    _pass("enemy_patrol_bt_uses_correct_param_names")


def test_enemy_patrol_bt_all_nodes_have_unique_ids() -> None:
    from mcp_bridge.generation.mechanics.enemy_patrol import apply_enemy_patrol
    intent = _make_intent("enemies that patrol the level")
    spec = apply_enemy_patrol(intent, _make_spec())
    bt = spec.behavior_trees[0]
    ids = set()
    def collect_ids(node):
        node_id = node.get("id", "")
        assert node_id, f"node type '{node.get('type')}' has empty/missing id"
        assert node_id not in ids, f"duplicate id: {node_id}"
        ids.add(node_id)
        for child in node.get("children", []):
            collect_ids(child)
        for dec in node.get("decorators", []):
            collect_ids(dec)
    collect_ids(bt.root)
    _pass("enemy_patrol_bt_all_nodes_have_unique_ids")
```

- [ ] **Step 2: Add the new tests to the runner block**

In the `other_mechanic_tests` list (around line 209), add entries after `test_enemy_patrol_adds_blackboard`:

```python
        test_enemy_patrol_bt_root_has_id,
        test_enemy_patrol_bt_root_has_decorators,
        test_enemy_patrol_bt_uses_correct_param_names,
        test_enemy_patrol_bt_all_nodes_have_unique_ids,
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `python unreal-plugin/Content/Python/tests/test_mechanics.py`

Expected: The 4 new tests fail (because `enemy_patrol.py` still uses old schema). Existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add unreal-plugin/Content/Python/tests/test_mechanics.py
git commit -m "test(bt-builder): add BT root structure assertions for enemy_patrol"
```

---

## Task 11: Upgrade enemy_patrol.py BT Root Schema

**Files:**
- Modify: `unreal-plugin/Content/Python/mcp_bridge/generation/mechanics/enemy_patrol.py:73-91`

- [ ] **Step 1: Replace old root with new JSON schema**

Replace lines 73-91 (the `root={...}` argument in `BehaviorTreeSpec`) with:

```python
        root={
            "id": "root_selector",
            "type": "Selector",
            "name": "EnemyBehavior",
            "children": [
                {
                    "id": "chase_sequence",
                    "type": "Sequence",
                    "name": "ChasePlayer",
                    "decorators": [
                        {
                            "id": "has_target",
                            "type": "Blackboard",
                            "name": "HasTarget",
                            "params": {
                                "blackboard_key": "TargetActor",
                                "condition": "IsSet",
                            },
                        },
                    ],
                    "children": [
                        {
                            "id": "move_to_target",
                            "type": "MoveTo",
                            "name": "ChaseTarget",
                            "params": {
                                "blackboard_key": "TargetActor",
                                "acceptable_radius": 100.0,
                            },
                        },
                    ],
                },
                {
                    "id": "patrol_sequence",
                    "type": "Sequence",
                    "name": "Patrol",
                    "decorators": [
                        {
                            "id": "no_target",
                            "type": "Blackboard",
                            "name": "NoTarget",
                            "params": {
                                "blackboard_key": "TargetActor",
                                "condition": "IsNotSet",
                            },
                        },
                    ],
                    "children": [
                        {
                            "id": "move_to_patrol",
                            "type": "MoveTo",
                            "name": "GoToPatrolPoint",
                            "params": {
                                "blackboard_key": "PatrolLocation",
                                "acceptable_radius": 50.0,
                            },
                        },
                        {
                            "id": "patrol_wait",
                            "type": "Wait",
                            "name": "WaitAtPoint",
                            "params": {
                                "wait_time": 2.0,
                                "random_deviation": 1.0,
                            },
                        },
                    ],
                },
            ],
        },
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `python unreal-plugin/Content/Python/tests/test_mechanics.py`

Expected: All enemy_patrol tests pass, including the 4 new BT root structure tests.

- [ ] **Step 3: Commit**

```bash
git add unreal-plugin/Content/Python/mcp_bridge/generation/mechanics/enemy_patrol.py
git commit -m "feat(bt-builder): upgrade enemy_patrol BT root to new JSON node schema"
```

**Deferred:** The design spec also calls for `graph_json` on the enemy Character BP (DetectionSphere overlap events to set/clear `TargetActor` on the blackboard) and on the AIController BP (BeginPlay to set `PatrolLocation`). These Blueprint event graphs depend on the existing BlueprintGraphBuilder (Pass 11) and are not part of the BT builder itself. They should be added in a follow-up task after the BT builder is verified working. Without them, the BT nodes are correct but the blackboard keys will never be set during PIE.

---

## Task 12: Update spec_schema.py Docstring

**Files:**
- Modify: `unreal-plugin/Content/Python/mcp_bridge/generation/spec_schema.py:120-123`

- [ ] **Step 1: Update docstring**

Replace lines 120-123 with:

```python
    # Root node as nested dict tree matching the BehaviorTreeBuilder JSON schema.
    root: Dict[str, Any] = field(default_factory=dict)
    # Each node: {"id": str, "type": "Selector"|"Sequence"|"MoveTo"|"Wait"|"Blackboard",
    #  "name": str (optional), "params": {...}, "children": [...], "decorators": [...]}
```

- [ ] **Step 2: Commit**

```bash
git add unreal-plugin/Content/Python/mcp_bridge/generation/spec_schema.py
git commit -m "docs(bt-builder): update BehaviorTreeSpec.root docstring to match new schema"
```

---

## Task 13: Python Integration -- ai_generator.py Builder Call

**Files:**
- Modify: `unreal-plugin/Content/Python/mcp_bridge/generation/ai_generator.py:69-102`

- [ ] **Step 1: Add C++ builder call to generate_behavior_tree**

Replace `generate_behavior_tree` (lines 69-102) with:

```python
def generate_behavior_tree(spec: BehaviorTreeSpec) -> Tuple[bool, str, Dict[str, Any]]:
    """Create a BehaviorTree asset, assign its Blackboard, and build node graph."""
    try:
        import unreal

        full_path = f"{spec.content_path}/{spec.name}"
        if unreal.EditorAssetLibrary.does_asset_exist(full_path):
            return True, "", {"path": full_path, "skipped": True}

        unreal.EditorAssetLibrary.make_directory(spec.content_path)

        factory_cls = getattr(unreal, "BehaviorTreeFactory", None)
        if factory_cls is None:
            return False, "BehaviorTreeFactory not available", {}

        asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
        bt = asset_tools.create_asset(spec.name, spec.content_path, unreal.BehaviorTree, factory_cls())
        if bt is None:
            return False, f"Failed to create BehaviorTree: {full_path}", {}

        # Assign blackboard BEFORE building nodes (builder needs it for key validation)
        blackboard_assigned = False
        if spec.blackboard_path:
            bb = unreal.EditorAssetLibrary.load_asset(spec.blackboard_path)
            if bb:
                try:
                    bt.set_editor_property("blackboard_asset", bb)
                    blackboard_assigned = True
                except Exception:
                    pass

        # Build node graph via C++ plugin
        graph_built = False
        builder_available = False
        build_error = ""

        if isinstance(spec.root, dict) and "type" in spec.root:
            import json as json_mod
            lib = getattr(unreal, "BehaviorTreeBuilderLibrary", None)
            if lib and hasattr(lib, "build_behavior_tree_from_json"):
                builder_available = True
                try:
                    json_str = json_mod.dumps({"root": spec.root})
                    build_error = lib.build_behavior_tree_from_json(bt, json_str)
                    graph_built = (build_error == "")
                except Exception as e:
                    build_error = str(e)

        success = graph_built or not builder_available
        if build_error and builder_available:
            success = False

        unreal.EditorAssetLibrary.save_asset(full_path)
        return success, build_error, {
            "path": full_path,
            "blackboard": spec.blackboard_path,
            "blackboard_assigned": blackboard_assigned,
            "builder_available": builder_available,
            "graph_built": graph_built,
            "skipped": False,
        }

    except Exception as e:
        return False, str(e), {}
```

**Logic for `success`:**
- If builder is available and build failed: `success = False`
- If builder is available and build succeeded: `success = True`
- If builder is not available (plugin not loaded): `success = True` (graceful degradation -- asset created as empty shell)

- [ ] **Step 2: Commit**

```bash
git add unreal-plugin/Content/Python/mcp_bridge/generation/ai_generator.py
git commit -m "feat(bt-builder): add C++ builder call in generate_behavior_tree with graceful degradation"
```

---

## Task 14: Update CLAUDE.md Active Workstreams

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add BT Builder to workstreams table**

In the Active Workstreams table, add a new row:

```markdown
| Behavior Tree Builder | ue4-plugin/BlueprintGraphBuilder/Private/BehaviorTreeBuilder/ | In progress | docs/superpowers/specs/2026-03-19-behavior-tree-builder-design.md |
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add Behavior Tree Builder to active workstreams"
```

---

## Task 15: Verify Everything Builds

- [ ] **Step 1: Run Python tests**

```bash
python unreal-plugin/Content/Python/tests/test_mechanics.py
```

Expected: All enemy_patrol tests pass (including 4 new BT root assertions). Other mechanic tests skip/fail as expected.

- [ ] **Step 2: Run npm build (TypeScript -- should be no changes)**

```bash
npm run build
```

Expected: Clean build, no errors. No TypeScript files were changed.

- [ ] **Step 3: Run npm test**

```bash
npm test
```

Expected: All existing MCP server unit tests pass. No BT-related TypeScript changes to test.

- [ ] **Step 4: Verify C++ files exist in correct structure**

```bash
ls -la ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/BehaviorTreeBuilder/
ls -la ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Public/BehaviorTreeBuilderLibrary.h
```

Expected: All 15 new C++ files present in correct locations.

**Note:** The C++ plugin compiles via Unreal Build Tool inside UE4, not via npm. To verify C++ compilation, rebuild the plugin in UE4.27 (requires opening the project). The files here are structurally correct and follow the Widget Builder patterns. C++ compilation errors (if any) will surface during the UE4 build step.

---

## Summary

| Task | Files | Description |
|---|---|---|
| 1 | Build.cs | Add module dependencies |
| 2 | BTBuildSpec.h | Data structures |
| 3 | BTNodeRegistry.h/cpp | Type maps + param application |
| 4 | BTJsonParser.h/cpp | JSON parsing |
| 5 | BTValidator.h/cpp | 9 validation rules |
| 6 | BTNodeFactory.h/cpp | Two-phase create+wire |
| 7 | BTBuilder.h/cpp | Orchestrator |
| 8 | BTEditorGraphSync.h/cpp | Editor graph sync |
| 9 | BehaviorTreeBuilderLibrary.h/cpp | Public API |
| 10 | test_mechanics.py | Failing tests for new schema |
| 11 | enemy_patrol.py | Upgrade BT root |
| 12 | spec_schema.py | Update docstring |
| 13 | ai_generator.py | C++ builder integration |
| 14 | CLAUDE.md | Workstreams update |
| 15 | (verification) | Build + test validation |
