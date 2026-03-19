# Widget Builder Pass 8 -- Widget Registry Expansion

## Objective

Expand the widget registry from 10 to 19 types so that AI-generated UI never hits an "unsupported widget type" rejection for any common gameplay UI pattern: HUDs, menus, QTEs, overlays, prompts, progress feedback, and settings panels.

Every new type gets a fully defined, strict property contract. No pass-through widgets. If a type is in the registry, its properties are validated and applied deterministically. All enum-valued properties validate against a fixed string set -- unknown values are hard errors, never silent defaults.

**Default value policy:** If a property is omitted from JSON, the UE4 engine default for that widget applies. The builder does not inject implicit overrides. This keeps JSON minimal and predictable.

## Scope

### Implement in Pass 8

- 9 new widget types added to `FWidgetClassRegistry`
- Per-widget property applier branches for all new types
- `FWidgetSlotSpec` extended with grid-specific integer fields and explicit string alignment fields
- `FWidgetSlotPropertyApplier` extended for GridSlot, ScrollBoxSlot, WrapBoxSlot
- `RegisterPanel` / `RegisterContent` / `RegisterLeaf` private helpers introduced in `FWidgetClassRegistry` to reduce boilerplate
- `bIsVariable = true` automatically set for interactive and animation-targeted widgets during tree construction

### Do NOT implement

- Helper function injection into widget Blueprint graphs
- Custom style-set creation for RichTextBlock
- Decorator configuration for RichTextBlock
- WrapBox `fillEmptySpace` / `fillSpanWhenLessThan` slot fields
- ScrollBox `orientation`, `alwaysShowScrollbar`, or other display properties
- CheckBox `checkedState` enum (v1 supports `isChecked` bool only)
- `isPassword` on EditableTextBox
- Widget Blueprint variable graph (no new BP variables created via Python API)

## Widget Registry (complete table after Pass 8)

### Panels (0..N children)

| JSON type | UE4 class | New in Pass 8 |
|---|---|---|
| CanvasPanel | UCanvasPanel | no |
| VerticalBox | UVerticalBox | no |
| HorizontalBox | UHorizontalBox | no |
| Overlay | UOverlay | no |
| ScrollBox | UScrollBox | yes |
| GridPanel | UGridPanel | yes |
| WrapBox | UWrapBox | yes |

### Content (0..1 child)

| JSON type | UE4 class | New in Pass 8 |
|---|---|---|
| Button | UButton | no |
| Border | UBorder | no |
| SizeBox | USizeBox | no |
| ScaleBox | UScaleBox | yes |

SizeBox appears here only. It is a Content widget (0..1 child). It does not appear under Panels.

### Leaf (no children)

| JSON type | UE4 class | New in Pass 8 |
|---|---|---|
| TextBlock | UTextBlock | no |
| Image | UImage | no |
| Spacer | USpacer | no |
| ProgressBar | UProgressBar | yes |
| Slider | USlider | yes |
| CheckBox | UCheckBox | yes |
| EditableTextBox | UEditableTextBox | yes |
| RichTextBlock | URichTextBlock | yes |

## Property Contracts

### Shared base properties (all widgets)

Applied by `ApplyBaseProperties`. No change from existing behavior.

| Property | JSON type | Maps to |
|---|---|---|
| visibility | string | SetVisibility |
| renderOpacity | number | SetRenderOpacity |
| isEnabled | bool | SetIsEnabled |

Valid `visibility` values: `Visible`, `Hidden`, `Collapsed`, `HitTestInvisible`, `SelfHitTestInvisible`. Reject unknown strings.

### ProgressBar

| Property | JSON type | Validation | Maps to |
|---|---|---|---|
| percent | number | reject if outside [0.0, 1.0] | SetPercent; applier also calls FMath::Clamp defensively |
| fillColorAndOpacity | object {r,g,b,a} | all 4 fields required; each rejected if outside [0.0, 1.0] | SetFillColorAndOpacity |
| barFillType | string | reject unknown values | SetBarFillType (EProgressBarFillType::Type) |
| isMarquee | bool | none | SetIsMarquee |

