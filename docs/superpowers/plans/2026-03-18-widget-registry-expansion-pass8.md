# Widget Registry Expansion Pass 8 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the Widget Blueprint Builder's registry from 10 to 19 widget types so AI-generated UI never rejects common widget types, with strict validated property contracts for every new type.

**Architecture:** All changes are in the existing C++ plugin at `ue4-plugin/BlueprintGraphBuilder/`. The work flows through five layers in order: spec structs → parser → validator → registry → appliers → tree builder. Each layer builds on the previous. No new files created -- all changes extend existing files.

**Tech Stack:** UE4.27 C++, UMG widget system, existing FWidgetClassRegistry/FWidgetPropertyApplier/FWidgetSlotPropertyApplier pattern. Build with Unreal Build Tool inside the CodePlayground project.

---

## File Map

| File | What changes |
|---|---|
| `Public/WidgetBlueprintSpec.h` | Add 8 new FWidgetSlotSpec fields (Row/Column/RowSpan/ColumnSpan + bHas* flags, HorizontalAlignment/VerticalAlignment strings + bHas* flags) |
| `Private/WidgetBuilder/WidgetBlueprintJsonParser.cpp` | Extend ValidSlotKeys; parse 6 new slot fields |
| `Private/WidgetBuilder/WidgetBlueprintValidator.cpp` | Add file-static `ValidateWidgetPropertyValues` helper; add 16 new property/slot validation rules called from `ValidateNode` |
| `Private/WidgetBuilder/WidgetClassRegistry.h` | Declare 3 private helper methods (RegisterPanel/RegisterContent/RegisterLeaf) |
| `Private/WidgetBuilder/WidgetClassRegistry.cpp` | Implement helpers; add 9 new type registrations; add 9 required headers |
| `Private/WidgetBuilder/WidgetPropertyApplier.h` | Declare 6 new private applier methods |
| `Private/WidgetBuilder/WidgetPropertyApplier.cpp` | Implement 6 new applier methods + dispatch branches; add 6 required headers; add centralized enum helpers |
| `Private/WidgetBuilder/WidgetSlotPropertyApplier.h` | Add forward declarations for UGridSlot, UScrollBoxSlot, UWrapBoxSlot |
| `Private/WidgetBuilder/WidgetSlotPropertyApplier.cpp` | Implement GridSlot/ScrollBoxSlot/WrapBoxSlot branches; implement alignment string-to-enum helpers; add 3 required headers |
| `Private/WidgetBuilder/WidgetTreeBuilder.h` | Update BuildTree/BuildNode signatures to thread AnimationTargets |
| `Private/WidgetBuilder/WidgetTreeBuilder.cpp` | Implement bIsVariable rule in BuildNode; add GridPanel column initialization; update signatures |
| `Private/WidgetBuilder/WidgetBlueprintBuilder.cpp` | Construct AnimationTargets TSet before calling BuildTree in Build() and Rebuild() |

All paths relative to `ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/`.

---

## Task 1: Extend FWidgetSlotSpec with new fields

**Files:**
- Modify: `Public/WidgetBlueprintSpec.h`

- [ ] **Step 1: Add the new fields to FWidgetSlotSpec**

Open `ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Public/WidgetBlueprintSpec.h`.

After the existing `bool bHasAutoSize = false;` line (line 41), add:

```cpp
	// Grid-specific slot fields (only meaningful for GridPanel children)
	int32 Row = 0;
	int32 Column = 0;
	int32 RowSpan = 1;
	int32 ColumnSpan = 1;
	bool bHasRow = false;
	bool bHasColumn = false;
	bool bHasRowSpan = false;
	bool bHasColumnSpan = false;

	// Explicit enum-style alignment fields for Grid/ScrollBox/WrapBox slots.
	// Separate from the existing Alignment FVector2D (Canvas/Box/Overlay only).
	FString HorizontalAlignment;
	FString VerticalAlignment;
	bool bHasHorizontalAlignment = false;
	bool bHasVerticalAlignment = false;
```

- [ ] **Step 2: Verify the struct compiles**

Open the CodePlayground `.uproject` in UE4.27 and trigger a build (or use `UnrealBuildTool` directly). The goal is to confirm the struct change compiles cleanly before touching any other files.

Expected: no compile errors on WidgetBlueprintSpec.h.

- [ ] **Step 3: Commit**

```bash
git add ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Public/WidgetBlueprintSpec.h
git commit -m "feat(widget-builder): extend FWidgetSlotSpec with grid and alignment fields"
```

---

## Task 2: Extend JSON parser to accept new slot fields

**Files:**
- Modify: `Private/WidgetBuilder/WidgetBlueprintJsonParser.cpp`

- [ ] **Step 1: Update ValidSlotKeys**

In `WidgetBlueprintJsonParser.cpp`, find the `ValidSlotKeys` static set (line 8). Replace it with:

```cpp
static const TSet<FString> ValidSlotKeys = {
    TEXT("position"), TEXT("size"), TEXT("alignment"), TEXT("padding"),
    TEXT("zOrder"), TEXT("autoSize"),
    TEXT("row"), TEXT("column"), TEXT("rowSpan"), TEXT("columnSpan"),
    TEXT("horizontalAlignment"), TEXT("verticalAlignment")
};
```

- [ ] **Step 2: Parse the new slot fields in ParseSlotSpec**

In `ParseSlotSpec`, after the existing `autoSize` block (around line 206), add:

```cpp
	// row
	double RowVal;
	if (SlotObj->TryGetNumberField(TEXT("row"), RowVal))
	{
		OutSlot.Row = static_cast<int32>(RowVal);
		OutSlot.bHasRow = true;
	}

	// column
	double ColVal;
	if (SlotObj->TryGetNumberField(TEXT("column"), ColVal))
	{
		OutSlot.Column = static_cast<int32>(ColVal);
		OutSlot.bHasColumn = true;
	}

	// rowSpan
	double RowSpanVal;
	if (SlotObj->TryGetNumberField(TEXT("rowSpan"), RowSpanVal))
	{
		OutSlot.RowSpan = static_cast<int32>(RowSpanVal);
		OutSlot.bHasRowSpan = true;
	}

	// columnSpan
	double ColSpanVal;
	if (SlotObj->TryGetNumberField(TEXT("columnSpan"), ColSpanVal))
	{
		OutSlot.ColumnSpan = static_cast<int32>(ColSpanVal);
		OutSlot.bHasColumnSpan = true;
	}

	// horizontalAlignment
	FString HAStr;
	if (SlotObj->TryGetStringField(TEXT("horizontalAlignment"), HAStr))
	{
		OutSlot.HorizontalAlignment = HAStr;
		OutSlot.bHasHorizontalAlignment = true;
	}

	// verticalAlignment
	FString VAStr;
	if (SlotObj->TryGetStringField(TEXT("verticalAlignment"), VAStr))
	{
		OutSlot.VerticalAlignment = VAStr;
		OutSlot.bHasVerticalAlignment = true;
	}
```

- [ ] **Step 3: Build and verify no compile errors**

- [ ] **Step 4: Commit**

```bash
git add ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/WidgetBuilder/WidgetBlueprintJsonParser.cpp
git commit -m "feat(widget-builder): parse grid slot and alignment fields in JSON parser"
```

---

## Task 3: Add registry helper methods and 9 new widget types

**Files:**
- Modify: `Private/WidgetBuilder/WidgetClassRegistry.h`
- Modify: `Private/WidgetBuilder/WidgetClassRegistry.cpp`

