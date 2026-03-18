# Widget Blueprint Builder Pass 2: Leaf Widgets + CanvasPanel Attachment

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Leaf widgets (TextBlock, Image, Spacer) can be created and attached as children of a CanvasPanel root, producing a valid widget hierarchy in the UE4 editor.

**Architecture:** Extend `FWidgetClassRegistry` with three new leaf types. Create `FWidgetChildAttachment` (panel path only) to handle `UPanelWidget::AddChild()` with slot validation. Extend `FWidgetTreeBuilder::BuildNode` to call attachment and recurse into children. No properties, no slot properties, no content widgets.

**Scope note:** The spec says Pass 2 is "one level deep" and Pass 3 adds recursion. This plan implements the recursion loop in Pass 2 because the code is trivial (a for loop over `Spec.Children`) and avoids a throwaway non-recursive version. Pass 2 testing only exercises one level. Pass 3 scope reduces to: add VerticalBox/HorizontalBox/Overlay types and test nested panel-in-panel hierarchies.

**Tech Stack:** C++ (UE4.27 Slate/UMG), no external dependencies

**Spec:** `docs/superpowers/specs/2026-03-18-widget-blueprint-builder-design.md` (Pass 2 section, lines 580-593; Child Attachment section, lines 325-343)

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `Private/WidgetBuilder/WidgetClassRegistry.cpp` | Register TextBlock, Image, Spacer as Leaf types |
| Create | `Private/WidgetBuilder/WidgetChildAttachment.h` | `FWidgetChildAttachment` class declaration |
| Create | `Private/WidgetBuilder/WidgetChildAttachment.cpp` | Panel attachment via `UPanelWidget::AddChild()`, slot validation |
| Modify | `Private/WidgetBuilder/WidgetTreeBuilder.h` | Add `FWidgetChildAttachment&` member |
| Modify | `Private/WidgetBuilder/WidgetTreeBuilder.cpp` | Call attachment + recurse children in `BuildNode` |
| Modify | `Private/WidgetBuilder/WidgetBlueprintBuilder.cpp` | Construct `FWidgetChildAttachment`, pass to `FWidgetTreeBuilder` |

All paths relative to `ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/`.

After code changes, copy the entire `ue4-plugin/BlueprintGraphBuilder/` directory to `D:\Unreal Projects\CodePlayground\Plugins\BlueprintGraphBuilder\` (overwriting Source/), then compile inside UE4.

---

## Task 1: Register Leaf Widget Types

**Files:**
- Modify: `Private/WidgetBuilder/WidgetClassRegistry.cpp`

- [ ] **Step 1: Add includes for leaf widget headers**

At the top of `WidgetClassRegistry.cpp`, add:

```cpp
#include "Components/TextBlock.h"
#include "Components/Image.h"
#include "Components/Spacer.h"
```

- [ ] **Step 2: Register TextBlock, Image, Spacer in `RegisterTypes()`**

After the existing CanvasPanel registration block, add:

```cpp
// Pass 2: Leaf widgets
FWidgetTypeInfo TextBlockInfo;
TextBlockInfo.WidgetClass = UTextBlock::StaticClass();
TextBlockInfo.Category = EWidgetCategory::Leaf;
TypeRegistry.Add(TEXT("TextBlock"), MoveTemp(TextBlockInfo));

FWidgetTypeInfo ImageInfo;
ImageInfo.WidgetClass = UImage::StaticClass();
ImageInfo.Category = EWidgetCategory::Leaf;
TypeRegistry.Add(TEXT("Image"), MoveTemp(ImageInfo));

