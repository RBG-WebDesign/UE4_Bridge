# Effects Cheatsheet -- python_proxy Calls

Every effect available via `python_proxy` until the dedicated MCP tools are hot-reloaded.
Claude Code can copy-paste any of these directly into `python_proxy`.

---

## Post-Process Presets (one-liner each)

```python
# Horror
from mcp_bridge.handlers.effects import handle_pp_preset; handle_pp_preset({"preset": "horror"})

# Cyberpunk
from mcp_bridge.handlers.effects import handle_pp_preset; handle_pp_preset({"preset": "cyberpunk"})

# Noir (black and white)
from mcp_bridge.handlers.effects import handle_pp_preset; handle_pp_preset({"preset": "noir"})

# Dream (bloom glow, soft focus)
from mcp_bridge.handlers.effects import handle_pp_preset; handle_pp_preset({"preset": "dream"})

# Underwater
from mcp_bridge.handlers.effects import handle_pp_preset; handle_pp_preset({"preset": "underwater"})

# Surveillance camera
from mcp_bridge.handlers.effects import handle_pp_preset; handle_pp_preset({"preset": "surveillance"})

# VHS Glitch
from mcp_bridge.handlers.effects import handle_pp_preset; handle_pp_preset({"preset": "vhs_glitch"})

# Damage (red screen)
from mcp_bridge.handlers.effects import handle_pp_preset; handle_pp_preset({"preset": "damage"})

# Drunk (blur + wobble)
from mcp_bridge.handlers.effects import handle_pp_preset; handle_pp_preset({"preset": "drunk"})

# Frozen (ice blue)
from mcp_bridge.handlers.effects import handle_pp_preset; handle_pp_preset({"preset": "frozen"})

# Nuclear (green glow)
from mcp_bridge.handlers.effects import handle_pp_preset; handle_pp_preset({"preset": "nuclear"})

# Sepia (old photo)
from mcp_bridge.handlers.effects import handle_pp_preset; handle_pp_preset({"preset": "sepia"})

# Cinematic (film grade)
from mcp_bridge.handlers.effects import handle_pp_preset; handle_pp_preset({"preset": "cinematic"})

# Neon (oversaturated bloom)
from mcp_bridge.handlers.effects import handle_pp_preset; handle_pp_preset({"preset": "neon"})

# Thermal (false-color)
from mcp_bridge.handlers.effects import handle_pp_preset; handle_pp_preset({"preset": "thermal"})
```

## Preset with custom intensity (0-2)

```python
from mcp_bridge.handlers.effects import handle_pp_preset; handle_pp_preset({"preset": "horror", "intensity": 1.5})
```

---

## Custom PostProcessVolume

```python
from mcp_bridge.handlers.effects import handle_pp_volume_spawn
handle_pp_volume_spawn({
    "name": "PP_Custom",
    "unbound": True,
    "blend_weight": 1.0,
    "settings": {
        "bloom_intensity": 2.0,
        "scene_fringe_intensity": 5.0,
        "grain_intensity": 0.4,
        "vignette_intensity": 0.7,
        "color_saturation": {"r": 0.5, "g": 0.8, "b": 1.2, "a": 1.0},
        "depth_of_field_focal_distance": 200.0,
        "depth_of_field_fstop": 1.4,
        "motion_blur_amount": 0.8,
        "auto_exposure_bias": -0.5,
    }
})
```

## Modify existing PP volume

```python
from mcp_bridge.handlers.effects import handle_pp_volume_modify
handle_pp_volume_modify({
    "actor_name": "PP_Custom",
    "settings": {
        "bloom_intensity": 0.5,
        "scene_fringe_intensity": 0.0,
    }
})
```

---

## Camera Shake Blueprints

### From preset

```python
from mcp_bridge.handlers.effects import handle_camera_shake_blueprint

# Explosion shake
handle_camera_shake_blueprint({"name": "CS_Explosion", "preset": "explosion"})

# Hit impact
handle_camera_shake_blueprint({"name": "CS_Hit", "preset": "hit"})

# Earthquake
handle_camera_shake_blueprint({"name": "CS_Earthquake", "preset": "earthquake"})

# Gunfire recoil
handle_camera_shake_blueprint({"name": "CS_Gunfire", "preset": "gunfire"})

# Footstep
handle_camera_shake_blueprint({"name": "CS_Footstep", "preset": "footstep"})

# Ambient breathing
handle_camera_shake_blueprint({"name": "CS_Ambient", "preset": "ambient"})

# Electric shock
handle_camera_shake_blueprint({"name": "CS_Shock", "preset": "electric_shock"})

# Glitch shake
handle_camera_shake_blueprint({"name": "CS_Glitch", "preset": "glitch_shake"})
```

### Custom oscillation

