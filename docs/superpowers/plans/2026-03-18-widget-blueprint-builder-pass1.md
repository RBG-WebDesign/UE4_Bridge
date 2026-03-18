# Widget Blueprint Builder Pass 1: Asset Creation + Root Assignment

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a UWidgetBlueprint asset with a CanvasPanel root widget from JSON, compilable and openable in the Widget Blueprint Editor Designer tab.

**Architecture:** Thin public library facade delegates to an orchestrator which uses a JSON parser, validator, asset factory, tree builder (stub), and finalizer. Only CanvasPanel is supported in this pass. All files live in the existing BlueprintGraphBuilder plugin under a new WidgetBuilder/ subdirectory.

**Tech Stack:** UE4.27 C++, UMG, UWidgetBlueprint, UWidgetTree, FAssetToolsModule

**Spec:** `docs/superpowers/specs/2026-03-18-widget-blueprint-builder-design.md`

**Plugin source (repo):** `ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/`
**Plugin deployed (live):** `D:/Unreal Projects/CodePlayground/Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/`
**Build command:** `& "D:/UE/UE_4.27/Engine/Build/BatchFiles/Build.bat" CodePlaygroundEditor Win64 Development -Project="D:/Unreal Projects/CodePlayground/CodePlayground.uproject" -WaitMutex -FromMsBuild`
**Note:** Build.bat must be invoked with `&` in PowerShell, not just quoted path.

**Testing approach:** This is a UE4 C++ plugin compiled by Unreal Build Tool. There are no unit tests in the traditional sense. Testing is done by:
1. Compile succeeds (Build.bat)
2. Call the function from UE4 Python console
3. Verify results in editor (Content Browser, Widget Blueprint Editor)

---

## File Map

All paths relative to `ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/`.

| File | Action | Purpose |
|---|---|---|
| `BlueprintGraphBuilder.Build.cs` | Modify | Add UMG/Slate dependencies |
| `Public/WidgetBlueprintBuilderLibrary.h` | Create | Public UFUNCTION facade |
| `Public/WidgetBlueprintSpec.h` | Create | Spec structs (FWidgetBlueprintSpec, FWidgetNodeSpec, FWidgetSlotSpec, EWidgetCategory) |
| `Private/WidgetBlueprintBuilderLibrary.cpp` | Create | Thin delegation to orchestrator |
| `Private/WidgetBuilder/WidgetBlueprintBuilder.h` | Create | Orchestrator class |
| `Private/WidgetBuilder/WidgetBlueprintBuilder.cpp` | Create | Build/Rebuild/Validate orchestration |
| `Private/WidgetBuilder/WidgetBlueprintJsonParser.h` | Create | Parser class |
| `Private/WidgetBuilder/WidgetBlueprintJsonParser.cpp` | Create | JSON -> FWidgetBlueprintSpec (minimal: root only) |
| `Private/WidgetBuilder/WidgetBlueprintValidator.h` | Create | Validator class |
| `Private/WidgetBuilder/WidgetBlueprintValidator.cpp` | Create | Spec validation (minimal: root type check) |
| `Private/WidgetBuilder/WidgetClassRegistry.h` | Create | Type whitelist + categories |
| `Private/WidgetBuilder/WidgetClassRegistry.cpp` | Create | CanvasPanel only for Pass 1 |
| `Private/WidgetBuilder/WidgetBlueprintAssetFactory.h` | Create | Asset creation helper |
| `Private/WidgetBuilder/WidgetBlueprintAssetFactory.cpp` | Create | UWidgetBlueprintFactory + FAssetToolsModule path |
| `Private/WidgetBuilder/WidgetTreeBuilder.h` | Create | Tree builder (stub for Pass 1) |
| `Private/WidgetBuilder/WidgetTreeBuilder.cpp` | Create | Constructs root widget only, no children |
| `Private/WidgetBuilder/WidgetBlueprintFinalizer.h` | Create | Compile + save helper |
| `Private/WidgetBuilder/WidgetBlueprintFinalizer.cpp` | Create | MarkStructurallyModified + Compile + SavePackage |

Pass 1 does NOT create: WidgetChildAttachment, WidgetPropertyApplier, WidgetSlotPropertyApplier (those come in Pass 2+).

---

### Task 1: Add UMG/Slate dependencies to Build.cs

**Files:**
- Modify: `BlueprintGraphBuilder.Build.cs`

- [ ] **Step 1: Add dependencies**

Add `UMG`, `UMGEditor`, `Slate`, `SlateCore` to `PrivateDependencyModuleNames`:

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
});
```

**Verification:** Confirm `UMGEditor` is the correct module name by checking that `D:/UE/UE_4.27/Engine/Source/Editor/UMGEditor/UMGEditor.Build.cs` exists. If the file is not found, search for the correct module name: `find "D:/UE/UE_4.27/Engine/Source/Editor" -name "*UMG*" -o -name "*Widget*Blueprint*"`. The module may be named `UMGEditor` or something else in 4.27.

- [ ] **Step 2: Commit**

```bash
git add ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/BlueprintGraphBuilder.Build.cs
git commit -m "build: add UMG/Slate dependencies for widget builder"
```

---

### Task 2: Create spec structs header

**Files:**
- Create: `Public/WidgetBlueprintSpec.h`

- [ ] **Step 1: Write the spec structs**

```cpp
#pragma once

#include "CoreMinimal.h"
#include "Dom/JsonValue.h"
#include "Layout/Margin.h"

enum class EWidgetCategory : uint8
{
    Leaf,
    Content,
    Panel
};

struct FWidgetPropertyDescriptor
{
    FString Name;
    EJson ExpectedType; // EJson::String, EJson::Number, EJson::Boolean, EJson::Object
};

struct FWidgetSlotSpec
{
    FVector2D Position = FVector2D::ZeroVector;
    FVector2D Size = FVector2D::ZeroVector;
    FVector2D Alignment = FVector2D::ZeroVector;
    FMargin Padding = FMargin(0);
    int32 ZOrder = 0;
    bool bAutoSize = false;

    bool bHasPosition = false;
    bool bHasSize = false;
    bool bHasAlignment = false;
    bool bHasPadding = false;
    bool bHasZOrder = false;
    bool bHasAutoSize = false;
};

struct FWidgetNodeSpec
{
    FString Type;
    FString Name;
    TMap<FString, TSharedPtr<FJsonValue>> Properties;
    FWidgetSlotSpec Slot;
    bool bHasSlot = false;
    TArray<FWidgetNodeSpec> Children;
};