- [ ] **Step 1: Declare helpers in header**

In `WidgetClassRegistry.h`, add three private method declarations after `static void AddCommonProperties(FWidgetTypeInfo& Info);`:

```cpp
	void RegisterPanel(const FString& TypeName, TSubclassOf<UWidget> WidgetClass);
	void RegisterContent(const FString& TypeName, TSubclassOf<UWidget> WidgetClass,
		TArray<FWidgetPropertyDescriptor> TypeSpecificProps = {});
	void RegisterLeaf(const FString& TypeName, TSubclassOf<UWidget> WidgetClass,
		TArray<FWidgetPropertyDescriptor> TypeSpecificProps);
```

- [ ] **Step 2: Add required includes to WidgetClassRegistry.cpp**

Add after the existing includes:

```cpp
#include "Components/ScrollBox.h"
#include "Components/GridPanel.h"
#include "Components/WrapBox.h"
#include "Components/ScaleBox.h"
#include "Components/ProgressBar.h"
#include "Components/Slider.h"
#include "Components/CheckBox.h"
#include "Components/EditableTextBox.h"
#include "Components/RichTextBlock.h"
```

- [ ] **Step 3: Implement the three helper methods**

Add before `FWidgetClassRegistry::FWidgetClassRegistry()`:

```cpp
void FWidgetClassRegistry::RegisterPanel(const FString& TypeName, TSubclassOf<UWidget> WidgetClass)
{
	FWidgetTypeInfo Info;
	Info.WidgetClass = WidgetClass;
	Info.Category = EWidgetCategory::Panel;
	AddCommonProperties(Info);
	TypeRegistry.Add(TypeName, MoveTemp(Info));
}

void FWidgetClassRegistry::RegisterContent(const FString& TypeName, TSubclassOf<UWidget> WidgetClass,
	TArray<FWidgetPropertyDescriptor> TypeSpecificProps)
{
	FWidgetTypeInfo Info;
	Info.WidgetClass = WidgetClass;
	Info.Category = EWidgetCategory::Content;
	AddCommonProperties(Info);
	for (auto& Prop : TypeSpecificProps) { Info.SupportedProperties.Add(MoveTemp(Prop)); }
	TypeRegistry.Add(TypeName, MoveTemp(Info));
}

void FWidgetClassRegistry::RegisterLeaf(const FString& TypeName, TSubclassOf<UWidget> WidgetClass,
	TArray<FWidgetPropertyDescriptor> TypeSpecificProps)
{
	FWidgetTypeInfo Info;
	Info.WidgetClass = WidgetClass;
	Info.Category = EWidgetCategory::Leaf;
	AddCommonProperties(Info);
	for (auto& Prop : TypeSpecificProps) { Info.SupportedProperties.Add(MoveTemp(Prop)); }
	TypeRegistry.Add(TypeName, MoveTemp(Info));
}
```

- [ ] **Step 4: Register the 9 new types**

At the end of `RegisterTypes()`, add:

```cpp
	// Pass 8: new panels
	RegisterPanel(TEXT("ScrollBox"), UScrollBox::StaticClass());
	RegisterPanel(TEXT("GridPanel"), UGridPanel::StaticClass());
	RegisterPanel(TEXT("WrapBox"),   UWrapBox::StaticClass());

	// Pass 8: new content
	RegisterContent(TEXT("ScaleBox"), UScaleBox::StaticClass(),
		{ {TEXT("stretch"), EJson::String}, {TEXT("stretchDirection"), EJson::String},
		  {TEXT("userSpecifiedScale"), EJson::Number} });

	// Pass 8: new leaf
	RegisterLeaf(TEXT("ProgressBar"), UProgressBar::StaticClass(),
		{ {TEXT("percent"), EJson::Number}, {TEXT("fillColorAndOpacity"), EJson::Object},
		  {TEXT("barFillType"), EJson::String}, {TEXT("isMarquee"), EJson::Boolean} });

	RegisterLeaf(TEXT("Slider"), USlider::StaticClass(),
		{ {TEXT("value"), EJson::Number}, {TEXT("minValue"), EJson::Number},
		  {TEXT("maxValue"), EJson::Number}, {TEXT("stepSize"), EJson::Number},
		  {TEXT("orientation"), EJson::String} });

	RegisterLeaf(TEXT("CheckBox"), UCheckBox::StaticClass(),
		{ {TEXT("isChecked"), EJson::Boolean} });

	RegisterLeaf(TEXT("EditableTextBox"), UEditableTextBox::StaticClass(),
		{ {TEXT("text"), EJson::String}, {TEXT("hintText"), EJson::String},
		  {TEXT("isReadOnly"), EJson::Boolean}, {TEXT("justification"), EJson::String} });

	RegisterLeaf(TEXT("RichTextBlock"), URichTextBlock::StaticClass(),
		{ {TEXT("text"), EJson::String}, {TEXT("justification"), EJson::String},
		  {TEXT("autoWrapText"), EJson::Boolean} });
```

- [ ] **Step 5: Build and verify 19 types registered**

Build the plugin. Then in UE4, call `ValidateWidgetJSON` with this JSON and confirm it passes (unknown type would fail):

```json
{"root": {"type": "ScrollBox", "name": "Root"}}
```

And confirm this still fails (unknown type):

```json
{"root": {"type": "ComboBox", "name": "Root"}}
```

- [ ] **Step 6: Commit**

```bash
git add ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/WidgetBuilder/WidgetClassRegistry.h
git add ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/WidgetBuilder/WidgetClassRegistry.cpp
git commit -m "feat(widget-builder): add 9 new widget types to registry with helper methods"
```

---

## Task 4: Add validation rules for new widget types and slot fields

**Files:**
- Modify: `Private/WidgetBuilder/WidgetBlueprintValidator.cpp`

The validator currently checks property existence and JSON types, but not semantic validity (e.g., percent out of range). This task adds those semantic rules.

- [ ] **Step 1: Add a ValidateWidgetPropertyValues file-static helper**

The existing `ValidateNode` checks that properties exist in the registry and have matching JSON types. Add a new **file-static** function `ValidateWidgetPropertyValues` in `WidgetBlueprintValidator.cpp`. Do NOT add any declaration to `WidgetBlueprintValidator.h` -- the spec marks that header as unchanged. Define the function just before `ValidateNode` in the `.cpp`:

- [ ] **Step 2: Implement ValidateWidgetPropertyValues in validator .cpp**

In `WidgetBlueprintValidator.cpp`, find the `ValidateNode` function. Add the following function body IMMEDIATELY BEFORE `ValidateNode` (not after -- C++ requires the definition to appear before any call site, and there is no forward declaration):

