# Prompt Interpreter (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the keyword-template `prompt_to_spec()` function with an intent extraction and mechanics assembly pipeline so that generated games reflect what was actually asked for, not a fixed template per genre keyword.

**Architecture:** Two new Python modules in `generation/`: `intent_extractor.py` parses the prompt into an `IntentMap` (actors, mechanics, relationships), and `spec_assembler.py` builds a `BuildSpec` from that IntentMap by composing registered mechanics. Each mechanic is a pure function in `generation/mechanics/` that contributes Blueprints, Widgets, Materials, etc. to the spec. `prompt_to_spec.py` becomes a thin wrapper: extract intent, assemble spec, return. No AI calls -- all deterministic NLP (regex, keyword sets, dependency graphs).

**Tech Stack:** Python 3.7+ dataclasses, regex for NLP, pure Python unit tests (no UE4), existing `spec_schema.py` types, existing `MockUnrealServer` for TypeScript integration tests.

---

## Current State (the problem)

`prompt_to_spec.py` has 5 genre keywords mapped to 3 template functions:
- `puzzle_fighter` -> `_puzzle_fighter_spec()` (684 lines of hardcoded assets)
- `menu_system` -> `_menu_system_spec()` (42 lines)
- `horror`, `platformer`, `inventory` -> `_generic_spec()` (36 lines, 2 Blueprints)

Result: "make a horror game with a flashlight and monster chasing you" produces the same 2 generic Blueprints as "make a platformer." The prompt is ignored beyond genre detection.

## Design Decisions

1. **IntentMap, not LLM.** We parse the prompt with regex and keyword dictionaries. Deterministic, testable, no API keys. The prompt interpreter is a compiler, not a chatbot.

2. **Mechanics are composable.** Each mechanic (player_movement, collect_item, door_trigger, etc.) is a function `(IntentMap, BuildSpec) -> BuildSpec`. They contribute assets independently. A "horror game with collectibles" composes `player_movement` + `collect_item` + `enemy_patrol` + `hide_from_enemy`. A "platformer with coins" composes `player_movement` + `collect_item`.

3. **Relationships are edges.** "Door opens when all coins collected" is a relationship `{subject: "door", verb: "opens", trigger: "all coins collected"}`. The `door_trigger` mechanic reads this relationship and wires a coin-count check into the door Blueprint's graph_json.

4. **Genre = default mechanic set.** Genre detection still exists but now selects a default set of mechanics rather than a monolithic template. Prompt keywords override and extend the defaults.

5. **Backward compatible.** `prompt_to_spec(prompt)` still returns `BuildSpec`. The promptbrush handler and TypeScript tools don't change. Only the guts of `prompt_to_spec.py` change.

6. **Existing templates preserved as fallback.** The puzzle_fighter template is kept as `_puzzle_fighter_spec()` since it's the most complete and well-tested. The new mechanics path handles everything else.

---

## File Map

### New Python files
- `unreal-plugin/Content/Python/mcp_bridge/generation/intent_extractor.py` -- `IntentMap` dataclass, `extract_intent(prompt) -> IntentMap`, NLP helpers
- `unreal-plugin/Content/Python/mcp_bridge/generation/spec_assembler.py` -- `assemble_spec(intent: IntentMap) -> BuildSpec`, mechanic dispatcher
- `unreal-plugin/Content/Python/mcp_bridge/generation/mechanics/__init__.py` -- package marker, `MechanicFn` type alias, `MECHANIC_REGISTRY` dict
- `unreal-plugin/Content/Python/mcp_bridge/generation/mechanics/player_movement.py` -- adds Character BP, PlayerController BP, input mappings
- `unreal-plugin/Content/Python/mcp_bridge/generation/mechanics/collect_item.py` -- adds collectible actor BP, score variable, pickup logic
- `unreal-plugin/Content/Python/mcp_bridge/generation/mechanics/door_trigger.py` -- adds door actor BP, trigger volume, relationship wiring
- `unreal-plugin/Content/Python/mcp_bridge/generation/mechanics/enemy_patrol.py` -- adds enemy BP, AIController, blackboard, patrol BT
- `unreal-plugin/Content/Python/mcp_bridge/generation/mechanics/hide_from_enemy.py` -- adds hiding spot BP, detection variable, stealth state
- `unreal-plugin/Content/Python/mcp_bridge/generation/mechanics/main_menu.py` -- adds main menu widget, game mode with menu state
- `unreal-plugin/Content/Python/mcp_bridge/generation/mechanics/game_over.py` -- adds game over widget, retry/quit buttons

### Modified Python files
- `unreal-plugin/Content/Python/mcp_bridge/generation/prompt_to_spec.py` -- replace body with: extract intent, assemble spec, return
- `unreal-plugin/Content/Python/mcp_bridge/generation/spec_schema.py` -- add `IntentMap`, `ActorIntent`, `MechanicIntent`, `RelationshipIntent` dataclasses

### New Python test files
- `unreal-plugin/Content/Python/tests/test_intent_extractor.py` -- pure Python, no UE4
- `unreal-plugin/Content/Python/tests/test_spec_assembler.py` -- pure Python, no UE4
- `unreal-plugin/Content/Python/tests/test_mechanics.py` -- pure Python, no UE4

### No TypeScript changes
The TypeScript `prompt_generate` tool and `promptbrush.ts` are unchanged. The MCP interface is stable. The only observable difference is that `prompt_to_spec()` returns richer, more prompt-faithful `BuildSpec` objects.

---

## Task 1: IntentMap schema dataclasses

**Files:**
- Modify: `unreal-plugin/Content/Python/mcp_bridge/generation/spec_schema.py`

- [ ] **Step 1: Add IntentMap dataclasses to spec_schema.py**

Append after the `ClassResolutionCache` class (end of file):

```python
# ---------------------------------------------------------------------------
# Phase 2: Prompt Interpreter
# ---------------------------------------------------------------------------

@dataclass
class ActorIntent:
    """An actor/entity extracted from the user's prompt."""
    name: str                    # e.g. "player", "enemy", "door", "coin"
    role: str                    # "player" | "enemy" | "interactable" | "collectible" | "environment"
    qualifiers: List[str] = field(default_factory=list)
    # e.g. ["flying", "patrolling", "locked"]


@dataclass
class MechanicIntent:
    """A gameplay mechanic extracted from the prompt."""
    name: str                    # matches a key in MECHANIC_REGISTRY
    # e.g. "player_movement", "collect_item", "door_trigger", "enemy_patrol"
    params: Dict[str, Any] = field(default_factory=dict)
    # mechanic-specific params, e.g. {"item_name": "coin", "count": 5}


@dataclass
class RelationshipIntent:
    """A causal relationship between game elements."""
    subject: str                 # e.g. "door"
    verb: str                    # e.g. "opens", "spawns", "destroys", "activates"
    trigger: str                 # e.g. "all coins collected", "player enters", "timer expires"
    params: Dict[str, Any] = field(default_factory=dict)


@dataclass
class IntentMap:
    """Structured representation of what the user wants to build."""
    genre: str                   # detected genre
    feature_name: str            # derived from prompt or genre
    description: str             # original prompt
    actors: List[ActorIntent] = field(default_factory=list)
    mechanics: List[MechanicIntent] = field(default_factory=list)
    relationships: List[RelationshipIntent] = field(default_factory=list)
    ui_requests: List[str] = field(default_factory=list)
    # e.g. ["main_menu", "hud", "game_over", "pause_menu"]
```

- [ ] **Step 2: Commit**

```bash
cd d:/UE/UE_Bridge
git add unreal-plugin/Content/Python/mcp_bridge/generation/spec_schema.py
git commit -m "feat(phase2): add IntentMap, ActorIntent, MechanicIntent, RelationshipIntent dataclasses"
```

---

## Task 2: Intent extractor with tests (TDD)

**Files:**
- Create: `unreal-plugin/Content/Python/tests/test_intent_extractor.py`
- Create: `unreal-plugin/Content/Python/mcp_bridge/generation/intent_extractor.py`

The intent extractor parses a natural language prompt into an `IntentMap`. It uses keyword dictionaries and regex -- no AI calls. It must handle prompts like:
- "make a horror game with a flashlight and monster chasing you"
- "build a platformer with coins and a door that opens when all coins are collected"
- "create a simple inventory system"

- [ ] **Step 1: Write the failing tests**

