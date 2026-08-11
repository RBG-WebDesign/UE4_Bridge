# CRT / VCR Screen Material

Status: Analyzed 2026-08-05 (read-only study of a third-party asset, not built here)
Engine: UE4.27
Origin: `BridgeInstallTest`, reading `/Game/CRT_VCR_Material/` (Cem Tezcan's
CRT/VCR filter pack) through `puerts_material_inspect`

This playbook is a study, not a build recipe from our own work. Sections 1-3
and 5 are what the asset actually does, read from the live editor. Section 4
is the pattern to copy, not a replay of steps we ran.

## 1. System Design Intent

One master Material carries every CRT artifact as an independently-scaled
term, all of them neutral by default, and ships a folder of Material
Instances that are nothing but parameter values. A CRT look is not one effect;
it is roughly a dozen stacked artifacts (scanlines, phosphor mask, chromatic
aberration, tracking noise, screen hop, halo bloom, vignette, barrel warp)
whose *relative* strengths are the whole difference between "1983 broadcast
TV" and "1996 VGA monitor". Putting them in one graph and shipping the
differences as instances means one shader permutation family, one place to
fix a bug, and a new look costs an asset with no graph edit. The screen image
itself is an input parameter, so the same material drives a static texture, a
render target, or a `MediaTexture` from a video file.

Copy this whenever a material is a *look* with variants rather than a single
surface: the master is the algorithm, the instances are the art direction.

## 2. Dependencies

Asset inventory read from the live editor (169 assets under
`/Game/CRT_VCR_Material/`):

- Master material: `Materials/00_animated_crt_v2_1` - Surface domain, Opaque,
  one-sided. 439 expressions, 572 connections, 58 exposed parameters,
  `structure_hash_sha1 fb054245...`.
- Two sibling masters, same look, different delivery: `00_animated_crt_v2_1_pp`
  (post-process form) and `00_animated_crt_v2_retainer` (UMG RetainerBox form).
  Domains unverified - `material_inspect` cannot read either one, see
  CAPABILITY_FINDINGS Finding 0ak.
- `Materials/legacy_material/` - the previous generation of all three, kept
  rather than deleted, so existing instances do not break on upgrade.
- 15 presets in `Materials/Presets/` (MaterialInstanceConstant): `CRT_Preset_*`
  for the surface master, `PP_Preset_*` for the post-process master,
  `Retainer_Preset_*` for the retainer master. Naming carries the parent.
- ~30 support textures in `Materials/animated_crt_textures/`: aperture and slot
  masks at two resolutions each (`aperture_mon_hi` / `aperture_mon_low`),
  `scanline_mask`, `odd_line_mask`, `signal_distortion`, a random offset map,
  a vignette texture, `Vertical_Trace_Gradient`, `barrel_reflection`,
  `screen_barrel`.
- Nine sample display images (`320x224`, `vga`, `svga`, `DOS`,
  `8_bit_pixelart`, ...) so the material demos without any scene setup.
- `Materials/Scale_Function` - the one project-local MaterialFunction on the
  master's side.
- Timestamp subsystem: `BP_Time_Stamp`, `T_Trace/time_stamp_MPC`
  (MaterialParameterCollection), `Time_Stamp_2D_Capture_Material`
  (TextureRenderTarget2D), ~16 per-digit Materials each with its own
  MaterialInstanceConstant, and three MaterialFunctions
  (`time_stamp_flipbook`, `static_flipbook`, `Time_stamp_combine1`).
- `Movies/NewMediaPlayer` + `NewMediaPlayer_Video` (MediaTexture) +
  `video_template_retro_scene` (FileMediaSource) - the video path.

No `Custom` HLSL node anywhere in the master. The entire effect is stock
nodes: 105 Multiply, 47 Add, 42 MaterialFunctionCall, 34 TextureSample,
25 Constant, 19 Clamp, 19 Subtract, 17 Panner, 16 OneMinus, 14
TextureCoordinate, 12 Divide, 8 If, 8 Sine, 7 Floor, 7 StaticSwitchParameter,
3 Fmod, 3 Time.

## 3. How-To Graph Logic

The graph reads left to right in editor X, from `-12144` to `+4386`, and that
axis *is* the pipeline. Every parameter's X position tells you which stage it
belongs to. Read as three phases:

```
PHASE A  (x -12144 .. -7632)  DISTORT THE UV, BEFORE ANY SAMPLE
  Signal Distortion Intensity / Distortion Interference Speed
  Random Horizontal Offset Strength|Frequency   per-scanline jitter
  Tracking Noise Level|Scale|Density            the VHS band
  Seed (0-255) -> Sine hash                     deterministic randomness
  Screen Hop Interval|Duration|Intensity|Randomness  -> Fmod(Time) gate
  Warp Belt Intensity                           barrel / rolling warp
  Scanline Count, Scanline Vertical Shift Speed, Oddline Clarity
  Chromatic Distance                            splits UV into 3 offsets
  Pixelation Scale + Pixelation Toggle          Floor(uv*N)/N, both axes

PHASE B  (x -7840 .. 0)       SAMPLE, THEN ADD ARTIFACTS TO THE COLOR
  Display Input (TextureObjectParameter) sampled 3x at the R/G/B offset UVs
  Image Blur, glow amount, glow_mip            mip-level fake blur/bloom
  halo mip level / opacity / fade / Halo shift  the phosphor halo
  Saturation / Desaturation
  Phospor Scale, Phospor Ratio (X/Y), Phosphor visibility
    x Slot mask / Shadow Mask   (which mask)
    x High Quaility Slot|Shadow Mask (for close up)  (which resolution)
  Vertical Trace Ray Speed|Repeat|Intensity     the rolling bright bar
  White Noise Scale|intensity, Scanline Intensity, Scanline gap weight
  Time Stamp * (7 params)                        composited last in this phase
  Vignette Amount

PHASE C  (x +1264 .. +4386)   GRADE, BYPASS, OUTPUT
  Monochrome Contrast -> Monochrome Screen -> B&W or Green Screen
  Filter On            static switch, whole chain vs raw Display Input
  Emissive intensity   -> EmissiveColor
  Glass Roughness Multiplier -> Roughness ; Specular -> Specular
```

Output wiring, read directly from `material_inputs`:

```
BaseColor    <- Constant                      (flat, the screen is not lit)
EmissiveColor<- Multiply(FilterChain, Emissive intensity)
Roughness    <- Multiply(_, Glass Roughness Multiplier)
Specular     <- ScalarParameter "Specular"
Normal, Metallic, Opacity, WPO   all unconnected
```

That is the core CRT trick: the picture is **Emissive** on an **Opaque**
surface with a constant BaseColor. The screen ignores scene lighting (a CRT
emits, it does not reflect its image), while Roughness and Specular stay live
so the *glass* still catches room reflections. `Emissive intensity` above 1
(the VCR preset uses 10) is what pushes it into bloom.

`Filter On` is a **StaticSwitchParameter**, not an If: turning the filter off
compiles the artifact chain out of the shader entirely rather than
multiplying it by zero at runtime. Same for the mask-quality switches - "high
quality for close up" is a second, larger texture selected at compile time,
not a runtime branch.

Sub-chains confirmed by tracing each parameter's consumers:

- **Chromatic aberration**: `Chromatic Distance` -> a function call -> three
  `TextureSample`s recombined through `Add`. Three samples of the same
  texture at offset UVs, one per channel. Inferred, not read: which channel
  each offset carries.
- **Pixelation**: `Pixelation Scale` -> `Floor` -> `Divide` on each axis, the
  standard `floor(uv * n) / n` quantise, gated by `If` and the
  `Pixelation Toggle` static switch.
- **Screen hop**: `Fmod` on a Time-derived value -> `If`, so the jump is a
  deterministic periodic event with a duration, not per-frame noise.
- **Seed (0-255)**: feeds `Sine` -> `Multiply` -> `Add` chains. A sine hash
  for pseudo-randomness with no noise texture read, and it is a *parameter*,
  so two TVs in one room can be given different seeds and stop flickering in
  lockstep. Copy this.
- **Phosphor mask**: `Phospor Scale` tiles the aperture texture; two nested
  static switches choose slot-vs-shadow mask and low-vs-high resolution.
- **Scanlines**: `Scanline Count` multiplies into UV, then through a
  `Panner` (so `Scanline Vertical Shift Speed` rolls them) into the
  `scanline_mask` sample.

Timestamp subsystem, the one part that leaves the material: `BP_Time_Stamp`
writes the current time into `time_stamp_MPC`, each digit is a Material
Instance that reads the collection and flipbooks to the right glyph, they
composite through `Time_stamp_combine1` into
`Time_Stamp_2D_Capture_Material` (a render target), and the master samples
that render target and blends it with `Time Stamp Opacity/Scale/Ratio/Shift/
Color`. A material cannot know the wall clock; the MPC is the bridge, and the
render target keeps 16 digit materials from becoming 16 samples in the CRT
shader.

## 4. Replication Steps

The pattern to copy for any variant-heavy screen or filter material:

1. One master material, Surface / Opaque, picture on **Emissive**, BaseColor
   a constant, Roughness and Specular still parameterised for the glass.