```cpp
static bool ValidateWidgetPropertyValues(
    const FWidgetNodeSpec& Node,
    const FString& Path,
    FString& OutError)
{
    const FString& T = Node.Type;
    const auto& Props = Node.Properties;

    // ProgressBar
    if (T == TEXT("ProgressBar"))
    {
        const TSharedPtr<FJsonValue>* PctVal = Props.Find(TEXT("percent"));
        if (PctVal && (*PctVal)->Type == EJson::Number)
        {
            double V = (*PctVal)->AsNumber();
            if (V < 0.0 || V > 1.0)
            {
                OutError = FString::Printf(TEXT("[WidgetBuilder] %s: 'percent' %.2f is outside [0.0, 1.0]"), *Path, V);
                return false;
            }
        }
        const TSharedPtr<FJsonValue>* FillTypeVal = Props.Find(TEXT("barFillType"));
        if (FillTypeVal && (*FillTypeVal)->Type == EJson::String)
        {
            static const TSet<FString> ValidFillTypes = {
                TEXT("LeftToRight"), TEXT("RightToLeft"), TEXT("FillFromCenter"),
                TEXT("TopToBottom"), TEXT("BottomToTop")
            };
            if (!ValidFillTypes.Contains((*FillTypeVal)->AsString()))
            {
                OutError = FString::Printf(TEXT("[WidgetBuilder] %s: Unknown barFillType '%s'"), *Path, *(*FillTypeVal)->AsString());
                return false;
            }
        }
        const TSharedPtr<FJsonValue>* ColorVal = Props.Find(TEXT("fillColorAndOpacity"));
        if (ColorVal && (*ColorVal)->Type == EJson::Object)
        {
            const TSharedPtr<FJsonObject>& Obj = (*ColorVal)->AsObject();
            for (const FString& Ch : { FString(TEXT("r")), FString(TEXT("g")), FString(TEXT("b")), FString(TEXT("a")) })
            {
                double ChVal;
                if (!Obj->TryGetNumberField(Ch, ChVal))
                {
                    OutError = FString::Printf(TEXT("[WidgetBuilder] %s: fillColorAndOpacity missing field '%s'"), *Path, *Ch);
                    return false;
                }
                if (ChVal < 0.0 || ChVal > 1.0)
                {
                    OutError = FString::Printf(TEXT("[WidgetBuilder] %s: fillColorAndOpacity '%s' %.2f outside [0,1]"), *Path, *Ch, ChVal);
                    return false;
                }
            }
        }
    }

    // Slider
    if (T == TEXT("Slider"))
    {
        double MinV = 0.0, MaxV = 1.0;
        bool bHasMin = false, bHasMax = false;
        const TSharedPtr<FJsonValue>* MinVal = Props.Find(TEXT("minValue"));
        const TSharedPtr<FJsonValue>* MaxVal = Props.Find(TEXT("maxValue"));
        if (MinVal && (*MinVal)->Type == EJson::Number) { MinV = (*MinVal)->AsNumber(); bHasMin = true; }
        if (MaxVal && (*MaxVal)->Type == EJson::Number) { MaxV = (*MaxVal)->AsNumber(); bHasMax = true; }

        if (bHasMin && bHasMax && MaxV < MinV)
        {
            OutError = FString::Printf(TEXT("[WidgetBuilder] %s: Slider maxValue %.2f < minValue %.2f"), *Path, MaxV, MinV);
            return false;
        }

        const TSharedPtr<FJsonValue>* StepVal = Props.Find(TEXT("stepSize"));
        if (StepVal && (*StepVal)->Type == EJson::Number && (*StepVal)->AsNumber() <= 0.0)
        {
            OutError = FString::Printf(TEXT("[WidgetBuilder] %s: Slider stepSize must be > 0"), *Path);
            return false;
        }

        const TSharedPtr<FJsonValue>* ValProp = Props.Find(TEXT("value"));
        if (ValProp && (*ValProp)->Type == EJson::Number)
        {
            double V = (*ValProp)->AsNumber();
            // Use explicit defaults if one bound missing
            double EffMin = bHasMin ? MinV : 0.0;
            double EffMax = bHasMax ? MaxV : 1.0;
            if (V < EffMin || V > EffMax)
            {
                OutError = FString::Printf(TEXT("[WidgetBuilder] %s: 'value' %.2f is outside [minValue=%.2f, maxValue=%.2f]"),
                    *Path, V, EffMin, EffMax);
                return false;
            }
        }

        const TSharedPtr<FJsonValue>* OrientVal = Props.Find(TEXT("orientation"));
        if (OrientVal && (*OrientVal)->Type == EJson::String)
        {
            const FString& S = (*OrientVal)->AsString();
            if (S != TEXT("Horizontal") && S != TEXT("Vertical"))
            {
                OutError = FString::Printf(TEXT("[WidgetBuilder] %s: Unknown orientation '%s'"), *Path, *S);
                return false;
            }
        }
    }

    // Justification (TextBlock, EditableTextBox, RichTextBlock share same valid values)
    static const TSet<FString> ValidJustification = { TEXT("Left"), TEXT("Center"), TEXT("Right") };
    if (T == TEXT("EditableTextBox") || T == TEXT("RichTextBlock"))
    {
        const TSharedPtr<FJsonValue>* JustVal = Props.Find(TEXT("justification"));
        if (JustVal && (*JustVal)->Type == EJson::String && !ValidJustification.Contains((*JustVal)->AsString()))
        {
            OutError = FString::Printf(TEXT("[WidgetBuilder] %s: Unknown justification '%s'"), *Path, *(*JustVal)->AsString());
            return false;
        }
    }

    // ScaleBox
    if (T == TEXT("ScaleBox"))
    {
        static const TSet<FString> ValidStretch = {
            TEXT("None"), TEXT("Fill"), TEXT("ScaleToFit"), TEXT("ScaleToFitX"),
            TEXT("ScaleToFitY"), TEXT("ScaleToFill"), TEXT("ScaleBySafeZone"), TEXT("UserSpecified")
        };
        static const TSet<FString> ValidStretchDir = { TEXT("Both"), TEXT("DownOnly"), TEXT("UpOnly") };

        const TSharedPtr<FJsonValue>* StretchVal = Props.Find(TEXT("stretch"));
        if (StretchVal && (*StretchVal)->Type == EJson::String && !ValidStretch.Contains((*StretchVal)->AsString()))
        {
            OutError = FString::Printf(TEXT("[WidgetBuilder] %s: Unknown stretch '%s'"), *Path, *(*StretchVal)->AsString());
            return false;
        }
        const TSharedPtr<FJsonValue>* DirVal = Props.Find(TEXT("stretchDirection"));
        if (DirVal && (*DirVal)->Type == EJson::String && !ValidStretchDir.Contains((*DirVal)->AsString()))
        {
            OutError = FString::Printf(TEXT("[WidgetBuilder] %s: Unknown stretchDirection '%s'"), *Path, *(*DirVal)->AsString());
            return false;
        }
    }

    // Visibility (all widgets)
    const TSharedPtr<FJsonValue>* VisVal = Props.Find(TEXT("visibility"));
    if (VisVal && (*VisVal)->Type == EJson::String)
    {
        static const TSet<FString> ValidVis = {
            TEXT("Visible"), TEXT("Hidden"), TEXT("Collapsed"),
            TEXT("HitTestInvisible"), TEXT("SelfHitTestInvisible")
        };
        if (!ValidVis.Contains((*VisVal)->AsString()))
        {
            OutError = FString::Printf(TEXT("[WidgetBuilder] %s: Unknown visibility '%s'"), *Path, *(*VisVal)->AsString());
            return false;
        }
    }

    return true;
}
```

- [ ] **Step 3: Call ValidateWidgetPropertyValues from ValidateNode**

In `ValidateNode`, after the property-existence check block (after the closing `}` of the `if (SupportedProps)` block, before the children recursion), add:

```cpp
	if (!ValidateWidgetPropertyValues(Node, NodePath, OutError))
	{
		return false;
	}
```

- [ ] **Step 4: Add slot value validation to ValidateNode**

After the `ValidateWidgetPropertyValues` call (before the children recursion loop), add the slot validation block. This ensures slot errors are reported before recursing into children, keeping error messages clear and avoiding wasted work:

In `ValidateNode`, right after the `ValidateWidgetPropertyValues` call, add:

```cpp
	// Validate slot field values
	if (Node.bHasSlot)
	{
		const FWidgetSlotSpec& Slot = Node.Slot;

		if (Slot.bHasRow && Slot.Row < 0)
		{
			OutError = FString::Printf(TEXT("[WidgetBuilder] %s.slot: 'row' must be >= 0"), *NodePath);
			return false;
		}
		if (Slot.bHasColumn && Slot.Column < 0)
		{
			OutError = FString::Printf(TEXT("[WidgetBuilder] %s.slot: 'column' must be >= 0"), *NodePath);
			return false;
		}
		if (Slot.bHasRowSpan && Slot.RowSpan < 1)
		{
			OutError = FString::Printf(TEXT("[WidgetBuilder] %s.slot: 'rowSpan' must be >= 1"), *NodePath);
			return false;
		}
		if (Slot.bHasColumnSpan && Slot.ColumnSpan < 1)
		{
			OutError = FString::Printf(TEXT("[WidgetBuilder] %s.slot: 'columnSpan' must be >= 1"), *NodePath);
			return false;
		}

		static const TSet<FString> ValidHAlign = { TEXT("Left"), TEXT("Center"), TEXT("Right"), TEXT("Fill") };
		static const TSet<FString> ValidVAlign = { TEXT("Top"), TEXT("Center"), TEXT("Bottom"), TEXT("Fill") };

		if (Slot.bHasHorizontalAlignment && !ValidHAlign.Contains(Slot.HorizontalAlignment))
		{
			OutError = FString::Printf(TEXT("[WidgetBuilder] %s.slot: Unknown horizontalAlignment '%s'"), *NodePath, *Slot.HorizontalAlignment);
			return false;
		}
		if (Slot.bHasVerticalAlignment && !ValidVAlign.Contains(Slot.VerticalAlignment))
		{
			OutError = FString::Printf(TEXT("[WidgetBuilder] %s.slot: Unknown verticalAlignment '%s'"), *NodePath, *Slot.VerticalAlignment);
			return false;
		}
	}
```

- [ ] **Step 5: Verify validation failures produce correct error messages**

Call `ValidateWidgetJSON` with these inputs and confirm each produces the stated error:

```json
{"root":{"type":"CanvasPanel","name":"Root","children":[{"type":"ProgressBar","name":"P","properties":{"percent":1.5}}]}}
```
Expected: `'percent' 1.5 is outside [0.0, 1.0]`

```json
{"root":{"type":"CanvasPanel","name":"Root","children":[{"type":"Slider","name":"S","properties":{"value":2.0,"minValue":0.0,"maxValue":1.0}}]}}
```
Expected: `'value' 2.0 is outside [minValue=0.0, maxValue=1.0]`

```json
{"root":{"type":"CanvasPanel","name":"Root","children":[{"type":"ProgressBar","name":"P","properties":{"barFillType":"InvalidType"}}]}}
```
Expected: `Unknown barFillType 'InvalidType'`

Also verify the partial-bound Slider case (spec test: value within partial range must PASS):

```json
{"root":{"type":"CanvasPanel","name":"Root","children":[{"type":"Slider","name":"S","properties":{"value":0.8,"minValue":0.5}}]}}
```
Expected: validation succeeds (maxValue not specified, defaults to 1.0; value=0.8 is within [0.5, 1.0]).

- [ ] **Step 6: Commit**

```bash
git add ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/WidgetBuilder/WidgetBlueprintValidator.cpp
git commit -m "feat(widget-builder): add semantic validation for new widget types and slot fields"
```

---

## Task 5: Add property appliers for new widget types

**Files:**
- Modify: `Private/WidgetBuilder/WidgetPropertyApplier.h`
- Modify: `Private/WidgetBuilder/WidgetPropertyApplier.cpp`

- [ ] **Step 1: Add required includes and file-static enum helpers to WidgetPropertyApplier.cpp**

After the existing includes, add:

```cpp
#include "Components/ProgressBar.h"
#include "Components/Slider.h"
#include "Components/CheckBox.h"
#include "Components/EditableTextBox.h"
#include "Components/RichTextBlock.h"
#include "Components/ScaleBox.h"
```

Then, before the `ApplyProperties` function definition, add three file-static centralized enum helpers. These prevent ad-hoc per-call string comparisons and provide a single conversion point:

```cpp
static EOrientation ParseOrientation(const FString& Value)
{
    if (Value == TEXT("Vertical")) return EOrientation::Orient_Vertical;
    return EOrientation::Orient_Horizontal; // validator ensures only valid values reach here
}

static EStretch::Type ParseStretch(const FString& Value)
{
    if (Value == TEXT("Fill"))             return EStretch::Fill;
    if (Value == TEXT("ScaleToFit"))       return EStretch::ScaleToFit;
    if (Value == TEXT("ScaleToFitX"))      return EStretch::ScaleToFitX;
    if (Value == TEXT("ScaleToFitY"))      return EStretch::ScaleToFitY;
    if (Value == TEXT("ScaleToFill"))      return EStretch::ScaleToFill;
    if (Value == TEXT("ScaleBySafeZone")) return EStretch::ScaleBySafeZone;
    if (Value == TEXT("UserSpecified"))    return EStretch::UserSpecified;
    return EStretch::None;
}

static EStretchDirection::Type ParseStretchDirection(const FString& Value)
{
    if (Value == TEXT("DownOnly")) return EStretchDirection::DownOnly;
    if (Value == TEXT("UpOnly"))   return EStretchDirection::UpOnly;
    return EStretchDirection::Both;
}
```

Note: These helpers assume the validator has already rejected invalid strings. They do not return errors -- instead they fall through to the default enum value. This is intentional (defensive clamp after strict validation).

- [ ] **Step 2: Declare 6 new private methods in WidgetPropertyApplier.h**

In the `private:` section of `FWidgetPropertyApplier`, add:

```cpp
	static bool ApplyProgressBarProperties(UProgressBar* Widget, const TMap<FString, TSharedPtr<FJsonValue>>& Props, const FString& Path, FString& OutError);
	static bool ApplySliderProperties(USlider* Widget, const TMap<FString, TSharedPtr<FJsonValue>>& Props, const FString& Path, FString& OutError);
	static bool ApplyCheckBoxProperties(UCheckBox* Widget, const TMap<FString, TSharedPtr<FJsonValue>>& Props, const FString& Path, FString& OutError);
	static bool ApplyEditableTextBoxProperties(UEditableTextBox* Widget, const TMap<FString, TSharedPtr<FJsonValue>>& Props, const FString& Path, FString& OutError);
	static bool ApplyRichTextBlockProperties(URichTextBlock* Widget, const TMap<FString, TSharedPtr<FJsonValue>>& Props, const FString& Path, FString& OutError);
	static bool ApplyScaleBoxProperties(UScaleBox* Widget, const TMap<FString, TSharedPtr<FJsonValue>>& Props, const FString& Path, FString& OutError);
```

Also add the forward declarations at the top of the header (before the class):

```cpp
class UProgressBar;
class USlider;
class UCheckBox;
class UEditableTextBox;
class URichTextBlock;
class UScaleBox;
```

- [ ] **Step 3: Add dispatch branches to ApplyProperties**

