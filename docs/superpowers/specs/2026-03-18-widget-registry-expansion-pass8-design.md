# Widget Builder Pass 8 -- Widget Registry Expansion

## Objective

Expand the widget registry from 10 to 19 types so that AI-generated UI never hits an "unsupported widget type" rejection for any common gameplay UI pattern: HUDs, menus, QTEs, overlays, prompts, progress feedback, and settings panels.

Every new type gets a fully defined, strict property contract. No pass-through widgets. If a type is in the registry, its properties are validated and applied deterministically.

## Scope

### Implement in Pass 8

- 9 new widget types added to `FWidgetClassRegistry`
- Per-widget property applier branches for all new types
- `FWidgetSlotSpec` extended with grid-specific fields
- `FWidgetSlotPropertyApplier` extended for GridSlot, ScrollBoxSlot, WrapBoxSlot
- `bIsVariable = true` automatically set for interactive and animation-targeted widgets

### Do NOT implement

- Helper function injection into widget Blueprint graphs
- Custom style-set creation for RichTextBlock
- Decorator configuration for RichTextBlock
- WrapBox `fillEmptySpace` / `fillSpanWhenLessThan` slot fields
- ScrollBox `alwaysShowScrollbar` or similar display properties
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
| visibility | string | SetVisibility (Visible, Hidden, Collapsed, HitTestInvisible, SelfHitTestInvisible) |
| renderOpacity | number | SetRenderOpacity |
| isEnabled | bool | SetIsEnabled |

### ProgressBar

| Property | JSON type | Validation | Maps to |
|---|---|---|---|
| percent | number | reject if outside [0.0, 1.0] | SetPercent (applier also clamps defensively) |
| fillColorAndOpacity | object {r,g,b,a} | all 4 fields required, reject if any outside [0,1] | SetFillColorAndOpacity |
| barFillType | string | reject unknown values | SetBarFillType |
| isMarquee | bool | none | SetIsMarquee |

Valid `barFillType` values: `LeftToRight`, `RightToLeft`, `FillFromCenter`, `FillFromCenterHorizontal`, `TopToBottom`, `BottomToTop`.

### Slider

| Property | JSON type | Validation | Maps to |
|---|---|---|---|
| value | number | validated after min/max are applied (see rule below) | SetValue |
| minValue | number | none | SetMinValue |
| maxValue | number | validated: maxValue >= minValue | SetMaxValue |
| stepSize | number | reject if <= 0 | SetStepSize |
| orientation | string | reject unknown values | SetOrientation |

Validation rule for `value`: if `minValue` and `maxValue` are both present, `value` must be within `[minValue, maxValue]`. If only one bound is present, the other defaults to UE4 behavior (typically 0..1). `value` without any min/max is validated against [0.0, 1.0].

Valid `orientation` values: `Horizontal`, `Vertical`.

### CheckBox

| Property | JSON type | Validation | Maps to |
|---|---|---|---|
| isChecked | bool | none | SetIsChecked |

### EditableTextBox

| Property | JSON type | Validation | Maps to |
|---|---|---|---|
| text | string | none | SetText |
| hintText | string | none | SetHintText |
| isReadOnly | bool | none | SetIsReadOnly |
| justification | string | reject unknown values | SetJustification |

Valid `justification` values: `Left`, `Center`, `Right` (same as TextBlock).

### RichTextBlock

v1 scope: text content and layout only. No decorator configuration, no custom style-set creation.

| Property | JSON type | Validation | Maps to |
|---|---|---|---|
| text | string | none | SetText (accepts rich text markup) |
| justification | string | reject unknown values | SetJustification |
| autoWrapText | bool | none | SetAutoWrapText |

RichTextBlock requires a data table asset for decorator styles. If no data table is assigned in the project, rich text tags are ignored at runtime and text renders as plain. This is expected behavior and not a builder error.

### ScrollBox

