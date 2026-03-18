# Widget Blueprint Builder -- Design Spec

Extend the existing BlueprintGraphBuilder C++ plugin to generate UMG Widget Blueprints from JSON. Same pipeline, new target: hierarchical widget trees instead of event graphs.

```
JSON -> MCP -> Python -> WidgetBlueprintBuilderLibrary -> UWidgetBlueprint (WidgetTree)
```

This system builds **Designer tree only**. Graph/event binding is intentionally excluded.

## Public API

Three functions exposed to Python via UE4 reflection on `UWidgetBlueprintBuilderLibrary`:

```cpp
// Create new asset and populate from JSON
static bool BuildWidgetFromJSON(
    const FString& PackagePath,
    const FString& AssetName,
    const FString& JsonString,
    FString& OutError
);

// Rebuild existing asset's widget tree from JSON
static bool RebuildWidgetFromJSON(
    UWidgetBlueprint* WidgetBlueprint,
    const FString& JsonString,
    FString& OutError
);

// Dry-run validation only, no side effects
static bool ValidateWidgetJSON(
    const FString& JsonString,
    FString& OutError
);
```

## JSON Schema

```json
{
  "root": {
    "type": "CanvasPanel",
    "name": "RootCanvas",
    "properties": {
      "visibility": "Visible"
    },
    "children": [
      {
        "type": "TextBlock",
        "name": "TitleText",
        "properties": {
          "text": "Hello World",
          "renderOpacity": 1.0,
          "colorAndOpacity": { "r": 1.0, "g": 0.8, "b": 0.2, "a": 1.0 }
        },
        "slot": {
          "position": { "x": 100, "y": 50 },
          "size": { "x": 300, "y": 40 },
          "alignment": { "x": 0, "y": 0 },
          "zOrder": 1
        }
      },
      {
        "type": "Button",
        "name": "PlayButton",
        "slot": {
          "position": { "x": 100, "y": 120 },
          "size": { "x": 220, "y": 60 }
        },
        "children": [
          {
            "type": "TextBlock",
            "name": "PlayButtonText",
            "properties": {
              "text": "Play"
            }
          }
        ]
      }
    ]
  }
}
```

### Schema Rules

- `type` required on every node, maps to registry whitelist
- `name` required, unique across entire WidgetTree
- `properties` optional, holds widget-intrinsic values (text, visibility, opacity)
- `slot` optional, holds parent-owned layout (position, size, alignment, padding, zOrder)
- `children` optional, validity depends on parent category:
  - Panel widgets: 0..N children
  - Content widgets: 0..1 child
  - Leaf widgets: 0 children (must be empty)
- Root widget `slot` is silently ignored (no parent to own it)
- Omitted properties fall back to engine defaults. The builder does not inject implicit values.
- Unknown keys at node level: error. Unknown keys in slot: error. Unknown keys in properties: passed to validator.
- Unknown widget types or unsupported properties fail validation, not silently ignored.

## Architecture

Approach B: decomposed builder with classes organized by UMG behavior categories.

### Class Map

```
UWidgetBlueprintBuilderLibrary   -- public facade (thin, parse + delegate)
  FWidgetBlueprintBuilder        -- orchestrator (parse -> validate -> create -> build -> finalize)
    FWidgetBlueprintJsonParser   -- JSON string -> FWidgetBlueprintSpec
    FWidgetBlueprintValidator    -- spec validation (types, children, names, properties)
    FWidgetBlueprintAssetFactory -- create/load UWidgetBlueprint assets
    FWidgetTreeBuilder           -- recursive widget construction
      FWidgetClassRegistry       -- type whitelist + categories + property descriptors
      FWidgetChildAttachment     -- panel vs content vs leaf attachment
      FWidgetPropertyApplier     -- widget-intrinsic properties
      FWidgetSlotPropertyApplier -- parent-owned slot layout
    FWidgetBlueprintFinalizer    -- compile + mark dirty + save
```

### Pipeline

```
JSON string
  -> FWidgetBlueprintJsonParser -> FWidgetBlueprintSpec
  -> FWidgetBlueprintValidator (gates correctness)
  -> FWidgetBlueprintAssetFactory (create or load asset)
  -> FWidgetTreeBuilder (recursive construction)
     -> FWidgetClassRegistry (resolve types)
     -> FWidgetChildAttachment (structural attachment)
     -> FWidgetPropertyApplier (widget props)
     -> FWidgetSlotPropertyApplier (slot layout)
  -> FWidgetBlueprintFinalizer (compile + save)
```

