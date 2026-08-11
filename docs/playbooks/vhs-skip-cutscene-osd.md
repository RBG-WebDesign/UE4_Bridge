# VHS Skip-Cutscene OSD (hold-to-skip prompt)

Status: Implemented 2026-08-10, editor-verified; PIE pass pending user run
Engine: UE4.27
Origin: Sinfeld_Demo, `UI_SkipCutscene` + `USFSkipCutsceneWidget` + `USFCutsceneSkipComponent`

## 1. System Design Intent

The hold-to-skip prompt over cinematics, styled as a consumer VCR on-screen
display: one instruction line (`HOLD [icon] TO SKIP`), one 20-segment meter,
bottom-right corner. Hold 1.0 s to arm, release to skip. At 100% the cutscene
does NOT skip; the text flips to RELEASE and waits. Cancel dumps the meter in
one frame with no error styling. Monochrome (#ECEAE0) until armed; red
(#E0402F) means armed and nothing else. Jitter ramps past 70% progress and
stops dead on arm.

Design source: `SkipCutscene-Package` (UIDesign export, turn-22 mocks,
`UE427-SkipCutscene-Handoff.md`). The package's TS controller
(`SkipCutsceneController.ts` / `VHSAnimator.ts`) assumed a game-runtime PuerTS
script layer that does not exist in Sinfeld_Demo, so the behavior was ported
1:1 into a C++ widget base instead. All state timings in
`SFSkipCutsceneWidget.cpp` are direct transcriptions of `VHSAnimator.ts`.

## 2. Division of authority

```
C++  USFCutsceneSkipComponent  what is ALLOWED to happen (hold, alpha, armed,
                               release-valid, the neutral-input finish gate)
C++  USFSkipCutsceneWidget     how it BEHAVES visually and audibly
UMG  UI_SkipCutscene           asset identity only; the OSD tree is built at
                               runtime by the C++ base
BP   BP_RenderedCutsceneTrigger owns input forwarding and cutscene assets
```

The widget never decides that a skip happened. It subscribes to every
`USFCutsceneSkipComponent` in the world at `NativeConstruct` (only the playing
cutscene's component ever fires) and reacts to
`OnSkipHoldStarted / OnSkipProgressChanged / OnSkipArmed / OnSkipCancelled /
OnSkipRequested`. Zero Blueprint graph changes were needed: the trigger's
legacy calls into the widget's old BP functions still resolve and land on
collapsed placeholder widgets.

## 3. Key files and assets

| Piece | Path |
|---|---|
| Skip state machine | `Source/Sinfeld_Demo/Public/Components/SFCutsceneSkipComponent.h` |
| OSD widget base | `Source/Sinfeld_Demo/Public/UI/SFSkipCutsceneWidget.h` + `Private/UI/...cpp` |
| Widget asset (reparented to the base) | `/Game/00_SinfeldER/Levels/00_StartMenus/Widgets/UI_SkipCutscene` |
| Retainer effect material (reused) | `/Game/00_SinfeldER/Materials/CRT_VCR_Material/Materials/M_TitleGlitch_UI` |
| OSD font (reused) | `/Game/00_SinfeldER/Fonts/VCR_OSD_MONO_1_001_Font` |
| Input cap textures (reused) | `/Game/CharacterCustomizer/CharacterCustomizer_Core/Widgets/Textures/Input/*` |
| Tape sounds (reused) | `/Game/HorrorEngine/Audio/_ReferenceCues/Vhs*`, `ClickButton*` |

All asset references are constructor defaults (`FObjectFinderOptional`) and
BP-overridable properties on the widget CDO.

## 4. How it works

- `NativeOnInitialized` collapses the asset's legacy placeholder widgets, then
  constructs Retainer_OSD (URetainerBox, effect material M_TitleGlitch_UI,
  texture param "Display Input") -> Root_Overlay (8 px inner margin so
  shadows/chroma/jitter never sample the RT edge) -> instruction HBox +
  meter (2 px frame hugging 20 x 18x21 UImage segments, 4 px gaps; never a
  UProgressBar; no forced-width SizeBox, which clipped the last segment at
  fractional DPI) + arm-flash overlay. Canvas slot: anchors (1,1), alignment
  (1,1), position (-124,-76) = spec (-132,-84) after the margin.
- Per-frame state machine in `NativeTick` (Slate-ticked, immune to game
  pause): ACQUIRE 0.09 s keyframes; HOLDING jitter table at 0.18 s steps with
  `intensity = max(0,(alpha-0.7)/0.3)`, 3.5 Hz lead-segment strobe, 2.3 s
  opacity flicker; ARMED one 0.05 s glitch burst then all instability to
  zero, 1 s icon pulse (no white-flash overlay: a full-rect flash image is
  the same artifact class as the tracking bar and could stick at 35% if a
  cancel landed mid-flash); CANCEL 0.12 s dropout; SKIP 0.24 s escalating
  glitch-out (1.2x -> 2.0x reference strengths while opacity steps
  1 -> 0.85 -> 0.5 -> 0.22 -> 0; peak distortion starts at FULL opacity per
  the wbp-glitch-effect rule). The spec's
  sweeping tracking-band image was cut after live review: as a flat white
  bar it clipped at the retainer edge and read as an artifact, not an
  effect. Reinstate only with a real 1x18 gradient texture, if ever.
- Material mapping (M_TitleGlitch_UI has no GlitchStrength/Brightness):
  glitch 0..1 -> Signal Distortion x25, White noise x0.35, HOffset x0.08,
  Tracking x0.8; chroma 0..1 -> Chromatic Distance x0.008; Seed rerolled per
  frame `(GFrameCounter*37)%256`; the 1.35 brightness kick is a 0.05 s white
  overlay image instead.
- Every glitch/chroma write is multiplied by the sitcom title controller's
  per-frame flicker hash (`0.55 + 0.45*Frac(Sin(frame*12.9898+phase)*43758.5453)`,
  phase from GetUniqueID so it never syncs with an on-screen title;
  `bGlitchFlicker` property turns it off). This is what makes the distortion
  read as live signal dropout instead of a smooth dial, and it is the whole
  visible difference between the static values and the title look.
- Do NOT swap the retainer material for the full CRT retainer master
  (`00_animated_crt_v2_retainer` / `MI_Retainer_CRT_*`): its opacity covers
  the whole rect and draws a dark band behind a transparent corner widget
  (verified failure mode, see wbp-glitch-effect.md). Those presets are for
  full-screen menus.
- Segments: `floor(alpha*20)`, whole segments only. Capstan tick every 5th.
- Hiss bed volume (never pitch) rises `0.25 + 0.75*alpha` via
  `UAudioComponent::SetVolumeMultiplier`.
- Input glyph resolves from the device actually holding the key
  (`PC->IsInputKeyDown` over the `Skip_Cutscene` mappings), rechecked 4x/s
  during the hold; keyboard shows a blank key cap + short key label, pads
  show a face-button texture. Unbound action = widget hidden entirely.
- `RemoveFromParent` is overridden: removal arriving while Armed/Skipping is
  deferred until the 0.08 s tear finishes, so the tear draws over the cut.
  The component's `ExecuteSkip` ordering (skip before any presentation
  broadcast) is what guarantees the cut never waits on the UI.

## 5. UE4.27 Legacy Gotchas

- `UImage::SetDesiredSizeOverride` does not exist in 4.27; use
  `SetBrushSize`.
- `URetainerBox::GetEffectMaterial` returns null until the Slate widget is
  constructed; fetch the MID lazily every use (see wbp-glitch-effect
  playbook).
- Colors must go through `FLinearColor::FromSRGBColor` to match the HTML
  reference hexes; dividing hex by 255 (as the TS did) skips the sRGB
  conversion and renders darker.
- Game pause: cutscenes pause the world, so nothing here uses FTimerManager;
  all sequencing is accumulated `NativeTick` time. The skip component ticks
  with `bTickEvenWhenPaused`.
- `Skip_Cutscene` had no gamepad mapping at all; `Gamepad_FaceButton_Bottom`
  was added via `puerts_input_mapping_patch` (Config/DefaultInput.ini).

## 6. Verification

- Editor-side: `puerts_blueprint_member_patch` reparent compiles clean;
  `puerts_widget_inspect` reports `parent_class =
  /Script/Sinfeld_Demo.SFSkipCutsceneWidget`.
- PIE (user-run): hold 1.0 s -> release skips with tear over the cut; release
  at 0.6 s -> meter dumps in one frame, dropout, no red; at 100% text reads
  RELEASE, meter solid red, jitter gone; pad hold shows the pad cap without
  reflow.

## 7. Known deliberate cuts

- No bespoke `M_UI_VHS_OSD` material: M_TitleGlitch_UI reused. Missing
  scanline darkening term and true brightness param (approximated by
  overlay). Building the bespoke material needs Custom-HLSL node support in
  `puerts_material_build` or a hand-authored material.
- No PS/Xbox/Nintendo brand detection (vanilla 4.27 cannot tell pads apart);
  one pad glyph property, PlayStation cross by default to match existing UI.
  Nintendo right-face-confirm rule unimplemented.
- VCR_OSD_MONO font asset is the project's existing runtime-cached font, not
  a 5x7 Offline-cache bitmap face at fixed sizes.
- The trigger still plays its old `Loading_Riser` cue on hold start,
  which fights the "no UI beeps" rule; removing it is a one-node trigger BP
  edit left to the user.