2. Make the source image a `TextureObjectParameter`, not a `TextureSample`
   with a baked texture. That is what lets one master accept a Texture2D, a
   render target, and a `MediaTexture` without a duplicate.
3. Order the graph so UV-space distortion happens before the sample and
   color-space artifacts after it, and lay the nodes out left to right in
   that order. In this asset editor-X alone recovers the pipeline; that is a
   readability property worth deliberately maintaining.
4. Every artifact gets its own scalar, and **every scalar defaults to
   off/neutral in the master**. Confirmed in the master's defaults: `glow
   amount` 0, `Vignette Amount` 0, `White noise intensity` 0, `Tracking Noise
   Level` 0, `Screen Hop Intensity` 0, `Warp Belt Intensity` 0. The master is
   the null look; the presets are the art.
5. Use `StaticSwitchParameter` for anything that is a mode rather than an
   amount (filter bypass, mask type, mask resolution, monochrome). Costs a
   permutation, saves the instruction.
6. Expose a `Seed` scalar wherever randomness is derived from Time, so
   multiple instances desynchronise.
7. Ship presets as Material Instances named for their parent
   (`CRT_Preset_*` / `PP_Preset_*` / `Retainer_Preset_*`) - a flat Presets
   folder with three parents is unusable otherwise.
8. Keep the previous generation in a `legacy_material/` subfolder instead of
   deleting it, so existing instances survive the upgrade.
9. Anything the material cannot know (wall clock, gameplay state) arrives
   through a MaterialParameterCollection written by a Blueprint; anything
   expensive to composite (16 digit glyphs) is pre-composited into a render
   target and sampled once.

## 5. UE4.27 Legacy Gotchas

- **A MediaTexture assigned to a plain Texture2D sampler warns on every
  compile.** The live editor emits, once per shader permutation:
  `applied to a non-external Texture2D sampler. This may work by chance on
  some platforms but is not portable. Please change sampler type to
  'External'. Parameter 'Display Input' (slot 6)`. The shipped
  `CRT_Preset_VCR` sets `Display Input` to
  `/Game/CRT_VCR_Material/Movies/NewMediaPlayer_Video`, a MediaTexture, into
  a sampler the master declares as Texture2D. It renders on D3D11; the
  warning is about mobile/GLES portability. If you copy this pattern and
  target mobile, either declare the sampler `External` (and then it will only
  take media) or keep two masters.
- **Emissive above 1 does nothing visible without bloom.** `Emissive
  intensity` 10 in the VCR preset assumes post-process bloom is on. On a map
  with bloom disabled the screen just clips white.
- Naming in the shipped parameters is inconsistent (`Phospor Scale` vs
  `Phosphor visibility`, `glow amount` vs `Halo shift`, `High Quaility`).
  Parameter names are the instance-override key, so they cannot be fixed
  after instances exist without breaking every override. Get them right the
  first time.
- Parameters carry no Group assignment in this asset - all 58 land in the
  default group, so the instance editor is one flat list. Set
  `Group`/`SortPriority` on parameters when there are more than ~15.

## 6. Verification

Read-only, no editor writes were made:

```
puerts_material_inspect /Game/CRT_VCR_Material/Materials/00_animated_crt_v2_1
  -> asset_kind material, domain Surface, blend Opaque, two_sided false
  -> expression_count 439, connection_count 572, parameter_count 58
  -> structure_hash_sha1 fb0542453a76cd6fa6e1eb2746b95e9b0e64e1b3
  -> package_dirty_before false, package_dirty_after false

puerts_material_inspect /Game/CRT_VCR_Material/Materials/Presets/CRT_Preset_VCR
  -> asset_kind material_instance, parent 00_animated_crt_v2_1
  -> 44 of 58 parameters overridden=true
  -> Display Input = /Game/CRT_VCR_Material/Movies/NewMediaPlayer_Video
  -> Emissive intensity 10 (master default 1)
  -> structure_hash_sha1 7dd623bec9cbc1943ef70e1f6f1eea8a9f549c06
```

The 44-of-58 number is the load-bearing evidence for section 4: a preset in
this design is *only* values, and it overrides most of them.

Failure signature to recognise: if a screen renders correctly lit and shaded
by scene lights, the picture was wired to BaseColor instead of Emissive.

## 7. What this study could not read

`puerts_material_inspect` returns node classes, positions, GUIDs, per-input
connection state and parameter names, but not node *payloads*: Constant
values, which Texture a TextureSample holds, which MaterialFunction a
MaterialFunctionCall targets, Panner speeds, TextureCoordinate tiling, and
Comment boxes are all absent. Everything above marked "inferred" is inferred
because of that. See CAPABILITY_FINDINGS Finding 0al.