FWidgetTypeInfo SpacerInfo;
SpacerInfo.WidgetClass = USpacer::StaticClass();
SpacerInfo.Category = EWidgetCategory::Leaf;
TypeRegistry.Add(TEXT("Spacer"), MoveTemp(SpacerInfo));
```

No properties registered for any of these types yet (Pass 6).

- [ ] **Step 3: Commit**

```bash
git add ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/WidgetBuilder/WidgetClassRegistry.cpp
git commit -m "feat(widget-builder): register TextBlock, Image, Spacer as leaf types"
```

---

## Task 2: Create FWidgetChildAttachment

**Files:**
- Create: `Private/WidgetBuilder/WidgetChildAttachment.h`
- Create: `Private/WidgetBuilder/WidgetChildAttachment.cpp`

- [ ] **Step 1: Create `WidgetChildAttachment.h`**

```cpp
#pragma once

#include "CoreMinimal.h"

class UWidget;
class UPanelWidget;

class FWidgetChildAttachment
{
public:
    bool AttachChild(UWidget* Parent, UWidget* Child, const FString& Path, FString& OutError);

private:
    bool AttachToPanel(UPanelWidget* Panel, UWidget* Child, const FString& Path, FString& OutError);
};
```

Notes:
- `Path` parameter is for error messages (e.g., "Root.Text1"). This is a deliberate addition to the spec's `AttachChild(Parent, Child, OutError)` signature for better debug output.
- Only the panel path is implemented in Pass 2. Content path is added in Pass 4.
- The spec's `GetCategory` method is not needed here because the validator already rejects children on leaf widgets. The attachment code only runs for panel parents.

- [ ] **Step 2: Create `WidgetChildAttachment.cpp`**

```cpp
#include "WidgetChildAttachment.h"
#include "Components/PanelWidget.h"
#include "Components/Widget.h"

bool FWidgetChildAttachment::AttachChild(UWidget* Parent, UWidget* Child, const FString& Path, FString& OutError)
{
    if (!Parent || !Child)
    {
        OutError = FString::Printf(TEXT("[WidgetBuilder] %s: Null parent or child in attachment"), *Path);
        return false;
    }

    UPanelWidget* Panel = Cast<UPanelWidget>(Parent);
    if (Panel)
    {
        return AttachToPanel(Panel, Child, Path, OutError);
    }

    // If parent is not a panel, attachment is not supported (content widgets added in Pass 4)
    OutError = FString::Printf(TEXT("[WidgetBuilder] %s: Parent '%s' is not a panel widget, cannot attach children"),
        *Path, *Parent->GetName());
    return false;
}

bool FWidgetChildAttachment::AttachToPanel(UPanelWidget* Panel, UWidget* Child, const FString& Path, FString& OutError)
{
    Panel->AddChild(Child);

    if (!Child->Slot)
    {
        OutError = FString::Printf(TEXT("[WidgetBuilder] %s: Slot is null after attaching '%s' to panel '%s'"),
            *Path, *Child->GetName(), *Panel->GetName());
        return false;
    }

    UE_LOG(LogTemp, Log, TEXT("[WidgetBuilder] %s: Attached '%s' to panel '%s'"),
        *Path, *Child->GetName(), *Panel->GetName());

    return true;
}
```

Key decisions:
- Uses `UPanelWidget::AddChild(Child)` which is the correct UE4.27 API for all panel types including `UCanvasPanel`. This creates the correct slot type (`UCanvasPanelSlot` for CanvasPanel, `UVerticalBoxSlot` for VerticalBox, etc.) automatically. The user's guidance to use `CanvasPanel->AddChildToCanvas()` is noted, but `UPanelWidget::AddChild()` is the base class method that all panels share, and it already dispatches to the correct slot creation internally. This keeps the code generic for Pass 3 when more panel types are added.
- Hard fail on null slot after attachment (spec requirement, line 342).
- Debug logging on every attachment (user's suggestion for Pass 2 debugging).

- [ ] **Step 3: Commit**

```bash
git add ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/WidgetBuilder/WidgetChildAttachment.h
git add ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/WidgetBuilder/WidgetChildAttachment.cpp
git commit -m "feat(widget-builder): add FWidgetChildAttachment with panel attachment path"
```

---

## Task 3: Extend FWidgetTreeBuilder for Recursive Children

**Files:**
- Modify: `Private/WidgetBuilder/WidgetTreeBuilder.h`
- Modify: `Private/WidgetBuilder/WidgetTreeBuilder.cpp`

- [ ] **Step 1: Update `WidgetTreeBuilder.h` to accept `FWidgetChildAttachment`**

Replace the constructor and add the member:

```cpp
#pragma once

