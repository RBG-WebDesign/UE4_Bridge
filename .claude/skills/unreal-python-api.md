---
name: unreal-python-api
description: >
  Reference for UE4.27's Python editor scripting API. Use whenever writing
  Python code that executes inside the Unreal editor, calling unreal module
  functions, creating assets through factories, manipulating actors, or
  controlling the viewport.
---

# UE4.27 Python API Reference

## Live API Lookup via Context7

When the quick reference below doesn't cover what you need, query the full UE4 Python API through Context7:

```
Tool: mcp__plugin_context7_context7__query-docs
libraryId: /radial-hks/unreal-python-stubhub
query: <class or method you need, e.g. "EditorAssetLibrary load_asset rename_asset">
```

This library has 57,781 snippets covering method signatures, class hierarchies, property types, and inheritance chains. Use it to:
- Look up exact method signatures before writing a Python handler
- Check class inheritance (e.g. does `AnimBlueprintGeneratedClass` extend `BlueprintGeneratedClass`?)
- Find available properties on UE4 types
- Verify parameter types and return values

Fallback (official Epic docs, less reliable for 4.27):
```
libraryId: /websites/dev_epicgames_en-us_unreal-engine_python-api
```

## Core Module
All calls go through the `unreal` module, which is available globally inside the editor's Python environment.

## Actor Operations (`unreal.EditorLevelLibrary`)
| Method | Description |
|--------|-------------|
| `get_all_level_actors()` | Returns list of all actors in the current level |
| `get_all_level_actors_components()` | Returns all components across all actors |
| `spawn_actor_from_class(actor_class, location, rotation)` | Spawns an actor of the given class |
| `spawn_actor_from_object(asset, location, rotation)` | Spawns an actor from a loaded asset |
| `destroy_actor(actor)` | Removes an actor from the level |
| `get_actor_reference(path)` | Gets an actor by path/label |
| `set_actor_location(actor, location, sweep)` | Sets actor world location |
| `set_actor_rotation(actor, rotation)` | Sets actor world rotation |
| `set_actor_scale3d(actor, scale)` | Sets actor world scale |
| `get_selected_level_actors()` | Returns currently selected actors |
| `set_selected_level_actors(actors)` | Sets editor selection |

## Asset Operations (`unreal.EditorAssetLibrary`)
| Method | Description |
|--------|-------------|
| `list_assets(path, recursive, include_folder)` | Lists assets under a path |
| `does_asset_exist(asset_path)` | Checks if an asset exists |
| `load_asset(asset_path)` | Loads an asset by path |
| `find_asset_data(asset_path)` | Gets asset metadata without loading |
| `save_asset(asset_path)` | Saves a single asset |
| `save_loaded_assets(assets, only_if_dirty)` | Batch save loaded assets |
| `duplicate_asset(source, destination)` | Duplicates an asset |
| `delete_asset(asset_path)` | Deletes an asset |

## Asset Creation (`unreal.AssetToolsHelpers`)
```python
asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
asset_tools.create_asset(name, path, asset_class, factory)
```

### Common Factories
- `unreal.BlueprintFactory()` - Create Blueprint assets
- `unreal.MaterialFactoryNew()` - Create base materials
- `unreal.MaterialInstanceConstantFactoryNew()` - Create material instances
- `unreal.WorldFactory()` - Create level/map assets

## System Info (`unreal.SystemLibrary`)
| Method | Description |
|--------|-------------|
| `get_engine_version()` | Returns engine version string |
| `get_project_directory()` | Returns project root path |
| `get_project_content_directory()` | Returns Content/ path |
| `get_game_name()` | Returns project name |

## Transactions
```python
unreal.SystemLibrary.begin_transaction("My Operation")
# ... perform editor operations ...
unreal.SystemLibrary.end_transaction()
```
Wrapping operations in transactions enables Ctrl+Z undo in the editor.

## Level Operations (`unreal.EditorLevelUtils`)
| Method | Description |
|--------|-------------|
| `get_levels(world)` | Returns sub-levels |
| `add_level_to_world(world, path, streaming_class)` | Adds a sub-level |

## Viewport (4.27)
UE4.27's Python viewport control is limited. Primary methods:
```python
# Get editor subsystem
subsystem = unreal.UnrealEditorSubsystem()
subsystem.get_level_viewport_camera_info()  # Returns (location, rotation)
subsystem.set_level_viewport_camera_info(location, rotation)
```

For screenshots, use:
```python
unreal.AutomationLibrary.take_high_res_screenshot(
    resolution_x, resolution_y, filename
)
```

## Path Conventions
- All asset paths must start with `/Game/`
- Use forward slashes, not backslashes
- Example: `/Game/Meshes/SM_Cube`

## Threading
- All `unreal` module calls MUST run on the game thread
- Background threads must marshal work to the game thread
- Use `unreal.register_slate_post_tick_callback(callable)` for deferred execution
- Remove callbacks with `unreal.unregister_slate_post_tick_callback(handle)`

## Common Gotchas
1. `load_asset()` returns None silently if the path is wrong
2. Actor transforms use `unreal.Vector` and `unreal.Rotator`, not tuples
3. Blueprint compilation can fail silently; always check the return of `compile_blueprint()`
4. Some editor operations require `unreal.EditorLoadingAndSavingUtils` for level save
