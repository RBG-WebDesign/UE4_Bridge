# Widget Blueprint Builder -- Pass 7: Build-Time Animations (Opacity v1)

## Objective

Add build-time widget animations to the Widget Blueprint Builder. Animations are defined in JSON, baked into the Widget Blueprint as `UWidgetAnimation` objects, and playable via `PlayAnimation()` in Blueprint. No runtime system required.

Pass 7 implements **opacity tracks only**. The JSON schema and class architecture support translation and scale tracks in future passes without redesign.

## Motivation

QTE prompts, title screens, and cinematic UI all need fade in/out behavior. Without animations baked into the widget blueprint, gameplay code has no way to trigger visual transitions. This pass makes built widgets self-contained: the tree AND its animations ship together in one asset.

## Scope

### Implement in Pass 7

- Opacity animation tracks (RenderOpacity)
- Single target widget per animation
- Linear interpolation (two keyframes: start and end)
- Duration-based playback (seconds)
- JSON parsing, validation, and MovieScene construction

### Do NOT implement

- Translation tracks (future pass)
- Scale tracks (future pass)
- Easing curves
- Multiple targets per animation
- Keyframe arrays (>2 keys)
- Looping, delays, reverse playback

## JSON Schema

Top-level `animations` array, sibling to `root`:

```json
{
  "root": { ... },
  "animations": [
    {
      "name": "FadeIn",
      "target": "QTEText",
      "duration": 0.25,
      "tracks": [
        {
          "type": "opacity",
          "from": 0.0,
          "to": 1.0
        }
      ]
    }
  ]
}
```

### Field definitions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `animations` | array | No | Top-level, sibling to `root`. Omit if no animations. |
| `name` | string | Yes | Animation name. Must be unique within the blueprint. |
| `target` | string | Yes | Widget name. Must match a widget in the tree. |
| `duration` | number | Yes | Playback duration in seconds. Must be > 0. |
| `tracks` | array | Yes | At least one track. |
| `tracks[].type` | string | Yes | Track type. v1 supports `"opacity"` only. |
| `tracks[].from` | number | Yes (opacity) | Start value. Must be in [0, 1] (rejected if out of range). |
| `tracks[].to` | number | Yes (opacity) | End value. Must be in [0, 1] (rejected if out of range). |

### Valid top-level keys

Add `"animations"` to the existing set: `{ "root", "animations" }`.

Unknown top-level keys remain a parse error.

## Spec Structs

### New structs (add to WidgetBlueprintSpec.h)

```cpp
struct FWidgetAnimationTrackSpec
{
    FString Type;  // "opacity" (v1), "translation", "scale" (future)

    // Opacity track data (v1)
    float FromOpacity = 0.0f;
    float ToOpacity = 1.0f;
    bool bHasOpacityData = false;
};

struct FWidgetAnimationSpec
{
    FString Name;
    FString Target;
    float Duration = 0.0f;
    TArray<FWidgetAnimationTrackSpec> Tracks;
};
```

### Extend FWidgetBlueprintSpec

```cpp
struct FWidgetBlueprintSpec
{
    FWidgetNodeSpec Root;
    TArray<FWidgetAnimationSpec> Animations;  // NEW
};
```

### Design note: typed fields vs raw JSON

Track data uses typed fields (`FromOpacity`, `ToOpacity`) rather than storing raw `TSharedPtr<FJsonObject>`. This keeps validation and construction code clean. Future track types (translation, scale) add their own typed fields to `FWidgetAnimationTrackSpec` with corresponding `bHas*` presence flags, following the same pattern as `FWidgetSlotSpec`.

## New Class: FWidgetAnimationBuilder

File pair: `WidgetBuilder/WidgetAnimationBuilder.h` and `.cpp`

```cpp
class FWidgetAnimationBuilder
{
public:
    bool BuildAnimations(
        UWidgetBlueprint* WidgetBP,
        const TArray<FWidgetAnimationSpec>& Animations,
        FString& OutError
    );

private:
    bool BuildSingleAnimation(
        UWidgetBlueprint* WidgetBP,
        const FWidgetAnimationSpec& AnimSpec,
        FString& OutError
    );

    bool BuildOpacityTrack(
        UMovieScene* MovieScene,
        const FGuid& BindingGuid,
        const FWidgetAnimationTrackSpec& Track,
        FFrameNumber DurationFrames,
        const FString& AnimName,
        FString& OutError
    );
};
```