#include "CoreMinimal.h"
#include "WidgetBlueprintSpec.h"

class UWidgetBlueprint;
class UWidgetTree;
class UWidget;
class FWidgetClassRegistry;
class FWidgetChildAttachment;

class FWidgetTreeBuilder
{
public:
    FWidgetTreeBuilder(const FWidgetClassRegistry& InClassRegistry, FWidgetChildAttachment& InChildAttachment);

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
    FWidgetChildAttachment& ChildAttachment;
};
```

- [ ] **Step 2: Update `WidgetTreeBuilder.cpp` with attachment + recursion**

Replace the entire file:

```cpp
#include "WidgetTreeBuilder.h"
#include "WidgetClassRegistry.h"
#include "WidgetChildAttachment.h"
#include "WidgetBlueprint.h"
#include "Blueprint/WidgetTree.h"
#include "Components/Widget.h"

FWidgetTreeBuilder::FWidgetTreeBuilder(const FWidgetClassRegistry& InClassRegistry, FWidgetChildAttachment& InChildAttachment)
    : ClassRegistry(InClassRegistry)
    , ChildAttachment(InChildAttachment)
{
}

UWidget* FWidgetTreeBuilder::BuildTree(
    UWidgetBlueprint* WidgetBP,
    UWidgetTree* WidgetTree,
    const FWidgetBlueprintSpec& Spec,
    FString& OutError)
{
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

    // Step 3: Attach to parent (skip for root -- root is assigned to WidgetTree->RootWidget by caller)
    if (Parent)
    {
        if (!ChildAttachment.AttachChild(Parent, Widget, Path, OutError))
        {
            return nullptr;
        }
    }

    // Step 4: Recurse into children
    for (int32 i = 0; i < Spec.Children.Num(); ++i)
    {
        const FWidgetNodeSpec& ChildSpec = Spec.Children[i];
        FString ChildPath = FString::Printf(TEXT("%s.%s"), *Path, *ChildSpec.Name);

        UWidget* Child = BuildNode(WidgetBP, WidgetTree, ChildSpec, Widget, ChildPath, OutError);
        if (!Child)
        {
            return nullptr;
        }
    }

    return Widget;
}
```

Key points:
- Root widget (Parent == nullptr) is NOT attached -- the caller (`FWidgetBlueprintBuilder::Build`) assigns it to `WidgetTree->RootWidget`.
- Children are attached to their parent via `ChildAttachment.AttachChild()`.
- Recursion happens naturally -- each child's children are processed in the same call.
- Failure in any child aborts the entire tree build (hard fail).
- Order is preserved: JSON array index = AddChild call order.

- [ ] **Step 3: Commit**

```bash
git add ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/WidgetBuilder/WidgetTreeBuilder.h
git add ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/WidgetBuilder/WidgetTreeBuilder.cpp
git commit -m "feat(widget-builder): add child attachment and recursion to tree builder"
```

---

## Task 4: Wire FWidgetChildAttachment into FWidgetBlueprintBuilder

**Files:**
- Modify: `Private/WidgetBuilder/WidgetBlueprintBuilder.cpp`

- [ ] **Step 1: Add include and construct attachment**

Add include at top:

```cpp
#include "WidgetChildAttachment.h"
```

- [ ] **Step 2: Update Build() and Rebuild() to pass attachment to tree builder**

In both `Build()` and `Rebuild()`, change the tree builder construction from:

```cpp
FWidgetTreeBuilder TreeBuilder(Registry);
```

to:

```cpp
FWidgetChildAttachment ChildAttachment;
FWidgetTreeBuilder TreeBuilder(Registry, ChildAttachment);
```

This change is identical in both methods (lines 52 and 108 of the current file).

- [ ] **Step 3: Commit**

```bash
git add ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/WidgetBuilder/WidgetBlueprintBuilder.cpp
git commit -m "feat(widget-builder): wire child attachment into build pipeline"
```

---

## Task 5: Compile and Test in UE4

**Files:**
- No code changes. This is a build + manual verification task.

- [ ] **Step 1: Copy source to project plugin directory**

Copy `ue4-plugin/BlueprintGraphBuilder/Source/` to `D:\Unreal Projects\CodePlayground\Plugins\BlueprintGraphBuilder\Source\` (overwrite).

- [ ] **Step 2: Compile in UE4**

Build the project in UE4 editor or via UnrealBuildTool. Fix any compile errors.

Common issues to watch for:
- Missing `#include "Components/PanelSlot.h"` if `UPanelSlot` is not found
- `UPanelWidget::AddChild` return type -- verify it returns `UPanelSlot*` in UE4.27
- If `AddChild` does not return a slot pointer, check `Child->Slot` directly instead