In `WidgetPropertyApplier.cpp`, at the end of `ApplyProperties` (after the existing TextBlock branch, before `return true`):

```cpp
	if (TypeName == TEXT("ProgressBar"))
	{
		UProgressBar* PB = Cast<UProgressBar>(Widget);
		if (PB && !ApplyProgressBarProperties(PB, Properties, Path, OutError)) return false;
	}
	if (TypeName == TEXT("Slider"))
	{
		USlider* S = Cast<USlider>(Widget);
		if (S && !ApplySliderProperties(S, Properties, Path, OutError)) return false;
	}
	if (TypeName == TEXT("CheckBox"))
	{
		UCheckBox* CB = Cast<UCheckBox>(Widget);
		if (CB && !ApplyCheckBoxProperties(CB, Properties, Path, OutError)) return false;
	}
	if (TypeName == TEXT("EditableTextBox"))
	{
		UEditableTextBox* ETB = Cast<UEditableTextBox>(Widget);
		if (ETB && !ApplyEditableTextBoxProperties(ETB, Properties, Path, OutError)) return false;
	}
	if (TypeName == TEXT("RichTextBlock"))
	{
		URichTextBlock* RTB = Cast<URichTextBlock>(Widget);
		if (RTB && !ApplyRichTextBlockProperties(RTB, Properties, Path, OutError)) return false;
	}
	if (TypeName == TEXT("ScaleBox"))
	{
		UScaleBox* SB = Cast<UScaleBox>(Widget);
		if (SB && !ApplyScaleBoxProperties(SB, Properties, Path, OutError)) return false;
	}
```

- [ ] **Step 4: Implement the 6 new applier methods**

`WidgetPropertyApplier.cpp` already has a file-static `ParseJustification(const FString&)` helper (used by the TextBlock branch). The new EditableTextBox and RichTextBlock appliers call it directly -- no additional definition needed.

Before implementing the new methods, search the file for `ParseJustification`. If it exists, proceed. If it does NOT exist (it may have been renamed or removed), add this definition immediately before `ApplyProperties`:

```cpp
static ETextJustify::Type ParseJustification(const FString& Value)
{
    if (Value == TEXT("Center")) return ETextJustify::Center;
    if (Value == TEXT("Right"))  return ETextJustify::Right;
    return ETextJustify::Left;
}
```

Add at the bottom of `WidgetPropertyApplier.cpp`:

```cpp
bool FWidgetPropertyApplier::ApplyProgressBarProperties(
    UProgressBar* Widget,
    const TMap<FString, TSharedPtr<FJsonValue>>& Props,
    const FString& Path,
    FString& OutError)
{
    const TSharedPtr<FJsonValue>* PctVal = Props.Find(TEXT("percent"));
    if (PctVal && (*PctVal)->Type == EJson::Number)
    {
        Widget->SetPercent(FMath::Clamp(static_cast<float>((*PctVal)->AsNumber()), 0.0f, 1.0f));
    }

    const TSharedPtr<FJsonValue>* FillTypeVal = Props.Find(TEXT("barFillType"));
    if (FillTypeVal && (*FillTypeVal)->Type == EJson::String)
    {
        const FString& S = (*FillTypeVal)->AsString();
        EProgressBarFillType::Type FillType = EProgressBarFillType::LeftToRight;
        if (S == TEXT("RightToLeft"))     FillType = EProgressBarFillType::RightToLeft;
        else if (S == TEXT("FillFromCenter")) FillType = EProgressBarFillType::FillFromCenter;
        else if (S == TEXT("TopToBottom")) FillType = EProgressBarFillType::TopToBottom;
        else if (S == TEXT("BottomToTop")) FillType = EProgressBarFillType::BottomToTop;
        Widget->SetBarFillType(FillType);
    }

    const TSharedPtr<FJsonValue>* MarqueeVal = Props.Find(TEXT("isMarquee"));
    if (MarqueeVal && (*MarqueeVal)->Type == EJson::Boolean)
    {
        Widget->SetIsMarquee((*MarqueeVal)->AsBool());
    }

    const TSharedPtr<FJsonValue>* ColorVal = Props.Find(TEXT("fillColorAndOpacity"));
    if (ColorVal && (*ColorVal)->Type == EJson::Object)
    {
        const TSharedPtr<FJsonObject>& Obj = (*ColorVal)->AsObject();
        FLinearColor Color(
            FMath::Clamp(static_cast<float>(Obj->GetNumberField(TEXT("r"))), 0.0f, 1.0f),
            FMath::Clamp(static_cast<float>(Obj->GetNumberField(TEXT("g"))), 0.0f, 1.0f),
            FMath::Clamp(static_cast<float>(Obj->GetNumberField(TEXT("b"))), 0.0f, 1.0f),
            FMath::Clamp(static_cast<float>(Obj->GetNumberField(TEXT("a"))), 0.0f, 1.0f)
        );
        Widget->SetFillColorAndOpacity(Color);
    }

    return true;
}

bool FWidgetPropertyApplier::ApplySliderProperties(
    USlider* Widget,
    const TMap<FString, TSharedPtr<FJsonValue>>& Props,
    const FString& Path,
    FString& OutError)
{
    const TSharedPtr<FJsonValue>* MinVal = Props.Find(TEXT("minValue"));
    if (MinVal && (*MinVal)->Type == EJson::Number)
        Widget->MinValue = static_cast<float>((*MinVal)->AsNumber());

    const TSharedPtr<FJsonValue>* MaxVal = Props.Find(TEXT("maxValue"));
    if (MaxVal && (*MaxVal)->Type == EJson::Number)
        Widget->MaxValue = static_cast<float>((*MaxVal)->AsNumber());

    const TSharedPtr<FJsonValue>* ValProp = Props.Find(TEXT("value"));
    if (ValProp && (*ValProp)->Type == EJson::Number)
        Widget->SetValue(static_cast<float>((*ValProp)->AsNumber()));

    const TSharedPtr<FJsonValue>* StepVal = Props.Find(TEXT("stepSize"));
    if (StepVal && (*StepVal)->Type == EJson::Number)
        Widget->SetStepSize(static_cast<float>((*StepVal)->AsNumber()));

    const TSharedPtr<FJsonValue>* OrientVal = Props.Find(TEXT("orientation"));
    if (OrientVal && (*OrientVal)->Type == EJson::String)
    {
        Widget->SetOrientation(ParseOrientation((*OrientVal)->AsString()));
    }

    return true;
}

bool FWidgetPropertyApplier::ApplyCheckBoxProperties(
    UCheckBox* Widget,
    const TMap<FString, TSharedPtr<FJsonValue>>& Props,
    const FString& Path,
    FString& OutError)
{
    const TSharedPtr<FJsonValue>* CheckedVal = Props.Find(TEXT("isChecked"));
    if (CheckedVal && (*CheckedVal)->Type == EJson::Boolean)
        Widget->SetIsChecked((*CheckedVal)->AsBool());
    return true;
}

bool FWidgetPropertyApplier::ApplyEditableTextBoxProperties(
    UEditableTextBox* Widget,
    const TMap<FString, TSharedPtr<FJsonValue>>& Props,
    const FString& Path,
    FString& OutError)
{
    const TSharedPtr<FJsonValue>* TextVal = Props.Find(TEXT("text"));
    if (TextVal && (*TextVal)->Type == EJson::String)
        Widget->SetText(FText::FromString((*TextVal)->AsString()));

    const TSharedPtr<FJsonValue>* HintVal = Props.Find(TEXT("hintText"));
    if (HintVal && (*HintVal)->Type == EJson::String)
        Widget->SetHintText(FText::FromString((*HintVal)->AsString()));

    const TSharedPtr<FJsonValue>* ReadOnlyVal = Props.Find(TEXT("isReadOnly"));
    if (ReadOnlyVal && (*ReadOnlyVal)->Type == EJson::Boolean)
        Widget->SetIsReadOnly((*ReadOnlyVal)->AsBool());

    const TSharedPtr<FJsonValue>* JustVal = Props.Find(TEXT("justification"));
    if (JustVal && (*JustVal)->Type == EJson::String)
        Widget->SetJustification(ParseJustification((*JustVal)->AsString()));

    return true;
}

bool FWidgetPropertyApplier::ApplyRichTextBlockProperties(
    URichTextBlock* Widget,
    const TMap<FString, TSharedPtr<FJsonValue>>& Props,
    const FString& Path,
    FString& OutError)
{
    const TSharedPtr<FJsonValue>* TextVal = Props.Find(TEXT("text"));
    if (TextVal && (*TextVal)->Type == EJson::String)
        Widget->SetText(FText::FromString((*TextVal)->AsString()));

    const TSharedPtr<FJsonValue>* JustVal = Props.Find(TEXT("justification"));
    if (JustVal && (*JustVal)->Type == EJson::String)
        Widget->SetJustification(ParseJustification((*JustVal)->AsString()));

    const TSharedPtr<FJsonValue>* WrapVal = Props.Find(TEXT("autoWrapText"));
    if (WrapVal && (*WrapVal)->Type == EJson::Boolean)
        Widget->SetAutoWrapText((*WrapVal)->AsBool());

    // Log if no style table assigned -- expected, not an error
    if (!Widget->GetDefaultStyleSet())
    {
        UE_LOG(LogTemp, Log, TEXT("[WidgetBuilder] %s: RichTextBlock '%s': no text style set assigned, markup will render as plain text"),
            *Path, *Widget->GetName());
    }

    return true;
}

bool FWidgetPropertyApplier::ApplyScaleBoxProperties(
    UScaleBox* Widget,
    const TMap<FString, TSharedPtr<FJsonValue>>& Props,
    const FString& Path,
    FString& OutError)
{
    const TSharedPtr<FJsonValue>* StretchVal = Props.Find(TEXT("stretch"));
    if (StretchVal && (*StretchVal)->Type == EJson::String)
    {
        Widget->SetStretch(ParseStretch((*StretchVal)->AsString()));
    }

    const TSharedPtr<FJsonValue>* DirVal = Props.Find(TEXT("stretchDirection"));
    if (DirVal && (*DirVal)->Type == EJson::String)
    {
        Widget->SetStretchDirection(ParseStretchDirection((*DirVal)->AsString()));
    }

    const TSharedPtr<FJsonValue>* ScaleVal = Props.Find(TEXT("userSpecifiedScale"));
    if (ScaleVal && (*ScaleVal)->Type == EJson::Number)
        Widget->SetUserSpecifiedScale(static_cast<float>((*ScaleVal)->AsNumber()));

    return true;
}
```