No type-specific properties in v1. Children attach via AddChild. Only base properties (visibility, renderOpacity, isEnabled) apply.

### GridPanel

No type-specific properties in v1. Per-child layout is controlled by grid slot fields.

### WrapBox

No type-specific properties in v1. Per-child layout is controlled by wrap box slot fields.

### ScaleBox

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
// Grid-specific slot fields
int32 Row = 0;
int32 Column = 0;
int32 RowSpan = 1;
int32 ColumnSpan = 1;
bool bHasRow = false;
bool bHasColumn = false;
bool bHasRowSpan = false;
bool bHasColumnSpan = false;

// Explicit alignment fields for grid/scroll/wrap slots
// These are separate from the existing Alignment FVector2D (Canvas-specific continuous values)
FString HorizontalAlignment;  // "Left", "Center", "Right", "Fill"
FString VerticalAlignment;    // "Top", "Center", "Bottom", "Fill"
bool bHasHorizontalAlignment = false;
bool bHasVerticalAlignment = false;
```

The existing `Alignment FVector2D` field remains for CanvasPanelSlot, VerticalBoxSlot, HorizontalBoxSlot, and OverlaySlot. The new string fields `HorizontalAlignment` / `VerticalAlignment` apply only to grid, scroll, and wrap slots.

### JSON slot fields for new panel types

**GridPanel children:**

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

**ScrollBox children:**

```json
"slot": {
  "padding": { "left": 4, "top": 4, "right": 4, "bottom": 4 },
  "horizontalAlignment": "Fill",
  "verticalAlignment": "Top"
}
```

**WrapBox children:**

```json
"slot": {
  "padding": { "left": 4, "top": 4, "right": 4, "bottom": 4 }
}
```

`fillEmptySpace` and `fillSpanWhenLessThan` are deferred to a future pass.

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

### FWidgetSlotPropertyApplier additions

Add three new dispatch branches:

**UGridSlot:**
- `bHasRow` -> SetRow
- `bHasColumn` -> SetColumn
- `bHasRowSpan` -> SetRowSpan
- `bHasColumnSpan` -> SetColumnSpan
- `bHasPadding` -> SetPadding
- `bHasHorizontalAlignment` -> SetHorizontalAlignment (string to EHorizontalAlignment enum)
- `bHasVerticalAlignment` -> SetVerticalAlignment (string to EVerticalAlignment enum)

**UScrollBoxSlot:**
- `bHasPadding` -> SetPadding
- `bHasHorizontalAlignment` -> SetHorizontalAlignment
- `bHasVerticalAlignment` -> SetVerticalAlignment

**UWrapBoxSlot:**
- `bHasPadding` -> SetPadding

Alignment string to enum mapping (used for all three new slot types):

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

Reject unknown values. No silent default.

## bIsVariable Rule

During tree construction in `FWidgetTreeBuilder::BuildNode`, after constructing each widget, set `Widget->bIsVariable = true` if either condition is met:

**Condition 1 -- interactive type:** widget type is one of: `ProgressBar`, `Slider`, `CheckBox`, `EditableTextBox`, `Button`

**Condition 2 -- animation target:** widget name matches any `Target` field in `Spec.Animations`

For Condition 2, collect all animation target names into a `TSet<FString>` before tree construction begins. Pass this set into `FWidgetTreeBuilder::BuildTree`.

Widgets that are neither interactive types nor animation targets get `bIsVariable = false` (engine default). This keeps the Blueprint cleaner -- only widgets that external code or animations need to reference appear as variables.

The `bIsVariable` flag is set on the widget object before attachment, not after.

## Validation Rules (additions to FWidgetBlueprintValidator)

In addition to existing rules, validate:

1. `ProgressBar.percent`: reject if outside [0.0, 1.0]
2. `ProgressBar.barFillType`: reject unknown enum strings
3. `ProgressBar.fillColorAndOpacity`: all 4 fields required, each must be in [0.0, 1.0]
4. `Slider.maxValue >= Slider.minValue` (only when both present)
5. `Slider.stepSize > 0` (only when present)
6. `Slider.value` within [minValue, maxValue] when bounds are present (see Slider contract above)
7. `Slider.orientation`: reject unknown strings
8. `EditableTextBox.justification`: reject unknown strings
9. `RichTextBlock.justification`: reject unknown strings
10. `ScaleBox.stretch`: reject unknown strings
11. `ScaleBox.stretchDirection`: reject unknown strings
12. Grid slot `row`, `column`: reject if < 0
13. Grid slot `rowSpan`, `columnSpan`: reject if < 1
14. Slot `horizontalAlignment`: reject unknown strings (Left, Center, Right, Fill only)
15. Slot `verticalAlignment`: reject unknown strings (Top, Center, Bottom, Fill only)

## Registry Changes (WidgetClassRegistry.cpp)

Add to `RegisterTypes()`:

```cpp
// Pass 8: new panels
RegisterPanel("ScrollBox",   UScrollBox::StaticClass());
RegisterPanel("GridPanel",   UGridPanel::StaticClass());
RegisterPanel("WrapBox",     UWrapBox::StaticClass());

