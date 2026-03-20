# Unified BlueprintSpec Schema System

**Status:** Production specification
**Scope:** Single entry point for all Unreal asset generation via `blueprint_build_from_json`

---

## 1. BlueprintSpec JSON Schema (STRICT)

### Top-Level Discriminator

Every BlueprintSpec has a `class_type` field that determines the schema shape and routes to the correct builder subsystem.

```json
{
  "class_type": "Actor",
  "name": "BP_EnemyTurret",
  "content_path": "/Game/Blueprints",
  ...
}
```

### Class Type Categories

| class_type | Builder Subsystem | C++ Entry Point |
|---|---|---|
| `Actor` | Blueprint Graph Builder | `BuildBlueprintFromJSON` |
| `Character` | Blueprint Graph Builder | `BuildBlueprintFromJSON` |
| `Pawn` | Blueprint Graph Builder | `BuildBlueprintFromJSON` |
| `PlayerController` | Blueprint Graph Builder | `BuildBlueprintFromJSON` |
| `GameMode` | Blueprint Graph Builder | `BuildBlueprintFromJSON` |
| `GameState` | Blueprint Graph Builder | `BuildBlueprintFromJSON` |
| `HUD` | Blueprint Graph Builder | `BuildBlueprintFromJSON` |
| `ActorComponent` | Blueprint Graph Builder | `BuildBlueprintFromJSON` |
| `SceneComponent` | Blueprint Graph Builder | `BuildBlueprintFromJSON` |
| `FunctionLibrary` | Blueprint Graph Builder | `BuildBlueprintFromJSON` |
| `Widget` | Widget Blueprint Builder | `BuildWidgetFromJSON` |
| `BehaviorTree` | Behavior Tree Builder | `BuildBehaviorTreeFromJSON` |
| `AnimBlueprint` | Animation Blueprint Builder | `BuildAnimBlueprintFromJSON` |

### 1.1 Common Fields (ALL class_types)

```jsonschema
{
  "type": "object",
  "required": ["class_type", "name", "content_path"],
  "properties": {
    "class_type": {
      "type": "string",
      "enum": [
        "Actor", "Character", "Pawn", "PlayerController",
        "GameMode", "GameState", "HUD",
        "ActorComponent", "SceneComponent", "FunctionLibrary",
        "Widget", "BehaviorTree", "AnimBlueprint"
      ]
    },
    "name": {
      "type": "string",
      "description": "Asset name without prefix. e.g. 'EnemyTurret' not 'BP_EnemyTurret'. Builder adds prefix.",
      "pattern": "^[A-Za-z_][A-Za-z0-9_]*$"
    },
    "content_path": {
      "type": "string",
      "description": "Content directory path. e.g. '/Game/Blueprints'",
      "pattern": "^/Game/"
    }
  }
}
```

### 1.2 K2 Blueprint Schema (Actor, Character, Pawn, PlayerController, GameMode, GameState, HUD, ActorComponent, SceneComponent, FunctionLibrary)

```json
{
  "class_type": "Actor",
  "name": "EnemyTurret",
  "content_path": "/Game/Blueprints",
  "parent_class": "Actor",

  "components": [
    {
      "name": "TurretBase",
      "type": "StaticMeshComponent",
      "is_root": true,
      "properties": {
        "static_mesh": "/Game/Meshes/SM_TurretBase",
        "relative_location": {"x": 0, "y": 0, "z": 0},
        "relative_rotation": {"pitch": 0, "yaw": 0, "roll": 0},
        "relative_scale": {"x": 1, "y": 1, "z": 1},
        "mobility": "Movable",
        "collision_preset": "BlockAll",
        "visible": true,
        "hidden_in_game": false,
        "cast_shadow": true
      },
      "children": ["TurretBarrel", "DetectionSphere"]
    },
    {
      "name": "TurretBarrel",
      "type": "StaticMeshComponent",
      "properties": {
        "static_mesh": "/Game/Meshes/SM_TurretBarrel",
        "relative_location": {"x": 0, "y": 0, "z": 120}
      }
    },
    {
      "name": "DetectionSphere",
      "type": "SphereComponent",
      "properties": {
        "sphere_radius": 500.0,
        "collision_preset": "OverlapAllDynamic",
        "generate_overlap_events": true,
        "hidden_in_game": true
      }
    }
  ],

  "variables": [
    {
      "name": "Health",
      "type": "float",
      "default": 100.0,
      "instance_editable": true,
      "category": "Combat",
      "tooltip": "Current health points",
      "replicated": false
    },
    {
      "name": "TargetActor",
      "type": "object_ref",
      "object_class": "Actor",
      "default": null,
      "blueprint_read_only": false
    },
    {
      "name": "PatrolPoints",
      "type": "array",
      "element_type": "vector",
      "default": [],
      "instance_editable": true
    }
  ],

  "functions": [
    {
      "name": "CalculateDamage",
      "access": "Public",
      "pure": true,
      "const": true,
      "category": "Combat",
      "inputs": [
        {"name": "BaseDamage", "type": "float"},
        {"name": "DamageMultiplier", "type": "float"}
      ],
      "outputs": [
        {"name": "FinalDamage", "type": "float"}
      ],
      "graph": {
        "nodes": [
          {"id": "multiply", "type": "Multiply_FloatFloat", "params": {}},
          {"id": "return", "type": "ReturnNode"}
        ],
        "connections": [
          {"from": "entry.BaseDamage", "to": "multiply.A"},
          {"from": "entry.DamageMultiplier", "to": "multiply.B"},
          {"from": "multiply.ReturnValue", "to": "return.FinalDamage"}
        ]
      }
    }
  ],

  "events": [
    {
      "name": "OnTargetAcquired",
      "type": "Custom",
      "replicated": false,
      "inputs": [
        {"name": "Target", "type": "object_ref", "object_class": "Actor"}
      ]
    }
  ],

  "dispatchers": [
    {
      "name": "OnHealthChanged",
      "params": [
        {"name": "NewHealth", "type": "float"},
        {"name": "OldHealth", "type": "float"}
      ]
    }
  ],

  "event_graph": {
    "nodes": [
      {"id": "begin_play", "type": "BeginPlay"},
      {"id": "print1", "type": "PrintString", "params": {"InString": "Turret Online"}}
    ],
    "connections": [
      {"from": "begin_play.exec", "to": "print1.exec"}
    ]
  },

  "timelines": [
    {
      "name": "RotationTimeline",
      "length": 2.0,
      "looping": true,
      "auto_play": false,
      "tracks": [
        {
          "name": "YawCurve",
          "type": "float",
          "keys": [
            {"time": 0.0, "value": 0.0},
            {"time": 1.0, "value": 180.0},
            {"time": 2.0, "value": 360.0}
          ]
        }
      ]
    }
  ],

  "details": {
    "tick_enabled": true,
    "tick_interval": 0.0,
    "replicates": false,
    "auto_possess_player": "Disabled",
    "auto_possess_ai": "PlacedInWorldOrSpawned",
    "input_priority": 0,
    "tags": ["Enemy", "Turret"]
  }
}
```

#### 1.2.1 ComponentSpec

```jsonschema
{
  "type": "object",
  "required": ["name", "type"],
  "properties": {
    "name": {
      "type": "string",
      "pattern": "^[A-Za-z_][A-Za-z0-9_]*$"
    },
    "type": {
      "type": "string",
      "enum": [
        "SceneComponent",
        "StaticMeshComponent",
        "SkeletalMeshComponent",
        "CameraComponent",
        "SpringArmComponent",
        "CapsuleComponent",
        "BoxComponent",
        "SphereComponent",
        "ArrowComponent",
        "AudioComponent",
        "ParticleSystemComponent",
        "NiagaraComponent",
        "WidgetComponent",
        "ChildActorComponent",
        "SpotLightComponent",
        "PointLightComponent",
        "DirectionalLightComponent",
        "DecalComponent",
        "SplineComponent",
        "ProjectileMovementComponent",
        "RotatingMovementComponent",
        "FloatingPawnMovement",
        "CharacterMovementComponent"
      ]
    },
    "is_root": {
      "type": "boolean",
      "default": false,
      "description": "If true, this is the DefaultSceneRoot. Exactly one per blueprint."
    },
    "children": {
      "type": "array",
      "items": {"type": "string"},
      "description": "Names of child components attached to this one."
    },
    "properties": {
      "type": "object",
      "description": "Type-specific properties. See ComponentProperties section."
    }
  }
}
```

#### 1.2.2 Component Properties (by type)

**All SceneComponent subtypes:**
```json
{
  "relative_location": {"x": 0, "y": 0, "z": 0},
  "relative_rotation": {"pitch": 0, "yaw": 0, "roll": 0},
  "relative_scale": {"x": 1, "y": 1, "z": 1},
  "mobility": "Static|Stationary|Movable",
  "visible": true,
  "hidden_in_game": false
}
```

**StaticMeshComponent / SkeletalMeshComponent:**
```json
{
  "static_mesh": "/Game/Path/To/Mesh",
  "skeletal_mesh": "/Game/Path/To/SkMesh",
  "materials": ["/Game/Path/To/Material"],
  "cast_shadow": true,
  "collision_preset": "BlockAll|OverlapAll|NoCollision|BlockAllDynamic|OverlapAllDynamic|...",
  "generate_overlap_events": false,
  "simulate_physics": false
}
```

**CapsuleComponent / BoxComponent / SphereComponent:**
```json
{
  "capsule_half_height": 96.0,
  "capsule_radius": 42.0,
  "box_extent": {"x": 32, "y": 32, "z": 32},
  "sphere_radius": 50.0,
  "collision_preset": "...",
  "generate_overlap_events": false
}
```

**CameraComponent:**
```json
{
  "field_of_view": 90.0,
  "aspect_ratio": 1.777,
  "constrain_aspect_ratio": false,
  "post_process_blend_weight": 1.0
}
```

**SpringArmComponent:**
```json
{
  "target_arm_length": 300.0,
  "use_pawn_control_rotation": true,
  "do_collision_test": true,
  "camera_lag_speed": 10.0,
  "enable_camera_lag": false
}
```

**AudioComponent:**
```json
{
  "sound": "/Game/Path/To/SoundCue",
  "auto_activate": false,
  "volume_multiplier": 1.0,
  "pitch_multiplier": 1.0
}
```