Valid `barFillType` values: `LeftToRight`, `RightToLeft`, `FillFromCenter`, `TopToBottom`, `BottomToTop`.

Note: `FillFromCenterHorizontal` does NOT exist in UE4.27's `EProgressBarFillType`. Do not add it.

### Slider

UE4.27 exposes `MinValue` and `MaxValue` as direct UPROPERTY fields on `USlider`, not necessarily as `SetMinValue`/`SetMaxValue` methods. The applier must assign `Slider->MinValue` and `Slider->MaxValue` directly. Verify method vs. property access at compile time.

| Property | JSON type | Validation | Maps to |
|---|---|---|---|
| value | number | see rule below | SetValue |
| minValue | number | none | Slider->MinValue (direct assignment) |
| maxValue | number | reject if maxValue < minValue (when both present) | Slider->MaxValue (direct assignment) |
| stepSize | number | reject if <= 0 | SetStepSize |
| orientation | string | reject unknown values | SetOrientation |

Validation rule for `value`: if both `minValue` and `maxValue` are present, `value` must be within `[minValue, maxValue]`. If neither bound is specified, `value` is validated against [0.0, 1.0] (UE4 default range). If only one bound is specified, that bound is used and the other defaults to UE4 behavior.

Valid `orientation` values: `Horizontal`, `Vertical`.

### CheckBox

| Property | JSON type | Validation | Maps to |
|---|---|---|---|
| isChecked | bool | none | SetIsChecked |

### EditableTextBox

`SetText` and `SetHintText` both take `FText`. The applier must call `FText::FromString(Value)` on the JSON string value before passing to these methods.

| Property | JSON type | Validation | Maps to |
|---|---|---|---|
| text | string | none | SetText(FText::FromString(Value)) |
| hintText | string | none | SetHintText(FText::FromString(Value)) |
| isReadOnly | bool | none | SetIsReadOnly |
| justification | string | reject unknown values | SetJustification |

Valid `justification` values: `Left`, `Center`, `Right`.

### RichTextBlock

v1 scope: text content and layout only. Uses the default project text style. No decorator configuration, no custom style-set creation, no runtime styling beyond what the project's default table provides.

`SetText` takes `FText`. The applier must call `FText::FromString(Value)`.

| Property | JSON type | Validation | Maps to |
|---|---|---|---|
| text | string | none | SetText(FText::FromString(Value)) |
| justification | string | reject unknown values | SetJustification |
| autoWrapText | bool | none | SetAutoWrapText |

Valid `justification` values: `Left`, `Center`, `Right`.

If no DataTable is assigned to the RichTextBlock's `TextStyleSet` in the project, rich text markup tags are stripped at runtime and text renders as plain. This is expected behavior, not a builder error. Log once: `[WidgetBuilder] RichTextBlock 'X': no text style set assigned, markup will render as plain text`.

### ScrollBox

No type-specific properties in v1. Only base properties (visibility, renderOpacity, isEnabled) apply.

### GridPanel

No type-specific properties in v1. Per-child layout is controlled by grid slot fields.

### WrapBox

No type-specific properties in v1. Per-child layout is controlled by wrap box slot fields.

### ScaleBox

`UScaleBox` extends `UContentWidget`. The existing Pass 4 content widget attachment path handles child attachment.

| Property | JSON type | Validation | Maps to |
|---|---|---|---|
| stretch | string | reject unknown values | SetStretch |
| stretchDirection | string | reject unknown values | SetStretchDirection |
| userSpecifiedScale | number | none | SetUserSpecifiedScale |

Valid `stretch` values: `None`, `Fill`, `ScaleToFit`, `ScaleToFitX`, `ScaleToFitY`, `ScaleToFill`, `ScaleBySafeZone`, `UserSpecified`.

