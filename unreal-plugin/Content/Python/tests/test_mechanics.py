"""Unit tests for gameplay mechanics -- no UE4 required.

Tests for all mechanics (Tasks 4-8). Only player_movement is implemented now.
Tests for other mechanics will fail with ImportError until those mechanics
are implemented in later tasks -- that is expected.

Run: python unreal-plugin/Content/Python/tests/test_mechanics.py
"""
import sys
import os

_PYTHON_ROOT = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, _PYTHON_ROOT)

from mcp_bridge.generation.spec_schema import BuildSpec, IntentMap
from mcp_bridge.generation.intent_extractor import extract_intent


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_spec(prompt: str = "") -> BuildSpec:
    return BuildSpec(feature_name="Test", genre="generic", description=prompt)


def _make_intent(prompt: str = "test game") -> IntentMap:
    return extract_intent(prompt)


def _pass(name: str) -> None:
    print(f"  PASS  {name}")


# ---------------------------------------------------------------------------
# player_movement tests
# ---------------------------------------------------------------------------

def test_player_movement_adds_character_bp() -> None:
    from mcp_bridge.generation.mechanics.player_movement import apply_player_movement
    intent = _make_intent("test game")
    spec = apply_player_movement(intent, _make_spec())
    bp_names = [bp.name for bp in spec.blueprints]
    has_char = any("Character" in n or "Pawn" in n for n in bp_names)
    assert has_char, f"expected a Character/Pawn BP, got: {bp_names}"
    _pass("player_movement_adds_character_bp")


def test_player_movement_adds_controller() -> None:
    from mcp_bridge.generation.mechanics.player_movement import apply_player_movement
    intent = _make_intent("test game")
    spec = apply_player_movement(intent, _make_spec())
    bp_names = [bp.name for bp in spec.blueprints]
    has_controller = any("PlayerController" in n for n in bp_names)
    assert has_controller, f"expected a PlayerController BP, got: {bp_names}"
    _pass("player_movement_adds_controller")


def test_player_movement_adds_game_mode() -> None:
    from mcp_bridge.generation.mechanics.player_movement import apply_player_movement
    intent = _make_intent("test game")
    spec = apply_player_movement(intent, _make_spec())
    bp_names = [bp.name for bp in spec.blueprints]
    has_gm = any("GameMode" in n for n in bp_names)
    assert has_gm, f"expected a GameMode BP, got: {bp_names}"
    _pass("player_movement_adds_game_mode")


def test_player_movement_adds_input_mappings() -> None:
    from mcp_bridge.generation.mechanics.player_movement import apply_player_movement
    intent = _make_intent("test game")
    spec = apply_player_movement(intent, _make_spec())
    has_mappings = (
        len(spec.input_mappings.action_mappings) > 0
        or len(spec.input_mappings.axis_mappings) > 0
    )
    assert has_mappings, "expected action_mappings or axis_mappings to be non-empty"
    _pass("player_movement_adds_input_mappings")


# ---------------------------------------------------------------------------
# collect_item tests (will fail with ImportError until implemented)
# ---------------------------------------------------------------------------

def test_collect_item_adds_collectible_bp() -> None:
    from mcp_bridge.generation.mechanics.collect_item import apply_collect_item  # type: ignore[import]
    intent = _make_intent("collect coins")
    spec = apply_collect_item(intent, _make_spec())
    bp_names = [bp.name for bp in spec.blueprints]
    has_collectible = any(
        "Collectible" in n or "Coin" in n or "Item" in n or "Pickup" in n
        for n in bp_names
    )
    assert has_collectible, f"expected a collectible BP, got: {bp_names}"
    _pass("collect_item_adds_collectible_bp")


def test_collect_item_adds_score_hud() -> None:
    from mcp_bridge.generation.mechanics.collect_item import apply_collect_item  # type: ignore[import]
    intent = _make_intent("collect coins")
    spec = apply_collect_item(intent, _make_spec())
    widget_names = [w.name for w in spec.widgets]
    has_hud = any("HUD" in n or "Score" in n for n in widget_names)
    assert has_hud, f"expected a HUD/Score widget, got: {widget_names}"
    _pass("collect_item_adds_score_hud")


# ---------------------------------------------------------------------------
# door_trigger tests (will fail with ImportError until implemented)
# ---------------------------------------------------------------------------

def test_door_trigger_adds_door_bp() -> None:
    from mcp_bridge.generation.mechanics.door_trigger import apply_door_trigger  # type: ignore[import]
    intent = _make_intent("a door that opens when all coins are collected")
    spec = apply_door_trigger(intent, _make_spec())
    bp_names = [bp.name for bp in spec.blueprints]
    has_door = any("Door" in n or "Gate" in n for n in bp_names)
    assert has_door, f"expected a Door/Gate BP, got: {bp_names}"
    _pass("door_trigger_adds_door_bp")


# ---------------------------------------------------------------------------
# enemy_patrol tests (will fail with ImportError until implemented)
# ---------------------------------------------------------------------------

