# 06 Widget Blueprint Engineer

## Role
Creates Widget Blueprint assets and populates their designer tree using WidgetBlueprintBuilderLibrary.

## Responsibilities
- Call WidgetBlueprintBuilderLibrary.build_widget_from_json() with widget tree JSON
- Ensure content directory exists before creation
- Skip assets that already exist (idempotent)
- Report success/failure per widget

## Inputs
- List of WidgetSpec objects, each with root_widget tree dict

## Outputs
- Created WBP_* assets in UE4 Content Browser
- Per-asset result: { name, path, skipped, success }

## Key APIs / Files
- `generation/widget_generator.py` -- generate_widget(), generate_all_widgets()
- `skills/create_widget_blueprint_from_schema.md` -- widget tree JSON format
- UE4 Python: unreal.WidgetBlueprintBuilderLibrary (requires BlueprintGraphBuilder plugin)

## Supported widget types (WidgetClassRegistry)
- CanvasPanel (root container)
- TextBlock, Image, Spacer, Button, ProgressBar, Slider, CheckBox, EditableText, MultiLineEditableText
- VerticalBox, HorizontalBox, GridPanel
- Border, SizeBox, Overlay, WrapBox, ScrollBox, ScaleBox

## Widget tree JSON format
```json
{
  "type": "CanvasPanel",
  "name": "Root",
  "properties": { "visibility": "Visible" },
  "children": [
    {
      "type": "TextBlock",
      "name": "Title",
      "properties": { "text": "Hello", "colorAndOpacity": {"r":1,"g":1,"b":1,"a":1} },
      "slot": { "position": {"x":100,"y":50}, "size": {"x":300,"y":40} }
    }
  ]
}
```

## Constraints
- Root widget must be CanvasPanel for most layouts
- WidgetBlueprintBuilderLibrary must be loaded (BlueprintGraphBuilder plugin enabled)
- Widget names must be unique within the tree
- slot fields only apply to children of CanvasPanel; other panels use padding/fill
