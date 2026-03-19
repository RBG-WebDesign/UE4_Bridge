# prompt_to_spec.py -- Convert a natural language prompt to a BuildSpec.
# Uses keyword and genre template matching. Deterministic, no external AI calls.
from __future__ import annotations
from typing import Dict, List
from mcp_bridge.generation.spec_schema import (
    BuildSpec, BlueprintSpec, WidgetSpec, MaterialSpec,
    DataAssetSpec, LevelSpec, InputMappingSpec,
)


# ---------------------------------------------------------------------------
# Genre detection
# ---------------------------------------------------------------------------

GENRE_KEYWORDS: Dict[str, List[str]] = {
    "puzzle_fighter": [
        "puzzle fighter", "block puzzle", "falling blocks", "tetris", "puyo",
        "panel de pon", "combo puzzle", "match blocks", "grid puzzle",
    ],
    "horror": [
        "horror", "pt ", "silent hill", "resident evil", "jump scare",
        "hallway trigger", "atmospheric horror", "creepy", "monster pursuit",
    ],
    "platformer": [
        "platformer", "mario", "run and jump", "side scroller", "jump and run",
        "2d platform", "side-scroll",
    ],
    "inventory": [
        "inventory", "item system", "pickup", "loot", "backpack",
        "item management", "equipment", "slot system",
    ],
    "menu_system": [
        "main menu", "pause menu", "settings menu", "hud", "ui flow",
        "game over", "victory screen", "menu system", "ui system",
    ],
    "generic": [],
}


def detect_genre(prompt: str) -> str:
    lower = prompt.lower()
    for genre, keywords in GENRE_KEYWORDS.items():
        if genre == "generic":
            continue
        for kw in keywords:
            if kw in lower:
                return genre
    return "generic"


# ---------------------------------------------------------------------------
# Widget tree helpers
# ---------------------------------------------------------------------------

def _simple_canvas(name: str, title_text: str = "") -> Dict:
    return {
        "type": "CanvasPanel",
        "name": f"{name}Root",
        "properties": {"visibility": "Visible"},
        "children": [
            {
                "type": "TextBlock",
                "name": f"{name}Title",
                "properties": {
                    "text": title_text or name,
                    "color": {"r": 1.0, "g": 1.0, "b": 1.0, "a": 1.0},
                },
                "slot": {"position": {"x": 100, "y": 100}, "size": {"x": 600, "y": 80}},
            }
        ],
    }


def _main_menu_widget_tree(game_title: str = "GAME") -> Dict:
    return {
        "type": "CanvasPanel",
        "name": "MainMenuRoot",
        "properties": {"visibility": "Visible"},
        "children": [
            {
                "type": "TextBlock",
                "name": "GameTitle",
                "properties": {
                    "text": game_title,
                    "color": {"r": 1.0, "g": 0.8, "b": 0.0, "a": 1.0},
                },
                "slot": {"position": {"x": 200, "y": 60}, "size": {"x": 600, "y": 100}},
            },
            {
                "type": "VerticalBox",
                "name": "ButtonColumn",
                "slot": {"position": {"x": 300, "y": 220}, "size": {"x": 400, "y": 300}},
                "children": [
                    {
                        "type": "Button",
                        "name": "PlayButton",
                        "properties": {
                        },
                        "children": [
                            {
                                "type": "TextBlock",
                                "name": "PlayText",
                                "properties": {
                                    "text": "Play Game",
                                    "color": {"r": 1, "g": 1, "b": 1, "a": 1},
                                },
                            }
                        ],
                    },
                    {
                        "type": "Button",
                        "name": "SettingsButton",
                        "properties": {
                        },
                        "children": [
                            {
                                "type": "TextBlock",
                                "name": "SettingsText",
                                "properties": {
                                    "text": "Settings",
                                    "color": {"r": 1, "g": 1, "b": 1, "a": 1},
                                },
                            }
                        ],
                    },
                    {
                        "type": "Button",
                        "name": "QuitButton",
                        "properties": {
                        },
                        "children": [
                            {
                                "type": "TextBlock",
                                "name": "QuitText",
                                "properties": {
                                    "text": "Quit",
                                    "color": {"r": 1, "g": 1, "b": 1, "a": 1},
                                },
                            }
                        ],
                    },
                ],
            },
        ],
    }