Valid `stretchDirection` values: `Both`, `DownOnly`, `UpOnly`.

## Slot System

### Existing slot types (no change)

CanvasPanelSlot, VerticalBoxSlot, HorizontalBoxSlot, OverlaySlot, BorderSlot, SizeBoxSlot behavior is unchanged from Pass 5.

### FWidgetSlotSpec additions

Add to `FWidgetSlotSpec` in `WidgetBlueprintSpec.h`:

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

// Explicit enum-style alignment fields for Grid, ScrollBox, and WrapBox slots.
// Separate from the existing Alignment FVector2D, which remains for Canvas/Box/Overlay slots.
FString HorizontalAlignment;  // "Left", "Center", "Right", "Fill"
FString VerticalAlignment;    // "Top", "Center", "Bottom", "Fill"
bool bHasHorizontalAlignment = false;
bool bHasVerticalAlignment = false;
```

The existing `Alignment FVector2D` field is unchanged. It applies only to Canvas, VerticalBox, HorizontalBox, and Overlay slots. The new string fields apply only to Grid, ScrollBox, and WrapBox slots. The two alignment systems do not interact.

### Valid JSON slot keys

Update the `ValidSlotKeys` set in `WidgetBlueprintJsonParser.cpp`:

```cpp
static const TSet<FString> ValidSlotKeys = {
    TEXT("position"), TEXT("size"), TEXT("alignment"), TEXT("padding"),
    TEXT("zOrder"), TEXT("autoSize"),
    TEXT("row"), TEXT("column"), TEXT("rowSpan"), TEXT("columnSpan"),
    TEXT("horizontalAlignment"), TEXT("verticalAlignment")
};
```

`horizontalAlignment` and `verticalAlignment` are valid JSON keys for any widget's slot. The parser accepts them globally. The slot property applier only acts on them for slot types that support them (GridSlot, ScrollBoxSlot). For other slot types (e.g., WrapBoxSlot), `bHasHorizontalAlignment` is populated but the applier ignores it -- WrapBox slot horizontal alignment is not supported in v1 scope. This is intentional and not an error.

### JSON slot examples for new panel types

**GridPanel child:**
```json
"slot": {
  "row": 0,
  "column": 1,
  "rowSpan": 1,
  "columnSpan": 2,
  "padding": { "left": 0, "top": 0, "right": 0, "bottom": 0 },
  "horizontalAlignment": "Center",
  "verticalAlignment": "Top"
}
```

**ScrollBox child:**
```json
"slot": {
  "padding": { "left": 4, "top": 4, "right": 4, "bottom": 4 },
  "horizontalAlignment": "Fill"
}
```

Note: `verticalAlignment` on a ScrollBoxSlot is accepted in JSON but may have no effect -- `UScrollBoxSlot` in UE4.27 may not expose `SetVerticalAlignment`. See Risk 2.

**WrapBox child:**
```json
"slot": {
  "padding": { "left": 4, "top": 4, "right": 4, "bottom": 4 }
}
```

### FWidgetSlotPropertyApplier additions

Add three new dispatch branches (same Cast-based pattern as existing branches):

**UGridSlot:**
- `bHasRow` -> SetRow
- `bHasColumn` -> SetColumn
- `bHasRowSpan` -> SetRowSpan
- `bHasColumnSpan` -> SetColumnSpan
- `bHasPadding` -> SetPadding
- `bHasHorizontalAlignment` -> SetHorizontalAlignment (parse string to EHorizontalAlignment)
- `bHasVerticalAlignment` -> SetVerticalAlignment (parse string to EVerticalAlignment)

**UScrollBoxSlot:**
- `bHasPadding` -> SetPadding
- `bHasHorizontalAlignment` -> SetHorizontalAlignment
- `bHasVerticalAlignment` -> SetVerticalAlignment (only if method exists -- see Risk 2)

**UWrapBoxSlot:**
- `bHasPadding` -> SetPadding

Alignment string to enum conversion (shared helper, used by all three new slot types):

| String | EHorizontalAlignment |
|---|---|
| Left | HAlign_Left |
| Center | HAlign_Center |
| Right | HAlign_Right |
| Fill | HAlign_Fill |

| String | EVerticalAlignment |
|---|---|
| Top | VAlign_Top |
| Center | VAlign_Center |
| Bottom | VAlign_Bottom |
| Fill | VAlign_Fill |

Unknown strings: log error and return false. No silent default.

## Registry Helper Methods

Introduce three private helpers in `FWidgetClassRegistry` to replace the per-type boilerplate in `RegisterTypes()`. These are internal only -- not exposed in the header's public interface.

```cpp
// Adds panel type with common properties only (no type-specific properties for panels in v1)
void RegisterPanel(const FString& TypeName, TSubclassOf<UWidget> WidgetClass);

