# Skill: create_blueprint_asset

Create a Blueprint asset in UE4.27 via Python.

## MCP command
```json
{
  "command": "blueprint_create",
  "params": {
    "name": "BP_MyActor",
    "path": "/Game/Generated/Gameplay",
    "parent_class": "Actor",
    "components": [
      { "name": "MeshComp", "class": "StaticMeshComponent" }
    ]
  }
}
```

## Direct Python (generation pipeline)
```python
from generation.blueprint_generator import generate_blueprint
from generation.spec_schema import BlueprintSpec

spec = BlueprintSpec(
    name="BP_MyActor",
    parent_class="Actor",
    content_path="/Game/Generated/Gameplay",
    components=[{"name": "MeshComp", "class": "StaticMeshComponent"}],
)
ok, err, data = generate_blueprint(spec)
```

## Supported parent classes
Actor, Pawn, Character, PlayerController, GameModeBase, GameMode,
GameStateBase, HUD, AIController, GameInstance, ActorComponent,
SceneComponent, SaveGame, PlayerState

## Supported component classes
StaticMeshComponent, SkeletalMeshComponent, BoxComponent, SphereComponent,
CapsuleComponent, SceneComponent, ArrowComponent, AudioComponent,
ParticleSystemComponent, SpotLightComponent, PointLightComponent,
SpringArmComponent, CameraComponent, FloatingPawnMovement,
CharacterMovementComponent, ProjectileMovementComponent

## Error handling
- "Asset already exists" -- asset at path already exists, use `skipped: true` path
- "Unknown parent class" -- check getattr(unreal, class_name)
- "Failed to create Blueprint" -- check path starts with /Game/, directory writable
- Compile failure -- non-fatal, check generated_class after compile

## Idempotency
generate_blueprint() checks does_asset_exist() before creating. Re-running is safe.