def _hud_widget_tree() -> Dict:
    return {
        "type": "CanvasPanel",
        "name": "HUDRoot",
        "properties": {"visibility": "Visible"},
        "children": [
            {
                "type": "TextBlock",
                "name": "ScoreLabel",
                "properties": {
                    "text": "Score: 0",
                    "color": {"r": 1, "g": 1, "b": 1, "a": 1},
                },
                "slot": {"position": {"x": 20, "y": 20}, "size": {"x": 200, "y": 40}},
            },
            {
                "type": "TextBlock",
                "name": "TimerLabel",
                "properties": {
                    "text": "00:00",
                    "color": {"r": 1, "g": 0.9, "b": 0.0, "a": 1},
                },
                "slot": {"position": {"x": 400, "y": 20}, "size": {"x": 200, "y": 40}},
            },
            {
                "type": "TextBlock",
                "name": "ComboMeter",
                "properties": {"text": "Combo: 0"},
                "slot": {"position": {"x": 20, "y": 70}, "size": {"x": 300, "y": 20}},
            },
        ],
    }


def _score_display_widget_tree() -> Dict:
    return {
        "type": "CanvasPanel",
        "name": "ScoreRoot",
        "properties": {"visibility": "Visible"},
        "children": [
            {
                "type": "TextBlock",
                "name": "ScoreValue",
                "properties": {
                    "text": "0",
                    "color": {"r": 1, "g": 1, "b": 0, "a": 1},
                },
                "slot": {"position": {"x": 0, "y": 0}, "size": {"x": 200, "y": 60}},
            }
        ],
    }


def _timer_widget_tree() -> Dict:
    return {
        "type": "CanvasPanel",
        "name": "TimerRoot",
        "properties": {"visibility": "Visible"},
        "children": [
            {
                "type": "TextBlock",
                "name": "TimerValue",
                "properties": {
                    "text": "99",
                    "color": {"r": 1.0, "g": 0.3, "b": 0.3, "a": 1.0},
                },
                "slot": {"position": {"x": 0, "y": 0}, "size": {"x": 120, "y": 60}},
            }
        ],
    }


def _combo_popup_widget_tree() -> Dict:
    return {
        "type": "CanvasPanel",
        "name": "ComboRoot",
        "properties": {"visibility": "Hidden"},
        "children": [
            {
                "type": "TextBlock",
                "name": "ComboText",
                "properties": {
                    "text": "COMBO!",
                    "color": {"r": 1.0, "g": 0.8, "b": 0.0, "a": 1.0},
                },
                "slot": {"position": {"x": 0, "y": 0}, "size": {"x": 300, "y": 80}},
            },
            {
                "type": "TextBlock",
                "name": "ComboMultiplier",
                "properties": {
                    "text": "x2",
                    "color": {"r": 1.0, "g": 0.5, "b": 0.0, "a": 1.0},
                },
                "slot": {"position": {"x": 0, "y": 80}, "size": {"x": 200, "y": 60}},
            },
        ],
    }


def _pause_menu_widget_tree() -> Dict:
    return {
        "type": "CanvasPanel",
        "name": "PauseRoot",
        "properties": {"visibility": "Visible"},
        "children": [
            {
                "type": "Border",
                "name": "PauseBackground",
                "properties": {},
                "slot": {"position": {"x": 0, "y": 0}, "size": {"x": 1920, "y": 1080}},
                "children": [
                    {
                        "type": "VerticalBox",
                        "name": "PauseButtons",
                        "children": [
                            {
                                "type": "TextBlock",
                                "name": "PauseTitle",
                                "properties": {
                                    "text": "PAUSED",
                                    "color": {"r": 1, "g": 1, "b": 1, "a": 1},
                                },
                            },
                            {
                                "type": "Button",
                                "name": "ResumeButton",
                                "children": [
                                    {
                                        "type": "TextBlock",
                                        "name": "ResumeText",
                                        "properties": {"text": "Resume"},
                                    }
                                ],
                            },
                            {
                                "type": "Button",
                                "name": "MainMenuButton",
                                "children": [
                                    {
                                        "type": "TextBlock",
                                        "name": "MainMenuText",
                                        "properties": {"text": "Main Menu"},
                                    }
                                ],
                            },
                        ],
                    }
                ],
            }
        ],
    }