TreeBuilder returns the root widget. The orchestrator assigns `WidgetTree->RootWidget`. TreeBuilder does not mutate blueprint state directly.

### Error Format

All errors include node path for debuggability:

```
[WidgetBuilder] RootCanvas.PlayButton.PlayButtonText: Unsupported property 'foo' on TextBlock
```

## Spec Structs

```cpp
struct FWidgetPropertyDescriptor
{
    FString Name;
    EJsonType ExpectedType; // String, Number, Bool, Object
};

struct FWidgetSlotSpec
{
    FVector2D Position = FVector2D::ZeroVector;
    FVector2D Size = FVector2D::ZeroVector;
    FVector2D Alignment = FVector2D::ZeroVector;
    FMargin Padding = FMargin(0);  // FMargin default ctor does not zero-initialize in UE4.27
    int32 ZOrder = 0;
    bool bAutoSize = false;
    // Presence flags: distinguish "set to zero" from "not specified"
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
    TMap<FString, TSharedPtr<FJsonValue>> Properties; // preserve JSON types
    FWidgetSlotSpec Slot;
    bool bHasSlot = false;
    TArray<FWidgetNodeSpec> Children;
};

struct FWidgetBlueprintSpec
{
    FWidgetNodeSpec Root;
};
```

Properties use `TMap<FString, TSharedPtr<FJsonValue>>` to preserve original JSON types (string, number, bool, object). Avoids fragile string-to-type conversions.

## Widget Class Registry

Static whitelist. No dynamic discovery, no reflection scanning.

| JSON Type | UE4 Class | Category |
|---|---|---|
| CanvasPanel | UCanvasPanel | Panel |
| VerticalBox | UVerticalBox | Panel |
| HorizontalBox | UHorizontalBox | Panel |
| Overlay | UOverlay | Panel |
| TextBlock | UTextBlock | Leaf |
| Image | UImage | Leaf |
| Spacer | USpacer | Leaf |
| Button | UButton | Content |
| Border | UBorder | Content |
| SizeBox | USizeBox | Content |

Registry also stores supported property descriptors per type (name + expected JSON type). Validator queries registry to reject unsupported properties.

```cpp
class FWidgetClassRegistry
{
public:
    // Resolve "TextBlock" -> UTextBlock::StaticClass(). Returns nullptr if unsupported.
    TSubclassOf<UWidget> ResolveWidgetClass(const FString& TypeName) const;
    bool IsSupportedType(const FString& TypeName) const;
    EWidgetCategory GetCategory(const FString& TypeName) const;
    TArray<FString> GetSupportedTypes() const;
    // Property validation support
    const TArray<FWidgetPropertyDescriptor>* GetSupportedProperties(const FString& TypeName) const;
};
```

Implemented as static TMap initialized once. Instantiated per-call by the orchestrator (cheap -- just map lookups). No singleton.

```cpp
enum class EWidgetCategory
{
    Leaf,       // cannot have children
    Content,    // 0..1 child
    Panel       // 0..N children
};
```

## Builder Orchestrator Contract

```cpp
class FWidgetBlueprintBuilder
{
public:
    // Build new widget blueprint from scratch
    bool Build(const FString& PackagePath, const FString& AssetName, const FString& JsonString, FString& OutError);
    // Rebuild existing widget blueprint's tree
    bool Rebuild(UWidgetBlueprint* WidgetBlueprint, const FString& JsonString, FString& OutError);
    // Validate only, no side effects
    bool Validate(const FString& JsonString, FString& OutError);
};
```

Instantiated per-call. Internally constructs `FWidgetClassRegistry`, `FWidgetTreeBuilder`, and collaborators. Not a singleton. The `Validate` method constructs its own registry instance for property/type validation.

## Parser Contract

```cpp
class FWidgetBlueprintJsonParser
{
public:
    static bool Parse(const FString& JsonString, FWidgetBlueprintSpec& OutSpec, FString& OutError);
private:
    static bool ParseWidgetNode(const TSharedPtr<FJsonObject>& NodeObj, FWidgetNodeSpec& OutNode, const FString& Path, FString& OutError);
    static bool ParseSlotSpec(const TSharedPtr<FJsonObject>& SlotObj, FWidgetSlotSpec& OutSlot, const FString& Path, FString& OutError);
    static bool ParseProperties(const TSharedPtr<FJsonObject>& PropsObj, TMap<FString, TSharedPtr<FJsonValue>>& OutProperties, const FString& Path, FString& OutError);
};
```