- [ ] **Step 3: Test with leaf children JSON via python_proxy**

Run this Python script through UE4's Python console or via `python_proxy` MCP tool:

```python
import unreal

json_str = '{"root": {"type": "CanvasPanel", "name": "Root", "children": [{"type": "TextBlock", "name": "Text1"}, {"type": "Image", "name": "Image1"}, {"type": "Spacer", "name": "Spacer1"}]}}'
result = unreal.WidgetBlueprintBuilderLibrary.build_widget_from_json('/Game/UI', 'Pass2Test', json_str)
print('Result:', result)
```

- [ ] **Step 4: Verify in editor**

Open the created Widget Blueprint in UE4 editor. Confirm:

1. **Hierarchy panel** shows:
   ```
   Root (CanvasPanel)
     +-- Text1 (TextBlock)
     +-- Image1 (Image)
     +-- Spacer1 (Spacer)
   ```
2. **Designer tab** shows all three widgets (default placement, overlapping at origin is fine)
3. **No compile errors** in the blueprint
4. **No warnings** in the Output Log (except the expected `[WidgetBuilder]` log lines)

- [ ] **Step 5: Test rebuild (deterministic)**

```python
import unreal

# Load the existing asset
widget_bp = unreal.load_asset('/Game/UI/Pass2Test')

# Rebuild with different children
json_str = '{"root": {"type": "CanvasPanel", "name": "Root", "children": [{"type": "TextBlock", "name": "Title"}, {"type": "Image", "name": "Icon"}]}}'
result = unreal.WidgetBlueprintBuilderLibrary.rebuild_widget_from_json(widget_bp, json_str)
print('Rebuild result:', result)
```

Verify: old children (Text1, Image1, Spacer1) are gone, new children (Title, Icon) are present. No ghost widgets.

- [ ] **Step 6: Test validation rejects children on leaf**

```python
import unreal

# TextBlock with children should fail validation
json_str = '{"root": {"type": "CanvasPanel", "name": "Root", "children": [{"type": "TextBlock", "name": "Text1", "children": [{"type": "Image", "name": "Nested"}]}]}}'
result = unreal.WidgetBlueprintBuilderLibrary.validate_widget_json(json_str)
print('Should be error:', result)
```

Expected: error string containing "Leaf widget" and "cannot have children".

- [ ] **Step 7: Commit pass completion**

```bash
git add -A
git commit -m "feat(widget-builder): complete Pass 2 - leaf widgets under CanvasPanel"
```

---

## Success Criteria (from spec + user guidance)

All must be true before Pass 2 is considered complete:

- [x] TextBlock, Image, Spacer resolve via `FWidgetClassRegistry`
- [x] Children attach to CanvasPanel with valid slots (`Child->Slot != nullptr`)
- [x] Editor hierarchy shows correct parent-child relationships
- [x] Designer tab shows widgets (default placement)
- [x] Rebuild is deterministic (no ghost widgets)
- [x] Validation rejects children on leaf widgets
- [x] No crashes, no editor warnings
- [x] Compiles clean