Note: `GetDefaultStyleSet()` may not exist in UE4.27. If it doesn't compile, remove that log block entirely -- the RichTextBlock will still apply text, set justification, and set autoWrapText correctly. The log is informational only, not a required behavior. Its absence is not a regression.

Note on `MinValue`/`MaxValue`: if direct field assignment doesn't compile (they may be private in some UE4.27 versions), check for `SetMinValue`/`SetMaxValue` methods. If neither works, use `Widget->SetEditorPropertyValue` or skip those properties and document the issue.

- [ ] **Step 5: Build and verify a ProgressBar widget builds with properties**

Call `BuildWidgetFromJSON` with:

```json
{
  "root": {
    "type": "CanvasPanel", "name": "Root",
    "children": [
      {
        "type": "ProgressBar", "name": "Meter",
        "properties": { "percent": 0.5, "barFillType": "LeftToRight" },
        "slot": { "position": {"x": 100, "y": 100}, "size": {"x": 300, "y": 20} }
      }
    ]
  }
}
```

Open the asset in the editor. Verify the ProgressBar is visible and filled to 50%.

- [ ] **Step 6: Commit**

```bash
git add ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/WidgetBuilder/WidgetPropertyApplier.h
git add ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/WidgetBuilder/WidgetPropertyApplier.cpp
git commit -m "feat(widget-builder): add property appliers for ProgressBar, Slider, CheckBox, EditableTextBox, RichTextBlock, ScaleBox"
```

---

## Task 6: Add slot appliers for GridSlot, ScrollBoxSlot, WrapBoxSlot

**Files:**
- Modify: `Private/WidgetBuilder/WidgetSlotPropertyApplier.h`
- Modify: `Private/WidgetBuilder/WidgetSlotPropertyApplier.cpp`

- [ ] **Step 1: Add forward declarations to WidgetSlotPropertyApplier.h**

Open `WidgetSlotPropertyApplier.h`. Before the class declaration, add forward declarations for the three new slot classes:

```cpp
class UGridSlot;
class UScrollBoxSlot;
class UWrapBoxSlot;
```

The alignment helpers (`ParseHorizontalAlignment`, `ParseVerticalAlignment`) are file-static functions in the `.cpp` -- they don't need header declarations.

- [ ] **Step 2: Add required includes to WidgetSlotPropertyApplier.cpp**

After existing includes:

```cpp
#include "Components/GridSlot.h"
#include "Components/ScrollBoxSlot.h"
#include "Components/WrapBoxSlot.h"
```

- [ ] **Step 3: Add shared alignment helpers as file-static functions**

Before the `ApplySlotProperties` function definition, add:

```cpp
static bool ParseHorizontalAlignment(const FString& Value, EHorizontalAlignment& OutAlign, const FString& Path, FString& OutError)
{
    if (Value == TEXT("Left"))   { OutAlign = HAlign_Left;   return true; }
    if (Value == TEXT("Center")) { OutAlign = HAlign_Center; return true; }
    if (Value == TEXT("Right"))  { OutAlign = HAlign_Right;  return true; }
    if (Value == TEXT("Fill"))   { OutAlign = HAlign_Fill;   return true; }
    OutError = FString::Printf(TEXT("[WidgetBuilder] %s: Unknown horizontalAlignment '%s'"), *Path, *Value);
    return false;
}

static bool ParseVerticalAlignment(const FString& Value, EVerticalAlignment& OutAlign, const FString& Path, FString& OutError)
{
    if (Value == TEXT("Top"))    { OutAlign = VAlign_Top;    return true; }
    if (Value == TEXT("Center")) { OutAlign = VAlign_Center; return true; }
    if (Value == TEXT("Bottom")) { OutAlign = VAlign_Bottom; return true; }
    if (Value == TEXT("Fill"))   { OutAlign = VAlign_Fill;   return true; }
    OutError = FString::Printf(TEXT("[WidgetBuilder] %s: Unknown verticalAlignment '%s'"), *Path, *Value);
    return false;
}
```

- [ ] **Step 4: Add three new Cast branches to ApplySlotProperties**

At the end of `ApplySlotProperties`, before the "Unknown slot type" fallthrough:

```cpp
    // GridSlot: row, column, rowSpan, columnSpan, padding, alignment
    if (UGridSlot* Grid = Cast<UGridSlot>(Slot))
    {
        if (SlotSpec.bHasRow)         Grid->SetRow(SlotSpec.Row);
        if (SlotSpec.bHasColumn)      Grid->SetColumn(SlotSpec.Column);
        if (SlotSpec.bHasRowSpan)     Grid->SetRowSpan(SlotSpec.RowSpan);
        if (SlotSpec.bHasColumnSpan)  Grid->SetColumnSpan(SlotSpec.ColumnSpan);
        if (SlotSpec.bHasPadding)     Grid->SetPadding(SlotSpec.Padding);
        if (SlotSpec.bHasHorizontalAlignment)
        {
            EHorizontalAlignment HA;
            if (!ParseHorizontalAlignment(SlotSpec.HorizontalAlignment, HA, Path, OutError)) return false;
            Grid->SetHorizontalAlignment(HA);
        }
        if (SlotSpec.bHasVerticalAlignment)
        {
            EVerticalAlignment VA;
            if (!ParseVerticalAlignment(SlotSpec.VerticalAlignment, VA, Path, OutError)) return false;
            Grid->SetVerticalAlignment(VA);
        }
        return true;
    }

    // ScrollBoxSlot: padding, horizontalAlignment (verticalAlignment may not exist in UE4.27)
    if (UScrollBoxSlot* ScrollS = Cast<UScrollBoxSlot>(Slot))
    {
        if (SlotSpec.bHasPadding) ScrollS->SetPadding(SlotSpec.Padding);
        if (SlotSpec.bHasHorizontalAlignment)
        {
            EHorizontalAlignment HA;
            if (!ParseHorizontalAlignment(SlotSpec.HorizontalAlignment, HA, Path, OutError)) return false;
            ScrollS->SetHorizontalAlignment(HA);
        }
        // verticalAlignment: UScrollBoxSlot may not expose SetVerticalAlignment in UE4.27.
        // If this compiles, apply it. If not, comment out and log.
        if (SlotSpec.bHasVerticalAlignment)
        {
            // EVerticalAlignment VA;
            // if (!ParseVerticalAlignment(SlotSpec.VerticalAlignment, VA, Path, OutError)) return false;
            // ScrollS->SetVerticalAlignment(VA);  // Uncomment if method exists
            UE_LOG(LogTemp, Log, TEXT("[WidgetBuilder] %s: ScrollBoxSlot verticalAlignment not supported in UE4.27, ignored"), *Path);
        }
        return true;
    }

    // WrapBoxSlot: padding only (alignment not in v1 scope)
    if (UWrapBoxSlot* WrapS = Cast<UWrapBoxSlot>(Slot))
    {
        if (SlotSpec.bHasPadding) WrapS->SetPadding(SlotSpec.Padding);
        return true;
    }
```

These three blocks must be added BEFORE the existing "Unknown slot type" log+return block.

- [ ] **Step 5: Build and verify a GridPanel with slot positions**

```json
{
  "root": {
    "type": "GridPanel", "name": "Root",
    "children": [
      { "type": "TextBlock", "name": "A", "properties": {"text": "A"}, "slot": {"row": 0, "column": 0, "horizontalAlignment": "Center"} },
      { "type": "TextBlock", "name": "B", "properties": {"text": "B"}, "slot": {"row": 0, "column": 1, "horizontalAlignment": "Fill"} }
    ]
  }
}
```

Open the asset. Verify two text blocks appear in separate grid columns.

Also verify that a WrapBox child with alignment fields in its slot JSON builds without warnings:

```json
{"root": {"type": "WrapBox", "name": "Root", "children": [{"type": "TextBlock", "name": "A", "properties": {"text": "A"}, "slot": {"horizontalAlignment": "Center", "padding": {"left": 4, "top": 4, "right": 4, "bottom": 4}}}]}}
```

Expected: builds successfully, no warnings, alignment fields silently ignored for WrapBoxSlot.

- [ ] **Step 6: Commit**

```bash
git add ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/WidgetBuilder/WidgetSlotPropertyApplier.h
git add ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/WidgetBuilder/WidgetSlotPropertyApplier.cpp
git commit -m "feat(widget-builder): add GridSlot, ScrollBoxSlot, WrapBoxSlot appliers with centralized alignment helpers"
```

---

## Task 7: bIsVariable rule and GridPanel column initialization in WidgetTreeBuilder

**Files:**
- Modify: `Private/WidgetBuilder/WidgetTreeBuilder.h`
- Modify: `Private/WidgetBuilder/WidgetTreeBuilder.cpp`
- Modify: `Private/WidgetBuilder/WidgetBlueprintBuilder.cpp`

- [ ] **Step 1: Update WidgetTreeBuilder.h signatures**

In `WidgetTreeBuilder.h`, update the `BuildTree` declaration:

```cpp
UWidget* BuildTree(
    UWidgetBlueprint* WidgetBP,
    UWidgetTree* WidgetTree,
    const FWidgetBlueprintSpec& Spec,
    const TSet<FString>& AnimationTargets,
    FString& OutError
);
```

And update `BuildNode`:

```cpp
UWidget* BuildNode(
    UWidgetBlueprint* WidgetBP,
    UWidgetTree* WidgetTree,
    const FWidgetNodeSpec& Spec,
    UWidget* Parent,
    const TSet<FString>& AnimationTargets,
    const FString& Path,
    FString& OutError
);
```

- [ ] **Step 2: Update WidgetTreeBuilder.cpp -- BuildTree**

Replace the `BuildTree` implementation:

```cpp
UWidget* FWidgetTreeBuilder::BuildTree(
    UWidgetBlueprint* WidgetBP,
    UWidgetTree* WidgetTree,
    const FWidgetBlueprintSpec& Spec,
    const TSet<FString>& AnimationTargets,
    FString& OutError)
{
    return BuildNode(WidgetBP, WidgetTree, Spec.Root, nullptr, AnimationTargets, Spec.Root.Name, OutError);
}
```

- [ ] **Step 3: Update BuildNode -- add bIsVariable and GridPanel column init**

Replace the `BuildNode` implementation:

```cpp
UWidget* FWidgetTreeBuilder::BuildNode(
    UWidgetBlueprint* WidgetBP,
    UWidgetTree* WidgetTree,
    const FWidgetNodeSpec& Spec,
    UWidget* Parent,
    const TSet<FString>& AnimationTargets,
    const FString& Path,
    FString& OutError)
{
    static const TSet<FString> InteractiveTypes = {
        TEXT("ProgressBar"), TEXT("Slider"), TEXT("CheckBox"), TEXT("EditableTextBox"), TEXT("Button")
    };

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

    // Step 3: Set bIsVariable before compilation and attachment
    if (InteractiveTypes.Contains(Spec.Type) || AnimationTargets.Contains(Spec.Name))
    {
        Widget->bIsVariable = true;
        UE_LOG(LogTemp, Log, TEXT("[WidgetBuilder] %s: bIsVariable = true"), *Path);
    }

    // Step 4: Apply widget properties
    if (Spec.Properties.Num() > 0)
    {
        if (!FWidgetPropertyApplier::ApplyProperties(Widget, Spec.Type, Spec.Properties, Path, OutError))
        {
            return nullptr;
        }
    }

    // Step 5: Attach to parent (skip for root)
    if (Parent)
    {
        UPanelSlot* Slot = ChildAttachment.AttachChild(Parent, Widget, Path, OutError);
        if (!Slot)
        {
            return nullptr;
        }

        if (Spec.bHasSlot)
        {
            if (!FWidgetSlotPropertyApplier::ApplySlotProperties(Slot, Spec.Slot, Path, OutError))
            {
                return nullptr;
            }
        }
    }

    // Step 6: Recurse into children, tracking max column for GridPanel
    int32 MaxColumn = 0;
    bool bIsGrid = Spec.Type == TEXT("GridPanel");

    for (int32 i = 0; i < Spec.Children.Num(); ++i)
    {
        const FWidgetNodeSpec& ChildSpec = Spec.Children[i];
        FString ChildPath = FString::Printf(TEXT("%s.%s"), *Path, *ChildSpec.Name);

        UWidget* Child = BuildNode(WidgetBP, WidgetTree, ChildSpec, Widget, AnimationTargets, ChildPath, OutError);
        if (!Child)
        {
            return nullptr;
        }

        if (bIsGrid && ChildSpec.bHasSlot && ChildSpec.Slot.bHasColumn)
        {
            // Account for ColumnSpan: a cell at column=1 with columnSpan=2 occupies columns 1 and 2
            int32 SpanEnd = ChildSpec.Slot.Column;
            if (ChildSpec.Slot.bHasColumnSpan)
            {
                SpanEnd += ChildSpec.Slot.ColumnSpan - 1;
            }
            MaxColumn = FMath::Max(MaxColumn, SpanEnd);
        }
    }

    // Step 7: Initialize GridPanel column coefficients (always, not reactive)
    if (bIsGrid)
    {
        UGridPanel* Grid = Cast<UGridPanel>(Widget);
        if (Grid)
        {
            for (int32 Col = 0; Col <= MaxColumn; ++Col)
            {
                Grid->AddColumnFillCoefficient(1.0f);
            }
            UE_LOG(LogTemp, Log, TEXT("[WidgetBuilder] %s: GridPanel initialized %d columns"), *Path, MaxColumn + 1);
        }
    }

    return Widget;
}
```

- [ ] **Step 4: Update WidgetBlueprintBuilder.cpp to construct AnimationTargets**

In `FWidgetBlueprintBuilder::Build`, replace the `BuildTree` call with:

```cpp
    // Construct animation targets set for bIsVariable rule
    TSet<FString> AnimationTargets;
    for (const FWidgetAnimationSpec& AnimSpec : Spec.Animations)
    {
        AnimationTargets.Add(AnimSpec.Target);
    }

    FWidgetChildAttachment ChildAttachment;
    FWidgetTreeBuilder TreeBuilder(Registry, ChildAttachment);
    UWidget* Root = TreeBuilder.BuildTree(WidgetBP, Tree, Spec, AnimationTargets, OutError);
```

Do the same in `FWidgetBlueprintBuilder::Rebuild` (same pattern, same location in the function).

- [ ] **Step 5: Build and verify bIsVariable behavior**

Build the following JSON:

```json
{
  "root": {
    "type": "CanvasPanel", "name": "Root",
    "children": [
      { "type": "ProgressBar", "name": "Meter", "slot": {"position": {"x": 0, "y": 0}} },
      { "type": "TextBlock", "name": "Label", "properties": {"text": "HP"} }
    ]
  }
}
```

Open the asset in the editor's Variables panel:
- `Meter` appears (interactive type: ProgressBar)
- `Label` does NOT appear

Now add an animation targeting `Label` and rebuild. `Label` should now appear in Variables.

- [ ] **Step 6: Commit**

```bash
git add ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/WidgetBuilder/WidgetTreeBuilder.h
git add ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/WidgetBuilder/WidgetTreeBuilder.cpp
git add ue4-plugin/BlueprintGraphBuilder/Source/BlueprintGraphBuilder/Private/WidgetBuilder/WidgetBlueprintBuilder.cpp
git commit -m "feat(widget-builder): add bIsVariable rule and GridPanel column initialization to tree builder"
```

---

## Task 8: End-to-end integration test (QTE scenario)

This task validates the whole pass with a real scenario that exercises all new types.

**Files:** None modified -- this is a manual test using the MCP tool or direct Python call.

- [ ] **Step 1: Build the QTE widget**

Call `BuildWidgetFromJSON("/Game/UI", "WBP_ReconnectQTE", <json>)` with:

```json
{
  "root": {
    "type": "CanvasPanel",
    "name": "Root",
    "children": [
      {
        "type": "TextBlock",
        "name": "PromptText",
        "properties": {
          "text": "Tap X to Reconnect with your Dad",
          "renderOpacity": 0.0,
          "justification": "Center"
        },
        "slot": { "position": {"x": 500, "y": 300}, "size": {"x": 600, "y": 60} }
      },
      {
        "type": "ProgressBar",
        "name": "ReconnectMeter",
        "properties": {
          "percent": 0.0,
          "barFillType": "LeftToRight",
          "renderOpacity": 0.0
        },
        "slot": { "position": {"x": 500, "y": 380}, "size": {"x": 400, "y": 30} }
      }
    ]
  },
  "animations": [
    {
      "name": "FadeIn_UI",
      "target": "PromptText",
      "duration": 0.3,
      "tracks": [{ "type": "opacity", "from": 0.0, "to": 1.0 }]
    },
    {
      "name": "FadeOut_UI",
      "target": "PromptText",
      "duration": 0.3,
      "tracks": [{ "type": "opacity", "from": 1.0, "to": 0.0 }]
    }
  ]
}
```

- [ ] **Step 2: Verify in editor**

Open `WBP_ReconnectQTE` in the Widget Blueprint editor:
- Designer shows PromptText (TextBlock) and ReconnectMeter (ProgressBar)
- Both are positioned correctly
- Animations panel shows "FadeIn_UI" and "FadeOut_UI"
- Variables panel shows: `ReconnectMeter` (interactive type), `PromptText` (animation target)
- Blueprint compiles without warnings

- [ ] **Step 3: Verify validation rejection**

Call `ValidateWidgetJSON` with:

```json
{"root": {"type": "CanvasPanel", "name": "Root", "children": [{"type": "ComboBox", "name": "Foo"}]}}
```

Expected error: `Unsupported widget type 'ComboBox'`

```json
{"root": {"type": "CanvasPanel", "name": "Root", "children": [{"type": "ProgressBar", "name": "P", "properties": {"percent": -0.5}}]}}
```

Expected error: `'percent' -0.50 is outside [0.0, 1.0]`

- [ ] **Step 4: Final commit**

```bash
git commit --allow-empty -m "test(widget-builder): Pass 8 integration verified - QTE widget builds with ProgressBar, animations, bIsVariable"
```

---

## Known Risks and Resolution Guidance

**Risk: USlider MinValue/MaxValue direct assignment fails to compile**
If `Widget->MinValue = ...` doesn't compile (field may be private), try `Widget->SetMinValue(Value)` and `Widget->SetMaxValue(Value)`. If neither works, remove those two property lines from `ApplySliderProperties` and log a note. The value can still be set via `SetValue`.

**Risk: URichTextBlock::GetDefaultStyleSet() doesn't exist**
Remove the log block entirely. The `SetText` call will still work -- the log was informational only.

**Risk: UScrollBoxSlot::SetVerticalAlignment doesn't exist**
The code in Task 6 already comments it out with an explanation. Leave it commented.

**Risk: UGridPanel::AddColumnFillCoefficient doesn't exist**
Replace with direct column setup if available, or skip silently. Grid children will still attach -- they just may all render in column 0 until this is resolved in a future pass.