- Fail on missing `root` object
- Fail on missing `type` or `name` on any node
- Fail on unknown keys at node level (valid keys: type, name, properties, slot, children)
- Fail on unknown keys in slot (valid keys: position, size, alignment, padding, zOrder, autoSize)
- Accept all keys in properties (validator decides)
- Path tracking through recursion for error context (e.g., `RootCanvas.PlayButton.PlayButtonText`)

## Validator Contract

```cpp
class FWidgetBlueprintValidator
{
public:
    static bool Validate(const FWidgetBlueprintSpec& Spec, const FWidgetClassRegistry& Registry, FString& OutError);
private:
    static bool ValidateNode(const FWidgetNodeSpec& Node, const FWidgetClassRegistry& Registry, TSet<FString>& SeenNames, const FString& Path, FString& OutError);
};
```

- Root must exist and be a panel type
- All names unique across entire tree
- All widget types must resolve in registry
- Leaf widgets: children must be empty
- Content widgets: children.Num() <= 1
- Panel widgets: 0..N children
- Properties validated per widget type via registry descriptors (name exists + JSON type matches)

## Tree Builder

```cpp
class FWidgetTreeBuilder
{
public:
    FWidgetTreeBuilder(
        const FWidgetClassRegistry& ClassRegistry,
        FWidgetChildAttachment& ChildAttachment,
        FWidgetPropertyApplier& PropertyApplier,
        FWidgetSlotPropertyApplier& SlotApplier
    );
    UWidget* BuildTree(UWidgetBlueprint* WidgetBP, UWidgetTree* WidgetTree, const FWidgetBlueprintSpec& Spec, FString& OutError);
private:
    UWidget* BuildNode(UWidgetBlueprint* WidgetBP, UWidgetTree* WidgetTree, const FWidgetNodeSpec& Spec, UWidget* Parent, const FString& Path, FString& OutError);
};
```

### BuildNode Order (critical)

1. Resolve widget class via ClassRegistry
2. Construct widget: `WidgetTree->ConstructWidget<UWidget>(WidgetClass, FName(*Spec.Name))`
3. Apply widget-intrinsic properties (PropertyApplier)
4. If parent exists: attach child (ChildAttachment) -- this creates the slot
5. If parent exists and `bHasSlot`: apply slot layout (SlotPropertyApplier)
6. Recurse through children in array order

Why this order:
- Widget must exist before properties (2 before 3)
- Widget properties are intrinsic, apply before parent attachment (3 before 4)
- Slot object only exists after parent attachment (4 before 5)
- Parent slot is configured before children are added (5 before 6)

## Child Attachment

```cpp
class FWidgetChildAttachment
{
public:
    bool AttachChild(UWidget* Parent, UWidget* Child, FString& OutError);
    EWidgetCategory GetCategory(UWidget* Widget) const;
private:
    bool AttachToPanel(UPanelWidget* Panel, UWidget* Child, FString& OutError);
    bool AttachToContent(UContentWidget* Content, UWidget* Child, FString& OutError);
};
```

- Panel: `Panel->AddChild(Child)`, verify `Child->Slot != nullptr` after
- Content: `UContentWidget` inherits from `UPanelWidget` in UE4.27. Use `ContentWidget->AddChild(Child)` (same as panel). The single-child constraint is enforced by `UContentWidget` internally (GetChildrenCount max 1). Check `ContentWidget->GetChildrenCount() == 0` before adding. Do NOT use `SetContent()` -- that method may not exist on the base class in UE4.27.
- Leaf: error, cannot have children
- Null slot after attachment is an error, not silently ignored
- JSON array order = widget tree order (AddChild appends)

## Property Application

### Widget Properties (FWidgetPropertyApplier)