def _game_over_widget_tree() -> Dict:
    return {
        "type": "CanvasPanel",
        "name": "GameOverRoot",
        "properties": {"visibility": "Visible"},
        "children": [
            {
                "type": "TextBlock",
                "name": "GameOverTitle",
                "properties": {
                    "text": "GAME OVER",
                    "color": {"r": 1.0, "g": 0.0, "b": 0.0, "a": 1.0},
                },
                "slot": {"position": {"x": 300, "y": 300}, "size": {"x": 600, "y": 100}},
            },
            {
                "type": "TextBlock",
                "name": "FinalScore",
                "properties": {
                    "text": "Final Score: 0",
                    "color": {"r": 1, "g": 1, "b": 1, "a": 1},
                },
                "slot": {"position": {"x": 350, "y": 420}, "size": {"x": 400, "y": 60}},
            },
            {
                "type": "Button",
                "name": "RetryButton",
                "slot": {"position": {"x": 400, "y": 520}, "size": {"x": 200, "y": 60}},
                "children": [
                    {
                        "type": "TextBlock",
                        "name": "RetryText",
                        "properties": {
                            "text": "Retry",
                            "color": {"r": 1, "g": 1, "b": 1, "a": 1},
                        },
                    }
                ],
            },
        ],
    }


# ---------------------------------------------------------------------------
# Genre templates
# ---------------------------------------------------------------------------