**ChildActorComponent:**
```json
{
  "child_actor_class": "/Game/Path/To/Blueprint"
}
```

**CharacterMovementComponent:**
```json
{
  "max_walk_speed": 600.0,
  "max_fly_speed": 600.0,
  "jump_z_velocity": 420.0,
  "gravity_scale": 1.0,
  "air_control": 0.05,
  "braking_deceleration_walking": 2048.0,
  "ground_friction": 8.0,
  "can_crouch": false,
  "crouch_half_height": 40.0
}
```

#### 1.2.3 VariableSpec

```jsonschema
{
  "type": "object",
  "required": ["name", "type"],
  "properties": {
    "name": {"type": "string", "pattern": "^[A-Za-z_][A-Za-z0-9_]*$"},
    "type": {
      "type": "string",
      "enum": [
        "bool", "int", "int64", "float", "name", "string", "text",
        "vector", "rotator", "transform", "color", "linear_color",
        "object_ref", "class_ref", "soft_object_ref", "interface_ref",
        "array", "set", "map"
      ]
    },
    "default": {
      "description": "Default value. Type must match variable type."
    },
    "object_class": {
      "type": "string",
      "description": "Required when type is object_ref, class_ref, soft_object_ref. UE4 class name."
    },
    "element_type": {
      "type": "string",
      "description": "Required when type is array or set. Element variable type."
    },
    "key_type": {
      "type": "string",
      "description": "Required when type is map. Key variable type."
    },
    "value_type": {
      "type": "string",
      "description": "Required when type is map. Value variable type."
    },
    "instance_editable": {"type": "boolean", "default": false},
    "expose_on_spawn": {"type": "boolean", "default": false},
    "blueprint_read_only": {"type": "boolean", "default": false},
    "category": {"type": "string", "default": "Default"},
    "tooltip": {"type": "string"},
    "replicated": {"type": "boolean", "default": false},
    "rep_notify": {"type": "boolean", "default": false}
  }
}
```

**Default value formats by type:**
| Type | JSON Format | Example |
|---|---|---|
| `bool` | boolean | `true` |
| `int`, `int64` | number (integer) | `42` |
| `float` | number | `3.14` |
| `name`, `string`, `text` | string | `"Hello"` |
| `vector` | `{"x": 0, "y": 0, "z": 0}` | `{"x": 1, "y": 2, "z": 3}` |
| `rotator` | `{"pitch": 0, "yaw": 0, "roll": 0}` | `{"pitch": 0, "yaw": 90, "roll": 0}` |
| `transform` | `{"location": {}, "rotation": {}, "scale": {}}` | see below |
| `color` | `{"r": 0-255, "g": 0-255, "b": 0-255, "a": 0-255}` | `{"r": 255, "g": 0, "b": 0, "a": 255}` |
| `linear_color` | `{"r": 0.0-1.0, "g": 0.0-1.0, "b": 0.0-1.0, "a": 0.0-1.0}` | `{"r": 1, "g": 0, "b": 0, "a": 1}` |
| `object_ref` | string (path) or null | `"/Game/BP_Enemy.BP_Enemy"` |
| `array` | array | `[1, 2, 3]` |
| `set` | array | `["a", "b"]` |
| `map` | object | `{"key1": "val1"}` |

#### 1.2.4 FunctionSpec

```jsonschema
{
  "type": "object",
  "required": ["name"],
  "properties": {
    "name": {"type": "string"},
    "access": {"type": "string", "enum": ["Public", "Private", "Protected"], "default": "Public"},
    "pure": {"type": "boolean", "default": false},
    "const": {"type": "boolean", "default": false},
    "call_in_editor": {"type": "boolean", "default": false},
    "category": {"type": "string"},
    "keywords": {"type": "string"},
    "inputs": {
      "type": "array",
      "items": {"$ref": "#/definitions/PinSpec"}
    },
    "outputs": {
      "type": "array",
      "items": {"$ref": "#/definitions/PinSpec"}
    },
    "graph": {"$ref": "#/definitions/GraphSpec"}
  }
}
```

#### 1.2.5 EventSpec

```jsonschema
{
  "type": "object",
  "required": ["name", "type"],
  "properties": {
    "name": {"type": "string"},
    "type": {
      "type": "string",
      "enum": ["Custom", "BeginPlay", "Tick", "EndPlay",
               "OnComponentBeginOverlap", "OnComponentEndOverlap", "OnHit",
               "InputAction", "InputAxis"]
    },
    "replicated": {"type": "boolean", "default": false},
    "multicast": {"type": "boolean", "default": false},
    "inputs": {
      "type": "array",
      "items": {"$ref": "#/definitions/PinSpec"},
      "description": "Only for Custom events"
    },
    "action_name": {
      "type": "string",
      "description": "Only for InputAction/InputAxis type"
    },
    "component_name": {
      "type": "string",
      "description": "Only for overlap/hit events. Name of the component."
    }
  }
}
```

#### 1.2.6 DispatcherSpec

```jsonschema
{
  "type": "object",
  "required": ["name"],
  "properties": {
    "name": {"type": "string"},
    "params": {
      "type": "array",
      "items": {"$ref": "#/definitions/PinSpec"}
    }
  }
}
```

#### 1.2.7 TimelineSpec

```jsonschema
{
  "type": "object",
  "required": ["name", "length", "tracks"],
  "properties": {
    "name": {"type": "string"},
    "length": {"type": "number", "minimum": 0.001},
    "looping": {"type": "boolean", "default": false},
    "auto_play": {"type": "boolean", "default": false},
    "tracks": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["name", "type", "keys"],
        "properties": {
          "name": {"type": "string"},
          "type": {"type": "string", "enum": ["float", "vector", "color", "event"]},
          "keys": {
            "type": "array",
            "items": {
              "type": "object",
              "required": ["time"],
              "properties": {
                "time": {"type": "number", "minimum": 0.0},
                "value": {
                  "description": "float for float tracks, {x,y,z} for vector, {r,g,b,a} for color, omitted for event"
                },
                "interp_mode": {
                  "type": "string",
                  "enum": ["Linear", "Cubic", "Constant"],
                  "default": "Linear"
                }
              }
            }
          }
        }
      }
    }
  }
}
```

#### 1.2.8 DetailsSpec

```jsonschema
{
  "type": "object",
  "properties": {
    "tick_enabled": {"type": "boolean", "default": false},
    "tick_interval": {"type": "number", "default": 0.0},
    "replicates": {"type": "boolean", "default": false},
    "net_load_on_client": {"type": "boolean", "default": true},
    "auto_possess_player": {
      "type": "string",
      "enum": ["Disabled", "Player0", "Player1", "Player2", "Player3"],
      "default": "Disabled"
    },
    "auto_possess_ai": {
      "type": "string",
      "enum": ["Disabled", "PlacedInWorld", "Spawned", "PlacedInWorldOrSpawned"],
      "default": "PlacedInWorldOrSpawned"
    },
    "input_priority": {"type": "integer", "default": 0},
    "tags": {
      "type": "array",
      "items": {"type": "string"}
    }
  }
}
```

### 1.3 Widget Blueprint Schema (class_type: "Widget")

```json
{
  "class_type": "Widget",
  "name": "HUDOverlay",
  "content_path": "/Game/UI",

  "root": {
    "type": "CanvasPanel",
    "name": "RootCanvas",
    "properties": {
      "visibility": "Visible"
    },
    "children": [
      {
        "type": "VerticalBox",
        "name": "InfoPanel",
        "slot": {
          "position": {"x": 50, "y": 50},
          "size": {"x": 400, "y": 300},
          "alignment": {"x": 0, "y": 0},
          "zOrder": 1
        },
        "children": [
          {
            "type": "TextBlock",
            "name": "HealthLabel",
            "properties": {
              "text": "Health: 100",
              "colorAndOpacity": {"r": 1.0, "g": 0.2, "b": 0.2, "a": 1.0},
              "justification": "Left"
            },
            "slot": {
              "padding": {"left": 10, "top": 5, "right": 10, "bottom": 5}
            }
          },
          {
            "type": "ProgressBar",
            "name": "HealthBar",
            "properties": {
              "percent": 1.0,
              "fillColorAndOpacity": {"r": 1.0, "g": 0.0, "b": 0.0, "a": 1.0}
            },
            "slot": {
              "padding": {"left": 10, "top": 0, "right": 10, "bottom": 5}
            }
          }
        ]
      }
    ]
  },

  "animations": [
    {
      "name": "FadeIn",
      "target": "RootCanvas",
      "duration": 0.5,
      "tracks": [
        {"type": "opacity", "from": 0.0, "to": 1.0}
      ]
    }
  ]
}
```

#### 1.3.1 WidgetNodeSpec

```jsonschema
{
  "type": "object",
  "required": ["type", "name"],
  "properties": {
    "type": {
      "type": "string",
      "enum": [
        "CanvasPanel", "VerticalBox", "HorizontalBox", "Overlay",
        "ScrollBox", "GridPanel", "WrapBox",
        "Button", "Border", "SizeBox", "ScaleBox",
        "TextBlock", "Image", "Spacer", "ProgressBar",
        "Slider", "CheckBox", "EditableTextBox", "RichTextBlock"
      ]
    },
    "name": {
      "type": "string",
      "pattern": "^[A-Za-z_][A-Za-z0-9_]*$",
      "description": "Must be unique across entire widget tree"
    },
    "properties": {
      "type": "object",
      "description": "Widget-type-specific properties. See WidgetProperties section."
    },
    "slot": {"$ref": "#/definitions/WidgetSlotSpec"},
    "children": {
      "type": "array",
      "items": {"$ref": "#/definitions/WidgetNodeSpec"}
    }
  }
}
```

**Widget categories and child rules:**
| Category | Types | Max Children |
|---|---|---|
| Panel | CanvasPanel, VerticalBox, HorizontalBox, Overlay, ScrollBox, GridPanel, WrapBox | unlimited |
| Content | Button, Border, SizeBox, ScaleBox | 0 or 1 |
| Leaf | TextBlock, Image, Spacer, ProgressBar, Slider, CheckBox, EditableTextBox, RichTextBlock | 0 |

#### 1.3.2 Widget Properties (by type)

