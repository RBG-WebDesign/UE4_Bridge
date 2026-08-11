# Menu 3D Button Extrusion (2.5D focus typography)

Status: Implemented 2026-08-10, editor-verified; PIE pass pending user run
Engine: UE4.27
Origin: Sinfeld_Demo, `UI_Menu3DButton` + `USFMenu3DButton`

## 1. System Design Intent

The main-menu buttons (START GAME / OPTIONS / CREDITS / QUIT / dynamic
CONTINUE) extrude toward the viewer on focus like a VHS-era title card
pulling off the television surface. The choreography, all in one 0.16 s
transition: one hard misregistration hit (whole-block +-5 px horizontal
misalign for a frame, red/cyan split, 1.6x brightness pop, one dropout frame,
k^2 falloff) -> the face punches forward (scale 1.0 -> 1.12 -> settles 1.09,
offset (+3,-2), hard shadow growing 2 -> 4 px) -> the extrusion stretches out
behind it on a 20% delay, overshoots its resting depth by 1.35x, and
compresses into place -> dead stable. Focus-out collapses in 0.10 s at half
the burst energy so rapid navigation reads as one clean handoff of
dimensional energy between titles.

The depth is deliberately nonlinear and sheared: resting offsets
(-1.5,1.5) / (-3,3.2) / (-5.5,6) / (-10,11) px, shades 0.9/0.6/0.35/0.18 of
HoveredColor, and per-layer scale receding from the face value to 1.0 at the
rear, so the stack reads as a volume receding into the CRT rather than four
repeated drop shadows.
The menu is already a world-space WidgetComponent on `BP_Menu3D` viewed by a
camera, so the typography reinforces real dimensionality; scene-level CRT
post handles the broad look. No RetainerBox per button on purpose.

## 2. Division of authority

```
BP   UI_Menu3DButton       designer surface: ButtonText, Text, In Font Info,
                           HoveredColor, GrabFocus, OnPressed, focus sound
C++  USFMenu3DButton       mirror-layer construction + all motion timing
                           (the role a runtime PuerTS layer would own; the
                           game ships no JsEnv, so C++ is the host)
BP   UI_MainMenu_SF etc.   untouched: actions, CONTINUE insertion, camera
                           transitions, navigation
```

C++ builds `Overlay_Text` inside the Button at NativeOnInitialized (BP cannot
construct raw TextBlocks; the bridge cannot patch widget trees in place), and
mirrors ButtonText's text/font into 4 depth + 2 chroma TextBlocks at construct
and on every focus gain, so labels and fonts - including the runtime-created
CONTINUE - can never desync. Depth colors derive from the Blueprint's
`HoveredColor` (read via reflection), darkened 0.85/0.55/0.32/0.16.

## 3. Key facts and fixes landed with it

- **The font bug**: `UI_Menu3DButton.PreConstruct` fed `SetFont` from a
  hardcoded MakeStruct (VCR 110/-25) while the exposed "In Font Info" property
  was dead. Graph-patched to wire the variable; the variable default was first
  upgraded from stale SLNTHLE-24 to VCR-110/-25 so never-overridden instances
  do not regress. The menu's authored 120/110/105/100 size cascade now renders.
- Old focus visuals (purple SetBackgroundColor box, 1.05 SetRenderScale,
  SetOpacity pair) removed from Enable/DisableFocusViz; EnableFocusViz now
  goes straight to its PlaySound, the single deliberate focus sound. The Slate
  style's concrete-footstep hover cue is cleared in C++ (`bClearStyleHoverSound`).
- Focus signal is event-driven: `NativeOnAddedToFocusPath` /
  `NativeOnRemovedFromFocusPath`. The BP's Tick polling remains only as the
  sound trigger; navigation behavior untouched. Mouse hover converges through
  the existing GrabFocus.
- All animation is render-transform only: desired size never changes, the
  VBox never reflows, hit areas never move.
- BP dims the label via ColorAndOpacity alpha 0.85 at PreConstruct; C++
  restores alpha 1 in NativeConstruct and animates RenderOpacity 0.85<->1.0
  instead. Do not add a second opacity channel.

## 4. UE4.27 Legacy Gotchas

- `UTextLayoutWidget::Justification` is protected: it can be Set but not read
  from outside. Mirror layers skip justification (identical slot alignment
  makes it moot for single-line labels).
- A local named `Padding` in any UUserWidget member function shadows
  `UUserWidget::Padding` and fails with warnings-as-errors.
- `UButton::SetStyle` with a copied FButtonStyle is the way to clear
  `HoveredSlateSound` at runtime; there is no per-sound setter.
- Reparenting an in-use widget BP via `puerts_blueprint_member_patch
  reparent_blueprint` preserves variables, graphs, dispatchers and instance
  property overrides (second proven use after UI_SkipCutscene).

## 5. Verification

- `reparent_blueprint` compile UpToDate, saved, p4 checked out; independent
  read-back reports parent `/Script/Sinfeld_Demo.SFMenu3DButton`.
- Graph patches verified by post-hash change + compile UpToDate
  (font rewire batch, visual-strip batch; both rolled into the asset).
- PIE checklist (user-run): hover/leave, keyboard and controller navigation,
  rapid focus movement, all five entries incl. CONTINUE with a save, only one
  item extruded at a time, no reflow, no footstep sound, per-instance fonts
  visibly different sizes.

## 6. Known deliberate cuts

- Depth/chroma layers are runtime-constructed, not designer-visible in the
  UMG tree. Rationale: BP cannot create TextBlocks, the bridge has no in-place
  widget-tree patch (capability gap; would need an MCP restart to land), and
  hand-authored copies would desync from label edits. The designer surface is
  ButtonText plus the tuning properties on the C++ CDO (Menu Button|Motion):
  per-layer offsets and shades are editable arrays, and overshoot, peak and
  settle scale, in/out times, foreground offset and burst length are all
  scalar properties, so the art direction is tunable without a compile.
- Focus loss keeps the last-focused item extruded until another takes focus,
  matching menu focus semantics (some widget always owns focus).