struct FWidgetBlueprintSpec
{
    FWidgetNodeSpec Root;
};
```

Note: The spec uses `EJson` (from `Dom/JsonValue.h`) for the expected type enum, not a custom `EJsonType`. Verify that `EJson` exists in UE4.27's `FJsonValue` -- it should be `EJson::None`, `EJson::String`, `EJson::Number`, `EJson::Boolean`, `EJson::Object`, `EJson::Array`, `EJson::Null`. If not, use a custom enum.

- [ ] **Step 2: Commit**

```bash
git add ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Public/WidgetBlueprintSpec.h
git commit -m "feat: add widget blueprint spec structs"
```

---

### Task 3: Create widget class registry (CanvasPanel only)

**Files:**
- Create: `Private/WidgetBuilder/WidgetClassRegistry.h`
- Create: `Private/WidgetBuilder/WidgetClassRegistry.cpp`

- [ ] **Step 1: Write the header**

```cpp
#pragma once

#include "CoreMinimal.h"
#include "WidgetBlueprintSpec.h"

class UWidget;

class FWidgetClassRegistry
{
public:
    FWidgetClassRegistry();

    TSubclassOf<UWidget> ResolveWidgetClass(const FString& TypeName) const;
    bool IsSupportedType(const FString& TypeName) const;
    EWidgetCategory GetCategory(const FString& TypeName) const;
    TArray<FString> GetSupportedTypes() const;
    const TArray<FWidgetPropertyDescriptor>* GetSupportedProperties(const FString& TypeName) const;

private:
    struct FWidgetTypeInfo
    {
        TSubclassOf<UWidget> WidgetClass;
        EWidgetCategory Category;
        TArray<FWidgetPropertyDescriptor> SupportedProperties;
    };

    TMap<FString, FWidgetTypeInfo> TypeRegistry;

    void RegisterTypes();
};
```

- [ ] **Step 2: Write the implementation**

```cpp
#include "WidgetClassRegistry.h"
#include "Components/CanvasPanel.h"
#include "Components/Widget.h"

FWidgetClassRegistry::FWidgetClassRegistry()
{
    RegisterTypes();
}

void FWidgetClassRegistry::RegisterTypes()
{
    // Pass 1: CanvasPanel only
    FWidgetTypeInfo CanvasPanelInfo;
    CanvasPanelInfo.WidgetClass = UCanvasPanel::StaticClass();
    CanvasPanelInfo.Category = EWidgetCategory::Panel;
    // No properties for CanvasPanel in v1
    TypeRegistry.Add(TEXT("CanvasPanel"), MoveTemp(CanvasPanelInfo));
}

TSubclassOf<UWidget> FWidgetClassRegistry::ResolveWidgetClass(const FString& TypeName) const
{
    const FWidgetTypeInfo* Info = TypeRegistry.Find(TypeName);
    return Info ? Info->WidgetClass : nullptr;
}

bool FWidgetClassRegistry::IsSupportedType(const FString& TypeName) const
{
    return TypeRegistry.Contains(TypeName);
}

EWidgetCategory FWidgetClassRegistry::GetCategory(const FString& TypeName) const
{
    const FWidgetTypeInfo* Info = TypeRegistry.Find(TypeName);
    return Info ? Info->Category : EWidgetCategory::Leaf;
}

TArray<FString> FWidgetClassRegistry::GetSupportedTypes() const
{
    TArray<FString> Types;
    TypeRegistry.GetKeys(Types);
    return Types;
}

const TArray<FWidgetPropertyDescriptor>* FWidgetClassRegistry::GetSupportedProperties(const FString& TypeName) const
{
    const FWidgetTypeInfo* Info = TypeRegistry.Find(TypeName);
    return Info ? &Info->SupportedProperties : nullptr;
}
```

- [ ] **Step 3: Commit**

```bash
git add ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/WidgetBuilder/WidgetClassRegistry.h
git add ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/WidgetBuilder/WidgetClassRegistry.cpp
git commit -m "feat: add widget class registry with CanvasPanel"
```

---

### Task 4: Create JSON parser (minimal root-only)

**Files:**
- Create: `Private/WidgetBuilder/WidgetBlueprintJsonParser.h`
- Create: `Private/WidgetBuilder/WidgetBlueprintJsonParser.cpp`

- [ ] **Step 1: Write the header**

```cpp
#pragma once

#include "CoreMinimal.h"
#include "WidgetBlueprintSpec.h"
#include "Dom/JsonObject.h"

class FWidgetBlueprintJsonParser
{
public:
    static bool Parse(const FString& JsonString, FWidgetBlueprintSpec& OutSpec, FString& OutError);

private:
    static bool ParseWidgetNode(
        const TSharedPtr<FJsonObject>& NodeObj,
        FWidgetNodeSpec& OutNode,
        const FString& Path,
        FString& OutError
    );

    static bool ParseSlotSpec(
        const TSharedPtr<FJsonObject>& SlotObj,
        FWidgetSlotSpec& OutSlot,
        const FString& Path,
        FString& OutError
    );

    static bool ParseProperties(
        const TSharedPtr<FJsonObject>& PropsObj,
        TMap<FString, TSharedPtr<FJsonValue>>& OutProperties,
        const FString& Path,
        FString& OutError
    );
};
```

- [ ] **Step 2: Write the implementation**

For Pass 1, the parser needs to handle the minimal case: `{"root": {"type": "CanvasPanel", "name": "RootCanvas"}}`. But implement it fully so it handles children, properties, and slot for future passes.

```cpp
#include "WidgetBlueprintJsonParser.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"

// Valid keys at node level
static const TSet<FString> ValidNodeKeys = { TEXT("type"), TEXT("name"), TEXT("properties"), TEXT("slot"), TEXT("children") };
// Valid keys in slot
static const TSet<FString> ValidSlotKeys = { TEXT("position"), TEXT("size"), TEXT("alignment"), TEXT("padding"), TEXT("zOrder"), TEXT("autoSize") };

bool FWidgetBlueprintJsonParser::Parse(const FString& JsonString, FWidgetBlueprintSpec& OutSpec, FString& OutError)
{
    TSharedPtr<FJsonObject> RootObj;
    TSharedRef<TJsonReader<>> Reader = TJsonReaderFactory<>::Create(JsonString);

    if (!FJsonSerializer::Deserialize(Reader, RootObj) || !RootObj.IsValid())
    {
        OutError = TEXT("[WidgetBuilder] Failed to parse JSON string");
        return false;
    }

    const TSharedPtr<FJsonObject>* RootNodeObj = nullptr;
    if (!RootObj->TryGetObjectField(TEXT("root"), RootNodeObj))
    {
        OutError = TEXT("[WidgetBuilder] Missing required 'root' object");
        return false;
    }

    return ParseWidgetNode(*RootNodeObj, OutSpec.Root, TEXT(""), OutError);
}

