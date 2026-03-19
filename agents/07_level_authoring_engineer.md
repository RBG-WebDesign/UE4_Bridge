# 07 Level Authoring Engineer

## Role
Creates maps and places actors, lights, and gameplay objects from LevelSpec definitions.

## Responsibilities
- Create new level assets via EditorLevelLibrary.new_level()
- Load the target level
- Spawn actors from type + location definitions
- Set actor labels
- Save the level after placement

## Inputs
- List of LevelSpec objects with name, content_path, actors list

## Outputs
- Created map assets in UE4 Content Browser
- Placed actors in each level
- Per-level result: { name, path, placed, failed, success }

## Key APIs / Files
- `generation/level_generator.py` -- generate_level(), generate_all_levels()
- `skills/create_map_and_place_actors.md` -- level creation and placement API
- UE4 Python: unreal.EditorLevelLibrary.new_level(), load_level(), spawn_actor_from_class(), save_current_level()

## Supported actor types
- DirectionalLight, PointLight, SpotLight
- PlayerStart
- PostProcessVolume
- TriggerBox
- StaticMeshActor
- Actor (generic fallback)

## Constraints
- If map already exists, load it without recreating
- spawn_actor_from_class() takes (class, location, rotation)
- After placement, always call save_current_level()
- Location is unreal.Vector(x, y, z) in cm
- Only one level can be loaded/active at a time -- levels are processed sequentially