Create `unreal-plugin/Content/Python/tests/test_intent_extractor.py`:

```python
"""Unit tests for intent_extractor -- no UE4 required.

Run: python unreal-plugin/Content/Python/tests/test_intent_extractor.py
"""
import sys
import os

_PYTHON_ROOT = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, _PYTHON_ROOT)

from mcp_bridge.generation.intent_extractor import extract_intent


def _pass(name: str) -> None:
    print(f"  PASS  {name}")


def test_horror_genre_detection() -> None:
    intent = extract_intent("make a horror game with a monster")
    assert intent.genre == "horror", f"expected horror, got {intent.genre}"
    _pass("horror genre detection")


def test_platformer_genre_detection() -> None:
    intent = extract_intent("build a platformer with coins")
    assert intent.genre == "platformer", f"expected platformer, got {intent.genre}"
    _pass("platformer genre detection")


def test_generic_fallback() -> None:
    intent = extract_intent("make something cool")
    assert intent.genre == "generic", f"expected generic, got {intent.genre}"
    _pass("generic fallback")


def test_enemy_actor_extracted() -> None:
    intent = extract_intent("horror game with a monster chasing the player")
    actor_names = [a.name for a in intent.actors]
    assert "enemy" in actor_names or "monster" in actor_names, f"expected enemy/monster in {actor_names}"
    assert "player" in actor_names, f"expected player in {actor_names}"
    _pass("enemy actor extracted")


def test_collectible_detected() -> None:
    intent = extract_intent("platformer with coins to collect")
    mechanic_names = [m.name for m in intent.mechanics]
    assert "collect_item" in mechanic_names, f"expected collect_item in {mechanic_names}"
    _pass("collectible detected")


def test_door_relationship() -> None:
    intent = extract_intent("a door that opens when all coins are collected")
    assert len(intent.relationships) >= 1, f"expected at least 1 relationship, got {len(intent.relationships)}"
    rel = intent.relationships[0]
    assert "door" in rel.subject.lower(), f"expected door in subject, got {rel.subject}"
    assert "open" in rel.verb.lower(), f"expected open in verb, got {rel.verb}"
    _pass("door relationship")


def test_enemy_patrol_mechanic() -> None:
    intent = extract_intent("enemies that patrol around the level")
    mechanic_names = [m.name for m in intent.mechanics]
    assert "enemy_patrol" in mechanic_names, f"expected enemy_patrol in {mechanic_names}"
    _pass("enemy patrol mechanic")


def test_menu_ui_request() -> None:
    intent = extract_intent("game with a main menu and pause screen")
    assert "main_menu" in intent.ui_requests, f"expected main_menu in {intent.ui_requests}"
    assert "pause_menu" in intent.ui_requests, f"expected pause_menu in {intent.ui_requests}"
    _pass("menu UI request")


def test_hide_mechanic() -> None:
    intent = extract_intent("horror game where you hide from the monster")
    mechanic_names = [m.name for m in intent.mechanics]
    assert "hide_from_enemy" in mechanic_names, f"expected hide_from_enemy in {mechanic_names}"
    _pass("hide mechanic")


def test_feature_name_derived() -> None:
    intent = extract_intent("make a horror game")
    assert intent.feature_name != "", f"feature_name should not be empty"
    assert "horror" in intent.feature_name.lower() or "Horror" in intent.feature_name, \
        f"expected horror in feature_name, got {intent.feature_name}"
    _pass("feature name derived")


def test_player_movement_always_present() -> None:
    intent = extract_intent("make a platformer")
    mechanic_names = [m.name for m in intent.mechanics]
    assert "player_movement" in mechanic_names, f"expected player_movement in {mechanic_names}"
    _pass("player_movement always present")


def test_description_preserved() -> None:
    prompt = "build a cool platformer with coins"
    intent = extract_intent(prompt)
    assert intent.description == prompt, f"description should be original prompt"
    _pass("description preserved")


if __name__ == "__main__":
    print("Running intent_extractor tests...")
    test_horror_genre_detection()
    test_platformer_genre_detection()
    test_generic_fallback()
    test_enemy_actor_extracted()
    test_collectible_detected()
    test_door_relationship()
    test_enemy_patrol_mechanic()
    test_menu_ui_request()
    test_hide_mechanic()
    test_feature_name_derived()
    test_player_movement_always_present()
    test_description_preserved()
    print("All intent_extractor tests passed.")
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd d:/UE/UE_Bridge
python unreal-plugin/Content/Python/tests/test_intent_extractor.py
```

Expected: `ModuleNotFoundError` or `ImportError` -- `intent_extractor` does not exist yet.

- [ ] **Step 3: Implement intent_extractor.py**

Create `unreal-plugin/Content/Python/mcp_bridge/generation/intent_extractor.py`:

```python
"""Intent extractor: parse a natural language prompt into an IntentMap.

Deterministic NLP using keyword dictionaries and regex.
No AI calls, no external dependencies beyond stdlib.
"""
from __future__ import annotations
import re
from typing import Dict, List, Set

from mcp_bridge.generation.spec_schema import (
    ActorIntent, IntentMap, MechanicIntent, RelationshipIntent,
)


# ---------------------------------------------------------------------------
# Genre detection -- import from prompt_to_spec to avoid duplication
# ---------------------------------------------------------------------------

from mcp_bridge.generation.prompt_to_spec import GENRE_KEYWORDS, detect_genre as _detect_genre


# ---------------------------------------------------------------------------
# Actor extraction
# ---------------------------------------------------------------------------

# Maps prompt keywords to (actor_name, role)
_ACTOR_KEYWORDS: Dict[str, tuple] = {
    "player": ("player", "player"),
    "character": ("player", "player"),
    "hero": ("player", "player"),
    "monster": ("enemy", "enemy"),
    "enemy": ("enemy", "enemy"),
    "zombie": ("enemy", "enemy"),
    "ghost": ("enemy", "enemy"),
    "creature": ("enemy", "enemy"),
    "boss": ("boss", "enemy"),
    "door": ("door", "interactable"),
    "gate": ("door", "interactable"),
    "chest": ("chest", "interactable"),
    "lever": ("lever", "interactable"),
    "switch": ("switch", "interactable"),
    "button": ("button", "interactable"),
    "coin": ("coin", "collectible"),
    "gem": ("gem", "collectible"),
    "key": ("key", "collectible"),
    "collectible": ("collectible", "collectible"),
    "pickup": ("pickup", "collectible"),
    "star": ("star", "collectible"),
    "flashlight": ("flashlight", "equipment"),
    "weapon": ("weapon", "equipment"),
    "torch": ("torch", "equipment"),
    "light": ("light_source", "environment"),
    "platform": ("platform", "environment"),
    "wall": ("wall", "environment"),
    "trap": ("trap", "environment"),
    "spike": ("spike", "environment"),
}

# Qualifier keywords that modify actors
_QUALIFIER_KEYWORDS: Dict[str, str] = {
    "flying": "flying",
    "patrolling": "patrolling",
    "patrol": "patrolling",
    "locked": "locked",
    "hidden": "hidden",
    "invisible": "invisible",
    "fast": "fast",
    "slow": "slow",
    "big": "large",
    "large": "large",
    "small": "small",
    "chasing": "chasing",
    "chase": "chasing",
}


def _extract_actors(prompt: str) -> List[ActorIntent]:
    lower = prompt.lower()
    seen: Set[str] = set()
    actors: List[ActorIntent] = []

    # Always add player if not explicitly mentioned but a game is being made
    has_player = False

    for keyword, (name, role) in _ACTOR_KEYWORDS.items():
        if keyword in lower and name not in seen:
            seen.add(name)
            # Find qualifiers near this keyword
            qualifiers = []
            for qkw, qval in _QUALIFIER_KEYWORDS.items():
                if qkw in lower:
                    qualifiers.append(qval)
            actors.append(ActorIntent(name=name, role=role, qualifiers=qualifiers))
            if role == "player":
                has_player = True

    if not has_player:
        actors.insert(0, ActorIntent(name="player", role="player"))

    return actors


# ---------------------------------------------------------------------------
# Mechanic extraction
# ---------------------------------------------------------------------------

# Maps prompt keywords to mechanic names
_MECHANIC_KEYWORDS: Dict[str, List[str]] = {
    "collect_item": [
        "collect", "coin", "gem", "pickup", "gather", "find items",
        "collectible", "star", "pick up",
    ],
    "door_trigger": [
        "door", "gate", "opens when", "unlock", "locked door",
    ],
    "enemy_patrol": [
        "patrol", "patrolling", "guard", "wander", "roam",
        "chasing", "chase", "pursue", "pursuit",
    ],
    "hide_from_enemy": [
        "hide", "hiding", "stealth", "sneak", "avoid detection",
        "hide from", "crouch",
    ],
    "main_menu": [
        "main menu", "title screen", "start screen",
    ],
    "game_over": [
        "game over", "death screen", "lose screen", "retry",
    ],
}

# Genre -> default mechanics that are always included
_GENRE_DEFAULT_MECHANICS: Dict[str, List[str]] = {
    "horror": ["player_movement", "enemy_patrol"],
    "platformer": ["player_movement"],
    "inventory": ["player_movement", "collect_item"],
    "menu_system": ["main_menu"],
    "generic": ["player_movement"],
    "puzzle_fighter": [],  # puzzle_fighter uses legacy template
}


def _extract_mechanics(prompt: str, genre: str) -> List[MechanicIntent]:
    lower = prompt.lower()
    mechanic_names: Set[str] = set()

    # Start with genre defaults
    defaults = _GENRE_DEFAULT_MECHANICS.get(genre, ["player_movement"])
    for name in defaults:
        mechanic_names.add(name)

    # Scan for keyword matches
    for mechanic, keywords in _MECHANIC_KEYWORDS.items():
        for kw in keywords:
            if kw in lower:
                mechanic_names.add(mechanic)
                break

    # player_movement is always present unless it's a pure menu/puzzle
    if genre not in ("menu_system", "puzzle_fighter"):
        mechanic_names.add("player_movement")

    return [MechanicIntent(name=name) for name in sorted(mechanic_names)]


# ---------------------------------------------------------------------------
# Relationship extraction
# ---------------------------------------------------------------------------

# Patterns: "<subject> <verb> when <trigger>"
_RELATIONSHIP_PATTERNS = [
    re.compile(
        r"(?:the\s+)?(\w+)\s+(opens?|closes?|unlocks?|activates?|spawns?|destroys?|appears?)"
        r"\s+when\s+(.+?)(?:\.|,|$)",
        re.IGNORECASE,
    ),
    re.compile(
        r"when\s+(.+?),?\s+(?:the\s+)?(\w+)\s+(opens?|closes?|unlocks?|activates?|spawns?)",
        re.IGNORECASE,
    ),
]


def _extract_relationships(prompt: str) -> List[RelationshipIntent]:
    relationships: List[RelationshipIntent] = []
    for pattern in _RELATIONSHIP_PATTERNS:
        for match in pattern.finditer(prompt):
            groups = match.groups()
            if len(groups) == 3:
                # First pattern: subject, verb, trigger
                # Second pattern: trigger, subject, verb
                if pattern == _RELATIONSHIP_PATTERNS[0]:
                    subject, verb, trigger = groups
                else:
                    trigger, subject, verb = groups
                relationships.append(RelationshipIntent(
                    subject=subject.strip(),
                    verb=verb.strip(),
                    trigger=trigger.strip(),
                ))
    return relationships


# ---------------------------------------------------------------------------
# UI request extraction
# ---------------------------------------------------------------------------

_UI_KEYWORDS: Dict[str, List[str]] = {
    "main_menu": ["main menu", "title screen", "start screen", "start menu"],
    "pause_menu": ["pause menu", "pause screen", "pause"],
    "hud": ["hud", "heads up", "score display", "health bar", "status bar"],
    "game_over": ["game over", "death screen", "lose screen", "retry screen"],
    "settings": ["settings menu", "options menu", "settings screen"],
    "inventory_ui": ["inventory screen", "inventory menu", "backpack"],
}

# Genres that imply certain UI by default
_GENRE_DEFAULT_UI: Dict[str, List[str]] = {
    "horror": ["hud"],
    "platformer": ["hud"],
    "inventory": ["hud", "inventory_ui"],
    "menu_system": ["main_menu", "pause_menu", "settings"],
    "generic": [],
    "puzzle_fighter": [],
}


def _extract_ui_requests(prompt: str, genre: str) -> List[str]:
    lower = prompt.lower()
    ui_set: Set[str] = set()

    # Genre defaults
    for name in _GENRE_DEFAULT_UI.get(genre, []):
        ui_set.add(name)

    # Keyword scan
    for ui_name, keywords in _UI_KEYWORDS.items():
        for kw in keywords:
            if kw in lower:
                ui_set.add(ui_name)
                break

    return sorted(ui_set)


# ---------------------------------------------------------------------------
# Feature name derivation
# ---------------------------------------------------------------------------

_GENRE_FEATURE_NAMES: Dict[str, str] = {
    "horror": "Horror",
    "platformer": "Platformer",
    "inventory": "InventorySystem",
    "menu_system": "MenuSystem",
    "puzzle_fighter": "PuzzleFighter",
    "generic": "GeneratedFeature",
}


def _derive_feature_name(prompt: str, genre: str) -> str:
    """Derive a PascalCase feature name from the prompt or genre."""
    return _GENRE_FEATURE_NAMES.get(genre, "GeneratedFeature")


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def extract_intent(prompt: str) -> IntentMap:
    """Parse a natural language prompt into a structured IntentMap.

    Deterministic. No AI calls. Uses keyword dictionaries and regex.
    """
    genre = _detect_genre(prompt)
    actors = _extract_actors(prompt)
    mechanics = _extract_mechanics(prompt, genre)
    relationships = _extract_relationships(prompt)
    ui_requests = _extract_ui_requests(prompt, genre)
    feature_name = _derive_feature_name(prompt, genre)

    return IntentMap(
        genre=genre,
        feature_name=feature_name,
        description=prompt,
        actors=actors,
        mechanics=mechanics,
        relationships=relationships,
        ui_requests=ui_requests,
    )
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd d:/UE/UE_Bridge
python unreal-plugin/Content/Python/tests/test_intent_extractor.py
```

Expected:
```
Running intent_extractor tests...
  PASS  horror genre detection
  PASS  platformer genre detection
  PASS  generic fallback
  PASS  enemy actor extracted
  PASS  collectible detected
  PASS  door relationship
  PASS  enemy patrol mechanic
  PASS  menu UI request
  PASS  hide mechanic
  PASS  feature name derived
  PASS  player_movement always present
  PASS  description preserved
All intent_extractor tests passed.
```

- [ ] **Step 5: Commit**

```bash
cd d:/UE/UE_Bridge
git add unreal-plugin/Content/Python/mcp_bridge/generation/intent_extractor.py \
        unreal-plugin/Content/Python/tests/test_intent_extractor.py \
        unreal-plugin/Content/Python/mcp_bridge/generation/spec_schema.py
git commit -m "feat(phase2): add intent_extractor with NLP parsing and unit tests"
```

---

## Task 3: Mechanics registry

**Files:**
- Create: `unreal-plugin/Content/Python/mcp_bridge/generation/mechanics/__init__.py`

The mechanics registry is a dict mapping mechanic names to functions. Each mechanic function takes `(IntentMap, BuildSpec)` and returns the mutated `BuildSpec`. Mechanics are composed: the assembler calls each one in sequence.

- [ ] **Step 1: Create mechanics package with registry**

Create `unreal-plugin/Content/Python/mcp_bridge/generation/mechanics/__init__.py`:

```python
"""Mechanics registry: composable functions that contribute assets to a BuildSpec.

Each mechanic is a function (IntentMap, BuildSpec) -> BuildSpec.
Mechanics are registered by name and dispatched by spec_assembler.py.
"""
from __future__ import annotations
from typing import Callable, Dict

from mcp_bridge.generation.spec_schema import BuildSpec, IntentMap

MechanicFn = Callable[[IntentMap, BuildSpec], BuildSpec]

MECHANIC_REGISTRY: Dict[str, MechanicFn] = {}


def register_mechanic(name: str) -> Callable[[MechanicFn], MechanicFn]:
    """Decorator to register a mechanic function."""
    def decorator(fn: MechanicFn) -> MechanicFn:
        MECHANIC_REGISTRY[name] = fn
        return fn
    return decorator
```

- [ ] **Step 2: Commit**

```bash
cd d:/UE/UE_Bridge
git add unreal-plugin/Content/Python/mcp_bridge/generation/mechanics/__init__.py
git commit -m "feat(phase2): add mechanics registry with register_mechanic decorator"
```