## Build Flow Integration

In `FWidgetBlueprintBuilder::Build()` and `::Rebuild()`, insert animation building AFTER tree construction, BEFORE finalize:

```
Parse -> Validate -> Create Asset -> Clear Tree -> Build Tree -> Assign Root
-> BUILD ANIMATIONS (new)
-> Finalize
```

For Rebuild: clear existing animations alongside tree clearing (in the reset phase, before tree build):

```cpp
WidgetBP->Animations.Empty();
```

### No Python/TypeScript changes needed

The `blueprint_build_from_json` MCP tool passes raw JSON strings through to the C++ layer. Since the C++ parser handles the new `animations` field, no Python handler or MCP server changes are required. The JSON passes through opaquely.

## Implementation Steps (per animation)

### Step 1: Create UWidgetAnimation

```cpp
UWidgetAnimation* Anim = NewObject<UWidgetAnimation>(WidgetBP, FName(*AnimSpec.Name));
UMovieScene* MovieScene = NewObject<UMovieScene>(Anim);
Anim->MovieScene = MovieScene;
```

### Step 2: Set playback range

```cpp
FFrameRate TickResolution = MovieScene->GetTickResolution();
FFrameNumber EndFrame = (AnimSpec.Duration * TickResolution).FloorToFrame();
// Minimum 1 frame -- prevents degenerate animations from very small durations
EndFrame = FMath::Max(EndFrame, FFrameNumber(1));
MovieScene->SetPlaybackRange(FFrameNumber(0), EndFrame.Value);
```

Time conversion note: UE4.27 MovieScene uses frame numbers internally. `GetTickResolution()` returns the tick resolution (typically 24000 fps). Multiply duration in seconds by tick resolution to get frame numbers. Minimum duration resolves to at least 1 frame.

### Step 3: Bind widget

Implementation must use `FWidgetAnimationBinding`. This is the UMG-native binding system. Do not mix with MovieScene possessable bindings.

```cpp
FWidgetAnimationBinding Binding;
Binding.WidgetName = FName(*AnimSpec.Target);
Binding.AnimationGuid = FGuid::NewGuid();
Anim->AnimationBindings.Add(Binding);
```

If engine access prevents direct `FWidgetAnimationBinding` use (private fields, missing headers), switch the entire implementation to MovieScene possessables as a documented alternate path. Do not mix both systems -- pick one and commit.

Fallback (alternate implementation, not runtime fallback):

```cpp
FGuid Guid = MovieScene->AddPossessable(AnimSpec.Target, UWidget::StaticClass());
```

### Step 4: Create opacity track

```cpp
UMovieSceneFloatTrack* Track = MovieScene->AddTrack<UMovieSceneFloatTrack>(BindingGuid);
Track->SetPropertyNameAndPath(TEXT("RenderOpacity"), TEXT("RenderOpacity"));
```

The property path MUST be `"RenderOpacity"` exactly. Without `SetPropertyNameAndPath`, the track exists but nothing animates.

### Step 5: Create section with keyframes

```cpp
UMovieSceneFloatSection* Section = Cast<UMovieSceneFloatSection>(Track->CreateNewSection());
Track->AddSection(*Section);
// +1 because UE4 section ranges are half-open: [start, end)
Section->SetRange(TRange<FFrameNumber>(FFrameNumber(0), FFrameNumber(EndFrame.Value + 1)));

// Add keys -- try AddLinearKey first, fall back to direct key manipulation
FMovieSceneFloatChannel* Channel = Section->GetChannelProxy().GetChannel<FMovieSceneFloatChannel>(0);
Channel->AddLinearKey(FFrameNumber(0), FromValue);
Channel->AddLinearKey(EndFrame, ToValue);
```

Channel API note: The exact method signature varies across UE4.27 versions. If `AddLinearKey` doesn't exist, use `AddKeys()` or manipulate `Channel->GetData().GetValues()` directly. Resolve at compile time -- this is a 2-minute fix, not a design decision.

### Step 6: Register animation

```cpp
WidgetBP->Animations.Add(Anim);
```

Ensure created `UWidgetAnimation` objects are properly outered to the WidgetBlueprint (the `NewObject` outer in Step 1 handles this) and flagged so they serialize and appear in the editor Animations panel. If animations build but don't show up in editor, check:
- Object flags (may need `RF_Transactional`)
- `WidgetBP->Modify()` call before adding
- That the animation is outered to the WidgetBlueprint, not the package