```cpp
class FWidgetPropertyApplier
{
public:
    bool Apply(UWidget* Widget, const FWidgetNodeSpec& Spec, const FString& Path, FString& OutError);
private:
    void ApplyBaseProperties(UWidget* Widget, const TMap<FString, TSharedPtr<FJsonValue>>& Props);
    bool ApplyTextBlockProperties(UTextBlock* Widget, const TMap<FString, TSharedPtr<FJsonValue>>& Props, const FString& Path, FString& OutError);
    bool ApplyImageProperties(UImage* Widget, const TMap<FString, TSharedPtr<FJsonValue>>& Props, const FString& Path, FString& OutError);
    bool ApplyButtonProperties(UButton* Widget, const TMap<FString, TSharedPtr<FJsonValue>>& Props, const FString& Path, FString& OutError);
    bool ApplyBorderProperties(UBorder* Widget, const TMap<FString, TSharedPtr<FJsonValue>>& Props, const FString& Path, FString& OutError);
};
```

Base properties apply to all widgets. Type-specific appliers are called via cast. Widget types with no specific applier (Spacer, SizeBox in v1) are skipped silently.

Applier checks `Props.Contains(key)` before applying -- does not assume presence. Ignores unknown keys gracefully (validator is the gatekeeper, applier is the executor).

Centralized enum parsing:
```cpp
namespace WidgetPropertyParsing
{
    bool ParseVisibility(const FString& Value, ESlateVisibility& Out);
    bool ParseJustification(const FString& Value, ETextJustify::Type& Out);
}
```

v1 supported properties:

| Property | JSON Type | Applies To | Maps To |
|---|---|---|---|
| visibility | string | all | UWidget::SetVisibility (enum) |
| renderOpacity | number | all | UWidget::SetRenderOpacity |
| isEnabled | bool | all | UWidget::SetIsEnabled |
| text | string | TextBlock | UTextBlock::SetText |
| justification | string | TextBlock | UTextBlock::SetJustification (enum) |
| colorAndOpacity | object {r,g,b,a} | TextBlock | UTextBlock::SetColorAndOpacity |

Color format: `{"r": 1.0, "g": 0.8, "b": 0.2, "a": 1.0}`. All 4 fields required, 0-1 floats. No hex, no alternative formats in v1.

### Slot Properties (FWidgetSlotPropertyApplier)

```cpp
class FWidgetSlotPropertyApplier
{
public:
    bool Apply(UPanelSlot* Slot, const FWidgetSlotSpec& Spec, const FString& Path, FString& OutError);
private:
    bool ApplyCanvasSlot(UCanvasPanelSlot* Slot, const FWidgetSlotSpec& Spec);
    bool ApplyVerticalBoxSlot(UVerticalBoxSlot* Slot, const FWidgetSlotSpec& Spec);
    bool ApplyHorizontalBoxSlot(UHorizontalBoxSlot* Slot, const FWidgetSlotSpec& Spec);
    bool ApplyOverlaySlot(UOverlaySlot* Slot, const FWidgetSlotSpec& Spec);
};
```

Early-out: if `!Spec.bHasSlot`, return true immediately.

Dispatches by actual slot class (`Cast<>`), not parent widget type.

Only calls setters when `bHas* == true`. Never normalizes missing fields.

Per-slot property mapping:

**UCanvasPanelSlot:**
- position -> SetPosition
- size -> SetSize
- alignment -> SetAlignment
- zOrder -> SetZOrder
- autoSize -> SetAutoSize
- padding NOT mapped to canvas (offsets != padding semantically)

**UVerticalBoxSlot / UHorizontalBoxSlot:**
- padding -> SetPadding
- alignment -> Interpreted differently than canvas. Box/overlay alignment maps to discrete enums (EHorizontalAlignment, EVerticalAlignment), not continuous floats. Conversion: X maps to HorizontalAlignment (0.0=Left, 0.5=Center, 1.0=Right, -1.0=Fill), Y maps to VerticalAlignment (0.0=Top, 0.5=Center, 1.0=Bottom, -1.0=Fill). Values that don't match a known threshold are rounded to nearest.

**UOverlaySlot:**
- padding -> SetPadding
- alignment -> Same float-to-enum conversion as box slots

**Content widget slots:**
Content widget slot classes vary by UE4 version. In UE4.27, Button/Border/SizeBox children may receive `UPanelSlot` or subclass-specific slots. The slot applier should cast to the actual slot class at runtime and apply padding/alignment where available. If the slot type is unrecognized (just `UPanelSlot` base), skip slot application gracefully.

Fields that don't apply to a given slot type are silently ignored.