---

## Task 4: player_movement mechanic (TDD)

**Files:**
- Create: `unreal-plugin/Content/Python/mcp_bridge/generation/mechanics/player_movement.py`
- Create: `unreal-plugin/Content/Python/tests/test_mechanics.py`

- [ ] **Step 1: Write the failing tests**

Create `unreal-plugin/Content/Python/tests/test_mechanics.py`:

```python
"""Unit tests for individual mechanics -- no UE4 required.

Run: python unreal-plugin/Content/Python/tests/test_mechanics.py
"""
import sys
import os

_PYTHON_ROOT = os.path.join(os.path.dirname(__file__), "..")
sys.path.insert(0, _PYTHON_ROOT)

from mcp_bridge.generation.spec_schema import BuildSpec, IntentMap
from mcp_bridge.generation.intent_extractor import extract_intent


def _pass(name: str) -> None:
    print(f"  PASS  {name}")


def _make_spec(prompt: str = "") -> BuildSpec:
    return BuildSpec(feature_name="Test", genre="generic", description=prompt)


def _make_intent(prompt: str = "test game") -> IntentMap:
    return extract_intent(prompt)


# ---------------------------------------------------------------------------
# player_movement
# ---------------------------------------------------------------------------

def test_player_movement_adds_character_bp() -> None:
    from mcp_bridge.generation.mechanics.player_movement import apply_player_movement
    spec = _make_spec()
    intent = _make_intent("make a platformer")
    spec = apply_player_movement(intent, spec)
    bp_names = [b.name for b in spec.blueprints]
    assert any("Character" in n or "Pawn" in n for n in bp_names), \
        f"expected Character/Pawn blueprint, got {bp_names}"
    _pass("player_movement adds character BP")


def test_player_movement_adds_controller() -> None:
    from mcp_bridge.generation.mechanics.player_movement import apply_player_movement
    spec = _make_spec()
    intent = _make_intent("make a horror game")
    spec = apply_player_movement(intent, spec)
    bp_names = [b.name for b in spec.blueprints]
    assert any("PlayerController" in n for n in bp_names), \
        f"expected PlayerController blueprint, got {bp_names}"
    _pass("player_movement adds controller")


def test_player_movement_adds_game_mode() -> None:
    from mcp_bridge.generation.mechanics.player_movement import apply_player_movement
    spec = _make_spec()
    intent = _make_intent("make a game")
    spec = apply_player_movement(intent, spec)
    bp_names = [b.name for b in spec.blueprints]
    assert any("GameMode" in n for n in bp_names), \
        f"expected GameMode blueprint, got {bp_names}"
    _pass("player_movement adds game mode")


def test_player_movement_adds_input_mappings() -> None:
    from mcp_bridge.generation.mechanics.player_movement import apply_player_movement
    spec = _make_spec()
    intent = _make_intent("make a platformer")
    spec = apply_player_movement(intent, spec)
    assert len(spec.input_mappings.action_mappings) > 0 or \
           len(spec.input_mappings.axis_mappings) > 0, \
        "expected input mappings"
    _pass("player_movement adds input mappings")


# ---------------------------------------------------------------------------
# collect_item
# ---------------------------------------------------------------------------

def test_collect_item_adds_collectible_bp() -> None:
    from mcp_bridge.generation.mechanics.collect_item import apply_collect_item
    spec = _make_spec()
    intent = _make_intent("platformer with coins to collect")
    spec = apply_collect_item(intent, spec)
    bp_names = [b.name for b in spec.blueprints]
    assert any("Collect" in n or "Item" in n or "Coin" in n for n in bp_names), \
        f"expected collectible blueprint, got {bp_names}"
    _pass("collect_item adds collectible BP")


def test_collect_item_adds_score_hud() -> None:
    from mcp_bridge.generation.mechanics.collect_item import apply_collect_item
    spec = _make_spec()
    intent = _make_intent("game with coins")
    spec = apply_collect_item(intent, spec)
    widget_names = [w.name for w in spec.widgets]
    assert any("Score" in n or "HUD" in n or "Counter" in n for n in widget_names), \
        f"expected score/HUD widget, got {widget_names}"
    _pass("collect_item adds score HUD")


# ---------------------------------------------------------------------------
# door_trigger
# ---------------------------------------------------------------------------

def test_door_trigger_adds_door_bp() -> None:
    from mcp_bridge.generation.mechanics.door_trigger import apply_door_trigger
    spec = _make_spec()
    intent = _make_intent("game with a door that opens")
    spec = apply_door_trigger(intent, spec)
    bp_names = [b.name for b in spec.blueprints]
    assert any("Door" in n for n in bp_names), \
        f"expected door blueprint, got {bp_names}"
    _pass("door_trigger adds door BP")


# ---------------------------------------------------------------------------
# enemy_patrol
# ---------------------------------------------------------------------------

def test_enemy_patrol_adds_enemy_bp() -> None:
    from mcp_bridge.generation.mechanics.enemy_patrol import apply_enemy_patrol
    spec = _make_spec()
    intent = _make_intent("horror game with enemies")
    spec = apply_enemy_patrol(intent, spec)
    bp_names = [b.name for b in spec.blueprints]
    assert any("Enemy" in n for n in bp_names), \
        f"expected enemy blueprint, got {bp_names}"
    _pass("enemy_patrol adds enemy BP")


def test_enemy_patrol_adds_ai_controller() -> None:
    from mcp_bridge.generation.mechanics.enemy_patrol import apply_enemy_patrol
    spec = _make_spec()
    intent = _make_intent("game with patrolling guards")
    spec = apply_enemy_patrol(intent, spec)
    bp_names = [b.name for b in spec.blueprints]
    assert any("AIController" in n for n in bp_names), \
        f"expected AIController blueprint, got {bp_names}"
    _pass("enemy_patrol adds AI controller")


def test_enemy_patrol_adds_blackboard() -> None:
    from mcp_bridge.generation.mechanics.enemy_patrol import apply_enemy_patrol
    spec = _make_spec()
    intent = _make_intent("game with enemies")
    spec = apply_enemy_patrol(intent, spec)
    assert len(spec.blackboards) > 0, "expected blackboard"
    _pass("enemy_patrol adds blackboard")


# ---------------------------------------------------------------------------
# hide_from_enemy
# ---------------------------------------------------------------------------

def test_hide_adds_hiding_spot() -> None:
    from mcp_bridge.generation.mechanics.hide_from_enemy import apply_hide_from_enemy
    spec = _make_spec()
    intent = _make_intent("horror game where you hide from enemies")
    spec = apply_hide_from_enemy(intent, spec)
    bp_names = [b.name for b in spec.blueprints]
    assert any("Hide" in n or "Hiding" in n for n in bp_names), \
        f"expected hiding spot blueprint, got {bp_names}"
    _pass("hide_from_enemy adds hiding spot")


# ---------------------------------------------------------------------------
# main_menu
# ---------------------------------------------------------------------------

def test_main_menu_adds_widget() -> None:
    from mcp_bridge.generation.mechanics.main_menu import apply_main_menu
    spec = _make_spec()
    intent = _make_intent("game with a main menu")
    spec = apply_main_menu(intent, spec)
    widget_names = [w.name for w in spec.widgets]
    assert any("MainMenu" in n or "Menu" in n for n in widget_names), \
        f"expected main menu widget, got {widget_names}"
    _pass("main_menu adds widget")


# ---------------------------------------------------------------------------
# game_over
# ---------------------------------------------------------------------------

def test_game_over_adds_widget() -> None:
    from mcp_bridge.generation.mechanics.game_over import apply_game_over
    spec = _make_spec()
    intent = _make_intent("game with a game over screen")
    spec = apply_game_over(intent, spec)
    widget_names = [w.name for w in spec.widgets]
    assert any("GameOver" in n for n in widget_names), \
        f"expected game over widget, got {widget_names}"
    _pass("game_over adds widget")


if __name__ == "__main__":
    print("Running mechanics tests...")
    test_player_movement_adds_character_bp()
    test_player_movement_adds_controller()
    test_player_movement_adds_game_mode()
    test_player_movement_adds_input_mappings()
    test_collect_item_adds_collectible_bp()
    test_collect_item_adds_score_hud()
    test_door_trigger_adds_door_bp()
    test_enemy_patrol_adds_enemy_bp()
    test_enemy_patrol_adds_ai_controller()
    test_enemy_patrol_adds_blackboard()
    test_hide_adds_hiding_spot()
    test_main_menu_adds_widget()
    test_game_over_adds_widget()
    print("All mechanics tests passed.")
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd d:/UE/UE_Bridge
python unreal-plugin/Content/Python/tests/test_mechanics.py
```

