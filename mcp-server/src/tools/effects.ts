/**
 * Effects tools: post-processing, camera shake, visual effects.
 */

import { z } from "zod";
import { UnrealClient } from "../unreal-client.js";
import type { ToolDefinition } from "../types.js";

const ColorSchema = z.object({
  r: z.number().describe("Red 0.0-2.0"),
  g: z.number().describe("Green 0.0-2.0"),
  b: z.number().describe("Blue 0.0-2.0"),
  a: z.number().optional().default(1.0).describe("Alpha"),
});

const LocationSchema = z.object({
  x: z.number().describe("X coordinate"),
  y: z.number().describe("Y coordinate"),
  z: z.number().describe("Z coordinate"),
});

const PostProcessSettingsSchema = z.object({
  // Bloom
  bloom_intensity: z.number().optional().describe("Bloom intensity (0=off, 1=default, higher=stronger)"),
  bloom_threshold: z.number().optional().describe("Bloom threshold (lower=more bloom)"),
  bloom_size_scale: z.number().optional().describe("Bloom size scale"),
  // Exposure
  auto_exposure_bias: z.number().optional().describe("Exposure compensation (-5 to 5)"),
  auto_exposure_min_brightness: z.number().optional(),
  auto_exposure_max_brightness: z.number().optional(),
  auto_exposure_speed_up: z.number().optional(),
  auto_exposure_speed_down: z.number().optional(),
  auto_exposure_method: z.number().int().optional().describe("0=Histogram, 1=Basic"),
  // Color Grading
  color_saturation: ColorSchema.optional().describe("Global saturation (1.0=normal, 0=desaturated, >1=oversaturated)"),
  color_contrast: ColorSchema.optional().describe("Global contrast"),
  color_gamma: ColorSchema.optional().describe("Global gamma"),
  color_gain: ColorSchema.optional().describe("Global gain (brightness multiplier)"),
  color_offset: ColorSchema.optional().describe("Global color offset"),
  // Shadows/Midtones/Highlights grading
  color_saturation_shadows: ColorSchema.optional(),
  color_contrast_shadows: ColorSchema.optional(),
  color_gamma_shadows: ColorSchema.optional(),
  color_gain_shadows: ColorSchema.optional(),
  color_offset_shadows: ColorSchema.optional(),
  color_saturation_midtones: ColorSchema.optional(),
  color_contrast_midtones: ColorSchema.optional(),
  color_gamma_midtones: ColorSchema.optional(),
  color_gain_midtones: ColorSchema.optional(),
  color_offset_midtones: ColorSchema.optional(),
  color_saturation_highlights: ColorSchema.optional(),
  color_contrast_highlights: ColorSchema.optional(),
  color_gamma_highlights: ColorSchema.optional(),
  color_gain_highlights: ColorSchema.optional(),
  color_offset_highlights: ColorSchema.optional(),
  // White Balance
  white_temp: z.number().optional().describe("Color temperature in Kelvin (2000=warm, 6500=neutral, 12000=cool)"),
  white_tint: z.number().optional().describe("White tint offset"),
  // Film
  film_slope: z.number().optional(),
  film_toe: z.number().optional(),
  film_shoulder: z.number().optional(),
  film_black_clip: z.number().optional(),
  film_white_clip: z.number().optional(),
  // Chromatic Aberration / Glitch
  scene_fringe_intensity: z.number().optional().describe("Chromatic aberration intensity (0=off, 1=subtle, 5+=glitch)"),
  // Vignette
  vignette_intensity: z.number().optional().describe("Edge darkening (0=off, 1=strong)"),
  // Film Grain
  grain_intensity: z.number().optional().describe("Film grain / noise (0=off, 0.5=visible, 1=heavy)"),
  grain_jitter: z.number().optional().describe("Grain animation speed"),
  // Ambient Occlusion
  ambient_occlusion_intensity: z.number().optional(),
  ambient_occlusion_radius: z.number().optional(),
  ambient_occlusion_power: z.number().optional(),
  // Depth of Field
  depth_of_field_focal_distance: z.number().optional().describe("Focus distance in cm"),
  depth_of_field_fstop: z.number().optional().describe("Aperture (lower=more blur)"),
  depth_of_field_sensor_width: z.number().optional(),
  depth_of_field_depth_blur_amount: z.number().optional(),
  depth_of_field_depth_blur_radius: z.number().optional(),
  depth_of_field_focal_region: z.number().optional(),
  depth_of_field_near_blur_size: z.number().optional(),
  depth_of_field_far_blur_size: z.number().optional(),
  // Motion Blur
  motion_blur_amount: z.number().optional().describe("Motion blur strength (0=off)"),
  motion_blur_max: z.number().optional(),
  motion_blur_target_fps: z.number().int().optional(),
  // Screen Space Reflections
  screen_space_reflection_intensity: z.number().optional(),
  screen_space_reflection_quality: z.number().optional(),
  // Global Illumination
  indirect_lighting_intensity: z.number().optional(),
  // Lens Flare
  lens_flare_intensity: z.number().optional(),
  lens_flare_bokeh_size: z.number().optional(),
  lens_flare_threshold: z.number().optional(),
  // Scene Color
  scene_color_tint: ColorSchema.optional().describe("Scene-wide color tint"),
  // LUT
  color_grading_lut: z.string().optional().describe("Content path to LUT texture"),
  // Resolution
  screen_percentage: z.number().optional().describe("Render resolution scale (10-200)"),
}).describe("Post-process settings. Every field auto-enables its override flag.");