Unrecognized slot types: log once per type, return success.

Assumes widget is already attached to parent and Slot is valid.

## Asset Factory

```cpp
class FWidgetBlueprintAssetFactory
{
public:
    static UWidgetBlueprint* CreateWidgetBlueprint(const FString& PackagePath, const FString& AssetName, FString& OutError);
    static UWidgetBlueprint* LoadWidgetBlueprint(const FString& AssetPath, FString& OutError);
};
```

Creation path: use `UWidgetBlueprintFactory` via `FAssetToolsModule`, not raw `NewObject` or generic `CreateBlueprint`.

```cpp
UWidgetBlueprintFactory* Factory = NewObject<UWidgetBlueprintFactory>();
Factory->ParentClass = UUserWidget::StaticClass();
UObject* Asset = AssetTools.CreateAsset(AssetName, PackagePath, UWidgetBlueprint::StaticClass(), Factory);
```

After creation:
- Assert `WidgetBlueprint->WidgetTree` exists (do not manually create WidgetTree -- if null, upstream creation failed)
- Call `FAssetRegistryModule::AssetCreated(WidgetBlueprint)` in the factory

## Finalizer

```cpp
class FWidgetBlueprintFinalizer
{
public:
    static bool Finalize(UWidgetBlueprint* WidgetBlueprint, bool bSave, FString& OutError);
};
```

Flow:
1. `FBlueprintEditorUtils::MarkBlueprintAsStructurallyModified(WidgetBlueprint)`
2. `FKismetEditorUtilities::CompileBlueprint(WidgetBlueprint)`
3. Mark package dirty
4. If bSave: `UPackage::SavePackage(...)` (only after compile)

The public API does not expose `bSave`. The orchestrator always passes `bSave = true` for `Build` (new assets should be persisted) and `bSave = false` for `Rebuild` (caller decides when to save). This can be revised if needed.

## Builder Orchestrator Flow

**Build (new asset):**
1. Parse JSON -> FWidgetBlueprintSpec
2. Validate spec
3. Create asset via factory
4. Clear tree: `WidgetTree->GetAllWidgets(Widgets)` copies into a TArray, then reverse-iterate (`i = Num-1; i >= 0; --i`) calling `WidgetTree->RemoveWidget(Widgets[i])` for each, then `WidgetTree->RootWidget = nullptr`. Reverse iteration avoids dependency issues if UE internally reorders on removal. `AllWidgets` is private in UE4.27 -- must use `GetAllWidgets()`.
5. Build tree via TreeBuilder -> returns root widget
6. Assign `WidgetTree->RootWidget = Root`
7. Finalize

**Rebuild (existing asset):**
1. Verify WidgetBlueprint and WidgetTree are valid
2. Parse JSON -> FWidgetBlueprintSpec
3. Validate spec
4. Clear tree (GetAllWidgets + reverse-iterate RemoveWidget, then RootWidget = nullptr)
5. Build tree -> returns root
6. Assign root
7. Finalize

**Validate (dry run):**
1. Parse JSON
2. Validate spec
3. Return result (no asset creation)

## Critical Implementation Rules

These behavioral constraints are derived from UE4.27 engine behavior and must be followed exactly.

**Root widget must NOT be attached to any parent.** The root widget is constructed and assigned directly to `WidgetTree->RootWidget`. It is never passed through `AddChild`. If root gets attached like a normal child, the tree will be broken or widgets invisible.

**Null slot after attachment is a hard error.** If `AddChild` succeeds but `Child->Slot` is null, something is structurally wrong. Do not continue building -- fail immediately.

**Asset creation fails if asset already exists.** `CreateWidgetBlueprint` checks for existing asset at path and returns error. No silent overwrite in v1. Use `RebuildWidgetFromJSON` for existing assets.

**Alignment values clamped to [-1.0, 1.0] before float-to-enum conversion.** Prevents unpredictable rounding from out-of-range inputs.

**Color object validation:** All 4 fields (r, g, b, a) must be present, must be numbers, clamped to [0, 1]. No implicit defaults. Construct via `FLinearColor(r, g, b, a)`.

**Compile success check:** After `FKismetEditorUtilities::CompileBlueprint`, verify `WidgetBlueprint->Status == BS_UpToDate`. If not, return error. Silent compile failures are unacceptable.