bool FWidgetBlueprintJsonParser::ParseWidgetNode(
    const TSharedPtr<FJsonObject>& NodeObj,
    FWidgetNodeSpec& OutNode,
    const FString& Path,
    FString& OutError)
{
    // Check for unknown keys at node level
    for (const auto& Pair : NodeObj->Values)
    {
        if (!ValidNodeKeys.Contains(Pair.Key))
        {
            OutError = FString::Printf(TEXT("[WidgetBuilder] %s: Unknown key '%s' at node level"), *Path, *Pair.Key);
            return false;
        }
    }

    // Required: type
    if (!NodeObj->TryGetStringField(TEXT("type"), OutNode.Type))
    {
        OutError = FString::Printf(TEXT("[WidgetBuilder] %s: Missing required 'type' field"), *Path);
        return false;
    }

    // Required: name
    if (!NodeObj->TryGetStringField(TEXT("name"), OutNode.Name))
    {
        OutError = FString::Printf(TEXT("[WidgetBuilder] %s: Missing required 'name' field"), *Path);
        return false;
    }

    // Build path for this node
    FString NodePath = Path.IsEmpty() ? OutNode.Name : FString::Printf(TEXT("%s.%s"), *Path, *OutNode.Name);

    // Optional: properties
    const TSharedPtr<FJsonObject>* PropsObj = nullptr;
    if (NodeObj->TryGetObjectField(TEXT("properties"), PropsObj))
    {
        if (!ParseProperties(*PropsObj, OutNode.Properties, NodePath, OutError))
        {
            return false;
        }
    }

    // Optional: slot
    const TSharedPtr<FJsonObject>* SlotObj = nullptr;
    if (NodeObj->TryGetObjectField(TEXT("slot"), SlotObj))
    {
        OutNode.bHasSlot = true;
        if (!ParseSlotSpec(*SlotObj, OutNode.Slot, NodePath, OutError))
        {
            return false;
        }
    }

    // Optional: children
    const TArray<TSharedPtr<FJsonValue>>* ChildrenArray = nullptr;
    if (NodeObj->TryGetArrayField(TEXT("children"), ChildrenArray))
    {
        for (int32 i = 0; i < ChildrenArray->Num(); ++i)
        {
            const TSharedPtr<FJsonObject>& ChildObj = (*ChildrenArray)[i]->AsObject();
            if (!ChildObj.IsValid())
            {
                OutError = FString::Printf(TEXT("[WidgetBuilder] %s: Child %d is not a valid object"), *NodePath, i);
                return false;
            }

            FWidgetNodeSpec ChildSpec;
            if (!ParseWidgetNode(ChildObj, ChildSpec, NodePath, OutError))
            {
                return false;
            }
            OutNode.Children.Add(MoveTemp(ChildSpec));
        }
    }

    return true;
}

bool FWidgetBlueprintJsonParser::ParseSlotSpec(
    const TSharedPtr<FJsonObject>& SlotObj,
    FWidgetSlotSpec& OutSlot,
    const FString& Path,
    FString& OutError)
{
    // Check for unknown keys
    for (const auto& Pair : SlotObj->Values)
    {
        if (!ValidSlotKeys.Contains(Pair.Key))
        {
            OutError = FString::Printf(TEXT("[WidgetBuilder] %s.slot: Unknown key '%s'"), *Path, *Pair.Key);
            return false;
        }
    }

    // position: {x, y}
    const TSharedPtr<FJsonObject>* PosObj = nullptr;
    if (SlotObj->TryGetObjectField(TEXT("position"), PosObj))
    {
        OutSlot.Position.X = (*PosObj)->GetNumberField(TEXT("x"));
        OutSlot.Position.Y = (*PosObj)->GetNumberField(TEXT("y"));
        OutSlot.bHasPosition = true;
    }

    // size: {x, y}
    const TSharedPtr<FJsonObject>* SizeObj = nullptr;
    if (SlotObj->TryGetObjectField(TEXT("size"), SizeObj))
    {
        OutSlot.Size.X = (*SizeObj)->GetNumberField(TEXT("x"));
        OutSlot.Size.Y = (*SizeObj)->GetNumberField(TEXT("y"));
        OutSlot.bHasSize = true;
    }

    // alignment: {x, y}
    const TSharedPtr<FJsonObject>* AlignObj = nullptr;
    if (SlotObj->TryGetObjectField(TEXT("alignment"), AlignObj))
    {
        OutSlot.Alignment.X = (*AlignObj)->GetNumberField(TEXT("x"));
        OutSlot.Alignment.Y = (*AlignObj)->GetNumberField(TEXT("y"));
        OutSlot.bHasAlignment = true;
    }

    // padding: {left, top, right, bottom}
    const TSharedPtr<FJsonObject>* PadObj = nullptr;
    if (SlotObj->TryGetObjectField(TEXT("padding"), PadObj))
    {
        OutSlot.Padding.Left = (*PadObj)->GetNumberField(TEXT("left"));
        OutSlot.Padding.Top = (*PadObj)->GetNumberField(TEXT("top"));
        OutSlot.Padding.Right = (*PadObj)->GetNumberField(TEXT("right"));
        OutSlot.Padding.Bottom = (*PadObj)->GetNumberField(TEXT("bottom"));
        OutSlot.bHasPadding = true;
    }

    // zOrder
    double ZOrder;
    if (SlotObj->TryGetNumberField(TEXT("zOrder"), ZOrder))
    {
        OutSlot.ZOrder = static_cast<int32>(ZOrder);
        OutSlot.bHasZOrder = true;
    }

    // autoSize
    bool AutoSize;
    if (SlotObj->TryGetBoolField(TEXT("autoSize"), AutoSize))
    {
        OutSlot.bAutoSize = AutoSize;
        OutSlot.bHasAutoSize = true;
    }

    return true;
}

bool FWidgetBlueprintJsonParser::ParseProperties(
    const TSharedPtr<FJsonObject>& PropsObj,
    TMap<FString, TSharedPtr<FJsonValue>>& OutProperties,
    const FString& Path,
    FString& OutError)
{
    // Accept all keys in properties -- validator decides which are supported
    for (const auto& Pair : PropsObj->Values)
    {
        OutProperties.Add(Pair.Key, Pair.Value);
    }
    return true;
}
```

- [ ] **Step 3: Commit**

```bash
git add ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/WidgetBuilder/WidgetBlueprintJsonParser.h
git add ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/WidgetBuilder/WidgetBlueprintJsonParser.cpp
git commit -m "feat: add widget blueprint JSON parser"
```

---

### Task 5: Create validator (minimal root check)

**Files:**
- Create: `Private/WidgetBuilder/WidgetBlueprintValidator.h`
- Create: `Private/WidgetBuilder/WidgetBlueprintValidator.cpp`

- [ ] **Step 1: Write the header**

```cpp
#pragma once

#include "CoreMinimal.h"
#include "WidgetBlueprintSpec.h"

class FWidgetClassRegistry;

