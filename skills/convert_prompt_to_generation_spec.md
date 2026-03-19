# Skill: convert_prompt_to_generation_spec

Convert a natural language user prompt to a BuildSpec JSON.

## Entry point
```python
from generation.prompt_to_spec import prompt_to_spec
spec = prompt_to_spec("Make me gameplay like Puzzle Fighter")
```

## Genre detection
```python
from generation.prompt_to_spec import detect_genre
genre = detect_genre(prompt)  # returns "puzzle_fighter", "menu_system", "generic", etc.
```

## Genre keyword map
| Genre | Trigger keywords |
|---|---|
| puzzle_fighter | puzzle fighter, falling blocks, tetris, combo puzzle, grid puzzle |
| horror | horror, pt , silent hill, resident evil, hallway trigger |
| platformer | platformer, mario, run and jump, side scroller |
| inventory | inventory, item system, pickup, loot, equipment |
| menu_system | main menu, pause menu, hud, ui flow, game over |
| generic | (fallback if nothing matches) |

## Adding a new genre
1. Add keywords to `GENRE_KEYWORDS` in `prompt_to_spec.py`
2. Write `_<genre>_spec(prompt: str) -> BuildSpec` function
3. Register: `if genre == "my_genre": return _my_genre_spec(prompt)`

## BuildSpec fields
```python
BuildSpec(
    feature_name="PuzzleFighter",    # asset prefix / folder name
    genre="puzzle_fighter",
    description=prompt,              # original user text
    blueprints=[...],                # List[BlueprintSpec]
    widgets=[...],                   # List[WidgetSpec]
    materials=[...],                 # List[MaterialSpec]
    data_assets=[...],               # List[DataAssetSpec]
    levels=[...],                    # List[LevelSpec]
    input_mappings=InputMappingSpec(
        action_mappings=[{"name": "Jump", "key": "SpaceBar"}],
        axis_mappings=[{"name": "MoveForward", "key": "W", "scale": 1.0}],
    ),
    acceptance_tests=["All 5 BPs compiled"],
)
```

## Persist spec to disk
```python
import json
from generation.spec_schema import spec_to_dict
with open("spec_abc123.json", "w") as f:
    json.dump(spec_to_dict(spec), f, indent=2)
```