**All widgets:**
```json
{
  "visibility": "Visible|Collapsed|Hidden|HitTestInvisible|SelfHitTestInvisible",
  "renderOpacity": 1.0,
  "isEnabled": true
}
```

**TextBlock:**
```json
{
  "text": "string",
  "colorAndOpacity": {"r": 1.0, "g": 1.0, "b": 1.0, "a": 1.0},
  "justification": "Left|Center|Right",
  "autoWrapText": false,
  "wrappingPolicy": "DefaultWrapping|AllowPerCharacterWrapping"
}
```

**Image:**
```json
{
  "brush": "/Game/Path/To/Texture",
  "colorAndOpacity": {"r": 1.0, "g": 1.0, "b": 1.0, "a": 1.0}
}
```

**ProgressBar:**
```json
{
  "percent": 0.0,
  "fillColorAndOpacity": {"r": 1.0, "g": 1.0, "b": 1.0, "a": 1.0},
  "barFillType": "LeftToRight|RightToLeft|FillFromCenter|TopToBottom|BottomToTop"
}
```

**Slider:**
```json
{
  "value": 0.0,
  "minValue": 0.0,
  "maxValue": 1.0,
  "orientation": "Horizontal|Vertical"
}
```

**CheckBox:**
```json
{
  "isChecked": false
}
```

**Button:**
```json
{
  "colorAndOpacity": {"r": 1.0, "g": 1.0, "b": 1.0, "a": 1.0}
}
```

**Border:**
```json
{
  "contentColorAndOpacity": {"r": 1.0, "g": 1.0, "b": 1.0, "a": 1.0},
  "horizontalAlignment": "Fill|Left|Center|Right",
  "verticalAlignment": "Fill|Top|Center|Bottom"
}
```

**SizeBox:**
```json
{
  "widthOverride": 100.0,
  "heightOverride": 50.0,
  "minDesiredWidth": 0.0,
  "minDesiredHeight": 0.0,
  "maxDesiredWidth": 0.0,
  "maxDesiredHeight": 0.0
}
```

#### 1.3.3 WidgetSlotSpec

Slot properties depend on the parent widget type. The builder reads the parent type and applies the correct slot class.

**UCanvasPanelSlot:**
```json
{
  "position": {"x": 0, "y": 0},
  "size": {"x": 100, "y": 50},
  "alignment": {"x": 0, "y": 0},
  "zOrder": 0,
  "autoSize": false
}
```

**UVerticalBoxSlot / UHorizontalBoxSlot:**
```json
{
  "padding": {"left": 0, "top": 0, "right": 0, "bottom": 0},
  "horizontalAlignment": "Fill|Left|Center|Right",
  "verticalAlignment": "Fill|Top|Center|Bottom",
  "size_rule": "Auto|Fill",
  "fill_weight": 1.0
}
```

**UOverlaySlot:**
```json
{
  "padding": {"left": 0, "top": 0, "right": 0, "bottom": 0},
  "horizontalAlignment": "Fill|Left|Center|Right",
  "verticalAlignment": "Fill|Top|Center|Bottom"
}
```

#### 1.3.4 WidgetAnimationSpec

```jsonschema
{
  "type": "object",
  "required": ["name", "target", "duration", "tracks"],
  "properties": {
    "name": {"type": "string"},
    "target": {"type": "string", "description": "Widget name in the tree"},
    "duration": {"type": "number", "minimum": 0.001},
    "tracks": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["type"],
        "properties": {
          "type": {"type": "string", "enum": ["opacity", "translation", "scale"]},
          "from": {"description": "Start value. float for opacity, {x,y} for translation/scale"},
          "to": {"description": "End value. Same format as from."}
        }
      }
    }
  }
}
```

### 1.4 Behavior Tree Schema (class_type: "BehaviorTree")

```json
{
  "class_type": "BehaviorTree",
  "name": "BT_EnemyAI",
  "content_path": "/Game/AI",

  "blackboard": {
    "keys": [
      {"name": "TargetActor", "type": "Object", "base_class": "Actor"},
      {"name": "HomeLocation", "type": "Vector"},
      {"name": "HasLineOfSight", "type": "Bool"},
      {"name": "DistanceToTarget", "type": "Float"},
      {"name": "AlertLevel", "type": "Int"},
      {"name": "PatrolIndex", "type": "Int"}
    ]
  },

  "root": {
    "id": "root_sel",
    "type": "Selector",
    "name": "RootBehavior",
    "children": [
      {
        "id": "combat_seq",
        "type": "Sequence",
        "name": "CombatSequence",
        "decorators": [
          {
            "id": "has_target",
            "type": "Blackboard",
            "name": "HasTarget",
            "params": {
              "blackboard_key": "TargetActor",
              "condition": "IsSet"
            }
          }
        ],
        "services": [
          {
            "id": "focus_svc",
            "type": "DefaultFocus",
            "params": {
              "blackboard_key": "TargetActor"
            }
          }
        ],
        "children": [
          {
            "id": "move_to",
            "type": "MoveTo",
            "params": {
              "blackboard_key": "TargetActor",
              "acceptable_radius": 200.0
            }
          }
        ]
      },
      {
        "id": "patrol_seq",
        "type": "Sequence",
        "name": "PatrolSequence",
        "children": [
          {
            "id": "move_home",
            "type": "MoveTo",
            "params": {
              "blackboard_key": "HomeLocation",
              "acceptable_radius": 50.0
            }
          },
          {
            "id": "wait_patrol",
            "type": "Wait",
            "params": {
              "wait_time": 3.0,
              "random_deviation": 1.0
            }
          }
        ]
      }
    ]
  }
}
```

#### 1.4.1 BlackboardSpec

```jsonschema
{
  "type": "object",
  "required": ["keys"],
  "properties": {
    "keys": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["name", "type"],
        "properties": {
          "name": {"type": "string"},
          "type": {
            "type": "string",
            "enum": ["Bool", "Int", "Float", "String", "Name", "Vector", "Rotator", "Object", "Class", "Enum"]
          },
          "base_class": {
            "type": "string",
            "description": "Required when type is Object or Class. UE4 class name."
          }
        }
      }
    }
  }
}
```

#### 1.4.2 BTNodeSpec

```jsonschema
{
  "type": "object",
  "required": ["id", "type"],
  "properties": {
    "id": {
      "type": "string",
      "description": "Unique across entire tree"
    },
    "type": {
      "type": "string",
      "enum": [
        "Selector", "Sequence", "SimpleParallel",
        "MoveTo", "Wait", "WaitBlackboardTime", "RotateToFaceBBEntry",
        "PlayAnimation", "MakeNoise", "RunBehavior", "PlaySound",
        "FinishWithResult", "SetTagCooldown",
        "Blackboard", "ForceSuccess", "Loop", "TimeLimit", "Cooldown",
        "CompareBBEntries", "IsAtLocation", "DoesPathExist",
        "TagCooldown", "ConditionalLoop", "KeepInCone", "IsBBEntryOfClass",
        "DefaultFocus"
      ]
    },
    "name": {"type": "string"},
    "params": {
      "type": "object",
      "additionalProperties": {
        "oneOf": [
          {"type": "string"},
          {"type": "number"},
          {"type": "boolean"}
        ]
      }
    },
    "children": {
      "type": "array",
      "items": {"$ref": "#/definitions/BTNodeSpec"},
      "description": "Only valid for composite types"
    },
    "decorators": {
      "type": "array",
      "items": {"$ref": "#/definitions/BTNodeSpec"},
      "description": "Only decorator types allowed here"
    },
    "services": {
      "type": "array",
      "items": {"$ref": "#/definitions/BTNodeSpec"},
      "description": "Only service types allowed here. Attach to composite nodes."
    }
  }
}
```

**Node params by type:**

| Node | Required Params | Optional Params |
|---|---|---|
| Selector | - | - |
| Sequence | - | - |
| SimpleParallel | - | `finish_mode`: "Immediate"\|"Delayed" |
| MoveTo | `blackboard_key` | `acceptable_radius` (default: 50.0) |
| Wait | - | `wait_time` (default: 5.0), `random_deviation` (default: 0.0) |
| WaitBlackboardTime | `blackboard_key` | - |
| RotateToFaceBBEntry | `blackboard_key` | - |
| PlayAnimation | - | `non_blocking` (default: false), `looping` (default: false) |
| MakeNoise | - | `loudness` (default: 1.0) |
| RunBehavior | `behavior_tree` (asset path) | - |
| PlaySound | `sound_cue` (asset path) | `non_blocking` (default: false) |
| FinishWithResult | - | `result`: "Succeeded"\|"Failed"\|"Aborted" (default: "Succeeded") |
| SetTagCooldown | `cooldown_tag` | `cooldown_duration` (default: 5.0), `add_to_existing` (default: true) |
| Blackboard | `blackboard_key`, `condition` | `int_value`, `float_value` (for arithmetic conditions) |
| ForceSuccess | - | - |
| Loop | - | `num_loops` (default: 3), `infinite_loop` (default: false) |
| TimeLimit | - | `time_limit` (default: 5.0) |
| Cooldown | - | `cool_down_time` (default: 5.0) |
| CompareBBEntries | `blackboard_key_a`, `blackboard_key_b`, `operator` | - |
| IsAtLocation | `blackboard_key` | `acceptable_radius` (default: 100.0), `inverse_condition` (default: false) |
| DoesPathExist | `blackboard_key_a`, `blackboard_key_b` | `path_exists_condition`: "PathExists"\|"PathDoesNotExist", `filter_class` |
| TagCooldown | `cooldown_tag` | `cooldown_duration` (default: 5.0), `add_to_existing` (default: true) |
| ConditionalLoop | `blackboard_key`, `condition` | - |
| KeepInCone | `cone_origin`, `observed` | `cone_half_angle` (default: 45.0) |
| IsBBEntryOfClass | `blackboard_key`, `test_class` | - |
| DefaultFocus | `blackboard_key` | - |

### 1.5 Animation Blueprint Schema (class_type: "AnimBlueprint")