// Adds content type (0..1 child) with common properties + optional type-specific properties
void RegisterContent(const FString& TypeName, TSubclassOf<UWidget> WidgetClass,
    TArray<FWidgetPropertyDescriptor> TypeSpecificProps = {});

// Adds leaf type (no children) with common properties + type-specific properties
void RegisterLeaf(const FString& TypeName, TSubclassOf<UWidget> WidgetClass,
    TArray<FWidgetPropertyDescriptor> TypeSpecificProps);
```

Each helper internally creates a `FWidgetTypeInfo`, calls `AddCommonProperties()` on it, appends `TypeSpecificProps`, sets the category, and calls `TypeRegistry.Add(TypeName, MoveTemp(Info))`.

`RegisterPanel` sets `Category = EWidgetCategory::Panel`.
`RegisterContent` sets `Category = EWidgetCategory::Content`.
`RegisterLeaf` sets `Category = EWidgetCategory::Leaf`.

These helpers replace the existing verbose `FWidgetTypeInfo` construction blocks for all new types. Existing Pass 1-4 types may remain as-is or be refactored to use the helpers -- either is acceptable, refactoring is not required.

### Registry additions to RegisterTypes()

```cpp
// Pass 8: panels (common properties only)
RegisterPanel(TEXT("ScrollBox"),  UScrollBox::StaticClass());
RegisterPanel(TEXT("GridPanel"),  UGridPanel::StaticClass());
RegisterPanel(TEXT("WrapBox"),    UWrapBox::StaticClass());

// Pass 8: content widget
RegisterContent(TEXT("ScaleBox"), UScaleBox::StaticClass(),
    { {TEXT("stretch"), EJson::String}, {TEXT("stretchDirection"), EJson::String},
      {TEXT("userSpecifiedScale"), EJson::Number} });

// Pass 8: leaf widgets
RegisterLeaf(TEXT("ProgressBar"),  UProgressBar::StaticClass(),
    { {TEXT("percent"), EJson::Number}, {TEXT("fillColorAndOpacity"), EJson::Object},
      {TEXT("barFillType"), EJson::String}, {TEXT("isMarquee"), EJson::Boolean} });

RegisterLeaf(TEXT("Slider"),       USlider::StaticClass(),
    { {TEXT("value"), EJson::Number}, {TEXT("minValue"), EJson::Number},
      {TEXT("maxValue"), EJson::Number}, {TEXT("stepSize"), EJson::Number},
      {TEXT("orientation"), EJson::String} });

RegisterLeaf(TEXT("CheckBox"),     UCheckBox::StaticClass(),
    { {TEXT("isChecked"), EJson::Boolean} });

RegisterLeaf(TEXT("EditableTextBox"), UEditableTextBox::StaticClass(),
    { {TEXT("text"), EJson::String}, {TEXT("hintText"), EJson::String},
      {TEXT("isReadOnly"), EJson::Boolean}, {TEXT("justification"), EJson::String} });