**Content widget child guard:** Check `ContentWidget->GetChildrenCount() == 0` before `AddChild`. Do not rely on UE silently replacing content.

## File Layout

Inside `ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/`:

### Public/
- `BlueprintGraphBuilderLibrary.h` (existing)
- `WidgetBlueprintBuilderLibrary.h`
- `WidgetBlueprintSpec.h`

### Private/
- `BlueprintGraphBuilderLibrary.cpp` (existing)
- `BlueprintGraphBuilderModule.cpp` (existing)
- `WidgetBlueprintBuilderLibrary.cpp`
- `WidgetBuilder/WidgetBlueprintBuilder.h`
- `WidgetBuilder/WidgetBlueprintBuilder.cpp`
- `WidgetBuilder/WidgetBlueprintAssetFactory.h`
- `WidgetBuilder/WidgetBlueprintAssetFactory.cpp`
- `WidgetBuilder/WidgetTreeBuilder.h`
- `WidgetBuilder/WidgetTreeBuilder.cpp`
- `WidgetBuilder/WidgetBlueprintJsonParser.h`
- `WidgetBuilder/WidgetBlueprintJsonParser.cpp`
- `WidgetBuilder/WidgetBlueprintValidator.h`
- `WidgetBuilder/WidgetBlueprintValidator.cpp`
- `WidgetBuilder/WidgetClassRegistry.h`
- `WidgetBuilder/WidgetClassRegistry.cpp`
- `WidgetBuilder/WidgetChildAttachment.h`
- `WidgetBuilder/WidgetChildAttachment.cpp`
- `WidgetBuilder/WidgetPropertyApplier.h`
- `WidgetBuilder/WidgetPropertyApplier.cpp`
- `WidgetBuilder/WidgetSlotPropertyApplier.h`
- `WidgetBuilder/WidgetSlotPropertyApplier.cpp`
- `WidgetBuilder/WidgetBlueprintFinalizer.h`
- `WidgetBuilder/WidgetBlueprintFinalizer.cpp`

### Build.cs Changes

Add to private dependencies: `UMG`, `UMGEditor`, `Slate`, `SlateCore`

## Pass Structure

### Pass 1: Asset creation + root assignment

**Scope:** FWidgetBlueprintAssetFactory, FWidgetBlueprintBuilder (skeleton), FWidgetBlueprintFinalizer, FWidgetBlueprintJsonParser (minimal), FWidgetClassRegistry (CanvasPanel only)

**Goal:** `BuildWidgetFromJSON("/Game/UI", "TestWidget", json)` creates a UWidgetBlueprint with a CanvasPanel root.

**Test JSON:**
```json
{"root": {"type": "CanvasPanel", "name": "RootCanvas"}}
```

**Success criteria:**
- Asset appears in Content Browser
- Opens in Widget Blueprint Editor Designer tab without errors
- Shows empty CanvasPanel as root
- Compiles clean

**Engine risk:** Finding the correct UWidgetBlueprint creation path in UE4.27.

### Pass 2: Leaf widgets under CanvasPanel

**Scope:** FWidgetTreeBuilder (basic), FWidgetChildAttachment (panel path only), FWidgetClassRegistry (add TextBlock, Image, Spacer)

**Goal:** Leaf widgets attach to CanvasPanel. Slot is created on attachment.

**Test JSON:** Root CanvasPanel with TextBlock and Image children.

**Success criteria:**
- Widgets visible in editor hierarchy with correct parent-child relationship
- Child->Slot != nullptr after attachment
- No recursion complexity yet (one level deep)

**Engine risk:** `WidgetTree->ConstructWidget` behavior, `UCanvasPanel::AddChild` slot creation.

### Pass 3: Multi-child panel recursion

**Scope:** FWidgetTreeBuilder (recursive), FWidgetClassRegistry (add VerticalBox, HorizontalBox, Overlay)

**Goal:** Nested panels work. Child order preserved. Arbitrary depth.

**Test JSON:** CanvasPanel -> VerticalBox -> [TextBlock, TextBlock]

**Success criteria:**
- Nested hierarchy renders correctly in editor
- Child ordering matches JSON array order exactly
- Panel-in-panel attachment is stable

**Engine risk:** Panel-in-panel attachment, slot types changing with parent.

### Pass 4: Single-child content widgets