```json
{
  "class_type": "AnimBlueprint",
  "name": "ABP_FirstPerson",
  "content_path": "/Game/FirstPerson/Animations",
  "skeleton_path": "/Game/FirstPerson/Character/Mesh/FirstPerson_Skeleton",

  "variables": [
    {"name": "IsMoving", "type": "bool", "default": false},
    {"name": "bIsInAir", "type": "bool", "default": false}
  ],

  "anim_graph": {
    "pipeline": [
      {"id": "sm1", "type": "StateMachine", "name": "LocomotionSM"},
      {"id": "slot1", "type": "Slot", "name": "Arms"}
    ]
  },

  "state_machine": {
    "states": [
      {
        "id": "idle",
        "name": "FPP_Idle",
        "animation": "/Game/FirstPerson/Animations/FirstPerson_Idle",
        "looping": true,
        "is_entry": true
      },
      {
        "id": "run",
        "name": "FPP_Run",
        "animation": "/Game/FirstPerson/Animations/FirstPerson_Run",
        "looping": true,
        "is_entry": false
      },
      {
        "id": "jump_start",
        "name": "FPP_JumpStart",
        "animation": "/Game/FirstPerson/Animations/FirstPerson_JumpStart",
        "looping": false,
        "is_entry": false
      },
      {
        "id": "jump_loop",
        "name": "FPP_JumpLoop",
        "animation": "/Game/FirstPerson/Animations/FirstPerson_JumpLoop",
        "looping": true,
        "is_entry": false
      },
      {
        "id": "jump_end",
        "name": "FPP_JumpEnd",
        "animation": "/Game/FirstPerson/Animations/FirstPerson_JumpEnd",
        "looping": false,
        "is_entry": false
      }
    ],
    "transitions": [
      {
        "from": "idle",
        "to": "run",
        "blend_time": 0.2,
        "condition": {"type": "bool_variable", "variable": "IsMoving", "value": true}
      },
      {
        "from": "run",
        "to": "idle",
        "blend_time": 0.2,
        "condition": {"type": "bool_variable", "variable": "IsMoving", "value": false}
      },
      {
        "from": "idle",
        "to": "jump_start",
        "blend_time": 0.1,
        "condition": {"type": "bool_variable", "variable": "bIsInAir", "value": true}
      },
      {
        "from": "run",
        "to": "jump_start",
        "blend_time": 0.1,
        "condition": {"type": "bool_variable", "variable": "bIsInAir", "value": true}
      },
      {
        "from": "jump_start",
        "to": "jump_loop",
        "blend_time": 0.1,
        "condition": {"type": "time_remaining", "threshold": 0.1}
      },
      {
        "from": "jump_loop",
        "to": "jump_end",
        "blend_time": 0.2,
        "condition": {"type": "bool_variable", "variable": "bIsInAir", "value": false}
      },
      {
        "from": "jump_end",
        "to": "idle",
        "blend_time": 0.2,
        "condition": {"type": "time_remaining", "threshold": 0.1}
      }
    ]
  },

  "event_graph": {
    "nodes": [
      {"id": "begin_play", "type": "BeginPlay"},
      {"id": "print1", "type": "PrintString", "params": {"InString": "AnimBP Ready"}}
    ],
    "connections": [
      {"from": "begin_play.exec", "to": "print1.exec"}
    ]
  }
}
```

#### 1.5.1 AnimBlueprintSpec Fields

```jsonschema
{
  "type": "object",
  "required": ["class_type", "name", "content_path", "skeleton_path"],
  "properties": {
    "class_type": {"const": "AnimBlueprint"},
    "name": {"type": "string"},
    "content_path": {"type": "string"},
    "skeleton_path": {
      "type": "string",
      "description": "Content path to USkeleton asset"
    },
    "variables": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["name", "type"],
        "properties": {
          "name": {"type": "string"},
          "type": {"type": "string", "enum": ["bool"]},
          "default": {"type": "boolean"}
        }
      },
      "description": "v1: bool only"
    },
    "anim_graph": {
      "type": "object",
      "required": ["pipeline"],
      "properties": {
        "pipeline": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["id", "type", "name"],
            "properties": {
              "id": {"type": "string"},
              "type": {"type": "string", "enum": ["StateMachine", "Slot"]},
              "name": {"type": "string"}
            }
          },
          "description": "Ordered left-to-right. Wired right-to-left toward Root."
        }
      }
    },
    "state_machine": {
      "type": "object",
      "required": ["states", "transitions"],
      "properties": {
        "states": {
          "type": "array",
          "items": {"$ref": "#/definitions/AnimStateSpec"}
        },
        "transitions": {
          "type": "array",
          "items": {"$ref": "#/definitions/AnimTransitionSpec"}
        }
      }
    },
    "event_graph": {"$ref": "#/definitions/GraphSpec"}
  }
}
```

#### 1.5.2 AnimStateSpec

```jsonschema
{
  "type": "object",
  "required": ["id", "name", "animation"],
  "properties": {
    "id": {"type": "string", "description": "Unique within state machine"},
    "name": {"type": "string", "description": "Display name in editor"},
    "animation": {"type": "string", "description": "Content path to UAnimSequence"},
    "looping": {"type": "boolean", "default": true},
    "is_entry": {"type": "boolean", "default": false, "description": "Exactly one must be true"}
  }
}
```

#### 1.5.3 AnimTransitionSpec

```jsonschema
{
  "type": "object",
  "required": ["from", "to", "condition"],
  "properties": {
    "from": {"type": "string", "description": "Source state id"},
    "to": {"type": "string", "description": "Target state id"},
    "blend_time": {"type": "number", "default": 0.2, "minimum": 0},
    "condition": {
      "oneOf": [
        {
          "type": "object",
          "required": ["type", "variable", "value"],
          "properties": {
            "type": {"const": "bool_variable"},
            "variable": {"type": "string"},
            "value": {"type": "boolean"}
          }
        },
        {
          "type": "object",
          "required": ["type", "threshold"],
          "properties": {
            "type": {"const": "time_remaining"},
            "threshold": {"type": "number", "minimum": 0}
          }
        }
      ]
    }
  }
}
```

---

## 2. Type System Definition

### 2.1 Primitive Types

| Type ID | UE4 Type | JSON Representation | C++ Pin Type |
|---|---|---|---|
| `bool` | `bool` | `true` / `false` | `PC_Boolean` |
| `int` | `int32` | integer number | `PC_Int` |
| `int64` | `int64` | integer number | `PC_Int64` |
| `float` | `float` | number | `PC_Float` |
| `name` | `FName` | string | `PC_Name` |
| `string` | `FString` | string | `PC_String` |
| `text` | `FText` | string | `PC_Text` |

### 2.2 Struct Types

| Type ID | UE4 Type | JSON Representation |
|---|---|---|
| `vector` | `FVector` | `{"x": 0, "y": 0, "z": 0}` |
| `rotator` | `FRotator` | `{"pitch": 0, "yaw": 0, "roll": 0}` |
| `transform` | `FTransform` | `{"location": {x,y,z}, "rotation": {pitch,yaw,roll}, "scale": {x,y,z}}` |
| `vector2d` | `FVector2D` | `{"x": 0, "y": 0}` |
| `color` | `FColor` | `{"r": 0-255, "g": 0-255, "b": 0-255, "a": 0-255}` |
| `linear_color` | `FLinearColor` | `{"r": 0.0-1.0, "g": 0.0-1.0, "b": 0.0-1.0, "a": 0.0-1.0}` |

### 2.3 Object Reference Types

| Type ID | UE4 Type | JSON Representation | Pin Category |
|---|---|---|---|
| `object_ref` | `UObject*` | content path string or null | `PC_Object` |
| `class_ref` | `TSubclassOf<>` | content path string or null | `PC_Class` |
| `soft_object_ref` | `TSoftObjectPtr<>` | content path string or null | `PC_SoftObject` |
| `interface_ref` | `TScriptInterface<>` | content path string or null | `PC_Interface` |

All object reference types require an `object_class` field specifying the base UE4 class.

### 2.4 Container Types

| Type ID | UE4 Type | JSON Representation | Additional Required Fields |
|---|---|---|---|
| `array` | `TArray<>` | JSON array | `element_type` |
| `set` | `TSet<>` | JSON array (unique values) | `element_type` |
| `map` | `TMap<>` | JSON object | `key_type`, `value_type` |

Container nesting is allowed: `array` of `array` of `float` is valid.
Map keys must be hashable types: `bool`, `int`, `int64`, `float`, `name`, `string`, `object_ref`, `class_ref`.

### 2.5 Pin Type Specification

Every data pin in a node graph has a type. Pin types use the same type IDs as variables.

```json
{
  "pin_type": "float",
  "container": "none|array|set|map",
  "object_class": "Actor",
  "is_reference": false
}
```

**Pin type resolution from node context:**
- Function call nodes: pin types determined by the function signature in UE4
- Variable get/set nodes: pin type matches the variable type
- Math nodes: pin types determined by the operation
- Cast nodes: input is `object_ref`, output is `object_ref` with the target class

### 2.6 Type Validation Rules

1. **Connection type matching:** Source pin type must match target pin type exactly, OR an implicit cast must exist.
2. **Implicit casts allowed:**
   - `int` -> `float`
   - `float` -> `int` (truncation, with warning)
   - `int` -> `string` (via conversion node, auto-inserted)
   - `float` -> `string` (via conversion node, auto-inserted)
   - `name` -> `string`
   - `string` -> `name`
   - `string` -> `text`
   - `text` -> `string`
   - Subclass -> parent class (for `object_ref` with compatible `object_class`)
3. **Disallowed connections (hard error):**
   - `bool` -> any numeric type
   - Any type -> `exec` (execution pins are not data)
   - `vector` -> `rotator`
   - Container type mismatch (array vs non-array)
4. **Coercion:** No implicit coercion. Type conversion is explicit via converter nodes. The builder inserts auto-conversion nodes where implicit casts are allowed.

### 2.7 Failure Conditions

| Condition | Severity | Behavior |
|---|---|---|
| Unknown type ID | Error | Reject entire spec |
| Missing `object_class` on object_ref | Error | Reject variable/pin |
| Missing `element_type` on array | Error | Reject variable |
| Container of `exec` | Error | Reject |
| `map` key with non-hashable type | Error | Reject variable |
| Nested containers > 2 deep | Warning | Accept but flag |

---

## 3. Node Graph Specification

### 3.1 GraphSpec

The K2 event graph format used by Blueprint Graph Builder and reused by AnimBP event graphs.