def _puzzle_fighter_spec(prompt: str) -> BuildSpec:
    gameplay = "/Game/Generated/PuzzleFighter/Gameplay"
    ui = "/Game/Generated/PuzzleFighter/UI"
    data = "/Game/Generated/PuzzleFighter/Data"
    maps = "/Game/Generated/PuzzleFighter/Maps"
    art = "/Game/Generated/PuzzleFighter/Art"

    spec = BuildSpec(
        feature_name="PuzzleFighter",
        genre="puzzle_fighter",
        description=prompt,
        placeholder_policy="generate",
    )

    spec.blueprints = [
        BlueprintSpec("BP_PF_GameMode", "GameModeBase", gameplay),
        BlueprintSpec("BP_PF_GameState", "GameStateBase", gameplay),
        BlueprintSpec("BP_PF_PlayerController", "PlayerController", gameplay),
        BlueprintSpec(
            "BP_PF_BoardPawn", "Pawn", gameplay,
            components=[{"name": "BoardMesh", "class": "StaticMeshComponent"}],
        ),
        BlueprintSpec("BP_PF_AIController", "AIController", gameplay),
        BlueprintSpec("BP_PF_GameInstance", "GameInstance", gameplay),
        BlueprintSpec(
            "BP_PF_GridManager", "Actor", gameplay,
            components=[{"name": "GridRoot", "class": "SceneComponent"}],
        ),
        BlueprintSpec(
            "BP_PF_Block", "Actor", gameplay,
            components=[
                {"name": "BlockMesh", "class": "StaticMeshComponent"},
                {"name": "BlockCollision", "class": "BoxComponent"},
            ],
        ),
        BlueprintSpec(
            "BP_PF_BlockSpawner", "Actor", gameplay,
            components=[{"name": "SpawnRoot", "class": "SceneComponent"}],
        ),
        BlueprintSpec("BP_PF_MatchResolver", "Actor", gameplay),
        BlueprintSpec("BP_PF_ComboSystem", "Actor", gameplay),
        BlueprintSpec("BP_PF_GarbageSystem", "Actor", gameplay),
        BlueprintSpec("BP_PF_DropController", "Actor", gameplay),
        BlueprintSpec("BP_PF_InputHandler", "Actor", gameplay),
        BlueprintSpec("BP_PF_RuleSet", "Actor", gameplay),
        BlueprintSpec("BP_PF_SaveGame", "SaveGame", gameplay),
        BlueprintSpec("BP_PF_AI_BoardEvaluator", "Actor", gameplay),
        BlueprintSpec("BP_PF_AI_MovePlanner", "Actor", gameplay),
        BlueprintSpec("BP_PF_AI_DifficultyScaler", "Actor", gameplay),
    ]

    spec.widgets = [
        WidgetSpec("WBP_PF_MainMenu", ui, _main_menu_widget_tree("PUZZLE FIGHTER")),
        WidgetSpec("WBP_PF_HUD", ui, _hud_widget_tree()),
        WidgetSpec("WBP_PF_GameBoard", ui, _simple_canvas("GameBoard")),
        WidgetSpec("WBP_PF_ScoreDisplay", ui, _score_display_widget_tree()),
        WidgetSpec("WBP_PF_Timer", ui, _timer_widget_tree()),
        WidgetSpec("WBP_PF_ComboPopup", ui, _combo_popup_widget_tree()),
        WidgetSpec("WBP_PF_PauseMenu", ui, _pause_menu_widget_tree()),
        WidgetSpec("WBP_PF_GameOver", ui, _game_over_widget_tree()),
        WidgetSpec("WBP_PF_VictoryScreen", ui, _simple_canvas("VictoryScreen", "VICTORY!")),
        WidgetSpec("WBP_PF_SettingsMenu", ui, _simple_canvas("SettingsMenu", "Settings")),
    ]

    spec.materials = [
        MaterialSpec("M_PF_Block_Red", art, base_color=[1.0, 0.1, 0.1, 1.0]),
        MaterialSpec("M_PF_Block_Blue", art, base_color=[0.1, 0.3, 1.0, 1.0]),
        MaterialSpec("M_PF_Block_Green", art, base_color=[0.1, 0.8, 0.1, 1.0]),
        MaterialSpec("M_PF_Block_Yellow", art, base_color=[1.0, 0.9, 0.1, 1.0]),
        MaterialSpec("M_PF_UI_Base", art, base_color=[0.05, 0.05, 0.1, 0.9]),
        MaterialSpec("M_PF_Grid", art, base_color=[0.15, 0.15, 0.2, 1.0]),
    ]

    spec.data_assets = [
        DataAssetSpec("DA_PF_BlockTypes", data, "DataAsset"),
        DataAssetSpec("DA_PF_ComboRules", data, "DataAsset"),
        DataAssetSpec("DA_PF_DifficultySettings", data, "DataAsset"),
        DataAssetSpec("E_PF_BlockType", data, "Enum"),
        DataAssetSpec("E_PF_GameState", data, "Enum"),
        DataAssetSpec("E_PF_MatchType", data, "Enum"),
        DataAssetSpec("Struct_PF_BlockData", data, "Struct"),
        DataAssetSpec("Struct_PF_GridCell", data, "Struct"),
        DataAssetSpec("Struct_PF_PlayerProgress", data, "Struct"),
        DataAssetSpec("Struct_PF_Settings", data, "Struct"),
        DataAssetSpec("Curve_PF_FallSpeed", data, "CurveFloat"),
        DataAssetSpec("Curve_PF_ComboScale", data, "CurveFloat"),
        DataAssetSpec("Curve_PF_UIBounce", data, "CurveFloat"),
        DataAssetSpec("DT_PF_BlockStats", data, "DataTable"),
        DataAssetSpec("DT_PF_Scoring", data, "DataTable"),
        DataAssetSpec("DT_PF_LevelProgression", data, "DataTable"),
    ]

    spec.levels = [
        LevelSpec(
            "Map_PF_MainMenu", maps,
            actors=[
                {"type": "DirectionalLight", "name": "MenuLight",
                 "location": {"x": 0, "y": 0, "z": 500}},
            ],
        ),
        LevelSpec(
            "Map_PF_Gameplay", maps,
            actors=[
                {"type": "DirectionalLight", "name": "GameLight",
                 "location": {"x": 0, "y": 0, "z": 800}},
                {"type": "PlayerStart", "name": "PlayerStart",
                 "location": {"x": 0, "y": 0, "z": 100}},
                {"type": "PostProcessVolume", "name": "PPV",
                 "location": {"x": 0, "y": 0, "z": 0}},
            ],
        ),
        LevelSpec("Map_PF_Results", maps, actors=[]),
    ]

    spec.input_mappings = InputMappingSpec(
        action_mappings=[
            {"name": "PF_MoveLeft", "key": "Left"},
            {"name": "PF_MoveRight", "key": "Right"},
            {"name": "PF_RotateCW", "key": "X"},
            {"name": "PF_RotateCCW", "key": "Z"},
            {"name": "PF_HardDrop", "key": "Down"},
            {"name": "PF_Pause", "key": "Escape"},
        ],
        axis_mappings=[
            {"name": "PF_MoveHorizontal", "key": "Left", "scale": -1.0},
            {"name": "PF_MoveHorizontal", "key": "Right", "scale": 1.0},
        ],
    )

    spec.acceptance_tests = [
        "All 19 Blueprint assets exist and compiled",
        "All 10 Widget assets exist",
        "All 6 materials exist",
        "All 16 data assets exist",
        "All 3 maps exist",
        "Input mappings written to DefaultInput.ini",
    ]

    return spec