## Required Module Dependencies

Add to `BlueprintGraphBuilder.Build.cs` PrivateDependencyModuleNames:

```csharp
"MovieScene",
"MovieSceneTracks",
```

## Parser Changes (WidgetBlueprintJsonParser)

### Top-level key validation

Change valid top-level keys from `{ "root" }` to `{ "root", "animations" }`.

Currently the parser only reads `root` from the top-level object. It does not validate unknown top-level keys. Add validation: reject unknown keys at top level (same pattern as node-level key validation).

### New parse method

```cpp
static bool ParseAnimations(
    const TArray<TSharedPtr<FJsonValue>>* AnimArray,
    TArray<FWidgetAnimationSpec>& OutAnimations,
    FString& OutError
);
```

### Animation-level valid keys

```cpp
static const TSet<FString> ValidAnimationKeys = { "name", "target", "duration", "tracks" };
```

### Track-level valid keys (opacity)

```cpp
static const TSet<FString> ValidOpacityTrackKeys = { "type", "from", "to" };
```

Unknown keys at animation level or track level are parse errors.

## Validator Changes (WidgetBlueprintValidator)

### New validation method

```cpp
static bool ValidateAnimations(
    const TArray<FWidgetAnimationSpec>& Animations,
    const FWidgetBlueprintSpec& Spec,
    FString& OutError
);
```

### Validation rules

1. Animation `name` must not be empty
2. Animation `name` must be unique across all animations
3. Animation `target` must reference a widget name that exists in the tree (collect all names during tree validation, pass to animation validation)
4. `duration` must be > 0
5. `tracks` must have at least one entry
6. Each track must have a valid `type` (v1: only `"opacity"`)
7. Opacity tracks: `from` and `to` must be present and in range [0, 1] (reject, do not clamp)
8. Unknown track type is a validation error (not a warning)
9. Duplicate track types within a single animation are rejected (one opacity track per animation in v1)
10. `from == to` is valid (no-op animation, not rejected)
11. Multiple animations may target the same widget and property. Conflict resolution is left to gameplay code (caller decides which animation to play). This is not a validation error.

### Wiring into validation flow

`FWidgetBlueprintValidator::Validate()` must call `ValidateAnimations()` after tree validation succeeds. The standalone `FWidgetBlueprintBuilder::Validate()` path (used by `ValidateWidgetJSON`) must also validate animations -- this happens automatically since it calls `FWidgetBlueprintValidator::Validate()` which now includes animation validation.

Pass the set of widget names collected during tree validation into `ValidateAnimations()` for target resolution.

### Error format

Same pattern as existing errors:

```
[WidgetBuilder] Animation 'FadeIn': target widget 'Typo' does not exist
[WidgetBuilder] Animation 'FadeIn': duplicate animation name
[WidgetBuilder] Animation 'FadeIn'.tracks[0]: opacity 'from' must be between 0 and 1
```

## Rebuild Behavior

When rebuilding:

1. Clear `WidgetBP->Animations` array
2. Rebuild animations from JSON (same path as Build)
3. Finalize recompiles the blueprint

Animations are fully declarative -- rebuild replaces all animations, same as tree rebuild replaces all widgets.

## Logging

Required log lines:

```
[WidgetBuilder] Animation 'FadeIn': created, target='QTEText', duration=0.25s
[WidgetBuilder] Animation 'FadeIn': opacity track 0.00 -> 1.00
[WidgetBuilder] Animation 'FadeIn': bound to widget 'QTEText'
```

## Test Case

### Input JSON

```json
{
  "root": {
    "type": "CanvasPanel",
    "name": "Root",
    "children": [
      {
        "type": "TextBlock",
        "name": "QTEText",
        "properties": {
          "text": "PRESS X",
          "renderOpacity": 0.0
        },
        "slot": {
          "position": { "x": 400, "y": 300 },
          "size": { "x": 200, "y": 50 }
        }
      }
    ]
  },
  "animations": [
    {
      "name": "FadeIn",
      "target": "QTEText",
      "duration": 0.25,
      "tracks": [
        {
          "type": "opacity",
          "from": 0.0,
          "to": 1.0
        }
      ]
    },
    {
      "name": "FadeOut",
      "target": "QTEText",
      "duration": 0.25,
      "tracks": [
        {
          "type": "opacity",
          "from": 1.0,
          "to": 0.0
        }
      ]
    }
  ]
}
```