class FWidgetBlueprintValidator
{
public:
    static bool Validate(
        const FWidgetBlueprintSpec& Spec,
        const FWidgetClassRegistry& Registry,
        FString& OutError
    );

private:
    static bool ValidateNode(
        const FWidgetNodeSpec& Node,
        const FWidgetClassRegistry& Registry,
        TSet<FString>& SeenNames,
        const FString& Path,
        FString& OutError
    );
};
```

- [ ] **Step 2: Write the implementation**

```cpp
#include "WidgetBlueprintValidator.h"
#include "WidgetClassRegistry.h"

bool FWidgetBlueprintValidator::Validate(
    const FWidgetBlueprintSpec& Spec,
    const FWidgetClassRegistry& Registry,
    FString& OutError)
{
    // Root must exist
    if (Spec.Root.Type.IsEmpty())
    {
        OutError = TEXT("[WidgetBuilder] Root widget has no type");
        return false;
    }

    // Root must be a panel type
    if (!Registry.IsSupportedType(Spec.Root.Type))
    {
        OutError = FString::Printf(TEXT("[WidgetBuilder] Root type '%s' is not supported. Supported: %s"),
            *Spec.Root.Type, *FString::Join(Registry.GetSupportedTypes(), TEXT(", ")));
        return false;
    }

    if (Registry.GetCategory(Spec.Root.Type) != EWidgetCategory::Panel)
    {
        OutError = FString::Printf(TEXT("[WidgetBuilder] Root widget must be a Panel type, got '%s'"), *Spec.Root.Type);
        return false;
    }

    TSet<FString> SeenNames;
    return ValidateNode(Spec.Root, Registry, SeenNames, TEXT(""), OutError);
}

bool FWidgetBlueprintValidator::ValidateNode(
    const FWidgetNodeSpec& Node,
    const FWidgetClassRegistry& Registry,
    TSet<FString>& SeenNames,
    const FString& Path,
    FString& OutError)
{
    FString NodePath = Path.IsEmpty() ? Node.Name : FString::Printf(TEXT("%s.%s"), *Path, *Node.Name);

    // Name must not be empty
    if (Node.Name.IsEmpty())
    {
        OutError = FString::Printf(TEXT("[WidgetBuilder] %s: Widget name is empty"), *NodePath);
        return false;
    }

    // Name must be unique
    if (SeenNames.Contains(Node.Name))
    {
        OutError = FString::Printf(TEXT("[WidgetBuilder] %s: Duplicate widget name '%s'"), *NodePath, *Node.Name);
        return false;
    }
    SeenNames.Add(Node.Name);

    // Type must be supported
    if (!Registry.IsSupportedType(Node.Type))
    {
        OutError = FString::Printf(TEXT("[WidgetBuilder] %s: Unsupported widget type '%s'"), *NodePath, *Node.Type);
        return false;
    }

    // Validate children based on category
    EWidgetCategory Category = Registry.GetCategory(Node.Type);
    switch (Category)
    {
    case EWidgetCategory::Leaf:
        if (Node.Children.Num() > 0)
        {
            OutError = FString::Printf(TEXT("[WidgetBuilder] %s: Leaf widget '%s' cannot have children"), *NodePath, *Node.Type);
            return false;
        }
        break;
    case EWidgetCategory::Content:
        if (Node.Children.Num() > 1)
        {
            OutError = FString::Printf(TEXT("[WidgetBuilder] %s: Content widget '%s' can have at most 1 child, got %d"),
                *NodePath, *Node.Type, Node.Children.Num());
            return false;
        }
        break;
    case EWidgetCategory::Panel:
        // 0..N children, no restriction
        break;
    }

    // Validate properties against registry
    const TArray<FWidgetPropertyDescriptor>* SupportedProps = Registry.GetSupportedProperties(Node.Type);
    if (SupportedProps)
    {
        for (const auto& Pair : Node.Properties)
        {
            bool bFound = false;
            for (const FWidgetPropertyDescriptor& Desc : *SupportedProps)
            {
                if (Desc.Name == Pair.Key)
                {
                    bFound = true;
                    // Check JSON type matches expected
                    if (Pair.Value.IsValid() && Pair.Value->Type != Desc.ExpectedType)
                    {
                        OutError = FString::Printf(TEXT("[WidgetBuilder] %s: Property '%s' has wrong type"), *NodePath, *Pair.Key);
                        return false;
                    }
                    break;
                }
            }
            if (!bFound)
            {
                OutError = FString::Printf(TEXT("[WidgetBuilder] %s: Unsupported property '%s' on %s"), *NodePath, *Pair.Key, *Node.Type);
                return false;
            }
        }
    }
    else if (Node.Properties.Num() > 0)
    {
        // No properties defined for this type but some were provided
        TArray<FString> Keys;
        Node.Properties.GetKeys(Keys);
        OutError = FString::Printf(TEXT("[WidgetBuilder] %s: Unsupported property '%s' on %s"), *NodePath, *Keys[0], *Node.Type);
        return false;
    }

    // Recurse into children
    for (const FWidgetNodeSpec& Child : Node.Children)
    {
        if (!ValidateNode(Child, Registry, SeenNames, NodePath, OutError))
        {
            return false;
        }
    }

    return true;
}
```


- [ ] **Step 3: Commit**

```bash
git add ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/WidgetBuilder/WidgetBlueprintValidator.h
git add ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/WidgetBuilder/WidgetBlueprintValidator.cpp
git commit -m "feat: add widget blueprint validator"
```

---

### Task 6: Create asset factory

**Files:**
- Create: `Private/WidgetBuilder/WidgetBlueprintAssetFactory.h`
- Create: `Private/WidgetBuilder/WidgetBlueprintAssetFactory.cpp`

This is the highest-risk task in Pass 1. The exact API for creating UWidgetBlueprint via UWidgetBlueprintFactory in UE4.27 must be verified at compile time.

- [ ] **Step 1: Write the header**

```cpp
#pragma once

#include "CoreMinimal.h"

class UWidgetBlueprint;

class FWidgetBlueprintAssetFactory
{
public:
    static UWidgetBlueprint* CreateWidgetBlueprint(
        const FString& PackagePath,
        const FString& AssetName,
        FString& OutError
    );

    static UWidgetBlueprint* LoadWidgetBlueprint(
        const FString& AssetPath,
        FString& OutError
    );
};
```

- [ ] **Step 2: Write the implementation**

```cpp
#include "WidgetBlueprintAssetFactory.h"
#include "WidgetBlueprint.h"
#include "Blueprint/UserWidget.h"
#include "UMGEditor/Public/WidgetBlueprintFactory.h"
#include "AssetToolsModule.h"
#include "AssetRegistryModule.h"
#include "UObject/Package.h"

