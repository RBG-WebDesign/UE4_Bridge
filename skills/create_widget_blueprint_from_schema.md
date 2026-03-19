# Skill: create_widget_blueprint_from_schema

Create a Widget Blueprint with a populated designer tree from JSON.

## MCP command
```json
{
  "command": "widget_build_from_json",
  "params": {
    "package_path": "/Game/Generated/UI",
    "asset_name": "WBP_MyWidget",
    "widget_json": {
      "type": "CanvasPanel",
      "name": "Root",
      "properties": { "visibility": "Visible" },
      "children": [
        {
          "type": "TextBlock",
          "name": "Title",
          "properties": {
            "text": "Hello",
            "colorAndOpacity": {"r": 1.0, "g": 1.0, "b": 1.0, "a": 1.0}
          },
          "slot": {
            "position": {"x": 100, "y": 50},
            "size": {"x": 300, "y": 40},
            "alignment": {"x": 0.5, "y": 0.5}
          }
        }
      ]
    }
  }
}
```

## Widget type reference

| Type | Category | Notes |
|---|---|---|
| CanvasPanel | Panel | Default root; children use position/size slots |
| VerticalBox | Panel | Children stacked vertically |
| HorizontalBox | Panel | Children side by side |
| GridPanel | Panel | Grid rows/columns |
| Overlay | Panel | Children stacked on top of each other |
| ScrollBox | Panel | Scrollable container |
| Border | Content | One child, background brush |
| SizeBox | Content | Fixed or constrained size |
| TextBlock | Leaf | text, colorAndOpacity, justification |
| Image | Leaf | brush, colorAndOpacity |
| Button | Content | One child, backgroundColor, OnClicked |
| ProgressBar | Leaf | percent, fillColorAndOpacity |
| Slider | Leaf | value, minValue, maxValue |
| CheckBox | Leaf | isChecked |
| EditableText | Leaf | text, hintText |
| Spacer | Leaf | size |

## Canvas slot fields
```json
"slot": {
  "position": {"x": 0, "y": 0},
  "size": {"x": 200, "y": 60},
  "alignment": {"x": 0.5, "y": 0.5},
  "zOrder": 0
}
```

## Color fields
```json
"colorAndOpacity": {"r": 1.0, "g": 0.5, "b": 0.0, "a": 1.0}
```

## Python pipeline
```python
from generation.widget_generator import generate_widget
from generation.spec_schema import WidgetSpec

spec = WidgetSpec(
    name="WBP_MyWidget",
    content_path="/Game/Generated/UI",
    root_widget={ "type": "CanvasPanel", "name": "Root", "children": [...] }
)
ok, err, data = generate_widget(spec)
```

## Availability check
```python
import unreal
has_lib = hasattr(unreal, "WidgetBlueprintBuilderLibrary")
```