**Scope:** FWidgetChildAttachment (content widget path), FWidgetClassRegistry (add Button, Border, SizeBox)

**Goal:** Content widgets accept exactly one child. Validation rejects >1.

**Test JSON:** CanvasPanel -> Button -> TextBlock

**Success criteria:**
- Content widget shows child in editor
- Validation fails on Button with 2 children
- Content widget attachment uses AddChild (same as panel -- UContentWidget inherits from UPanelWidget)
- GetChildrenCount() == 0 is checked before adding

**Engine risk:** Content widget child count enforcement, content slot class behavior in UE4.27.

### Pass 5: Slot properties by parent type

**Scope:** FWidgetSlotPropertyApplier (all slot types), FWidgetSlotSpec presence flags

**Goal:** Canvas position/size/alignment/zOrder work. Box padding/alignment work.

**Test JSON:** Full example with positioned TextBlocks under canvas and padded children under VerticalBox.

**Success criteria:**
- Widgets appear at specified positions in canvas
- Box children have correct padding and alignment
- Only fields with bHas* = true are applied
- Canvas padding is NOT applied (intentionally excluded)

**Engine risk:** Slot property setter API differences between slot classes, alignment enum mapping.

### Pass 6: Widget properties + compile/finalize

**Scope:** FWidgetPropertyApplier (base + type-specific), FWidgetBlueprintFinalizer, enum parsing helpers

**Goal:** Text content, visibility, opacity, color, justification all apply correctly. Blueprint compiles and works at runtime.

**Test JSON:** Full example with styled TextBlocks, hidden widgets, colored text.

**Success criteria:**
- Properties visible in editor details panel
- Blueprint compiles
- Asset can be placed in a level and displays correctly at runtime
- Enum values parse correctly (Visible/Hidden/Collapsed, Left/Center/Right)

**Engine risk:** Enum string parsing, FLinearColor struct construction, compile step revealing deferred errors.

## MCP Layer (after C++ passes complete)

### Python handlers

New file: `unreal-plugin/Content/Python/mcp_bridge/handlers/widgets.py`

Three handlers matching the three public C++ functions:
- `handle_widget_build_from_json` -- calls `unreal.WidgetBlueprintBuilderLibrary.build_widget_from_json(package_path, asset_name, json_string)`
- `handle_widget_rebuild_from_json` -- loads asset, calls `rebuild_widget_from_json(widget_bp, json_string)`
- `handle_widget_validate_json` -- calls `validate_widget_json(json_string)`

These use **dedicated handlers** (not `python_proxy`), matching the pattern used by `blueprint_create`, `blueprint_compile`, etc. The existing `blueprint_build_from_json` tool uses `python_proxy`, but for widgets we use dedicated handlers because we have three distinct operations with different parameter shapes.

Registered in `router.py`:
- `"widget_build_from_json"` -> `handle_widget_build_from_json`
- `"widget_rebuild_from_json"` -> `handle_widget_rebuild_from_json`
- `"widget_validate_json"` -> `handle_widget_validate_json`

### TypeScript tools

New file: `mcp-server/src/tools/widgets.ts`

Tools:
- `widget_blueprint_build_from_json` -- create new widget blueprint from JSON
- `widget_blueprint_rebuild_from_json` -- rebuild existing widget blueprint
- `widget_blueprint_validate_json` -- dry-run validation

Each tool maps to its corresponding command in the router. Mirrors existing blueprint tool pattern.

### index.ts changes

- Import and register widget tools
- Add `widget_blueprint_build_from_json` and `widget_blueprint_rebuild_from_json` to `modifyingCommands` set

## UE4 Engine Types Referenced

### Asset/Blueprint
- UWidgetBlueprint, UWidgetBlueprintGeneratedClass, UWidgetBlueprintFactory, UPackage

### Tree/Widget Base
- UWidgetTree, UWidget, UPanelWidget, UContentWidget, UPanelSlot

### Widgets (v1)
- UCanvasPanel, UTextBlock, UButton, UImage, UBorder, UVerticalBox, UHorizontalBox, UOverlay, USizeBox, USpacer

### Slot Classes
- UCanvasPanelSlot, UVerticalBoxSlot, UHorizontalBoxSlot, UOverlaySlot, UBorderSlot, USizeBoxSlot
- Note: UButtonSlot may not exist in UE4.27. Button children may get UPanelSlot base. Verify at implementation time.