UWidgetBlueprint* FWidgetBlueprintAssetFactory::CreateWidgetBlueprint(
    const FString& PackagePath,
    const FString& AssetName,
    FString& OutError)
{
    // Check if asset already exists
    FString FullPath = PackagePath / AssetName;
    UObject* ExistingAsset = StaticLoadObject(UWidgetBlueprint::StaticClass(), nullptr, *FullPath);
    if (ExistingAsset)
    {
        OutError = FString::Printf(TEXT("[WidgetBuilder] Asset already exists at '%s'. Use RebuildWidgetFromJSON for existing assets."), *FullPath);
        return nullptr;
    }

    // Create via UWidgetBlueprintFactory + FAssetToolsModule
    UWidgetBlueprintFactory* Factory = NewObject<UWidgetBlueprintFactory>();
    Factory->ParentClass = UUserWidget::StaticClass();

    IAssetTools& AssetTools = FModuleManager::LoadModuleChecked<FAssetToolsModule>("AssetTools").Get();
    UObject* CreatedAsset = AssetTools.CreateAsset(AssetName, PackagePath, UWidgetBlueprint::StaticClass(), Factory);

    if (!CreatedAsset)
    {
        OutError = FString::Printf(TEXT("[WidgetBuilder] Failed to create UWidgetBlueprint at '%s'"), *FullPath);
        return nullptr;
    }

    UWidgetBlueprint* WidgetBP = Cast<UWidgetBlueprint>(CreatedAsset);
    if (!WidgetBP)
    {
        OutError = FString::Printf(TEXT("[WidgetBuilder] Created asset is not a UWidgetBlueprint at '%s'"), *FullPath);
        return nullptr;
    }

    // Verify WidgetTree exists (factory should create it)
    if (!WidgetBP->WidgetTree)
    {
        OutError = TEXT("[WidgetBuilder] UWidgetBlueprint missing WidgetTree after creation. Factory path may be incorrect.");
        return nullptr;
    }

    // Notify asset registry
    FAssetRegistryModule::AssetCreated(WidgetBP);

    UE_LOG(LogTemp, Log, TEXT("[WidgetBuilder] Created UWidgetBlueprint at '%s'"), *FullPath);
    return WidgetBP;
}

UWidgetBlueprint* FWidgetBlueprintAssetFactory::LoadWidgetBlueprint(
    const FString& AssetPath,
    FString& OutError)
{
    UObject* LoadedAsset = StaticLoadObject(UWidgetBlueprint::StaticClass(), nullptr, *AssetPath);
    if (!LoadedAsset)
    {
        OutError = FString::Printf(TEXT("[WidgetBuilder] Could not load asset at '%s'"), *AssetPath);
        return nullptr;
    }

    UWidgetBlueprint* WidgetBP = Cast<UWidgetBlueprint>(LoadedAsset);
    if (!WidgetBP)
    {
        OutError = FString::Printf(TEXT("[WidgetBuilder] Asset at '%s' is not a UWidgetBlueprint"), *AssetPath);
        return nullptr;
    }

    if (!WidgetBP->WidgetTree)
    {
        OutError = FString::Printf(TEXT("[WidgetBuilder] UWidgetBlueprint at '%s' has no WidgetTree"), *AssetPath);
        return nullptr;
    }

    return WidgetBP;
}
```

**Important:** The `#include "UMGEditor/Public/WidgetBlueprintFactory.h"` path may differ in UE4.27. If it fails to compile, try:
- `#include "WidgetBlueprintFactory.h"` (if UMGEditor is in the include path)
- Check `Engine/Source/Editor/UMGEditor/Public/` for the exact header name
- Search for `UWidgetBlueprintFactory` in the engine source: `grep -r "class UWidgetBlueprintFactory" "D:/UE/UE_4.27/Engine/Source/"`

Similarly, `WidgetBlueprint.h` include path may need adjustment. Try `#include "WidgetBlueprint.h"` first, fall back to `#include "UMG/Public/WidgetBlueprint.h"`.

- [ ] **Step 3: Commit**

```bash
git add ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/WidgetBuilder/WidgetBlueprintAssetFactory.h
git add ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/WidgetBuilder/WidgetBlueprintAssetFactory.cpp
git commit -m "feat: add widget blueprint asset factory"
```

---

### Task 7: Create tree builder (stub for Pass 1)

**Files:**
- Create: `Private/WidgetBuilder/WidgetTreeBuilder.h`
- Create: `Private/WidgetBuilder/WidgetTreeBuilder.cpp`

Pass 1 tree builder only constructs the root widget (CanvasPanel). No children, no properties, no slots.

- [ ] **Step 1: Write the header**

```cpp
#pragma once

#include "CoreMinimal.h"
#include "WidgetBlueprintSpec.h"

class UWidgetBlueprint;
class UWidgetTree;
class UWidget;
class FWidgetClassRegistry;

class FWidgetTreeBuilder
{
public:
    FWidgetTreeBuilder(const FWidgetClassRegistry& InClassRegistry);

    UWidget* BuildTree(
        UWidgetBlueprint* WidgetBP,
        UWidgetTree* WidgetTree,
        const FWidgetBlueprintSpec& Spec,
        FString& OutError
    );

private:
    UWidget* BuildNode(
        UWidgetBlueprint* WidgetBP,
        UWidgetTree* WidgetTree,
        const FWidgetNodeSpec& Spec,
        UWidget* Parent,
        const FString& Path,
        FString& OutError
    );

    const FWidgetClassRegistry& ClassRegistry;
};
```

Note: Pass 1 constructor only takes ClassRegistry. Pass 2+ will add ChildAttachment, PropertyApplier, SlotPropertyApplier parameters.

- [ ] **Step 2: Write the implementation**

```cpp
#include "WidgetTreeBuilder.h"
#include "WidgetClassRegistry.h"
#include "WidgetBlueprint.h"
#include "Blueprint/WidgetTree.h"
#include "Components/Widget.h"

FWidgetTreeBuilder::FWidgetTreeBuilder(const FWidgetClassRegistry& InClassRegistry)
    : ClassRegistry(InClassRegistry)
{
}

UWidget* FWidgetTreeBuilder::BuildTree(
    UWidgetBlueprint* WidgetBP,
    UWidgetTree* WidgetTree,
    const FWidgetBlueprintSpec& Spec,
    FString& OutError)
{
    // Build root node with no parent
    return BuildNode(WidgetBP, WidgetTree, Spec.Root, nullptr, Spec.Root.Name, OutError);
}

UWidget* FWidgetTreeBuilder::BuildNode(
    UWidgetBlueprint* WidgetBP,
    UWidgetTree* WidgetTree,
    const FWidgetNodeSpec& Spec,
    UWidget* Parent,
    const FString& Path,
    FString& OutError)
{
    // Step 1: Resolve widget class
    TSubclassOf<UWidget> WidgetClass = ClassRegistry.ResolveWidgetClass(Spec.Type);
    if (!WidgetClass)
    {
        OutError = FString::Printf(TEXT("[WidgetBuilder] %s: Could not resolve widget class for type '%s'"), *Path, *Spec.Type);
        return nullptr;
    }

    // Step 2: Construct widget
    UWidget* Widget = WidgetTree->ConstructWidget<UWidget>(WidgetClass, FName(*Spec.Name));
    if (!Widget)
    {
        OutError = FString::Printf(TEXT("[WidgetBuilder] %s: ConstructWidget failed for type '%s'"), *Path, *Spec.Type);
        return nullptr;
    }

    UE_LOG(LogTemp, Log, TEXT("[WidgetBuilder] %s: Constructed %s as '%s'"), *Path, *Spec.Type, *Spec.Name);

    // Steps 3-6 (properties, attachment, slot, children) will be added in Pass 2+
    // For Pass 1, root widget is returned directly without attachment (root is never attached)

    return Widget;
}
```