### Success criteria

1. `BuildWidgetFromJSON` returns empty string (success)
2. Opening the widget blueprint shows "FadeIn" and "FadeOut" in the Animations panel
3. Selecting FadeIn shows an opacity track from 0 to 1
4. Selecting FadeOut shows an opacity track from 1 to 0
5. In a test blueprint: calling `PlayAnimation(FadeIn)` fades the text from invisible to visible
6. Blueprint compiles without warnings

### Validation failure tests

These must produce clear error messages:

1. `"target": "NonExistent"` -- target widget does not exist
2. Two animations with `"name": "FadeIn"` -- duplicate name
3. `"name": ""` -- empty animation name
4. `"duration": 0` -- invalid duration
5. `"duration": -1.5` -- negative duration
6. `"tracks": []` -- empty tracks array
7. Opacity track with `"from": 2.0` -- out of range
8. Track with `"type": "translation"` -- unsupported type in v1
9. Two opacity tracks in one animation -- duplicate track type

## File Inventory

### New files

| File | Purpose |
|------|---------|
| `WidgetBuilder/WidgetAnimationBuilder.h` | Animation builder class declaration |
| `WidgetBuilder/WidgetAnimationBuilder.cpp` | Animation builder implementation |

### Modified files

| File | Change |
|------|--------|
| `WidgetBlueprintSpec.h` | Add `FWidgetAnimationTrackSpec`, `FWidgetAnimationSpec`, extend `FWidgetBlueprintSpec` |
| `WidgetBlueprintJsonParser.h/cpp` | Parse `animations` array, top-level key validation |
| `WidgetBlueprintValidator.h/cpp` | Validate animation specs against widget tree |
| `WidgetBlueprintBuilder.h/cpp` | Call animation builder between tree build and finalize |
| `BlueprintGraphBuilder.Build.cs` | Add MovieScene, MovieSceneTracks dependencies |

### Unchanged files

All other WidgetBuilder files (WidgetTreeBuilder, WidgetChildAttachment, WidgetSlotPropertyApplier, WidgetPropertyApplier, WidgetClassRegistry, WidgetBlueprintAssetFactory, WidgetBlueprintFinalizer) remain untouched.

## Risk Log

### Risk 1: FWidgetAnimationBinding accessibility (HIGH)

`AnimationBindings` may be private or have different field names in UE4.27. Try direct insertion first. Fallback: `MovieScene->AddPossessable()`. Resolve at compile time.

### Risk 2: Property path binding (MEDIUM)

Track must call `SetPropertyNameAndPath("RenderOpacity", "RenderOpacity")` or equivalent. Without this, animation exists but nothing moves. Exact API may vary -- verify at compile time.

### Risk 3: Float channel key insertion (LOW)

`AddLinearKey` signature may differ. Fall back to `AddKeys()` or direct array manipulation. 2-minute fix at compile time.

### Risk 4: Widget bindability (LOW)

Widgets must be findable by name for animation binding. The builder already assigns names via `ConstructWidget<UWidget>(WidgetClass, FName(*Name))`. If binding fails silently at runtime (animation plays but nothing moves), the widget may need to be marked as a variable. In UMG, this is controlled by `UWidget::bIsVariable`. The animation builder should set `bIsVariable = true` **only on widgets referenced by animations**, not on all widgets. Do this during the animation build phase, not during tree construction. This keeps the builder deterministic and avoids side effects on unrelated widgets. If the field is not accessible, skip it -- but try it first since the UMG designer does this automatically for animated widgets.

## Future Passes (design only, do not implement)

### Pass 8: Translation tracks

```json
{ "type": "translation", "from": {"x": 0, "y": -50}, "to": {"x": 0, "y": 0} }
```

Animates `RenderTransform.Translation`. Add `FVector2D FromTranslation, ToTranslation` to `FWidgetAnimationTrackSpec`.

### Pass 9: Scale tracks

```json
{ "type": "scale", "from": {"x": 0.5, "y": 0.5}, "to": {"x": 1.0, "y": 1.0} }
```

Animates `RenderTransform.Scale`. Add `FVector2D FromScale, ToScale` to `FWidgetAnimationTrackSpec`.

The `tracks[]` array in the JSON schema already supports these without schema changes.