Expected: `ImportError` for `player_movement`.

- [ ] **Step 3: Implement player_movement.py**

Create `unreal-plugin/Content/Python/mcp_bridge/generation/mechanics/player_movement.py`:

```python
"""player_movement mechanic: adds Character, PlayerController, GameMode, input mappings."""
from __future__ import annotations

from mcp_bridge.generation.spec_schema import (
    BlueprintSpec, BuildSpec, InputMappingSpec, IntentMap, LevelSpec,
)
from mcp_bridge.generation.mechanics import register_mechanic


def _content_path(intent: IntentMap) -> str:
    return f"/Game/Generated/{intent.feature_name}/Gameplay"


def _maps_path(intent: IntentMap) -> str:
    return f"/Game/Generated/{intent.feature_name}/Maps"


def apply_player_movement(intent: IntentMap, spec: BuildSpec) -> BuildSpec:
    """Add player Character, PlayerController, GameMode, and basic input mappings."""
    prefix = f"BP_{intent.feature_name}"
    path = _content_path(intent)

    spec.blueprints.extend([
        BlueprintSpec(
            f"{prefix}_Character", "Character", path,
            components=[
                {"name": "CameraBoom", "class": "SpringArmComponent"},
                {"name": "FollowCamera", "class": "CameraComponent"},
            ],
        ),
        BlueprintSpec(f"{prefix}_PlayerController", "PlayerController", path),
        BlueprintSpec(f"{prefix}_GameMode", "GameModeBase", path),
    ])

    # Default level with PlayerStart
    maps = _maps_path(intent)
    spec.levels.append(LevelSpec(
        f"Map_{intent.feature_name}_Gameplay", maps,
        actors=[
            {"type": "PlayerStart", "name": "PlayerStart",
             "location": {"x": 0, "y": 0, "z": 100}},
            {"type": "DirectionalLight", "name": "MainLight",
             "location": {"x": 0, "y": 0, "z": 500}},
        ],
    ))

    # Genre-appropriate input mappings
    if intent.genre == "platformer":
        spec.input_mappings = InputMappingSpec(
            action_mappings=[
                {"name": "Jump", "key": "SpaceBar"},
            ],
            axis_mappings=[
                {"name": "MoveRight", "key": "D", "scale": 1.0},
                {"name": "MoveRight", "key": "A", "scale": -1.0},
            ],
        )
    else:
        # First/third person defaults
        spec.input_mappings = InputMappingSpec(
            action_mappings=[
                {"name": "Jump", "key": "SpaceBar"},
                {"name": "Interact", "key": "E"},
                {"name": "Sprint", "key": "LeftShift"},
            ],
            axis_mappings=[
                {"name": "MoveForward", "key": "W", "scale": 1.0},
                {"name": "MoveForward", "key": "S", "scale": -1.0},
                {"name": "MoveRight", "key": "D", "scale": 1.0},
                {"name": "MoveRight", "key": "A", "scale": -1.0},
                {"name": "Turn", "key": "MouseX", "scale": 1.0},
                {"name": "LookUp", "key": "MouseY", "scale": -1.0},
            ],
        )

    return spec


# Register with the mechanic registry
register_mechanic("player_movement")(apply_player_movement)
```

- [ ] **Step 4: Run the player_movement tests to verify they pass**

```bash
cd d:/UE/UE_Bridge
python -c "
import sys, os
sys.path.insert(0, 'unreal-plugin/Content/Python')
from tests.test_mechanics import (
    test_player_movement_adds_character_bp,
    test_player_movement_adds_controller,
    test_player_movement_adds_game_mode,
    test_player_movement_adds_input_mappings,
)
test_player_movement_adds_character_bp()
test_player_movement_adds_controller()
test_player_movement_adds_game_mode()
test_player_movement_adds_input_mappings()
print('player_movement tests passed.')
"
```

- [ ] **Step 5: Commit**

```bash
cd d:/UE/UE_Bridge
git add unreal-plugin/Content/Python/mcp_bridge/generation/mechanics/player_movement.py \
        unreal-plugin/Content/Python/tests/test_mechanics.py
git commit -m "feat(phase2): add player_movement mechanic with TDD tests"
```

---

## Task 5: collect_item mechanic

**Files:**
- Create: `unreal-plugin/Content/Python/mcp_bridge/generation/mechanics/collect_item.py`

- [ ] **Step 1: Implement collect_item.py**

```python
"""collect_item mechanic: adds collectible actor, score tracking, pickup HUD."""
from __future__ import annotations

from mcp_bridge.generation.spec_schema import (
    BlueprintSpec, BuildSpec, IntentMap, WidgetSpec,
)
from mcp_bridge.generation.mechanics import register_mechanic


def apply_collect_item(intent: IntentMap, spec: BuildSpec) -> BuildSpec:
    """Add a collectible item actor and a score counter widget."""
    prefix = f"BP_{intent.feature_name}"
    path = f"/Game/Generated/{intent.feature_name}/Gameplay"
    ui = f"/Game/Generated/{intent.feature_name}/UI"

    # Determine item name from actors
    item_name = "Collectible"
    for actor in intent.actors:
        if actor.role == "collectible":
            item_name = actor.name.capitalize()
            break

    spec.blueprints.append(BlueprintSpec(
        f"{prefix}_{item_name}", "Actor", path,
        components=[
            {"name": "ItemMesh", "class": "StaticMeshComponent"},
            {"name": "PickupCollision", "class": "SphereComponent"},
        ],
    ))

    # Score counter widget
    spec.widgets.append(WidgetSpec(
        f"WBP_{intent.feature_name}_ScoreCounter", ui,
        root_widget={
            "type": "CanvasPanel",
            "name": "ScoreRoot",
            "properties": {"visibility": "Visible"},
            "children": [
                {
                    "type": "TextBlock",
                    "name": "ScoreLabel",
                    "properties": {
                        "text": f"{item_name}s: 0",
                        "color": {"r": 1, "g": 1, "b": 1, "a": 1},
                    },
                    "slot": {"position": {"x": 20, "y": 20}, "size": {"x": 200, "y": 40}},
                },
            ],
        },
    ))

    return spec


register_mechanic("collect_item")(apply_collect_item)
```

- [ ] **Step 2: Run collect_item tests**

```bash
cd d:/UE/UE_Bridge
python -c "
import sys; sys.path.insert(0, 'unreal-plugin/Content/Python')
from tests.test_mechanics import test_collect_item_adds_collectible_bp, test_collect_item_adds_score_hud
test_collect_item_adds_collectible_bp()
test_collect_item_adds_score_hud()
print('collect_item tests passed.')
"
```

- [ ] **Step 3: Commit**

```bash
cd d:/UE/UE_Bridge
git add unreal-plugin/Content/Python/mcp_bridge/generation/mechanics/collect_item.py
git commit -m "feat(phase2): add collect_item mechanic"
```

---

## Task 6: door_trigger mechanic

**Files:**
- Create: `unreal-plugin/Content/Python/mcp_bridge/generation/mechanics/door_trigger.py`

- [ ] **Step 1: Implement door_trigger.py**

```python
"""door_trigger mechanic: adds door actor with trigger volume."""
from __future__ import annotations

from mcp_bridge.generation.spec_schema import (
    BlueprintSpec, BuildSpec, IntentMap,
)
from mcp_bridge.generation.mechanics import register_mechanic


def apply_door_trigger(intent: IntentMap, spec: BuildSpec) -> BuildSpec:
    """Add a door actor with trigger volume and optional relationship wiring."""
    prefix = f"BP_{intent.feature_name}"
    path = f"/Game/Generated/{intent.feature_name}/Gameplay"

    spec.blueprints.extend([
        BlueprintSpec(
            f"{prefix}_Door", "Actor", path,
            components=[
                {"name": "DoorMesh", "class": "StaticMeshComponent"},
                {"name": "TriggerVolume", "class": "BoxComponent"},
            ],
            variables=[
                {"name": "bIsOpen", "type": "Boolean", "default": False},
                {"name": "bIsLocked", "type": "Boolean", "default": False},
                {"name": "RequiredKeyCount", "type": "Integer", "default": 0},
            ],
        ),
        BlueprintSpec(
            f"{prefix}_TriggerZone", "Actor", path,
            components=[
                {"name": "TriggerBox", "class": "BoxComponent"},
            ],
        ),
    ])

    return spec


register_mechanic("door_trigger")(apply_door_trigger)
```