// Pass 8: new content widget
RegisterContent("ScaleBox",  UScaleBox::StaticClass(),
    { {"stretch", EJson::String}, {"stretchDirection", EJson::String},
      {"userSpecifiedScale", EJson::Number} });

// Pass 8: new leaf widgets
RegisterLeaf("ProgressBar",  UProgressBar::StaticClass(),
    { {"percent", EJson::Number}, {"fillColorAndOpacity", EJson::Object},
      {"barFillType", EJson::String}, {"isMarquee", EJson::Boolean} });

RegisterLeaf("Slider",       USlider::StaticClass(),
    { {"value", EJson::Number}, {"minValue", EJson::Number},
      {"maxValue", EJson::Number}, {"stepSize", EJson::Number},
      {"orientation", EJson::String} });

RegisterLeaf("CheckBox",     UCheckBox::StaticClass(),
    { {"isChecked", EJson::Boolean} });

RegisterLeaf("EditableTextBox", UEditableTextBox::StaticClass(),
    { {"text", EJson::String}, {"hintText", EJson::String},
      {"isReadOnly", EJson::Boolean}, {"justification", EJson::String} });

RegisterLeaf("RichTextBlock", URichTextBlock::StaticClass(),
    { {"text", EJson::String}, {"justification", EJson::String},
      {"autoWrapText", EJson::Boolean} });