def test_enemy_patrol_adds_enemy_bp() -> None:
    from mcp_bridge.generation.mechanics.enemy_patrol import apply_enemy_patrol  # type: ignore[import]
    intent = _make_intent("enemies that patrol the level")
    spec = apply_enemy_patrol(intent, _make_spec())
    bp_names = [bp.name for bp in spec.blueprints]
    has_enemy = any("Enemy" in n or "Monster" in n or "Guard" in n for n in bp_names)
    assert has_enemy, f"expected an enemy BP, got: {bp_names}"
    _pass("enemy_patrol_adds_enemy_bp")


def test_enemy_patrol_adds_ai_controller() -> None:
    from mcp_bridge.generation.mechanics.enemy_patrol import apply_enemy_patrol  # type: ignore[import]
    intent = _make_intent("enemies that patrol the level")
    spec = apply_enemy_patrol(intent, _make_spec())
    bp_names = [bp.name for bp in spec.blueprints]
    has_aic = any("AIController" in n or "AIC_" in n for n in bp_names)
    assert has_aic, f"expected an AIController BP, got: {bp_names}"
    _pass("enemy_patrol_adds_ai_controller")


def test_enemy_patrol_adds_blackboard() -> None:
    from mcp_bridge.generation.mechanics.enemy_patrol import apply_enemy_patrol  # type: ignore[import]
    intent = _make_intent("enemies that patrol the level")
    spec = apply_enemy_patrol(intent, _make_spec())
    has_bb = len(spec.blackboards) > 0
    assert has_bb, "expected at least one blackboard in spec"
    _pass("enemy_patrol_adds_blackboard")


# ---------------------------------------------------------------------------
# hide_from_enemy tests (will fail with ImportError until implemented)
# ---------------------------------------------------------------------------

def test_hide_adds_hiding_spot() -> None:
    from mcp_bridge.generation.mechanics.hide_from_enemy import apply_hide_from_enemy  # type: ignore[import]
    intent = _make_intent("hide from the monster in hiding spots")
    spec = apply_hide_from_enemy(intent, _make_spec())
    bp_names = [bp.name for bp in spec.blueprints]
    has_hiding = any("Hiding" in n or "HideSpot" in n or "Cover" in n for n in bp_names)
    assert has_hiding, f"expected a hiding spot BP, got: {bp_names}"
    _pass("hide_adds_hiding_spot")


# ---------------------------------------------------------------------------
# main_menu tests (will fail with ImportError until implemented)
# ---------------------------------------------------------------------------

def test_main_menu_adds_widget() -> None:
    from mcp_bridge.generation.mechanics.main_menu import apply_main_menu  # type: ignore[import]
    intent = _make_intent("game with a main menu")
    spec = apply_main_menu(intent, _make_spec())
    widget_names = [w.name for w in spec.widgets]
    has_menu = any("MainMenu" in n or "Menu" in n or "Title" in n for n in widget_names)
    assert has_menu, f"expected a main menu widget, got: {widget_names}"
    _pass("main_menu_adds_widget")


# ---------------------------------------------------------------------------
# game_over tests (will fail with ImportError until implemented)
# ---------------------------------------------------------------------------

def test_game_over_adds_widget() -> None:
    from mcp_bridge.generation.mechanics.game_over import apply_game_over  # type: ignore[import]
    intent = _make_intent("game over screen when player dies")
    spec = apply_game_over(intent, _make_spec())
    widget_names = [w.name for w in spec.widgets]
    has_gameover = any("GameOver" in n or "Death" in n or "Retry" in n for n in widget_names)
    assert has_gameover, f"expected a game over widget, got: {widget_names}"
    _pass("game_over_adds_widget")


# ---------------------------------------------------------------------------
# Main -- runs all tests (unimplemented ones will fail, that's expected)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    player_movement_tests = [
        test_player_movement_adds_character_bp,
        test_player_movement_adds_controller,
        test_player_movement_adds_game_mode,
        test_player_movement_adds_input_mappings,
    ]

    other_mechanic_tests = [
        test_collect_item_adds_collectible_bp,
        test_collect_item_adds_score_hud,
        test_door_trigger_adds_door_bp,
        test_enemy_patrol_adds_enemy_bp,
        test_enemy_patrol_adds_ai_controller,
        test_enemy_patrol_adds_blackboard,
        test_hide_adds_hiding_spot,
        test_main_menu_adds_widget,
        test_game_over_adds_widget,
    ]

    print("Running player_movement tests...")
    for fn in player_movement_tests:
        fn()
    print("All player_movement tests passed.\n")

    print("Running other mechanic tests (expected to fail with ImportError)...")
    for fn in other_mechanic_tests:
        try:
            fn()
        except ImportError as e:
            print(f"  SKIP  {fn.__name__} (ImportError: {e})")
        except Exception as e:
            print(f"  FAIL  {fn.__name__}: {e}")
    print("Done.")