export function createEffectsTools(client: UnrealClient): ToolDefinition[] {
  return [
    // ── PostProcess Volume ──
    {
      name: "pp_volume_spawn",
      description: "Spawn a PostProcessVolume with full settings control. Supports bloom, exposure, color grading, DOF, chromatic aberration, grain, vignette, motion blur, SSR, lens flare, and more.",
      inputSchema: z.object({
        name: z.string().optional().default("PP_Effect").describe("Actor label"),
        location: LocationSchema.optional().describe("Spawn location (default: origin)"),
        unbound: z.boolean().optional().default(true).describe("Affect entire level"),
        blend_radius: z.number().optional().default(100).describe("Blend radius when bounded"),
        blend_weight: z.number().optional().default(1.0).describe("Effect strength 0-1"),
        priority: z.number().optional().default(0).describe("Priority when overlapping"),
        enabled: z.boolean().optional().default(true),
        settings: PostProcessSettingsSchema.optional(),
      }),
      handler: async (params) => {
        const result = await client.sendCommand("pp_volume_spawn", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      },
    },
    {
      name: "pp_volume_modify",
      description: "Modify an existing PostProcessVolume's settings. Settings merge with existing values.",
      inputSchema: z.object({
        actor_name: z.string().describe("Label of the PostProcessVolume"),
        unbound: z.boolean().optional(),
        blend_weight: z.number().optional(),
        blend_radius: z.number().optional(),
        priority: z.number().optional(),
        settings: PostProcessSettingsSchema.optional(),
      }),
      handler: async (params) => {
        const result = await client.sendCommand("pp_volume_modify", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      },
    },
    // ── Presets ──
    {
      name: "pp_preset",
      description: `Apply a named post-processing preset. Creates or updates a PP volume.
Presets: horror, cyberpunk, noir, dream, underwater, surveillance, vhs_glitch, damage, drunk, frozen, nuclear, sepia, cinematic, neon, thermal.`,
      inputSchema: z.object({
        preset: z.enum([
          "horror", "cyberpunk", "noir", "dream", "underwater",
          "surveillance", "vhs_glitch", "damage", "drunk", "frozen",
          "nuclear", "sepia", "cinematic", "neon", "thermal",
        ]).describe("Preset name"),
        name: z.string().optional().describe("Actor label (default: PP_<preset>)"),
        intensity: z.number().optional().default(1.0).describe("Scale all values 0-2"),
      }),
      handler: async (params) => {
        const result = await client.sendCommand("pp_preset", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      },
    },
    // ── Camera Shake ──
    {
      name: "camera_shake_blueprint",
      description: `Create a CameraShake Blueprint asset with oscillation parameters.
Shake presets: explosion, hit, earthquake, gunfire, footstep, ambient, electric_shock, glitch_shake.
Or set individual rot_pitch/yaw/roll_amp/freq, loc_x/y/z_amp/freq, fov_amp/freq values.`,
      inputSchema: z.object({
        name: z.string().optional().default("CS_CameraShake").describe("Asset name"),
        content_path: z.string().optional().default("/Game/CameraShakes").describe("Content directory"),
        preset: z.enum([
          "explosion", "hit", "earthquake", "gunfire",
          "footstep", "ambient", "electric_shock", "glitch_shake",
        ]).optional().describe("Shake preset (overrides individual values)"),
        duration: z.number().optional().describe("Shake duration (-1 = infinite)"),
        blend_in_time: z.number().optional(),
        blend_out_time: z.number().optional(),
        // Rotation oscillation
        rot_pitch_amp: z.number().optional().describe("Pitch amplitude degrees"),
        rot_pitch_freq: z.number().optional().describe("Pitch frequency Hz"),
        rot_yaw_amp: z.number().optional(),
        rot_yaw_freq: z.number().optional(),
        rot_roll_amp: z.number().optional(),
        rot_roll_freq: z.number().optional(),
        // Location oscillation
        loc_x_amp: z.number().optional(),
        loc_x_freq: z.number().optional(),
        loc_y_amp: z.number().optional(),
        loc_y_freq: z.number().optional(),
        loc_z_amp: z.number().optional(),
        loc_z_freq: z.number().optional(),
        // FOV oscillation
        fov_amp: z.number().optional().describe("FOV oscillation amplitude"),
        fov_freq: z.number().optional(),
        shake_scale: z.number().optional().default(1.0),
      }),
      handler: async (params) => {
        const result = await client.sendCommand("camera_shake_blueprint", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      },
    },
    {
      name: "camera_shake_play",
      description: "Play a camera shake during PIE. Requires PIE to be running.",
      inputSchema: z.object({
        shake_class: z.string().describe("CameraShake class path or short name"),
        scale: z.number().optional().default(1.0).describe("Intensity multiplier"),
        play_space: z.enum(["CameraLocal", "World"]).optional().default("CameraLocal"),
      }),
      handler: async (params) => {
        const result = await client.sendCommand("camera_shake_play", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      },
    },
    {
      name: "camera_shake_spawn",
      description: "Spawn a CameraShakeSourceActor in the level. Emits shake within inner/outer radius during PIE.",
      inputSchema: z.object({
        name: z.string().optional().default("CameraShake_Source"),
        location: LocationSchema.optional(),
        inner_radius: z.number().optional().default(500),
        outer_radius: z.number().optional().default(1500),
        shake_class: z.string().optional().describe("Content path to CameraShake BP"),
      }),
      handler: async (params) => {
        const result = await client.sendCommand("camera_shake_spawn", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      },
    },
    {
      name: "camera_shake_trigger",
      description: "Spawn a C++ ShakeTriggerActor: plays camera shake when the player overlaps its trigger box during PIE. Python builds, C++ executes -- the reliable pattern.",
      inputSchema: z.object({
        name: z.string().optional().default("ShakeTrigger"),
        location: LocationSchema.optional(),
        shake_class: z.string().describe("Content path to CameraShake BP (e.g. /Game/CS_Earthquake)"),
        shake_scale: z.number().optional().default(1.0).describe("Shake intensity multiplier"),
        box_extent: z.object({
          x: z.number().default(200),
          y: z.number().default(200),
          z: z.number().default(200),
        }).optional().describe("Trigger box half-extents"),
      }),
      handler: async (params) => {
        const result = await client.sendCommand("camera_shake_trigger", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      },
    },
    // ── Console Effects ──
    {
      name: "console_effect",
      description: `Toggle rendering features via console commands.
Commands: freeze_rendering, show_fps, screen_percentage, temporal_aa, fxaa, motion_blur, bloom, eye_adaptation, tonemapper, ssr, ao, dof, aa_quality, shadow_quality, view_distance_quality, post_process_quality.`,
      inputSchema: z.object({
        command: z.enum([
          "freeze_rendering", "show_fps", "screen_percentage",
          "temporal_aa", "fxaa", "motion_blur", "bloom",
          "eye_adaptation", "tonemapper", "ssr", "ao", "dof",
          "aa_quality", "shadow_quality", "view_distance_quality",
          "post_process_quality",
        ]).describe("Effect command"),
        value: z.union([z.string(), z.number()]).optional().describe("Command value"),
      }),
      handler: async (params) => {
        const result = await client.sendCommand("console_effect", params);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
      },
    },
  ];
}