```python
from mcp_bridge.handlers.effects import handle_camera_shake_blueprint
handle_camera_shake_blueprint({
    "name": "CS_Custom",
    "duration": 1.0,
    "blend_in_time": 0.05,
    "blend_out_time": 0.3,
    "rot_pitch_amp": 3.0, "rot_pitch_freq": 20.0,
    "rot_yaw_amp": 2.0, "rot_yaw_freq": 15.0,
    "rot_roll_amp": 1.0, "rot_roll_freq": 25.0,
    "loc_z_amp": 5.0, "loc_z_freq": 20.0,
    "fov_amp": 2.0, "fov_freq": 10.0,
})
```

---

## Console Effects (immediate toggle)

```python
from mcp_bridge.handlers.effects import handle_console_effect

# Toggle rendering features
handle_console_effect({"command": "bloom", "value": "0"})         # disable bloom
handle_console_effect({"command": "bloom", "value": "1"})         # enable bloom
handle_console_effect({"command": "dof", "value": "0"})           # disable DOF
handle_console_effect({"command": "motion_blur", "value": "0"})   # disable motion blur
handle_console_effect({"command": "ssr", "value": "0"})           # disable SSR
handle_console_effect({"command": "ao", "value": "0"})            # disable AO
handle_console_effect({"command": "eye_adaptation", "value": "0"}) # disable auto exposure
handle_console_effect({"command": "tonemapper", "value": "0"})    # disable tonemapper
handle_console_effect({"command": "show_fps"})                    # toggle FPS
handle_console_effect({"command": "freeze_rendering"})            # freeze frame
handle_console_effect({"command": "screen_percentage", "value": "50"})  # half res
handle_console_effect({"command": "aa_quality", "value": "0"})    # AA off
handle_console_effect({"command": "shadow_quality", "value": "4"}) # max shadows
handle_console_effect({"command": "post_process_quality", "value": "4"}) # max PP
```

---

## Direct unreal API (no handler needed)

```python
import unreal

# Spawn PP volume directly
vol = unreal.EditorLevelLibrary.spawn_actor_from_class(unreal.PostProcessVolume, unreal.Vector(0,0,0))
vol.set_actor_label("PP_Direct")
vol.unbound = True
vol.settings.override_bloom_intensity = True
vol.settings.bloom_intensity = 3.0
vol.settings.override_scene_fringe_intensity = True
vol.settings.scene_fringe_intensity = 8.0
vol.settings.override_grain_intensity = True
vol.settings.grain_intensity = 0.6
vol.settings.override_vignette_intensity = True
vol.settings.vignette_intensity = 0.9
```

---

## All 60+ Post-Process Properties

### Bloom
bloom_intensity, bloom_threshold, bloom_size_scale, bloom_convolution_scatter_dispersion

### Exposure
auto_exposure_bias, auto_exposure_min_brightness, auto_exposure_max_brightness, auto_exposure_speed_up, auto_exposure_speed_down, auto_exposure_method

### Color Grading (Global)
color_saturation, color_contrast, color_gamma, color_gain, color_offset

### Color Grading (Shadows)
color_saturation_shadows, color_contrast_shadows, color_gamma_shadows, color_gain_shadows, color_offset_shadows

### Color Grading (Midtones)
color_saturation_midtones, color_contrast_midtones, color_gamma_midtones, color_gain_midtones, color_offset_midtones

### Color Grading (Highlights)
color_saturation_highlights, color_contrast_highlights, color_gamma_highlights, color_gain_highlights, color_offset_highlights

### White Balance
white_temp, white_tint

### Film Curve
film_slope, film_toe, film_shoulder, film_black_clip, film_white_clip

### Chromatic Aberration
scene_fringe_intensity

### Vignette
vignette_intensity

### Film Grain
grain_intensity, grain_jitter

### Ambient Occlusion
ambient_occlusion_intensity, ambient_occlusion_radius, ambient_occlusion_static_fraction, ambient_occlusion_fade_distance, ambient_occlusion_power, ambient_occlusion_bias, ambient_occlusion_quality

### Depth of Field
depth_of_field_focal_distance, depth_of_field_fstop, depth_of_field_sensor_width, depth_of_field_min_fstop, depth_of_field_blade_count, depth_of_field_depth_blur_amount, depth_of_field_depth_blur_radius, depth_of_field_focal_region, depth_of_field_near_transition_region, depth_of_field_far_transition_region, depth_of_field_near_blur_size, depth_of_field_far_blur_size, depth_of_field_occlusion, depth_of_field_sky_focus_distance

### Motion Blur
motion_blur_amount, motion_blur_max, motion_blur_per_object_size, motion_blur_target_fps

### Screen Space Reflections
screen_space_reflection_intensity, screen_space_reflection_quality, screen_space_reflection_max_roughness

### Global Illumination
indirect_lighting_color, indirect_lighting_intensity

### Lens Flare
lens_flare_intensity, lens_flare_tint, lens_flare_bokeh_size, lens_flare_threshold

### Misc
scene_color_tint, color_grading_lut, screen_percentage