```

`RegisterPanel`, `RegisterContent`, `RegisterLeaf` are internal helpers that can be introduced in this pass to reduce boilerplate in `RegisterTypes()`. Each adds common properties automatically, then appends type-specific ones.

## Property Applier Changes (WidgetPropertyApplier.cpp)

Add dispatch branches for each new leaf/content type. Pattern matches existing TextBlock branch:

```cpp
if (TypeName == TEXT("ProgressBar"))     { ApplyProgressBarProperties(...) }
if (TypeName == TEXT("Slider"))          { ApplySliderProperties(...) }
if (TypeName == TEXT("CheckBox"))        { ApplyCheckBoxProperties(...) }
if (TypeName == TEXT("EditableTextBox")) { ApplyEditableTextBoxProperties(...) }
if (TypeName == TEXT("RichTextBlock"))   { ApplyRichTextBlockProperties(...) }
if (TypeName == TEXT("ScaleBox"))        { ApplyScaleBoxProperties(...) }
```

Add corresponding private methods to `FWidgetPropertyApplier`.

## Required Headers

Add to `WidgetPropertyApplier.cpp` includes:

```cpp
#include "Components/ProgressBar.h"
#include "Components/Slider.h"
#include "Components/CheckBox.h"
#include "Components/EditableTextBox.h"
#include "Components/RichTextBlock.h"
#include "Components/ScaleBox.h"
#include "Components/ScrollBox.h"
#include "Components/GridPanel.h"
#include "Components/WrapBox.h"
```

Add to `WidgetSlotPropertyApplier.cpp` includes:

```cpp
#include "Components/GridSlot.h"
#include "Components/ScrollBoxSlot.h"
#include "Components/WrapBoxSlot.h"
```

Add to `WidgetClassRegistry.cpp` includes:

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

No Build.cs changes needed -- UMG is already a private dependency from the Widget Builder's initial setup.

## File Inventory

### Modified files

| File | Change |
|---|---|
| `WidgetBlueprintSpec.h` | Add Row/Column/RowSpan/ColumnSpan fields + bHas* flags; add HorizontalAlignment/VerticalAlignment string fields + bHas* flags |
| `WidgetBlueprintJsonParser.cpp` | Extend ValidSlotKeys; parse new slot fields |
| `WidgetBlueprintValidator.cpp` | Add validation rules for new widget types and slot fields |
| `WidgetClassRegistry.h/cpp` | Add 9 new widget types; introduce RegisterPanel/RegisterContent/RegisterLeaf helpers |
| `WidgetPropertyApplier.h/cpp` | Add applier branches + private methods for new widget types |
| `WidgetSlotPropertyApplier.h/cpp` | Add GridSlot, ScrollBoxSlot, WrapBoxSlot dispatch branches |
| `WidgetTreeBuilder.h/cpp` | Pass animation target set into BuildTree; apply bIsVariable rule during BuildNode |

### New files

None. All changes go into existing files.

### Unchanged files

WidgetBlueprintBuilder, WidgetBlueprintAssetFactory, WidgetBlueprintFinalizer, WidgetChildAttachment, WidgetAnimationBuilder.

## Test Cases

### ProgressBar (pass)

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

### GridPanel (pass)

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

### Slider value validation (fail)

```json
{
  "type": "Slider", "name": "VolumeSlider",
  "properties": { "value": 2.0, "minValue": 0.0, "maxValue": 1.0 }
}
```

Expected error: `[WidgetBuilder] VolumeSlider: 'value' 2.0 is outside [minValue=0.0, maxValue=1.0]`

### Unknown widget type (fail)

```json
{ "type": "ComboBox", "name": "Foo" }
```

Expected error: `[WidgetBuilder] Unsupported widget type 'ComboBox'`

### bIsVariable (pass -- verify in editor)

Build a widget with a ProgressBar named `ReconnectMeter` and a TextBlock named `PromptText`. Verify in the Widget Blueprint editor:
- `ReconnectMeter` appears in the Variables panel (bIsVariable = true -- interactive type)
- `PromptText` does NOT appear in Variables (not interactive, not an animation target)
- If `PromptText` is referenced as an animation target, it SHOULD appear in Variables

## Risk Log

### Risk 1: UGridPanel column definition (MEDIUM)

`UGridPanel` in UE4.27 may require explicit column definitions via `AddColumnFillCoefficient` before children can be assigned to columns. If grid children render at column 0 regardless of slot column, add a pass after tree construction that calls `GridPanel->AddColumnFillCoefficient(1.0f)` for each unique column index encountered.

### Risk 2: URichTextBlock without style table (LOW)

If no `DataTable` is assigned to a RichTextBlock's `TextStyleSet`, markup tags are stripped at runtime. The builder does not assign a style table -- this is expected. Document clearly in logging: `[WidgetBuilder] RichTextBlock 'X': no text style set assigned, markup will be stripped at runtime`.

### Risk 3: UScaleBox child access (LOW)

`UScaleBox` extends `UContentWidget`. The existing content widget attachment path (Pass 4) should handle it. Verify at compile time.

### Risk 4: bIsVariable field accessibility (LOW)

`UWidget::bIsVariable` is a public UPROPERTY in UE4.27. Should be directly settable. If protected, use the existing property access pattern (`Widget->SetEditorPropertyValue` equivalent).