```jsonschema
{
  "type": "object",
  "required": ["nodes", "connections"],
  "properties": {
    "nodes": {
      "type": "array",
      "items": {"$ref": "#/definitions/NodeSpec"}
    },
    "connections": {
      "type": "array",
      "items": {"$ref": "#/definitions/ConnectionSpec"}
    }
  }
}
```

### 3.2 NodeSpec

```jsonschema
{
  "type": "object",
  "required": ["id", "type"],
  "properties": {
    "id": {
      "type": "string",
      "pattern": "^[a-zA-Z_][a-zA-Z0-9_]*$",
      "description": "Unique within this graph"
    },
    "type": {
      "type": "string",
      "description": "Node type key. Maps to a K2Node class via the node registry."
    },
    "function": {
      "type": "string",
      "description": "Required when type is CallFunction. Fully qualified: Class.FunctionName or just FunctionName for UKismetSystemLibrary."
    },
    "variable": {
      "type": "string",
      "description": "Required when type is VariableGet or VariableSet. Variable name."
    },
    "target_class": {
      "type": "string",
      "description": "Required for CastTo. The class to cast to."
    },
    "params": {
      "type": "object",
      "additionalProperties": {
        "oneOf": [
          {"type": "string"},
          {"type": "number"},
          {"type": "boolean"}
        ]
      },
      "description": "Pin default values keyed by pin name."
    },
    "comment": {
      "type": "string",
      "description": "Node comment shown in editor."
    },
    "position": {
      "type": "object",
      "properties": {
        "x": {"type": "number"},
        "y": {"type": "number"}
      },
      "description": "Graph editor position. Auto-calculated if omitted."
    }
  }
}
```

### 3.3 Node Type Registry

All resolvable node types:

**Event Nodes** (have exec output, no exec input):
| Type Key | UE4 Class | Output Pins |
|---|---|---|
| `BeginPlay` | `UK2Node_Event` (ReceiveBeginPlay) | exec |
| `Tick` | `UK2Node_Event` (ReceiveTick) | exec, DeltaSeconds(float) |
| `EndPlay` | `UK2Node_Event` (ReceiveEndPlay) | exec, EndPlayReason(enum) |
| `CustomEvent` | `UK2Node_CustomEvent` | exec, user-defined outputs |
| `InputAction` | `UK2Node_InputAction` | exec(Pressed), exec(Released) |
| `InputAxis` | `UK2Node_InputAxisEvent` | exec, AxisValue(float) |
| `OnComponentBeginOverlap` | `UK2Node_ComponentBoundEvent` | exec, OverlappedComponent, OtherActor, etc. |
| `OnComponentEndOverlap` | `UK2Node_ComponentBoundEvent` | exec, OverlappedComponent, OtherActor, etc. |
| `OnHit` | `UK2Node_ComponentBoundEvent` | exec, HitComponent, OtherActor, etc. |

**Flow Control Nodes:**
| Type Key | UE4 Class | Input Pins | Output Pins |
|---|---|---|---|
| `Branch` | `UK2Node_IfThenElse` | exec, Condition(bool) | True(exec), False(exec) |
| `Sequence` | `UK2Node_ExecutionSequence` | exec | Then_0(exec), Then_1(exec), ... |
| `DoOnce` | `UK2Node_DoOnce` | exec, Reset(exec) | exec |
| `DoN` | `UK2Node_DoN` | exec, N(int), Reset(exec) | exec, Counter(int) |
| `Delay` | `UK2Node_Delay` | exec, Duration(float) | exec (latent) |
| `Gate` | `UK2Node_Gate` | Enter(exec), Open(exec), Close(exec), Toggle(exec) | Exit(exec) |
| `FlipFlop` | `UK2Node_FlipFlop` | exec | A(exec), B(exec), IsA(bool) |
| `ForLoop` | `UK2Node_MacroInstance` | exec, FirstIndex(int), LastIndex(int) | LoopBody(exec), Index(int), Completed(exec) |
| `ForEachLoop` | `UK2Node_MacroInstance` | exec, Array(array) | LoopBody(exec), Element, Index(int), Completed(exec) |
| `WhileLoop` | `UK2Node_MacroInstance` | exec | LoopBody(exec), Completed(exec) |

**Function Call Nodes:**
| Type Key | UE4 Class | Notes |
|---|---|---|
| `CallFunction` | `UK2Node_CallFunction` | Requires `function` field. Pins from UFUNCTION signature. |
| `PrintString` | `UK2Node_CallFunction` | Shorthand for KismetSystemLibrary::PrintString |
| `SpawnActor` | `UK2Node_SpawnActorFromClass` | Class(class_ref), Transform, Owner |
| `DestroyActor` | `UK2Node_CallFunction` | Target.DestroyActor() |
| `GetActorLocation` | `UK2Node_CallFunction` | Returns vector |
| `SetActorLocation` | `UK2Node_CallFunction` | Takes vector |
| `SetActorRotation` | `UK2Node_CallFunction` | Takes rotator |
| `AddActorLocalOffset` | `UK2Node_CallFunction` | Takes vector |
| `SetTimerByEvent` | `UK2Node_CallFunction` | Latent |

**Variable Nodes:**
| Type Key | UE4 Class | Notes |
|---|---|---|
| `VariableGet` | `UK2Node_VariableGet` | Requires `variable` field |
| `VariableSet` | `UK2Node_VariableSet` | Requires `variable` field |

**Math Nodes:**
| Type Key | Description | Input Pins | Output Pin |
|---|---|---|---|
| `Add_FloatFloat` | Float + Float | A(float), B(float) | ReturnValue(float) |
| `Subtract_FloatFloat` | Float - Float | A(float), B(float) | ReturnValue(float) |
| `Multiply_FloatFloat` | Float * Float | A(float), B(float) | ReturnValue(float) |
| `Divide_FloatFloat` | Float / Float | A(float), B(float) | ReturnValue(float) |
| `Add_VectorVector` | Vector + Vector | A(vector), B(vector) | ReturnValue(vector) |
| `Subtract_VectorVector` | Vector - Vector | A(vector), B(vector) | ReturnValue(vector) |
| `Multiply_VectorFloat` | Vector * Float | A(vector), B(float) | ReturnValue(vector) |
| `BreakVector` | Split vector | InVec(vector) | X(float), Y(float), Z(float) |
| `MakeVector` | Construct vector | X(float), Y(float), Z(float) | ReturnValue(vector) |
| `BreakRotator` | Split rotator | InRot(rotator) | Roll(float), Pitch(float), Yaw(float) |
| `MakeRotator` | Construct rotator | Roll(float), Pitch(float), Yaw(float) | ReturnValue(rotator) |
| `VectorLength` | Vector magnitude | A(vector) | ReturnValue(float) |
| `Normalize` | Normalize vector | A(vector) | ReturnValue(vector) |
| `DotProduct` | Dot product | A(vector), B(vector) | ReturnValue(float) |
| `CrossProduct` | Cross product | A(vector), B(vector) | ReturnValue(vector) |
| `Less_FloatFloat` | Float < Float | A(float), B(float) | ReturnValue(bool) |
| `Greater_FloatFloat` | Float > Float | A(float), B(float) | ReturnValue(bool) |
| `EqualEqual_FloatFloat` | Float == Float | A(float), B(float) | ReturnValue(bool) |
| `NotEqual_FloatFloat` | Float != Float | A(float), B(float) | ReturnValue(bool) |
| `Not_PreBool` | !Bool | A(bool) | ReturnValue(bool) |
| `BooleanAND` | Bool && Bool | A(bool), B(bool) | ReturnValue(bool) |
| `BooleanOR` | Bool \|\| Bool | A(bool), B(bool) | ReturnValue(bool) |

**Cast Nodes:**
| Type Key | UE4 Class | Notes |
|---|---|---|
| `CastTo` | `UK2Node_DynamicCast` | Requires `target_class`. Input: Object. Output: exec(success), exec(fail), AsTargetClass |

**Utility Nodes:**
| Type Key | Description |
|---|---|
| `MakeArray` | Construct array from elements |
| `MakeLiteralFloat` | Float constant |
| `MakeLiteralInt` | Int constant |
| `MakeLiteralBool` | Bool constant |
| `MakeLiteralString` | String constant |
| `Select` | Switch on index |
| `IsValid` | Null check |
| `GetDisplayName` | Actor display name |
| `GetWorldDeltaSeconds` | Frame delta time |

### 3.4 ConnectionSpec

```jsonschema
{
  "type": "object",
  "required": ["from", "to"],
  "properties": {
    "from": {
      "type": "string",
      "pattern": "^[a-zA-Z_][a-zA-Z0-9_]*\\.[a-zA-Z_][a-zA-Z0-9_]*$",
      "description": "Format: nodeId.pinName"
    },
    "to": {
      "type": "string",
      "pattern": "^[a-zA-Z_][a-zA-Z0-9_]*\\.[a-zA-Z_][a-zA-Z0-9_]*$",
      "description": "Format: nodeId.pinName"
    }
  }
}
```

### 3.5 Pin Name Conventions

**Execution pins:**
- Input: `exec` (standard), `Reset` (on DoOnce/DoN), `Open`/`Close`/`Toggle` (on Gate)
- Output: `exec` (standard "then"), `True`/`False` (on Branch), `LoopBody`/`Completed` (on loops), `Then_0`/`Then_1` (on Sequence)

**Data pins:**
- Named by function parameter name: `InString`, `Duration`, `Target`
- Return values: `ReturnValue`
- Math: `A`, `B`, `ReturnValue`
- Entry node outputs match function/event input names
- Return node inputs match function output names

### 3.6 Connection Validation Rules

1. **Direction:** Connections go from output pins to input pins. Never input-to-input or output-to-output.
2. **Exec-to-exec only:** Exec output pins connect only to exec input pins. Data pins connect only to data pins.
3. **One exec target:** Each exec output pin connects to at most one exec input pin.
4. **Multiple data sources allowed:** A data output pin can connect to multiple data input pins (fan-out).
5. **One data source:** Each data input pin accepts at most one connection.
6. **Type safety:** Data connections must satisfy type validation (Section 2.6).
7. **No cycles:** The graph must be acyclic. Cycles cause infinite compile loops.
8. **Referential integrity:** Both `from` and `to` must reference existing node IDs and valid pin names.

### 3.7 Function Resolution System

When `type` is `CallFunction`, the `function` field resolves to a UFUNCTION:

1. **Unqualified name** (e.g., `"PrintString"`): Searched in order:
   - `UKismetSystemLibrary`
   - `UKismetMathLibrary`
   - `UGameplayStatics`
   - The blueprint's own class hierarchy

2. **Qualified name** (e.g., `"KismetSystemLibrary.PrintString"`): Searched in the specified class only.

3. **Self function** (e.g., `"Self.MyFunction"`): Calls a function defined in this blueprint's `functions` array.

Resolution failure (function not found) is a hard error that rejects the node.

---

## 4. Dispatch Routing Logic

### 4.1 Dispatch Flow

```
BlueprintSpec JSON
    |
    v
[Parse class_type field]
    |
    +---> Actor|Character|Pawn|PlayerController|GameMode|GameState|HUD
    |     |ActorComponent|SceneComponent|FunctionLibrary
    |     |
    |     v
    |     [K2 Blueprint Pipeline]
    |       1. Create or load UBlueprint asset
    |       2. Set parent class from class_type
    |       3. Build components (ComponentSpec[])
    |       4. Create variables (VariableSpec[])
    |       5. Create functions (FunctionSpec[])
    |       6. Create events (EventSpec[])
    |       7. Create dispatchers (DispatcherSpec[])
    |       8. Create timelines (TimelineSpec[])
    |       9. Build event_graph via BuildBlueprintFromJSON (GraphSpec)
    |      10. Build function graphs via BuildBlueprintFromJSON (per function)
    |      11. Apply details panel properties (DetailsSpec)
    |      12. Compile blueprint
    |
    +---> Widget
    |     |
    |     v
    |     [Widget Blueprint Pipeline]
    |       1. Validate root is a panel type
    |       2. Call BuildWidgetFromJSON(content_path, name, root_json)
    |       3. Apply animations
    |
    +---> BehaviorTree
    |     |
    |     v
    |     [BT Pipeline]
    |       1. Create or load UBehaviorTree + UBlackboardData assets
    |       2. Populate blackboard keys
    |       3. Call BuildBehaviorTreeFromJSON(bt, root_json)
    |
    +---> AnimBlueprint
          |
          v
          [AnimBP Pipeline]
            1. Call BuildAnimBlueprintFromJSON(content_path, name, skeleton_path, json)
            2. Event graph forwarded to BlueprintGraphBuilder
```

### 4.2 Class Type to Parent Class Mapping

| class_type | UE4 Parent Class | Asset Prefix |
|---|---|---|
| `Actor` | `AActor` | `BP_` |
| `Character` | `ACharacter` | `BP_` |
| `Pawn` | `APawn` | `BP_` |
| `PlayerController` | `APlayerController` | `BP_` |
| `GameMode` | `AGameModeBase` | `GM_` |
| `GameState` | `AGameStateBase` | `GS_` |
| `HUD` | `AHUD` | `HUD_` |
| `ActorComponent` | `UActorComponent` | `AC_` |
| `SceneComponent` | `USceneComponent` | `SC_` |
| `FunctionLibrary` | `UBlueprintFunctionLibrary` | `BPFL_` |
| `Widget` | `UUserWidget` | `WBP_` |
| `BehaviorTree` | `UBehaviorTree` | `BT_` |
| `AnimBlueprint` | `UAnimInstance` | `ABP_` |

### 4.3 Validation Gates

Each pipeline applies validation before building. Validation is fail-fast: first error aborts the build.

**Gate 1: Schema validation (all types)**
- `class_type` is a valid enum value
- `name` matches `^[A-Za-z_][A-Za-z0-9_]*$`
- `content_path` starts with `/Game/`
- Required fields for the class_type are present

**Gate 2: Type-specific validation**

K2 Blueprints:
- At most one component has `is_root: true`
- All component `children` references resolve to named components
- No cycles in component hierarchy
- All variable names unique
- All function names unique
- All event names unique
- Variable types are valid type IDs
- Graph connections reference existing nodes and pins

Widget:
- Root is a panel type (CanvasPanel, VerticalBox, HorizontalBox, Overlay, ScrollBox, GridPanel, WrapBox)
- All widget names unique across tree
- Leaf widgets have no children
- Content widgets have 0 or 1 child
- Animation targets reference existing widget names

BehaviorTree:
- Root node is a composite type
- All node IDs unique across entire tree
- All node types are registered
- Composites have at least 1 child
- SimpleParallel has exactly 2 children
- Tasks have no children
- Decorators only in `decorators` arrays
- Services only in `services` arrays, only on composites
- All blackboard_key params reference keys defined in `blackboard.keys`
- Blackboard key types match requirements (arithmetic conditions only on Int/Float)

AnimBlueprint:
- `skeleton_path` is present
- Exactly one state has `is_entry: true`
- All state IDs unique
- All transition `from`/`to` reference existing state IDs
- All animation paths are valid content paths
- Variables referenced in conditions exist in `variables` array
- Pipeline contains exactly one StateMachine
- `time_remaining` conditions only on states where `looping: false`
- Variable types are `bool` (v1 constraint)

**Gate 3: Asset validation (runtime)**
- Blueprint/asset at `content_path/name` can be created (directory exists, no name collision unless rebuild mode)
- Referenced meshes, materials, animations, sound cues, skeletons exist in content browser
- Referenced classes exist in UE4 class hierarchy

---

## 5. Complete Working Example

```json
{
  "class_type": "Character",
  "name": "PatrolEnemy",
  "content_path": "/Game/Characters/Enemies",

  "components": [
    {
      "name": "CapsuleRoot",
      "type": "CapsuleComponent",
      "is_root": true,
      "properties": {
        "capsule_half_height": 96.0,
        "capsule_radius": 42.0,
        "collision_preset": "Pawn"
      },
      "children": ["EnemyMesh", "DetectionSphere"]
    },
    {
      "name": "EnemyMesh",
      "type": "SkeletalMeshComponent",
      "properties": {
        "skeletal_mesh": "/Game/Mannequin/Character/Mesh/SK_Mannequin",
        "relative_location": {"x": 0, "y": 0, "z": -96},
        "relative_rotation": {"pitch": 0, "yaw": -90, "roll": 0},
        "cast_shadow": true
      }
    },
    {
      "name": "DetectionSphere",
      "type": "SphereComponent",
      "properties": {
        "sphere_radius": 800.0,
        "collision_preset": "OverlapAllDynamic",
        "generate_overlap_events": true,
        "hidden_in_game": true,
        "visible": false
      }
    }
  ],

  "variables": [
    {
      "name": "Health",
      "type": "float",
      "default": 100.0,
      "instance_editable": true,
      "category": "Combat"
    },
    {
      "name": "MaxHealth",
      "type": "float",
      "default": 100.0,
      "category": "Combat"
    },
    {
      "name": "PatrolSpeed",
      "type": "float",
      "default": 200.0,
      "instance_editable": true,
      "category": "Movement"
    },
    {
      "name": "ChaseSpeed",
      "type": "float",
      "default": 450.0,
      "instance_editable": true,
      "category": "Movement"
    },
    {
      "name": "IsAlerted",
      "type": "bool",
      "default": false,
      "category": "AI"
    },
    {
      "name": "CurrentTarget",
      "type": "object_ref",
      "object_class": "Actor",
      "default": null,
      "category": "AI"
    },
    {
      "name": "PatrolPoints",
      "type": "array",
      "element_type": "vector",
      "default": [],
      "instance_editable": true,
      "category": "AI"
    }
  ],

  "functions": [
    {
      "name": "TakeDamage",
      "access": "Public",
      "pure": false,
      "category": "Combat",
      "inputs": [
        {"name": "DamageAmount", "type": "float"},
        {"name": "Instigator", "type": "object_ref", "object_class": "Actor"}
      ],
      "outputs": [
        {"name": "IsDead", "type": "bool"}
      ],
      "graph": {
        "nodes": [
          {"id": "get_health", "type": "VariableGet", "variable": "Health"},
          {"id": "subtract", "type": "Subtract_FloatFloat"},
          {"id": "clamp", "type": "CallFunction", "function": "KismetMathLibrary.FClamp", "params": {"Min": 0, "Max": 100}},
          {"id": "set_health", "type": "VariableSet", "variable": "Health"},
          {"id": "less_eq", "type": "CallFunction", "function": "KismetMathLibrary.LessEqual_FloatFloat"},
          {"id": "literal_zero", "type": "MakeLiteralFloat", "params": {"Value": 0}},
          {"id": "return", "type": "ReturnNode"}
        ],
        "connections": [
          {"from": "entry.exec", "to": "set_health.exec"},
          {"from": "get_health.Health", "to": "subtract.A"},
          {"from": "entry.DamageAmount", "to": "subtract.B"},
          {"from": "subtract.ReturnValue", "to": "clamp.Value"},
          {"from": "clamp.ReturnValue", "to": "set_health.Health"},
          {"from": "set_health.exec", "to": "return.exec"},
          {"from": "clamp.ReturnValue", "to": "less_eq.A"},
          {"from": "literal_zero.ReturnValue", "to": "less_eq.B"},
          {"from": "less_eq.ReturnValue", "to": "return.IsDead"}
        ]
      }
    }
  ],

  "events": [
    {
      "name": "OnEnemyDeath",
      "type": "Custom",
      "inputs": []
    }
  ],

  "dispatchers": [
    {
      "name": "OnHealthChanged",
      "params": [
        {"name": "NewHealth", "type": "float"},
        {"name": "DamageAmount", "type": "float"}
      ]
    },
    {
      "name": "OnAlertStateChanged",
      "params": [
        {"name": "IsNowAlerted", "type": "bool"}
      ]
    }
  ],

  "event_graph": {
    "nodes": [
      {"id": "begin_play", "type": "BeginPlay"},
      {"id": "print_ready", "type": "PrintString", "params": {"InString": "Enemy spawned"}},
      {"id": "set_speed", "type": "CallFunction", "function": "CharacterMovementComponent.SetMaxWalkSpeed"},
      {"id": "get_patrol_speed", "type": "VariableGet", "variable": "PatrolSpeed"}
    ],
    "connections": [
      {"from": "begin_play.exec", "to": "print_ready.exec"},
      {"from": "print_ready.exec", "to": "set_speed.exec"},
      {"from": "get_patrol_speed.PatrolSpeed", "to": "set_speed.MaxWalkSpeed"}
    ]
  },

  "timelines": [
    {
      "name": "AlertPulse",
      "length": 1.0,
      "looping": true,
      "auto_play": false,
      "tracks": [
        {
          "name": "PulseAlpha",
          "type": "float",
          "keys": [
            {"time": 0.0, "value": 0.0},
            {"time": 0.5, "value": 1.0},
            {"time": 1.0, "value": 0.0}
          ]
        }
      ]
    }
  ],

  "details": {
    "tick_enabled": false,
    "replicates": false,
    "auto_possess_ai": "PlacedInWorldOrSpawned",
    "tags": ["Enemy", "AI", "Patrol"]
  }
}
```