- [ ] **Step 2: Run door_trigger test**

```bash
cd d:/UE/UE_Bridge
python -c "
import sys; sys.path.insert(0, 'unreal-plugin/Content/Python')
from tests.test_mechanics import test_door_trigger_adds_door_bp
test_door_trigger_adds_door_bp()
print('door_trigger test passed.')
"
```

- [ ] **Step 3: Commit**

```bash
cd d:/UE/UE_Bridge
git add unreal-plugin/Content/Python/mcp_bridge/generation/mechanics/door_trigger.py
git commit -m "feat(phase2): add door_trigger mechanic"
```

---

## Task 7: enemy_patrol mechanic

**Files:**
- Create: `unreal-plugin/Content/Python/mcp_bridge/generation/mechanics/enemy_patrol.py`

- [ ] **Step 1: Implement enemy_patrol.py**

```python
"""enemy_patrol mechanic: adds enemy Character, AIController, Blackboard, BT."""
from __future__ import annotations

from mcp_bridge.generation.spec_schema import (
    BehaviorTreeSpec, BlackboardSpec, BlueprintSpec, BuildSpec,
    IntentMap, MaterialSpec,
)
from mcp_bridge.generation.mechanics import register_mechanic


def apply_enemy_patrol(intent: IntentMap, spec: BuildSpec) -> BuildSpec:
    """Add enemy character, AI controller, blackboard, and behavior tree."""
    prefix = f"BP_{intent.feature_name}"
    path = f"/Game/Generated/{intent.feature_name}/Gameplay"
    ai_path = f"/Game/Generated/{intent.feature_name}/AI"
    art = f"/Game/Generated/{intent.feature_name}/Art"

    spec.blueprints.extend([
        BlueprintSpec(
            f"{prefix}_Enemy", "Character", path,
            components=[
                {"name": "EnemyMesh", "class": "StaticMeshComponent"},
                {"name": "DetectionSphere", "class": "SphereComponent"},
            ],
        ),
        BlueprintSpec(f"{prefix}_AIController", "AIController", path),
    ])

    # Blackboard
    spec.blackboards.append(BlackboardSpec(
        f"BB_{intent.feature_name}_Enemy", ai_path,
        keys=[
            {"name": "TargetActor", "type": "Object"},
            {"name": "PatrolLocation", "type": "Vector"},
            {"name": "bIsAlerted", "type": "Bool"},
            {"name": "AlertLevel", "type": "Float"},
        ],
    ))

    # Behavior tree (structure only -- Phase 3b will wire actual nodes)
    spec.behavior_trees.append(BehaviorTreeSpec(
        f"BT_{intent.feature_name}_Enemy", ai_path,
        blackboard_path=f"{ai_path}/BB_{intent.feature_name}_Enemy",
        root={
            "type": "Selector",
            "children": [
                {"type": "Sequence", "tasks": [
                    {"type": "BTTask_MoveTo", "params": {"AcceptanceRadius": 100}},
                ]},
                {"type": "Sequence", "tasks": [
                    {"type": "BTTask_Wait", "params": {"WaitTime": 2.0}},
                ]},
            ],
        },
    ))

    # Enemy material
    spec.materials.append(MaterialSpec(
        f"M_{intent.feature_name}_Enemy", art,
        base_color=[0.8, 0.1, 0.1, 1.0],
    ))

    return spec


register_mechanic("enemy_patrol")(apply_enemy_patrol)
```

- [ ] **Step 2: Run enemy_patrol tests**

```bash
cd d:/UE/UE_Bridge
python -c "
import sys; sys.path.insert(0, 'unreal-plugin/Content/Python')
from tests.test_mechanics import (
    test_enemy_patrol_adds_enemy_bp,
    test_enemy_patrol_adds_ai_controller,
    test_enemy_patrol_adds_blackboard,
)
test_enemy_patrol_adds_enemy_bp()
test_enemy_patrol_adds_ai_controller()
test_enemy_patrol_adds_blackboard()
print('enemy_patrol tests passed.')
"
```

- [ ] **Step 3: Commit**

```bash
cd d:/UE/UE_Bridge
git add unreal-plugin/Content/Python/mcp_bridge/generation/mechanics/enemy_patrol.py
git commit -m "feat(phase2): add enemy_patrol mechanic with AI assets"
```

---

## Task 8: hide_from_enemy, main_menu, game_over mechanics

**Files:**
- Create: `unreal-plugin/Content/Python/mcp_bridge/generation/mechanics/hide_from_enemy.py`
- Create: `unreal-plugin/Content/Python/mcp_bridge/generation/mechanics/main_menu.py`
- Create: `unreal-plugin/Content/Python/mcp_bridge/generation/mechanics/game_over.py`

These are smaller mechanics. Grouped into one task since each is straightforward.

- [ ] **Step 1: Implement hide_from_enemy.py**

```python
"""hide_from_enemy mechanic: adds hiding spots and stealth detection."""
from __future__ import annotations

from mcp_bridge.generation.spec_schema import (
    BlueprintSpec, BuildSpec, IntentMap,
)
from mcp_bridge.generation.mechanics import register_mechanic


def apply_hide_from_enemy(intent: IntentMap, spec: BuildSpec) -> BuildSpec:
    """Add hiding spot actors and stealth detection component."""
    prefix = f"BP_{intent.feature_name}"
    path = f"/Game/Generated/{intent.feature_name}/Gameplay"

    spec.blueprints.extend([
        BlueprintSpec(
            f"{prefix}_HidingSpot", "Actor", path,
            components=[
                {"name": "HideMesh", "class": "StaticMeshComponent"},
                {"name": "HideZone", "class": "BoxComponent"},
            ],
            variables=[
                {"name": "bIsOccupied", "type": "Boolean", "default": False},
            ],
        ),
    ])

    return spec


register_mechanic("hide_from_enemy")(apply_hide_from_enemy)
```

- [ ] **Step 2: Implement main_menu.py**

```python
"""main_menu mechanic: adds main menu widget and menu game mode."""
from __future__ import annotations

from mcp_bridge.generation.spec_schema import (
    BlueprintSpec, BuildSpec, IntentMap, LevelSpec, WidgetSpec,
)
from mcp_bridge.generation.mechanics import register_mechanic


def apply_main_menu(intent: IntentMap, spec: BuildSpec) -> BuildSpec:
    """Add main menu widget, menu game mode, and menu level."""
    prefix = f"BP_{intent.feature_name}"
    path = f"/Game/Generated/{intent.feature_name}/Gameplay"
    ui = f"/Game/Generated/{intent.feature_name}/UI"
    maps = f"/Game/Generated/{intent.feature_name}/Maps"

    # Menu game mode (separate from gameplay game mode)
    spec.blueprints.append(BlueprintSpec(
        f"{prefix}_MenuGameMode", "GameModeBase", path,
    ))

    # Main menu widget
    spec.widgets.append(WidgetSpec(
        f"WBP_{intent.feature_name}_MainMenu", ui,
        root_widget={
            "type": "CanvasPanel",
            "name": "MainMenuRoot",
            "properties": {"visibility": "Visible"},
            "children": [
                {
                    "type": "TextBlock",
                    "name": "GameTitle",
                    "properties": {
                        "text": intent.feature_name.upper(),
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
                            "children": [{"type": "TextBlock", "name": "PlayText",
                                          "properties": {"text": "Play Game",
                                                         "color": {"r": 1, "g": 1, "b": 1, "a": 1}}}],
                        },
                        {
                            "type": "Button",
                            "name": "QuitButton",
                            "children": [{"type": "TextBlock", "name": "QuitText",
                                          "properties": {"text": "Quit",
                                                         "color": {"r": 1, "g": 1, "b": 1, "a": 1}}}],
                        },
                    ],
                },
            ],
        },
    ))

    # Menu level
    spec.levels.append(LevelSpec(
        f"Map_{intent.feature_name}_MainMenu", maps,
        actors=[
            {"type": "DirectionalLight", "name": "MenuLight",
             "location": {"x": 0, "y": 0, "z": 500}},
        ],
    ))

    return spec


register_mechanic("main_menu")(apply_main_menu)
```

