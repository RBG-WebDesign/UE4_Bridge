# Skill: create_map_and_place_actors

Create a UE4.27 level and populate it with actors via Python.

## Create a new level
```python
import unreal
# Creates empty level at content path
unreal.EditorLevelLibrary.new_level("/Game/Generated/Maps/Map_MyLevel")
```

## Load an existing level
```python
unreal.EditorLevelLibrary.load_level("/Game/Generated/Maps/Map_MyLevel")
```

## Check if level exists
```python
exists = unreal.EditorAssetLibrary.does_asset_exist("/Game/Generated/Maps/Map_MyLevel")
```

## Spawn an actor
```python
location = unreal.Vector(0.0, 0.0, 100.0)
rotation = unreal.Rotator(0.0, 0.0, 0.0)
actor = unreal.EditorLevelLibrary.spawn_actor_from_class(
    unreal.DirectionalLight, location, rotation
)
if actor:
    actor.set_actor_label("MainLight")
```

## Supported actor class references
```python
unreal.DirectionalLight
unreal.PointLight
unreal.SpotLight
unreal.PlayerStart
unreal.PostProcessVolume
unreal.TriggerBox
unreal.StaticMeshActor
unreal.Actor  # generic fallback
```

## Save level
```python
unreal.EditorLevelLibrary.save_current_level()
```

## Pipeline function
```python
from generation.level_generator import generate_level
from generation.spec_schema import LevelSpec

spec = LevelSpec(
    name="Map_MyLevel",
    content_path="/Game/Generated/Maps",
    actors=[
        {"type": "DirectionalLight", "name": "Sun", "location": {"x": 0, "y": 0, "z": 800}},
        {"type": "PlayerStart", "name": "Start", "location": {"x": 0, "y": 0, "z": 100}},
    ]
)
ok, err, data = generate_level(spec)
```

## Constraints
- Only one level can be active/loaded at a time
- After new_level() the level is already loaded and active
- Actors are placed in world space (cm units)
- After all placements, always call save_current_level()