RegisterLeaf(TEXT("RichTextBlock"), URichTextBlock::StaticClass(),
    { {TEXT("text"), EJson::String}, {TEXT("justification"), EJson::String},
      {TEXT("autoWrapText"), EJson::Boolean} });
```

## bIsVariable Rule

`bIsVariable` controls whether a widget appears in the Widget Blueprint's Variables panel and is accessible from external Blueprint graphs.

**Rule:** During `FWidgetTreeBuilder::BuildNode`, after `ConstructWidget` and before `AttachChild`, set `Widget->bIsVariable = true` if either:

- **Condition 1 (interactive type):** The widget type is one of: `ProgressBar`, `Slider`, `CheckBox`, `EditableTextBox`, `Button`
- **Condition 2 (animation target):** The widget name is in the animation target set

All other widgets keep their engine default (`bIsVariable = false`).

**Animation target set construction:** Before `BuildTree` is called, the orchestrator (`FWidgetBlueprintBuilder`) builds a `TSet<FString>` by iterating `Spec.Animations` and adding each `AnimSpec.Target` to the set. It passes this set into `BuildTree`. `BuildTree` passes it down through `BuildNode` recursion.

**Updated signatures:**

`BuildTree` (public):
```cpp
UWidget* BuildTree(
    UWidgetBlueprint* WidgetBP,
    UWidgetTree* WidgetTree,
    const FWidgetBlueprintSpec& Spec,
    const TSet<FString>& AnimationTargets,  // NEW
    FString& OutError
);
```

`BuildNode` (private, updated to thread AnimationTargets through recursion):
```cpp
UWidget* BuildNode(
    UWidgetBlueprint* WidgetBP,
    UWidgetTree* WidgetTree,
    const FWidgetNodeSpec& NodeSpec,
    UWidget* Parent,
    const TSet<FString>& AnimationTargets,  // NEW
    const FString& Path,
    FString& OutError
);
```

The caller (`FWidgetBlueprintBuilder::Build` and `::Rebuild`) constructs `AnimationTargets` from `Spec.Animations` before calling `BuildTree`:

```cpp
TSet<FString> AnimationTargets;
for (const FWidgetAnimationSpec& AnimSpec : Spec.Animations)
{
    AnimationTargets.Add(AnimSpec.Target);
}
```

`BuildNode` sequence with bIsVariable (updated):
1. Resolve widget class (ClassRegistry)
2. Construct widget: `WidgetTree->ConstructWidget<UWidget>(...)`
3. **Set bIsVariable if Condition 1 or Condition 2** ← new, before attachment
4. Apply widget-intrinsic properties (PropertyApplier)
5. If parent exists: attach child (ChildAttachment) -- creates slot
6. If parent exists and bHasSlot: apply slot layout (SlotPropertyApplier)
7. Recurse through children

## Validation Rules (additions to FWidgetBlueprintValidator)

In addition to existing rules, validate the following. All produce errors in the format `[WidgetBuilder] <path>: <message>`.

1. `ProgressBar.percent`: reject if outside [0.0, 1.0]
2. `ProgressBar.barFillType`: reject unknown enum strings
3. `ProgressBar.fillColorAndOpacity`: reject if any of r/g/b/a are missing or outside [0.0, 1.0]
4. `Slider.maxValue >= Slider.minValue` when both are present
5. `Slider.stepSize > 0` when present
6. `Slider.value` within [minValue, maxValue] per the value rule above
7. `Slider.orientation`: reject unknown strings
8. `EditableTextBox.justification`: reject unknown strings
9. `RichTextBlock.justification`: reject unknown strings
10. `ScaleBox.stretch`: reject unknown strings
11. `ScaleBox.stretchDirection`: reject unknown strings
12. Grid slot `row`, `column`: reject if < 0
13. Grid slot `rowSpan`, `columnSpan`: reject if < 1
14. Slot `horizontalAlignment`: reject unknown strings
15. Slot `verticalAlignment`: reject unknown strings
16. `visibility` (all widgets): reject unknown strings

## Property Applier Changes (WidgetPropertyApplier.h/cpp)

Add dispatch branches after existing TextBlock/Image/Button/Border branches:

```cpp
if (TypeName == TEXT("ProgressBar"))      ApplyProgressBarProperties(Cast<UProgressBar>(Widget), Props, Path, OutError);
if (TypeName == TEXT("Slider"))           ApplySliderProperties(Cast<USlider>(Widget), Props, Path, OutError);
if (TypeName == TEXT("CheckBox"))         ApplyCheckBoxProperties(Cast<UCheckBox>(Widget), Props, Path, OutError);
if (TypeName == TEXT("EditableTextBox"))  ApplyEditableTextBoxProperties(Cast<UEditableTextBox>(Widget), Props, Path, OutError);
if (TypeName == TEXT("RichTextBlock"))    ApplyRichTextBlockProperties(Cast<URichTextBlock>(Widget), Props, Path, OutError);
if (TypeName == TEXT("ScaleBox"))         ApplyScaleBoxProperties(Cast<UScaleBox>(Widget), Props, Path, OutError);
```

Add corresponding private methods to `FWidgetPropertyApplier`. Each follows the existing TextBlock pattern: check `Props.Contains(key)` before reading, cast is already done by caller.

FText conversion note: `EditableTextBox` and `RichTextBlock` both require `FText::FromString(Value)` when calling `SetText` and `SetHintText`. `TextBlock` already does this. Apply the same pattern.

## Required Headers

Add to `WidgetClassRegistry.cpp`:
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

Add to `WidgetPropertyApplier.cpp`:
```cpp
#include "Components/ProgressBar.h"
#include "Components/Slider.h"
#include "Components/CheckBox.h"
#include "Components/EditableTextBox.h"
#include "Components/RichTextBlock.h"
#include "Components/ScaleBox.h"
```

Add to `WidgetSlotPropertyApplier.cpp`:
```cpp
#include "Components/GridSlot.h"
#include "Components/ScrollBoxSlot.h"
#include "Components/WrapBoxSlot.h"
```

No Build.cs changes needed. UMG is already a private dependency.

## File Inventory

### Modified files

| File | Change |
|---|---|
| `WidgetBlueprintSpec.h` | Add Row/Column/RowSpan/ColumnSpan + bHas* flags; add HorizontalAlignment/VerticalAlignment strings + bHas* flags |
| `WidgetBlueprintJsonParser.cpp` | Extend ValidSlotKeys; parse new slot fields |
| `WidgetBlueprintValidator.cpp` | Add 16 new validation rules |
| `WidgetClassRegistry.h` | Declare RegisterPanel/RegisterContent/RegisterLeaf private helpers |
| `WidgetClassRegistry.cpp` | Implement helpers; add 9 new widget registrations |
| `WidgetPropertyApplier.h` | Declare 6 new private applier methods |
| `WidgetPropertyApplier.cpp` | Implement 6 new applier methods + dispatch branches |
| `WidgetSlotPropertyApplier.h` | Declare GridSlot/ScrollBoxSlot/WrapBoxSlot applier methods |
| `WidgetSlotPropertyApplier.cpp` | Implement 3 new slot applier branches + alignment string helpers |
| `WidgetTreeBuilder.h` | Update BuildTree and BuildNode signatures to include AnimationTargets |
| `WidgetTreeBuilder.cpp` | Update BuildTree + BuildNode to accept and use AnimationTargets; apply bIsVariable rule |
| `WidgetBlueprintBuilder.cpp` | Construct AnimationTargets TSet from Spec.Animations before calling BuildTree in Build and Rebuild |

### New files

None.

### Unchanged files

WidgetBlueprintBuilder.h, WidgetBlueprintAssetFactory, WidgetBlueprintFinalizer, WidgetChildAttachment, WidgetAnimationBuilder, WidgetBlueprintValidator.h (validation logic only, not signature).

## Test Cases

### ProgressBar placement and properties (pass)

```json
{
  "root": {
    "type": "CanvasPanel", "name": "Root",
    "children": [
      {
        "type": "ProgressBar", "name": "ReconnectMeter",
        "properties": { "percent": 0.0, "barFillType": "LeftToRight", "isMarquee": false },
        "slot": { "position": {"x": 500, "y": 360}, "size": {"x": 300, "y": 30} }
      }
    ]
  }
}
```

Success: asset builds, ReconnectMeter appears as a variable in the Widget Blueprint editor.

### GridPanel with slot alignment (pass)

```json
{
  "root": {
    "type": "GridPanel", "name": "Root",
    "children": [
      {
        "type": "TextBlock", "name": "Cell00",
        "properties": { "text": "A" },
        "slot": { "row": 0, "column": 0, "horizontalAlignment": "Center", "verticalAlignment": "Top" }
      },
      {
        "type": "TextBlock", "name": "Cell01",
        "properties": { "text": "B" },
        "slot": { "row": 0, "column": 1, "horizontalAlignment": "Fill" }
      }
    ]
  }
}
```

### Slider value out of range (fail)

```json
{ "type": "Slider", "name": "VolumeSlider", "properties": { "value": 2.0, "minValue": 0.0, "maxValue": 1.0 } }
```

Expected: `[WidgetBuilder] VolumeSlider: 'value' 2.0 is outside [minValue=0.0, maxValue=1.0]`

### Unknown widget type (fail)

```json
{ "type": "ComboBox", "name": "Foo" }
```

Expected: `[WidgetBuilder] Unsupported widget type 'ComboBox'`

### bIsVariable verification (pass)

Build a widget with a ProgressBar `ReconnectMeter` and a TextBlock `PromptText` (no animations). In the editor:
- `ReconnectMeter` appears in the Variables panel (Condition 1: interactive type)
- `PromptText` does NOT appear in Variables

Add an animation targeting `PromptText` and rebuild. `PromptText` now appears in Variables (Condition 2: animation target).

## Risk Log

### Risk 1: UGridPanel column initialization (MEDIUM)

`UGridPanel` may require explicit column fill coefficients before children render at the correct column. If children all appear in column 0 regardless of slot values, add a post-build pass: after the tree is constructed, find all `UGridPanel` widgets, determine the maximum column index used by their children, and call `GridPanel->AddColumnFillCoefficient(1.0f)` for each column index 0..maxColumn.

### Risk 2: UScrollBoxSlot vertical alignment (MEDIUM)

`UScrollBoxSlot` in UE4.27 exposes `SetHorizontalAlignment` and `SetPadding`, but may not expose `SetVerticalAlignment` -- vertical layout in a scroll box is controlled by the scroll direction, not per-slot alignment. If `SetVerticalAlignment` does not exist on `UScrollBoxSlot`, omit it from the applier and log: `[WidgetBuilder] ScrollBoxSlot: verticalAlignment is not supported in UE4.27, ignored`. Do not fail the build.

### Risk 3: USlider property access (MEDIUM)

`USlider::MinValue` and `MaxValue` may be direct UPROPERTY fields rather than methods. Verify at compile time. If `SetMinValue()`/`SetMaxValue()` do not exist, use direct assignment: `Slider->MinValue = Value; Slider->MaxValue = Value;`.

### Risk 4: URichTextBlock without style table (LOW)

If no DataTable is assigned to `TextStyleSet`, markup is stripped at runtime. Expected, not an error. Log once per widget at build time.

### Risk 5: UScaleBox attachment (LOW)

`UScaleBox` extends `UContentWidget`. The existing Pass 4 `AddChild` path handles it. Verify at compile time.

### Risk 6: bIsVariable field accessibility (LOW)

`UWidget::bIsVariable` is a public UPROPERTY. Directly assignable. If for any reason it is not writeable, check for a setter method or use `SetEditorProperty`.