**Important:** The include `#include "Blueprint/WidgetTree.h"` may need adjustment for UE4.27. If it fails, try:
- `#include "WidgetTree.h"`
- Search engine source: `grep -r "class UWidgetTree" "D:/UE/UE_4.27/Engine/Source/"`

- [ ] **Step 3: Commit**

```bash
git add ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/WidgetBuilder/WidgetTreeBuilder.h
git add ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/WidgetBuilder/WidgetTreeBuilder.cpp
git commit -m "feat: add widget tree builder (root only, Pass 1 stub)"
```

---

### Task 8: Create finalizer

**Files:**
- Create: `Private/WidgetBuilder/WidgetBlueprintFinalizer.h`
- Create: `Private/WidgetBuilder/WidgetBlueprintFinalizer.cpp`

- [ ] **Step 1: Write the header**

```cpp
#pragma once

#include "CoreMinimal.h"

class UWidgetBlueprint;

class FWidgetBlueprintFinalizer
{
public:
    static bool Finalize(
        UWidgetBlueprint* WidgetBlueprint,
        bool bSave,
        FString& OutError
    );
};
```

- [ ] **Step 2: Write the implementation**

```cpp
#include "WidgetBlueprintFinalizer.h"
#include "WidgetBlueprint.h"
#include "Kismet2/BlueprintEditorUtils.h"
#include "Kismet2/KismetEditorUtilities.h"
#include "UObject/Package.h"
#include "Engine/Blueprint.h"

bool FWidgetBlueprintFinalizer::Finalize(
    UWidgetBlueprint* WidgetBlueprint,
    bool bSave,
    FString& OutError)
{
    if (!WidgetBlueprint)
    {
        OutError = TEXT("[WidgetBuilder] Cannot finalize null WidgetBlueprint");
        return false;
    }

    // Step 1: Mark structurally modified
    FBlueprintEditorUtils::MarkBlueprintAsStructurallyModified(WidgetBlueprint);

    // Step 2: Compile
    FKismetEditorUtilities::CompileBlueprint(WidgetBlueprint);

    // Step 3: Check compile status
    if (WidgetBlueprint->Status != BS_UpToDate)
    {
        OutError = FString::Printf(TEXT("[WidgetBuilder] Blueprint compile failed. Status: %d"), (int32)WidgetBlueprint->Status);
        return false;
    }

    // Step 4: Mark package dirty
    WidgetBlueprint->GetOutermost()->SetDirtyFlag(true);

    // Step 5: Save if requested
    if (bSave)
    {
        UPackage* Package = WidgetBlueprint->GetOutermost();
        FString PackageFilename = FPackageName::LongPackageNameToFilename(Package->GetName(), FPackageName::GetAssetPackageExtension());
        bool bSaved = UPackage::SavePackage(Package, WidgetBlueprint, RF_Public | RF_Standalone, *PackageFilename);
        if (!bSaved)
        {
            OutError = FString::Printf(TEXT("[WidgetBuilder] Failed to save package to '%s'"), *PackageFilename);
            return false;
        }
        UE_LOG(LogTemp, Log, TEXT("[WidgetBuilder] Saved package to '%s'"), *PackageFilename);
    }

    UE_LOG(LogTemp, Log, TEXT("[WidgetBuilder] Finalized and compiled '%s'"), *WidgetBlueprint->GetName());
    return true;
}
```

- [ ] **Step 3: Commit**

```bash
git add ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/WidgetBuilder/WidgetBlueprintFinalizer.h
git add ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/WidgetBuilder/WidgetBlueprintFinalizer.cpp
git commit -m "feat: add widget blueprint finalizer"
```

---

### Task 9: Create orchestrator

**Files:**
- Create: `Private/WidgetBuilder/WidgetBlueprintBuilder.h`
- Create: `Private/WidgetBuilder/WidgetBlueprintBuilder.cpp`

- [ ] **Step 1: Write the header**

```cpp
#pragma once

#include "CoreMinimal.h"

class UWidgetBlueprint;

class FWidgetBlueprintBuilder
{
public:
    bool Build(
        const FString& PackagePath,
        const FString& AssetName,
        const FString& JsonString,
        FString& OutError
    );

    bool Rebuild(
        UWidgetBlueprint* WidgetBlueprint,
        const FString& JsonString,
        FString& OutError
    );

    bool Validate(
        const FString& JsonString,
        FString& OutError
    );
};
```

- [ ] **Step 2: Write the implementation**

