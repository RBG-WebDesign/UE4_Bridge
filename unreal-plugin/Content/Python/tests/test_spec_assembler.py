"""Unit tests for spec_assembler -- no UE4 required.

Run: python unreal-plugin/Content/Python/tests/test_spec_assembler.py
"""
import sys
import os

_PYTHON_ROOT = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, _PYTHON_ROOT)

from mcp_bridge.generation.intent_extractor import extract_intent
from mcp_bridge.generation.spec_assembler import assemble_spec


def _pass(name: str) -> None:
    print(f"  PASS  {name}")


def test_horror_game_has_enemy_and_player() -> None:
    intent = extract_intent("make a horror game with a monster chasing you")
    spec = assemble_spec(intent)
    bp_names = [b.name for b in spec.blueprints]
    assert any("Character" in n for n in bp_names), f"no Character BP in {bp_names}"
    assert any("Enemy" in n for n in bp_names), f"no Enemy BP in {bp_names}"
    assert spec.genre == "horror"
    _pass("horror game has enemy and player")


def test_platformer_with_coins() -> None:
    intent = extract_intent("build a platformer with coins to collect")
    spec = assemble_spec(intent)
    bp_names = [b.name for b in spec.blueprints]
    assert any("Character" in n for n in bp_names), f"no Character BP in {bp_names}"
    assert any("Coin" in n or "Collect" in n for n in bp_names), f"no collectible BP in {bp_names}"
    widget_names = [w.name for w in spec.widgets]
    assert any("Score" in n or "Counter" in n for n in widget_names), f"no score widget in {widget_names}"
    _pass("platformer with coins")


def test_assembler_preserves_description() -> None:
    prompt = "make a cool game"
    intent = extract_intent(prompt)
    spec = assemble_spec(intent)
    assert spec.description == prompt
    _pass("assembler preserves description")


def test_assembler_sets_feature_name() -> None:
    intent = extract_intent("horror game")
    spec = assemble_spec(intent)
    assert spec.feature_name != ""
    _pass("assembler sets feature_name")


def test_unknown_mechanic_skipped() -> None:
    """If a mechanic name is not in the registry, it should be skipped, not crash."""
    from mcp_bridge.generation.spec_schema import IntentMap, MechanicIntent
    intent = IntentMap(
        genre="generic",
        feature_name="Test",
        description="test",
        mechanics=[MechanicIntent(name="nonexistent_mechanic")],
    )
    spec = assemble_spec(intent)  # should not raise
    assert spec is not None
    _pass("unknown mechanic skipped")


def test_acceptance_tests_generated() -> None:
    intent = extract_intent("make a platformer with coins")
    spec = assemble_spec(intent)
    assert len(spec.acceptance_tests) > 0, "expected acceptance_tests"
    _pass("acceptance tests generated")


def test_horror_with_hiding() -> None:
    intent = extract_intent("horror game where you hide from the monster")
    spec = assemble_spec(intent)
    bp_names = [b.name for b in spec.blueprints]
    assert any("Hiding" in n or "Hide" in n for n in bp_names), f"no hiding spot in {bp_names}"
    assert any("Enemy" in n for n in bp_names), f"no enemy in {bp_names}"
    _pass("horror with hiding")


def test_full_menu_game() -> None:
    intent = extract_intent("game with main menu, pause screen, and game over")
    spec = assemble_spec(intent)
    widget_names = [w.name for w in spec.widgets]
    assert any("MainMenu" in n for n in widget_names), f"no main menu in {widget_names}"
    assert any("GameOver" in n for n in widget_names), f"no game over in {widget_names}"
    _pass("full menu game")


if __name__ == "__main__":
    print("Running spec_assembler tests...")
    test_horror_game_has_enemy_and_player()
    test_platformer_with_coins()
    test_assembler_preserves_description()
    test_assembler_sets_feature_name()
    test_unknown_mechanic_skipped()
    test_acceptance_tests_generated()
    test_horror_with_hiding()
    test_full_menu_game()
    print("All spec_assembler tests passed.")