### Companion Widget for this Character's HUD

```json
{
  "class_type": "Widget",
  "name": "EnemyHealthBar",
  "content_path": "/Game/UI/Enemy",

  "root": {
    "type": "Overlay",
    "name": "Root",
    "children": [
      {
        "type": "SizeBox",
        "name": "BarContainer",
        "properties": {
          "widthOverride": 150.0,
          "heightOverride": 12.0
        },
        "children": [
          {
            "type": "ProgressBar",
            "name": "HealthBar",
            "properties": {
              "percent": 1.0,
              "fillColorAndOpacity": {"r": 1.0, "g": 0.1, "b": 0.1, "a": 1.0},
              "barFillType": "LeftToRight"
            }
          }
        ]
      }
    ]
  }
}
```

### Companion Behavior Tree for this Character

```json
{
  "class_type": "BehaviorTree",
  "name": "BT_PatrolEnemy",
  "content_path": "/Game/AI",

  "blackboard": {
    "keys": [
      {"name": "TargetActor", "type": "Object", "base_class": "Actor"},
      {"name": "HomeLocation", "type": "Vector"},
      {"name": "PatrolLocation", "type": "Vector"},
      {"name": "AlertLevel", "type": "Float"}
    ]
  },

  "root": {
    "id": "root_sel",
    "type": "Selector",
    "name": "MainBehavior",
    "children": [
      {
        "id": "combat_seq",
        "type": "Sequence",
        "name": "Combat",
        "decorators": [
          {
            "id": "has_target_dec",
            "type": "Blackboard",
            "name": "HasTarget",
            "params": {
              "blackboard_key": "TargetActor",
              "condition": "IsSet"
            }
          }
        ],
        "services": [
          {
            "id": "focus_svc",
            "type": "DefaultFocus",
            "params": {"blackboard_key": "TargetActor"}
          }
        ],
        "children": [
          {
            "id": "chase",
            "type": "MoveTo",
            "params": {
              "blackboard_key": "TargetActor",
              "acceptable_radius": 150.0
            }
          },
          {
            "id": "attack_wait",
            "type": "Wait",
            "params": {"wait_time": 1.5}
          }
        ]
      },
      {
        "id": "patrol_seq",
        "type": "Sequence",
        "name": "Patrol",
        "children": [
          {
            "id": "move_patrol",
            "type": "MoveTo",
            "params": {
              "blackboard_key": "PatrolLocation",
              "acceptable_radius": 50.0
            }
          },
          {
            "id": "patrol_wait",
            "type": "Wait",
            "params": {
              "wait_time": 3.0,
              "random_deviation": 1.5
            }
          },
          {
            "id": "go_home",
            "type": "MoveTo",
            "params": {
              "blackboard_key": "HomeLocation",
              "acceptable_radius": 50.0
            }
          },
          {
            "id": "home_wait",
            "type": "Wait",
            "params": {"wait_time": 2.0}
          }
        ]
      }
    ]
  }
}
```

### Companion AnimBP for this Character

```json
{
  "class_type": "AnimBlueprint",
  "name": "ABP_PatrolEnemy",
  "content_path": "/Game/Characters/Enemies",
  "skeleton_path": "/Game/Mannequin/Character/Mesh/UE4_Mannequin_Skeleton",

  "variables": [
    {"name": "IsMoving", "type": "bool", "default": false},
    {"name": "IsAlerted", "type": "bool", "default": false}
  ],

  "anim_graph": {
    "pipeline": [
      {"id": "sm1", "type": "StateMachine", "name": "LocomotionSM"}
    ]
  },

  "state_machine": {
    "states": [
      {
        "id": "idle",
        "name": "Idle",
        "animation": "/Game/Mannequin/Animations/ThirdPersonIdle",
        "looping": true,
        "is_entry": true
      },
      {
        "id": "walk",
        "name": "Walk",
        "animation": "/Game/Mannequin/Animations/ThirdPersonWalk",
        "looping": true,
        "is_entry": false
      }
    ],
    "transitions": [
      {
        "from": "idle",
        "to": "walk",
        "blend_time": 0.25,
        "condition": {"type": "bool_variable", "variable": "IsMoving", "value": true}
      },
      {
        "from": "walk",
        "to": "idle",
        "blend_time": 0.25,
        "condition": {"type": "bool_variable", "variable": "IsMoving", "value": false}
      }
    ]
  },

  "event_graph": {
    "nodes": [
      {"id": "begin_play", "type": "BeginPlay"},
      {"id": "print1", "type": "PrintString", "params": {"InString": "Enemy AnimBP Active"}}
    ],
    "connections": [
      {"from": "begin_play.exec", "to": "print1.exec"}
    ]
  }
}
```

---

## 6. C++ Integration Contract

### 6.1 Unified Entry Point

The dispatcher is a single Python handler that receives any BlueprintSpec and routes it. The C++ side has no single unified entry point -- each builder subsystem retains its own UFUNCTION. The Python layer is the router.

**Python dispatcher signature:**
```python
def handle_blueprint_build(params: dict) -> dict:
    """
    Receives full BlueprintSpec JSON. Routes to correct builder.
    Returns {"success": bool, "data": {...}, "error": str|None}
    """
```

**C++ entry points (unchanged):**

```cpp
// Blueprint Graph Builder
UFUNCTION(BlueprintCallable, Category="BlueprintGraphBuilder")
static void BuildBlueprintFromJSON(
    UBlueprint* Blueprint,
    const FString& JsonString,
    bool bClearExistingGraph = true
);

// Widget Blueprint Builder
UFUNCTION(BlueprintCallable, Category="BlueprintGraphBuilder")
static FString BuildWidgetFromJSON(
    const FString& PackagePath,
    const FString& AssetName,
    const FString& JsonString
);

// Behavior Tree Builder
UFUNCTION(BlueprintCallable, Category="BlueprintGraphBuilder")
static FString BuildBehaviorTreeFromJSON(
    UBehaviorTree* BehaviorTree,
    const FString& JsonString
);

// Animation Blueprint Builder
UFUNCTION(BlueprintCallable, CallInEditor, Category="BlueprintGraphBuilder")
static FString BuildAnimBlueprintFromJSON(
    const FString& PackagePath,
    const FString& AssetName,
    const FString& SkeletonPath,
    const FString& JsonString
);
```

### 6.2 Data Structures Required in C++

**Existing (no changes needed):**
- `FBTNodeSpec`, `FBTBuildSpec`, `FBTBuildContext` -- BT builder
- `FWidgetNodeSpec`, `FWidgetSlotSpec`, `FWidgetBlueprintSpec` -- Widget builder
- `FWidgetAnimationSpec`, `FWidgetAnimationTrackSpec` -- Widget animations
- `FWidgetPropertyDescriptor` -- Widget property validation

**New structures needed for K2 Blueprint expansion:**

```cpp
// Component specification
struct FBPComponentSpec
{
    FString Name;
    FString Type;          // "StaticMeshComponent", etc.
    bool bIsRoot = false;
    TArray<FString> Children;
    TMap<FString, TSharedPtr<FJsonValue>> Properties;
};

// Variable specification
struct FBPVariableSpec
{
    FString Name;
    FString Type;          // "float", "bool", "object_ref", "array", etc.
    TSharedPtr<FJsonValue> Default;
    FString ObjectClass;   // for object_ref, class_ref
    FString ElementType;   // for array, set
    FString KeyType;       // for map
    FString ValueType;     // for map
    bool bInstanceEditable = false;
    bool bExposeOnSpawn = false;
    bool bBlueprintReadOnly = false;
    bool bReplicated = false;
    bool bRepNotify = false;
    FString Category;
    FString Tooltip;
};

// Function specification
struct FBPFunctionSpec
{
    FString Name;
    FString Access;        // "Public", "Private", "Protected"
    bool bPure = false;
    bool bConst = false;
    bool bCallInEditor = false;
    FString Category;
    TArray<FBPPinSpec> Inputs;
    TArray<FBPPinSpec> Outputs;
    TSharedPtr<FJsonObject> Graph;  // forwarded to BuildBlueprintFromJSON
};

// Pin specification (used in functions, events, dispatchers)
struct FBPPinSpec
{
    FString Name;
    FString Type;          // same type IDs as VariableSpec
    FString ObjectClass;   // for object types
};

// Timeline specification
struct FBPTimelineSpec
{
    FString Name;
    float Length;
    bool bLooping = false;
    bool bAutoPlay = false;
    TArray<FBPTimelineTrackSpec> Tracks;
};

struct FBPTimelineTrackSpec
{
    FString Name;
    FString Type;          // "float", "vector", "color", "event"
    TArray<FBPTimelineKeySpec> Keys;
};

struct FBPTimelineKeySpec
{
    float Time;
    TSharedPtr<FJsonValue> Value;  // float, {x,y,z}, or {r,g,b,a}
    FString InterpMode;    // "Linear", "Cubic", "Constant"
};

// Unified build spec
struct FBlueprintBuildSpec
{
    FString ClassType;
    FString Name;
    FString ContentPath;
    TArray<FBPComponentSpec> Components;
    TArray<FBPVariableSpec> Variables;
    TArray<FBPFunctionSpec> Functions;
    TArray<FBPTimelineSpec> Timelines;
    TSharedPtr<FJsonObject> EventGraph;
    TSharedPtr<FJsonObject> Details;
};
```

### 6.3 Registry Dependencies

**Node Registry (K2 nodes):**
Maps node type keys to `UK2Node` subclasses and their pin signatures. This needs to be built for the Blueprint Graph Builder to move past Pass 1.