```cpp
#include "WidgetBlueprintBuilder.h"
#include "WidgetBlueprintJsonParser.h"
#include "WidgetBlueprintValidator.h"
#include "WidgetBlueprintAssetFactory.h"
#include "WidgetTreeBuilder.h"
#include "WidgetClassRegistry.h"
#include "WidgetBlueprintFinalizer.h"
#include "WidgetBlueprintSpec.h"
#include "WidgetBlueprint.h"
#include "Blueprint/WidgetTree.h"
#include "Components/Widget.h"

bool FWidgetBlueprintBuilder::Build(
    const FString& PackagePath,
    const FString& AssetName,
    const FString& JsonString,
    FString& OutError)
{
    // Step 1: Parse
    FWidgetBlueprintSpec Spec;
    if (!FWidgetBlueprintJsonParser::Parse(JsonString, Spec, OutError))
    {
        return false;
    }

    // Step 2: Validate
    FWidgetClassRegistry Registry;
    if (!FWidgetBlueprintValidator::Validate(Spec, Registry, OutError))
    {
        return false;
    }

    // Step 3: Create asset
    UWidgetBlueprint* WidgetBP = FWidgetBlueprintAssetFactory::CreateWidgetBlueprint(PackagePath, AssetName, OutError);
    if (!WidgetBP)
    {
        return false;
    }

    UWidgetTree* Tree = WidgetBP->WidgetTree;

    // Step 4: Clear existing tree (reverse iterate)
    TArray<UWidget*> ExistingWidgets;
    Tree->GetAllWidgets(ExistingWidgets);
    for (int32 i = ExistingWidgets.Num() - 1; i >= 0; --i)
    {
        Tree->RemoveWidget(ExistingWidgets[i]);
    }
    Tree->RootWidget = nullptr;

    // Step 5: Build tree
    FWidgetTreeBuilder TreeBuilder(Registry);
    UWidget* Root = TreeBuilder.BuildTree(WidgetBP, Tree, Spec, OutError);
    if (!Root)
    {
        return false;
    }

    // Step 6: Assign root (root must NOT be attached via AddChild)
    Tree->RootWidget = Root;

    // Step 7: Finalize (bSave = true for new assets)
    return FWidgetBlueprintFinalizer::Finalize(WidgetBP, true, OutError);
}

bool FWidgetBlueprintBuilder::Rebuild(
    UWidgetBlueprint* WidgetBlueprint,
    const FString& JsonString,
    FString& OutError)
{
    if (!WidgetBlueprint)
    {
        OutError = TEXT("[WidgetBuilder] WidgetBlueprint is null");
        return false;
    }

    UWidgetTree* Tree = WidgetBlueprint->WidgetTree;
    if (!Tree)
    {
        OutError = TEXT("[WidgetBuilder] WidgetBlueprint has no WidgetTree");
        return false;
    }

    // Steps 1-2: Parse and validate
    FWidgetBlueprintSpec Spec;
    if (!FWidgetBlueprintJsonParser::Parse(JsonString, Spec, OutError))
    {
        return false;
    }

    FWidgetClassRegistry Registry;
    if (!FWidgetBlueprintValidator::Validate(Spec, Registry, OutError))
    {
        return false;
    }

    // Step 4: Clear tree
    TArray<UWidget*> ExistingWidgets;
    Tree->GetAllWidgets(ExistingWidgets);
    for (int32 i = ExistingWidgets.Num() - 1; i >= 0; --i)
    {
        Tree->RemoveWidget(ExistingWidgets[i]);
    }
    Tree->RootWidget = nullptr;

    // Step 5-6: Build and assign
    FWidgetTreeBuilder TreeBuilder(Registry);
    UWidget* Root = TreeBuilder.BuildTree(WidgetBlueprint, Tree, Spec, OutError);
    if (!Root)
    {
        return false;
    }
    Tree->RootWidget = Root;

    // Step 7: Finalize (bSave = false for rebuild)
    return FWidgetBlueprintFinalizer::Finalize(WidgetBlueprint, false, OutError);
}

bool FWidgetBlueprintBuilder::Validate(
    const FString& JsonString,
    FString& OutError)
{
    FWidgetBlueprintSpec Spec;
    if (!FWidgetBlueprintJsonParser::Parse(JsonString, Spec, OutError))
    {
        return false;
    }

    FWidgetClassRegistry Registry;
    return FWidgetBlueprintValidator::Validate(Spec, Registry, OutError);
}
```

- [ ] **Step 3: Commit**

```bash
git add ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/WidgetBuilder/WidgetBlueprintBuilder.h
git add ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/WidgetBuilder/WidgetBlueprintBuilder.cpp
git commit -m "feat: add widget blueprint builder orchestrator"
```

---

### Task 10: Create public library facade

**Files:**
- Create: `Public/WidgetBlueprintBuilderLibrary.h`
- Create: `Private/WidgetBlueprintBuilderLibrary.cpp`

- [ ] **Step 1: Write the header**

```cpp
#pragma once

#include "CoreMinimal.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "WidgetBlueprintBuilderLibrary.generated.h"

UCLASS()
class BLUEPRINTGRAPHBUILDER_API UWidgetBlueprintBuilderLibrary : public UBlueprintFunctionLibrary
{
    GENERATED_BODY()

public:
    UFUNCTION(BlueprintCallable, CallInEditor, Category="BlueprintGraphBuilder")
    static bool BuildWidgetFromJSON(
        const FString& PackagePath,
        const FString& AssetName,
        const FString& JsonString,
        FString& OutError
    );

    UFUNCTION(BlueprintCallable, CallInEditor, Category="BlueprintGraphBuilder")
    static bool RebuildWidgetFromJSON(
        UWidgetBlueprint* WidgetBlueprint,
        const FString& JsonString,
        FString& OutError
    );

    UFUNCTION(BlueprintCallable, CallInEditor, Category="BlueprintGraphBuilder")
    static bool ValidateWidgetJSON(
        const FString& JsonString,
        FString& OutError
    );
};
```

Note: The `UFUNCTION` for `RebuildWidgetFromJSON` takes a `UWidgetBlueprint*` parameter. For this to work with Python, the class needs a forward include. Add `#include "WidgetBlueprint.h"` in the .cpp, and forward declare in the .h if needed. UE4 reflection should handle `UWidgetBlueprint*` as a parameter type since it inherits from UObject.

- [ ] **Step 2: Write the implementation**

```cpp
#include "WidgetBlueprintBuilderLibrary.h"
#include "WidgetBuilder/WidgetBlueprintBuilder.h"
#include "WidgetBlueprint.h"

bool UWidgetBlueprintBuilderLibrary::BuildWidgetFromJSON(
    const FString& PackagePath,
    const FString& AssetName,
    const FString& JsonString,
    FString& OutError)
{
    UE_LOG(LogTemp, Log, TEXT("[WidgetBuilder] BuildWidgetFromJSON: path='%s', name='%s'"), *PackagePath, *AssetName);

    FWidgetBlueprintBuilder Builder;
    return Builder.Build(PackagePath, AssetName, JsonString, OutError);
}

bool UWidgetBlueprintBuilderLibrary::RebuildWidgetFromJSON(
    UWidgetBlueprint* WidgetBlueprint,
    const FString& JsonString,
    FString& OutError)
{
    UE_LOG(LogTemp, Log, TEXT("[WidgetBuilder] RebuildWidgetFromJSON"));

    FWidgetBlueprintBuilder Builder;
    return Builder.Rebuild(WidgetBlueprint, JsonString, OutError);
}

bool UWidgetBlueprintBuilderLibrary::ValidateWidgetJSON(
    const FString& JsonString,
    FString& OutError)
{
    FWidgetBlueprintBuilder Builder;
    return Builder.Validate(JsonString, OutError);
}
```

- [ ] **Step 3: Commit**

```bash
git add ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Public/WidgetBlueprintBuilderLibrary.h
git add ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/WidgetBlueprintBuilderLibrary.cpp
git commit -m "feat: add widget blueprint builder public library facade"
```

---

### Task 11: Compile and fix include path issues