def _menu_system_spec(prompt: str) -> BuildSpec:
    ui = "/Game/Generated/MenuSystem/UI"
    gameplay = "/Game/Generated/MenuSystem/Gameplay"
    maps = "/Game/Generated/MenuSystem/Maps"

    spec = BuildSpec(
        feature_name="MenuSystem",
        genre="menu_system",
        description=prompt,
        placeholder_policy="generate",
    )

    spec.blueprints = [
        BlueprintSpec("BP_MS_GameMode", "GameModeBase", gameplay),
        BlueprintSpec("BP_MS_PlayerController", "PlayerController", gameplay),
        BlueprintSpec("BP_MS_HUD", "HUD", gameplay),
    ]

    spec.widgets = [
        WidgetSpec("WBP_MS_MainMenu", ui, _main_menu_widget_tree("MY GAME")),
        WidgetSpec("WBP_MS_PauseMenu", ui, _pause_menu_widget_tree()),
        WidgetSpec("WBP_MS_GameOver", ui, _game_over_widget_tree()),
        WidgetSpec("WBP_MS_HUD", ui, _hud_widget_tree()),
        WidgetSpec("WBP_MS_Settings", ui, _simple_canvas("Settings", "Settings")),
    ]

    spec.levels = [
        LevelSpec(
            "Map_MS_Main", maps,
            actors=[
                {"type": "DirectionalLight", "name": "Light",
                 "location": {"x": 0, "y": 0, "z": 500}},
            ],
        ),
    ]

    spec.acceptance_tests = [
        "All 3 Blueprint assets exist and compiled",
        "All 5 Widget assets exist",
        "Map_MS_Main exists",
    ]
    return spec


def _generic_spec(prompt: str) -> BuildSpec:
    path = "/Game/Generated/Generic"

    spec = BuildSpec(
        feature_name="GeneratedFeature",
        genre="generic",
        description=prompt,
        placeholder_policy="generate",
    )

    spec.blueprints = [
        BlueprintSpec("BP_GenericGameMode", "GameModeBase", path),
        BlueprintSpec(
            "BP_GenericActor", "Actor", path,
            components=[{"name": "Root", "class": "SceneComponent"}],
        ),
    ]

    spec.levels = [
        LevelSpec(
            "Map_Generic", path,
            actors=[
                {"type": "PlayerStart", "name": "Start",
                 "location": {"x": 0, "y": 0, "z": 100}},
                {"type": "DirectionalLight", "name": "Light",
                 "location": {"x": 0, "y": 0, "z": 500}},
            ],
        ),
    ]

    spec.acceptance_tests = [
        "BP_GenericGameMode exists and compiled",
        "BP_GenericActor exists and compiled",
        "Map_Generic exists",
    ]
    return spec


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def prompt_to_spec(prompt: str) -> BuildSpec:
    """Convert a natural language prompt to a BuildSpec. Entry point for the pipeline."""
    genre = detect_genre(prompt)
    if genre == "puzzle_fighter":
        return _puzzle_fighter_spec(prompt)
    if genre == "menu_system":
        return _menu_system_spec(prompt)
    return _generic_spec(prompt)