- [ ] **Step 3: Implement game_over.py**

```python
"""game_over mechanic: adds game over widget with retry/quit buttons."""
from __future__ import annotations

from mcp_bridge.generation.spec_schema import (
    BuildSpec, IntentMap, WidgetSpec,
)
from mcp_bridge.generation.mechanics import register_mechanic


def apply_game_over(intent: IntentMap, spec: BuildSpec) -> BuildSpec:
    """Add game over screen widget."""
    ui = f"/Game/Generated/{intent.feature_name}/UI"

    spec.widgets.append(WidgetSpec(
        f"WBP_{intent.feature_name}_GameOver", ui,
        root_widget={
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
                    "type": "Button",
                    "name": "RetryButton",
                    "slot": {"position": {"x": 400, "y": 450}, "size": {"x": 200, "y": 60}},
                    "children": [
                        {"type": "TextBlock", "name": "RetryText",
                         "properties": {"text": "Retry",
                                        "color": {"r": 1, "g": 1, "b": 1, "a": 1}}},
                    ],
                },
                {
                    "type": "Button",
                    "name": "QuitButton",
                    "slot": {"position": {"x": 400, "y": 530}, "size": {"x": 200, "y": 60}},
                    "children": [
                        {"type": "TextBlock", "name": "QuitText",
                         "properties": {"text": "Quit",
                                        "color": {"r": 1, "g": 1, "b": 1, "a": 1}}},
                    ],
                },
            ],
        },
    ))

    return spec


register_mechanic("game_over")(apply_game_over)
```

- [ ] **Step 4: Run all mechanics tests**

```bash
cd d:/UE/UE_Bridge
python unreal-plugin/Content/Python/tests/test_mechanics.py
```

Expected:
```
Running mechanics tests...
  PASS  player_movement adds character BP
  PASS  player_movement adds controller
  PASS  player_movement adds game mode
  PASS  player_movement adds input mappings
  PASS  collect_item adds collectible BP
  PASS  collect_item adds score HUD
  PASS  door_trigger adds door BP
  PASS  enemy_patrol adds enemy BP
  PASS  enemy_patrol adds AI controller
  PASS  enemy_patrol adds blackboard
  PASS  hide_from_enemy adds hiding spot
  PASS  main_menu adds widget
  PASS  game_over adds widget
All mechanics tests passed.
```

- [ ] **Step 5: Commit**

```bash
cd d:/UE/UE_Bridge
git add unreal-plugin/Content/Python/mcp_bridge/generation/mechanics/hide_from_enemy.py \
        unreal-plugin/Content/Python/mcp_bridge/generation/mechanics/main_menu.py \
        unreal-plugin/Content/Python/mcp_bridge/generation/mechanics/game_over.py
git commit -m "feat(phase2): add hide_from_enemy, main_menu, game_over mechanics"
```

---

## Task 9: Spec assembler with tests (TDD)

**Files:**
- Create: `unreal-plugin/Content/Python/tests/test_spec_assembler.py`
- Create: `unreal-plugin/Content/Python/mcp_bridge/generation/spec_assembler.py`

The assembler takes an `IntentMap` and dispatches registered mechanics to build a `BuildSpec`.

- [ ] **Step 1: Write the failing tests**

Create `unreal-plugin/Content/Python/tests/test_spec_assembler.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd d:/UE/UE_Bridge
python unreal-plugin/Content/Python/tests/test_spec_assembler.py
```

Expected: `ImportError` for `spec_assembler`.

- [ ] **Step 3: Implement spec_assembler.py**

Create `unreal-plugin/Content/Python/mcp_bridge/generation/spec_assembler.py`:

```python
"""Spec assembler: compose mechanics into a BuildSpec from an IntentMap.

This is the core of Phase 2. It replaces the monolithic genre templates
with composable mechanic functions.
"""
from __future__ import annotations
import importlib
import pkgutil
from typing import List

from mcp_bridge.generation.spec_schema import BuildSpec, IntentMap

# Auto-discover and import all mechanic modules to trigger @register_mechanic
import mcp_bridge.generation.mechanics as _mechanics_pkg
from mcp_bridge.generation.mechanics import MECHANIC_REGISTRY

for _importer, _modname, _ispkg in pkgutil.iter_modules(_mechanics_pkg.__path__):
    importlib.import_module(f"mcp_bridge.generation.mechanics.{_modname}")


def assemble_spec(intent: IntentMap) -> BuildSpec:
    """Build a complete BuildSpec by composing registered mechanics.

    Each mechanic in intent.mechanics is looked up in MECHANIC_REGISTRY
    and called with (intent, spec). Unknown mechanics are skipped with
    a warning in acceptance_tests.
    """
    spec = BuildSpec(
        feature_name=intent.feature_name,
        genre=intent.genre,
        description=intent.description,
    )

    skipped: List[str] = []

    for mechanic in intent.mechanics:
        fn = MECHANIC_REGISTRY.get(mechanic.name)
        if fn is None:
            skipped.append(mechanic.name)
            continue
        spec = fn(intent, spec)

    # Generate acceptance tests from the assembled spec
    spec.acceptance_tests = _generate_acceptance_tests(spec, skipped)

    return spec


def _generate_acceptance_tests(spec: BuildSpec, skipped: List[str]) -> List[str]:
    """Auto-generate acceptance test descriptions from the spec contents."""
    tests: List[str] = []

    if spec.blueprints:
        tests.append(f"All {len(spec.blueprints)} Blueprint assets exist and compiled")
    if spec.widgets:
        tests.append(f"All {len(spec.widgets)} Widget assets exist")
    if spec.materials:
        tests.append(f"All {len(spec.materials)} materials exist")
    if spec.data_assets:
        tests.append(f"All {len(spec.data_assets)} data assets exist")
    if spec.levels:
        tests.append(f"All {len(spec.levels)} maps exist")
    if spec.input_mappings.action_mappings or spec.input_mappings.axis_mappings:
        tests.append("Input mappings written to DefaultInput.ini")
    if spec.blackboards:
        for bb in spec.blackboards:
            tests.append(f"{bb.name} blackboard exists")
    if spec.behavior_trees:
        for bt in spec.behavior_trees:
            tests.append(f"{bt.name} behavior tree exists")

    for name in skipped:
        tests.append(f"WARNING: mechanic '{name}' was not found in registry")

    return tests
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd d:/UE/UE_Bridge
python unreal-plugin/Content/Python/tests/test_spec_assembler.py
```

Expected:
```
Running spec_assembler tests...
  PASS  horror game has enemy and player
  PASS  platformer with coins
  PASS  assembler preserves description
  PASS  assembler sets feature_name
  PASS  unknown mechanic skipped
  PASS  acceptance tests generated
  PASS  horror with hiding
  PASS  full menu game
All spec_assembler tests passed.
```

- [ ] **Step 5: Commit**

```bash
cd d:/UE/UE_Bridge
git add unreal-plugin/Content/Python/mcp_bridge/generation/spec_assembler.py \
        unreal-plugin/Content/Python/tests/test_spec_assembler.py
git commit -m "feat(phase2): add spec_assembler that composes mechanics into BuildSpec"
```

---

## Task 10: Rewire prompt_to_spec.py

**Files:**
- Modify: `unreal-plugin/Content/Python/mcp_bridge/generation/prompt_to_spec.py`

This is the integration point. `prompt_to_spec()` now calls `extract_intent()` then `assemble_spec()`. The puzzle_fighter template is preserved as a special case since it's the most complete and well-tested.

- [ ] **Step 1: Write an integration test**

Add to the end of `test_spec_assembler.py` (before the `if __name__` block):