- [ ] **Step 1: Copy all new files to the deployed plugin location**

Copy the entire `ue4-plugin/BlueprintGraphBuilder/` contents to `D:/Unreal Projects/CodePlayground/Plugins/BlueprintGraphBuilder/`. The deployed location is what UE4 actually compiles.

```bash
cp -r ue4-plugin/BlueprintGraphBuilder/Source/* "D:/Unreal Projects/CodePlayground/Plugins/BlueprintGraphBuilder/Source/"
```

Also copy the updated Build.cs:

```bash
cp ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/BlueprintGraphBuilder.Build.cs "D:/Unreal Projects/CodePlayground/Plugins/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/BlueprintGraphBuilder.Build.cs"
```

- [ ] **Step 2: Run the build**

```powershell
& "D:/UE/UE_4.27/Engine/Build/BatchFiles/Build.bat" CodePlaygroundEditor Win64 Development -Project="D:/Unreal Projects/CodePlayground/CodePlayground.uproject" -WaitMutex -FromMsBuild
```

Expected: May fail on first attempt due to include path issues. This is normal for UE4 plugin development.

- [ ] **Step 3: Fix include path issues**

Common fixes needed:
1. `#include "WidgetBlueprint.h"` -- may need full path like `#include "UMG/Public/WidgetBlueprint.h"` or `#include "Blueprint/WidgetBlueprint.h"`
2. `#include "Blueprint/WidgetTree.h"` -- may need `#include "UMG/Public/Blueprint/WidgetTree.h"`
3. `#include "UMGEditor/Public/WidgetBlueprintFactory.h"` -- may need `#include "WidgetBlueprintFactory.h"` or search for exact path
4. `#include "Components/CanvasPanel.h"` -- may need `#include "UMG/Public/Components/CanvasPanel.h"`

For each include failure:
- Search engine source: `grep -r "class UWidgetBlueprint " "D:/UE/UE_4.27/Engine/Source/"` (note trailing space)
- Find the header that declares the class
- Use the path relative to the module's Public/ folder

- [ ] **Step 4: Re-run build until clean**

Repeat Step 2 and Step 3 until build succeeds with 0 errors.

- [ ] **Step 5: Commit fixes**

```bash
git add -A ue4-plugin/BlueprintGraphBuilder/
git commit -m "fix: resolve UE4.27 include paths for widget builder"
```

---

### Task 12: End-to-end test in UE4

- [ ] **Step 1: Open UE4 editor with CodePlayground project**

Launch the editor. Verify in Output Log that the plugin loaded (no errors related to BlueprintGraphBuilder).

- [ ] **Step 2: Test validation from Python console**

Open the Python console in UE4 (Window > Developer Tools > Output Log, switch to Python).

```python
import unreal
result, error = unreal.WidgetBlueprintBuilderLibrary.validate_widget_json('{"root": {"type": "CanvasPanel", "name": "RootCanvas"}}')
print(f"Valid: {result}, Error: {error}")
```

Expected: `Valid: True, Error: `

- [ ] **Step 3: Test validation failure**

```python
result, error = unreal.WidgetBlueprintBuilderLibrary.validate_widget_json('{"root": {"type": "BadType", "name": "Root"}}')
print(f"Valid: {result}, Error: {error}")
```

Expected: `Valid: False, Error: [WidgetBuilder] Root type 'BadType' is not supported...`

- [ ] **Step 4: Test asset creation**

```python
result, error = unreal.WidgetBlueprintBuilderLibrary.build_widget_from_json('/Game/UI', 'TestWidget', '{"root": {"type": "CanvasPanel", "name": "RootCanvas"}}')
print(f"Success: {result}, Error: {error}")
```

Expected: `Success: True, Error: `

- [ ] **Step 5: Verify in Content Browser**

1. Navigate to `/Game/UI/` in Content Browser
2. Verify `TestWidget` asset exists
3. Double-click to open in Widget Blueprint Editor
4. Switch to Designer tab
5. Verify:
   - CanvasPanel is visible as root widget in the hierarchy panel
   - Designer tab shows no errors
   - Blueprint compiles (green checkmark in toolbar)

- [ ] **Step 6: Test rebuild on existing asset**

```python
import unreal
asset = unreal.load_asset('/Game/UI/TestWidget')
result, error = unreal.WidgetBlueprintBuilderLibrary.rebuild_widget_from_json(asset, '{"root": {"type": "CanvasPanel", "name": "NewRoot"}}')
print(f"Rebuild: {result}, Error: {error}")
```

Expected: `Rebuild: True, Error: `

Reopen the asset in Widget Blueprint Editor and verify the root widget is now named "NewRoot".

- [ ] **Step 7: Test duplicate creation fails**

```python
result, error = unreal.WidgetBlueprintBuilderLibrary.build_widget_from_json('/Game/UI', 'TestWidget', '{"root": {"type": "CanvasPanel", "name": "RootCanvas"}}')
print(f"Success: {result}, Error: {error}")
```

Expected: `Success: False, Error: [WidgetBuilder] Asset already exists at '/Game/UI/TestWidget'...`

- [ ] **Step 8: Commit any runtime fixes**

If any issues were found and fixed during testing:

```bash
git add -A ue4-plugin/BlueprintGraphBuilder/
git commit -m "fix: runtime fixes from Pass 1 end-to-end testing"
```

---

### Task 13: Sync repo source with deployed plugin

The repo source (`ue4-plugin/`) should match the deployed version after all fixes.

- [ ] **Step 1: Copy fixed files back to repo**

```bash
cp -r "D:/Unreal Projects/CodePlayground/Plugins/BlueprintGraphBuilder/Source/" ue4-plugin/BlueprintGraphBuilder/Source/
```

- [ ] **Step 2: Verify diff looks correct**

```bash
git diff ue4-plugin/
```

Review that only the new widget builder files and Build.cs changes are present. No accidental changes to existing BlueprintGraphBuilderLibrary files.

- [ ] **Step 3: Final commit**

```bash
git add ue4-plugin/BlueprintGraphBuilder/
git commit -m "feat: Widget Blueprint Builder Pass 1 complete - asset creation + root assignment"
```

---

## Pass 1 Success Checklist

After completing all tasks, verify:

- [ ] Plugin compiles clean
- [ ] `ValidateWidgetJSON` accepts valid JSON, rejects invalid JSON
- [ ] `BuildWidgetFromJSON` creates a real UWidgetBlueprint asset
- [ ] Asset appears in Content Browser at specified path
- [ ] Asset opens in Widget Blueprint Editor Designer tab without errors
- [ ] CanvasPanel is visible as root widget in hierarchy
- [ ] Blueprint compiles clean (BS_UpToDate)
- [ ] Duplicate creation is rejected
- [ ] All files committed and synced between repo and deployed plugin