```cpp
struct FK2NodeRegistryEntry
{
    FString TypeKey;                    // "PrintString", "Branch", etc.
    TSubclassOf<UK2Node> NodeClass;
    FString FunctionName;               // for CallFunction nodes
    UClass* FunctionOwnerClass;         // class containing the UFUNCTION
};

class FK2NodeRegistry
{
    TMap<FString, FK2NodeRegistryEntry> Entries;
    const FK2NodeRegistryEntry* Find(const FString& TypeKey) const;
    void RegisterDefaults();
};
```

**Component Registry:**
Maps component type names to UE4 component classes.

```cpp
class FComponentRegistry
{
    TMap<FString, TSubclassOf<UActorComponent>> ComponentTypes;
    TMap<FString, TArray<FString>> ValidProperties;  // per component type
    void RegisterDefaults();
};
```

**Existing registries (no changes):**
- `FBTNodeRegistry` -- BT node types, default params, BB key requirements
- `FWidgetClassRegistry` -- Widget types, categories, property descriptors

### 6.4 Required Validation Passes

**Pass order (all builders):**

1. **JSON Parse** -- Verify valid JSON. Return parse error with line/column.
2. **Schema Validate** -- Check required fields, correct types, valid enum values.
3. **Referential Integrity** -- All cross-references resolve (component children, variable names in graphs, BB keys, state IDs).
4. **Type Check** -- Pin types match across connections. Variable types are valid.
5. **Constraint Check** -- Builder-specific rules (max children, required root, etc).
6. **Asset Check** -- Referenced assets exist in content browser (runtime only, skip in dry-run validation).

Each pass returns a list of `{level: "error"|"warning", message: string, path: string}`. Errors abort. Warnings are reported but allow the build to continue.

---

## 7. Failure Modes and Safeguards

### 7.1 Schema-Level Failures

| Failure | Cause | Prevention | Severity |
|---|---|---|---|
| Unknown `class_type` | Typo or unsupported type | Enum validation at parse time | Error |
| Missing required field | Incomplete spec | Schema validation with required fields list | Error |
| Invalid `name` format | Spaces, special chars | Regex pattern `^[A-Za-z_][A-Za-z0-9_]*$` | Error |
| Invalid `content_path` | Doesn't start with /Game/ | Regex pattern `^/Game/` | Error |
| Invalid type ID in variable | Typo in type field | Enum validation against known type IDs | Error |
| Missing `object_class` | Object ref without class | Required-if rule: object_ref/class_ref/soft_object_ref requires it | Error |
| Missing `element_type` | Array/set without element type | Required-if rule | Error |

### 7.2 Graph-Level Failures

| Failure | Cause | Prevention | Severity |
|---|---|---|---|
| Duplicate node IDs | Copy-paste error | ID uniqueness check | Error |
| Unknown node type | Typo or unregistered type | Node registry lookup | Error |
| Invalid connection target | Typo in nodeId.pinName | Referential integrity check | Error |
| Exec pin connected to data pin | Wrong pin type | Pin category validation | Error |
| Type mismatch on data connection | Incompatible types | Type checker with implicit cast rules | Error |
| Missing `function` on CallFunction | Incomplete node | Required-if rule | Error |
| Function not found | Wrong name or class | Function resolution system | Error |
| Graph cycle detected | Feedback loop | Topological sort check | Error |
| Multiple connections to exec input | Ambiguous flow | Single-source rule on exec inputs | Error |
| Multiple connections to data input | Ambiguous value | Single-source rule on data inputs | Error |
| Unconnected exec output on flow node | Dead code path | Warning only | Warning |
| Orphan node (no connections) | Leftover from editing | Warning only | Warning |

### 7.3 Component-Level Failures

| Failure | Cause | Prevention | Severity |
|---|---|---|---|
| Multiple `is_root: true` | Wrong hierarchy | At-most-one check | Error |
| No root component | Missing root | Auto-create DefaultSceneRoot if none specified | Auto-fix |
| Child references unknown component | Typo | Name resolution check | Error |
| Cycle in component hierarchy | A->B->A | Cycle detection | Error |
| Invalid property for component type | Wrong property name | Property registry validation | Warning |
| Non-SceneComponent as root | Wrong type | Type check (root must extend USceneComponent) | Error |

### 7.4 Builder-Specific Failures

**Widget:**
| Failure | Cause | Prevention | Severity |
|---|---|---|---|
| Root is not panel type | Wrong root widget | Category check | Error |
| Leaf widget has children | Invalid hierarchy | Category-based child count check | Error |
| Content widget has >1 child | Too many children | Category-based child count check | Error |
| Duplicate widget names | Copy-paste | Global uniqueness check across tree | Error |
| Null slot after AddChild | UE4 internal failure | Hard error, builder aborts | Error |

**BehaviorTree:**
| Failure | Cause | Prevention | Severity |
|---|---|---|---|
| Root is not composite | Wrong root type | Registry category check | Error |
| Composite has 0 children | Empty composite | Minimum child count check | Error |
| SimpleParallel != 2 children | Wrong child count | Exact count check | Error |
| Task has children | Invalid hierarchy | Zero-children rule for tasks | Error |
| Non-decorator in decorators array | Wrong node category | Category check | Error |
| BB key not in blackboard | Typo or missing key | Key existence check | Error |
| Arithmetic condition on non-numeric key | Type mismatch | BB key type requirement check | Error |
| Service on task node | Invalid attachment | Services only on composites | Error |

**AnimBlueprint:**
| Failure | Cause | Prevention | Severity |
|---|---|---|---|
| Missing skeleton_path | Incomplete spec | Required field | Error |
| No entry state | Missing is_entry:true | Exactly-one-entry check | Error |
| Multiple entry states | Ambiguous entry | Exactly-one-entry check | Error |
| Transition refs non-existent state | Typo in from/to | State ID resolution | Error |
| time_remaining on looping state | Invalid condition | Looping state check | Error |
| Variable not found for condition | Typo | Variable existence check | Error |
| No StateMachine in pipeline | Missing SM | Pipeline composition check | Error |
| Animation path unloadable | Missing asset | Asset existence check (runtime) | Error |

### 7.5 Runtime Safeguards

1. **Atomic commit:** No builder modifies the target asset until all validation passes. On success, the build result is applied atomically. On failure, the asset is unchanged.
2. **UE4 transaction wrapping:** All modifications wrapped in `FScopedTransaction` for undo support.
3. **Compile after build:** K2 blueprints auto-compile after graph construction. Compile errors are returned in the response but do not roll back the graph (consistent with UE4 editor behavior).
4. **Editor graph sync:** BT and AnimBP sync their editor-visible graphs after building the runtime tree. Sync failures are warnings, not errors.
5. **Asset saving:** New assets are saved to disk. Rebuilt assets are marked dirty but not auto-saved (matches editor behavior for existing assets).

---

## Appendix A: PinSpec Definition

Referenced by FunctionSpec, EventSpec, DispatcherSpec.

```jsonschema
{
  "type": "object",
  "required": ["name", "type"],
  "properties": {
    "name": {
      "type": "string",
      "pattern": "^[A-Za-z_][A-Za-z0-9_]*$"
    },
    "type": {
      "type": "string",
      "enum": [
        "bool", "int", "int64", "float", "name", "string", "text",
        "vector", "rotator", "transform", "vector2d",
        "color", "linear_color",
        "object_ref", "class_ref", "soft_object_ref", "interface_ref",
        "array", "set", "map",
        "byte", "enum"
      ]
    },
    "object_class": {
      "type": "string",
      "description": "Required for object_ref, class_ref, soft_object_ref, interface_ref"
    },
    "element_type": {
      "type": "string",
      "description": "Required for array, set"
    },
    "key_type": {
      "type": "string",
      "description": "Required for map"
    },
    "value_type": {
      "type": "string",
      "description": "Required for map"
    },
    "enum_class": {
      "type": "string",
      "description": "Required for enum type. UE4 enum class name."
    }
  }
}
```

## Appendix B: Full class_type Dispatch Table

```
class_type          -> Subsystem              -> Entry Point                           -> Asset Type
--------------------+-------------------------+-----------------------------------------+------------------
Actor               -> K2 Blueprint Pipeline  -> BuildBlueprintFromJSON                -> UBlueprint
Character           -> K2 Blueprint Pipeline  -> BuildBlueprintFromJSON                -> UBlueprint
Pawn                -> K2 Blueprint Pipeline  -> BuildBlueprintFromJSON                -> UBlueprint
PlayerController    -> K2 Blueprint Pipeline  -> BuildBlueprintFromJSON                -> UBlueprint
GameMode            -> K2 Blueprint Pipeline  -> BuildBlueprintFromJSON                -> UBlueprint
GameState           -> K2 Blueprint Pipeline  -> BuildBlueprintFromJSON                -> UBlueprint
HUD                 -> K2 Blueprint Pipeline  -> BuildBlueprintFromJSON                -> UBlueprint
ActorComponent      -> K2 Blueprint Pipeline  -> BuildBlueprintFromJSON                -> UBlueprint
SceneComponent      -> K2 Blueprint Pipeline  -> BuildBlueprintFromJSON                -> UBlueprint
FunctionLibrary     -> K2 Blueprint Pipeline  -> BuildBlueprintFromJSON                -> UBlueprint
Widget              -> Widget Blueprint       -> BuildWidgetFromJSON                   -> UWidgetBlueprint
BehaviorTree        -> BT Builder             -> BuildBehaviorTreeFromJSON             -> UBehaviorTree
AnimBlueprint       -> AnimBP Builder         -> BuildAnimBlueprintFromJSON            -> UAnimBlueprint
```

## Appendix C: Version Constraints

This schema targets UE4.27. The following features are explicitly excluded:

- Enhanced Input System (UE5 only)
- Niagara parameter interfaces (UE4.27 Niagara is limited)
- Control Rig (UE5)
- Common UI (UE5)
- Subsystems (UE4.27 has them but they're not blueprint-creatable)
- Async blueprint nodes beyond Delay
- Blend spaces in AnimBP (v2 target)
- AnimBP non-bool variables (v2 target)
- Multiple state machines in AnimBP (v2 target)
- Widget event bindings (v2 target)
- Data Table generation (separate tool)
- Struct/Enum definition (separate tool)
- Interface implementation (v2 target)