```python
def test_prompt_to_spec_end_to_end() -> None:
    """Verify the full pipeline works through prompt_to_spec()."""
    from mcp_bridge.generation.prompt_to_spec import prompt_to_spec
    spec = prompt_to_spec("make a horror game with a monster and hiding spots")
    assert spec.genre == "horror"
    bp_names = [b.name for b in spec.blueprints]
    assert any("Character" in n for n in bp_names), f"no character: {bp_names}"
    assert any("Enemy" in n for n in bp_names), f"no enemy: {bp_names}"
    assert any("Hiding" in n or "Hide" in n for n in bp_names), f"no hiding: {bp_names}"
    _pass("prompt_to_spec end-to-end")


def test_puzzle_fighter_preserved() -> None:
    """puzzle_fighter genre still uses the legacy template."""
    from mcp_bridge.generation.prompt_to_spec import prompt_to_spec
    spec = prompt_to_spec("make a puzzle fighter game")
    assert spec.genre == "puzzle_fighter"
    assert len(spec.blueprints) >= 15, f"puzzle_fighter should have many BPs, got {len(spec.blueprints)}"
    _pass("puzzle_fighter preserved")


def test_menu_system_regression() -> None:
    """menu_system genre produces at least a main menu widget and game mode."""
    from mcp_bridge.generation.prompt_to_spec import prompt_to_spec
    spec = prompt_to_spec("make a menu system")
    widget_names = [w.name for w in spec.widgets]
    bp_names = [b.name for b in spec.blueprints]
    assert any("MainMenu" in n or "Menu" in n for n in widget_names), \
        f"expected main menu widget, got {widget_names}"
    assert any("GameMode" in n for n in bp_names), \
        f"expected game mode BP, got {bp_names}"
    _pass("menu_system regression")
```

Also add these to the `__main__` block:

```python
    test_prompt_to_spec_end_to_end()
    test_puzzle_fighter_preserved()
    test_menu_system_regression()
```

- [ ] **Step 2: Replace prompt_to_spec.py body**

Replace the content of `prompt_to_spec.py`. Keep the `_puzzle_fighter_spec` function and all widget tree helpers, but replace the `prompt_to_spec()` function and remove `_generic_spec` and `_menu_system_spec`:

The new `prompt_to_spec()` function at the bottom of the file should be:

```python
def prompt_to_spec(prompt: str) -> BuildSpec:
    """Convert a natural language prompt to a BuildSpec.

    Phase 2: uses intent extraction + mechanic composition for all genres
    except puzzle_fighter, which retains its legacy template.
    """
    genre = detect_genre(prompt)

    # puzzle_fighter has the most complete legacy template -- keep it
    if genre == "puzzle_fighter":
        return _puzzle_fighter_spec(prompt)

    # All other genres go through the Phase 2 pipeline
    from mcp_bridge.generation.intent_extractor import extract_intent
    from mcp_bridge.generation.spec_assembler import assemble_spec
    intent = extract_intent(prompt)
    return assemble_spec(intent)
```

Remove `_generic_spec()` and `_menu_system_spec()` functions (they are replaced by mechanics composition). Keep `detect_genre()`, `GENRE_KEYWORDS`, `_puzzle_fighter_spec()`, and all `_*_widget_tree()` helpers (puzzle_fighter still uses them).

- [ ] **Step 3: Run integration test**

```bash
cd d:/UE/UE_Bridge
python unreal-plugin/Content/Python/tests/test_spec_assembler.py
```

Expected: All tests pass including the two new ones.

- [ ] **Step 4: Run all Python tests**

```bash
cd d:/UE/UE_Bridge
python unreal-plugin/Content/Python/tests/test_pie_test_spec.py
python unreal-plugin/Content/Python/tests/test_intent_extractor.py
python unreal-plugin/Content/Python/tests/test_mechanics.py
python unreal-plugin/Content/Python/tests/test_spec_assembler.py
```

Expected: All 4 test files pass.

- [ ] **Step 5: Commit**

```bash
cd d:/UE/UE_Bridge
git add unreal-plugin/Content/Python/mcp_bridge/generation/prompt_to_spec.py \
        unreal-plugin/Content/Python/tests/test_spec_assembler.py
git commit -m "feat(phase2): rewire prompt_to_spec to use intent extraction + mechanic composition"
```

---

## Task 11: TypeScript build and full test suite

**Files:**
- No new files. Verify the full stack still works.

No TypeScript changes are needed -- the MCP interface is stable. But we should verify the build and all tests still pass.

- [ ] **Step 1: Build TypeScript**

```bash
cd d:/UE/UE_Bridge
npm run build
```

Expected: No errors.

- [ ] **Step 2: Run full npm test suite**

```bash
cd d:/UE/UE_Bridge
npm test
```

Expected: All 4 test files pass (actor-tools, level-viewport-tools, material-blueprint-tools, gameplay-tools).

- [ ] **Step 3: Run all Python tests**

```bash
cd d:/UE/UE_Bridge
python unreal-plugin/Content/Python/tests/test_pie_test_spec.py && \
python unreal-plugin/Content/Python/tests/test_intent_extractor.py && \
python unreal-plugin/Content/Python/tests/test_mechanics.py && \
python unreal-plugin/Content/Python/tests/test_spec_assembler.py
```

Expected: All pass.

- [ ] **Step 4: Commit (if any fixes were needed)**

Only run this step if fixes were actually needed. Skip if everything passed clean.
Stage only the specific files you fixed -- do not use `git add -A`.

```bash
cd d:/UE/UE_Bridge
git add <specific-files-you-changed>
git commit -m "fix(phase2): post-integration fixes"
```

---

## Task 12: Manual integration smoke test (requires UE4 running)

Skip if UE4 is not running. Tests the full prompt_generate -> asset creation path.

- [ ] **Step 1: Verify listener is alive**

```bash
curl -s -X POST http://localhost:8080/ -H "Content-Type: application/json" \
  -d "{\"command\":\"ping\",\"params\":{}}" | python -m json.tool
```

- [ ] **Step 2: Dry-run a horror prompt**

```bash
curl -s -X POST http://localhost:8080/ -H "Content-Type: application/json" \
  -d "{\"command\":\"prompt_generate\",\"params\":{\"prompt\":\"make a horror game with a monster chasing you and hiding spots\",\"dry_run\":true}}" | python -m json.tool
```

Expected: Returns a spec with Character, Enemy, HidingSpot BPs, blackboard, behavior tree, and materials. Genre should be "horror". Feature name "Horror".

- [ ] **Step 3: Dry-run a platformer prompt**

```bash
curl -s -X POST http://localhost:8080/ -H "Content-Type: application/json" \
  -d "{\"command\":\"prompt_generate\",\"params\":{\"prompt\":\"build a platformer with coins to collect and a door that opens when all coins are collected\",\"dry_run\":true}}" | python -m json.tool
```

Expected: Character, Coin/Collectible, Door BPs. Genre "platformer". ScoreCounter widget. At least one relationship.

- [ ] **Step 4: Full generation (creates assets in UE4)**

```bash
curl -s -X POST http://localhost:8080/ -H "Content-Type: application/json" \
  -d "{\"command\":\"prompt_generate\",\"params\":{\"prompt\":\"make a horror game with a monster\"}}" | python -m json.tool
```

Expected: Assets created, blueprints compiled, manifest written. Check `succeeded` vs `failed` counts.

---

## Definition of Done (offline-testable)

1. `python unreal-plugin/Content/Python/tests/test_intent_extractor.py` -- all 12 tests pass
2. `python unreal-plugin/Content/Python/tests/test_mechanics.py` -- all 13 tests pass
3. `python unreal-plugin/Content/Python/tests/test_spec_assembler.py` -- all 11 tests pass
4. `npm run build` -- no TypeScript errors
5. `npm test` -- all 4 test files pass (existing tests unbroken)
6. `prompt_to_spec("make a horror game with a monster")` produces a BuildSpec with Character, Enemy, AIController, Blackboard, BT
7. `prompt_to_spec("make a puzzle fighter")` still uses the legacy template (backward compatible)
8. `prompt_to_spec("platformer with coins")` produces Character + Collectible + ScoreCounter widget

**With UE4 running (not required for merge):**

9. `prompt_generate` dry_run returns enriched spec for any genre
10. Full `prompt_generate` creates assets without errors

---

## Phase handoff

After Phase 2 is merged:

- **Phase 3a** (Timelines) -- independent, can start anytime
- **Phase 3b** (Behavior Tree Node Graphs) -- independent, will populate the empty BT structures that enemy_patrol creates
- **Phase 3c** (Anim Blueprint State Machines) -- independent
- **Phase 4** (Repair Engine) -- depends on Phase 1 (already merged), not Phase 2
- New mechanics: create a file in `generation/mechanics/`, use `@register_mechanic`, and add keywords to `_MECHANIC_KEYWORDS` in `intent_extractor.py`. The spec_assembler auto-discovers new mechanic modules via `pkgutil`, so no changes needed there.
