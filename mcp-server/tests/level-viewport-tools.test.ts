/**
 * Unit tests for level and viewport tools.
 *
 * Uses MockUnrealServer to simulate the Python listener so we can test
 * tool registration, Zod input validation, and error handling without UE4.
 *
 * Run: npx tsx mcp-server/tests/level-viewport-tools.test.ts
 */

import http from "http";
import { MockUnrealServer } from "./mock-server.js";
import { UnrealClient } from "../src/unreal-client.js";
import { createLevelTools } from "../src/tools/level.js";
import { createViewportTools } from "../src/tools/viewport.js";
import type { ToolDefinition } from "../src/types.js";

const TEST_PORT = 18766;

let server: MockUnrealServer;
let client: UnrealClient;
let levelTools: ToolDefinition[];
let viewportTools: ToolDefinition[];
let toolMap: Map<string, ToolDefinition>;

// ---- Test runner ----

interface TestCase {
  name: string;
  fn: () => Promise<void>;
}

const tests: TestCase[] = [];
let passed = 0;
let failed = 0;

function test(name: string, fn: () => Promise<void>): void {
  tests.push({ name, fn });
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertIncludes(str: string, substr: string, label: string): void {
  if (!str.includes(substr)) {
    throw new Error(`${label}: expected "${str}" to include "${substr}"`);
  }
}

async function callTool(name: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  const tool = toolMap.get(name);
  if (!tool) throw new Error(`Tool not found: ${name}`);
  const result = await tool.handler(params);
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
}

// ---- Setup & Teardown ----

async function setup(): Promise<void> {
  server = new MockUnrealServer();
  await server.start(TEST_PORT);
  client = new UnrealClient({ port: TEST_PORT });
  levelTools = createLevelTools(client);
  viewportTools = createViewportTools(client);
  toolMap = new Map([
    ...levelTools.map((t) => [t.name, t] as [string, ToolDefinition]),
    ...viewportTools.map((t) => [t.name, t] as [string, ToolDefinition]),
  ]);
}

async function teardown(): Promise<void> {
  await server.stop();
}

// ---- Helper to spawn actors via the mock ----
async function spawnTestActor(name: string, folder: string = "", loc: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 }): Promise<void> {
  const payload = JSON.stringify({
    command: "actor_spawn",
    params: { asset_path: "/Game/Test", name, folder, location: loc },
  });
  await new Promise<void>((resolve) => {
    const req = http.request({ hostname: "localhost", port: TEST_PORT, path: "/", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } }, (res) => {
      res.on("data", () => {});
      res.on("end", () => resolve());
    });
    req.write(payload);
    req.end();
  });
}

// ---- Tool Registration ----

test("all 3 level tools are registered", async () => {
  const expectedNames = ["level_actors", "level_save", "level_outliner"];
  for (const name of expectedNames) {
    assert(toolMap.has(name), `Tool '${name}' should be registered`);
  }
  assertEqual(levelTools.length, 3, "level tool count");
});

test("all 8 viewport tools are registered", async () => {
  const expectedNames = [
    "viewport_screenshot", "viewport_camera", "viewport_mode", "viewport_focus",
    "viewport_render_mode", "viewport_bounds", "viewport_fit", "viewport_look_at",
  ];
  for (const name of expectedNames) {
    assert(toolMap.has(name), `Tool '${name}' should be registered`);
  }
  assertEqual(viewportTools.length, 8, "viewport tool count");
});

// ---- level_actors Tests ----

test("level_actors with no filters returns actor list with count", async () => {
  server.reset();
  await spawnTestActor("Floor_01", "Environment", { x: 0, y: 0, z: 0 });
  await spawnTestActor("Wall_01", "Environment/Walls", { x: 100, y: 0, z: 0 });
  await spawnTestActor("Light_01", "Lighting", { x: 0, y: 0, z: 300 });
  const result = await callTool("level_actors", {});
  assertEqual(result.success, true, "success");
  const data = result.data as Record<string, unknown>;
  assertEqual(data.count, 3, "count");
  assertEqual(data.total_in_level, 3, "total_in_level");
});

test("level_actors with class_filter returns filtered results", async () => {
  server.reset();
  await spawnTestActor("Cube_01");
  const result = await callTool("level_actors", { class_filter: "StaticMeshActor" });
  assertEqual(result.success, true, "success");
  const data = result.data as Record<string, unknown>;
  assertEqual(data.count, 1, "count");
});

test("level_actors with folder_filter returns filtered results", async () => {
  server.reset();
  await spawnTestActor("Wall_A", "Walls");
  await spawnTestActor("Floor_A", "Floors");
  const result = await callTool("level_actors", { folder_filter: "Walls" });
  assertEqual(result.success, true, "success");
  const data = result.data as Record<string, unknown>;
  assertEqual(data.count, 1, "count");
});

test("level_actors with name_filter returns filtered results", async () => {
  server.reset();
  await spawnTestActor("Torch_01");
  await spawnTestActor("Torch_02");
  await spawnTestActor("Chair_01");
  const result = await callTool("level_actors", { name_filter: "Torch_*" });
  assertEqual(result.success, true, "success");
  const data = result.data as Record<string, unknown>;
  assertEqual(data.count, 2, "count");
});

test("level_actors with limit caps results", async () => {
  server.reset();
  await spawnTestActor("A1");
  await spawnTestActor("A2");
  await spawnTestActor("A3");
  await spawnTestActor("A4");
  await spawnTestActor("A5");
  const result = await callTool("level_actors", { limit: 2 });
  assertEqual(result.success, true, "success");
  const data = result.data as Record<string, unknown>;
  assertEqual(data.count, 2, "count");
  assertEqual(data.truncated, true, "truncated");
});

test("level_actors with include_components includes component arrays", async () => {
  server.reset();
  await spawnTestActor("CompTest");
  const result = await callTool("level_actors", { include_components: true });
  assertEqual(result.success, true, "success");
  const data = result.data as Record<string, unknown>;
  const actors = data.actors as Array<Record<string, unknown>>;
  assert(Array.isArray(actors[0].components), "components should be an array");
});

test("level_actors with include_transforms false omits transform data", async () => {
  server.reset();
  await spawnTestActor("NoTransform");
  const result = await callTool("level_actors", { include_transforms: false });
  assertEqual(result.success, true, "success");
  const data = result.data as Record<string, unknown>;
  const actors = data.actors as Array<Record<string, unknown>>;
  assertEqual(actors[0].location, undefined, "location should be absent");
  assertEqual(actors[0].rotation, undefined, "rotation should be absent");
  assertEqual(actors[0].scale, undefined, "scale should be absent");
});

// ---- level_save Tests ----

test("level_save with save_all false returns level-only save result", async () => {
  server.reset();
  const result = await callTool("level_save", { save_all: false });
  assertEqual(result.success, true, "success");
  const data = result.data as Record<string, unknown>;
  assertEqual(data.level_saved, "MockLevel", "level_saved");
  assertEqual(data.assets_saved_count, 0, "assets_saved_count");
});

test("level_save with save_all true returns level + asset save count", async () => {
  server.reset();
  const result = await callTool("level_save", { save_all: true });
  assertEqual(result.success, true, "success");
  const data = result.data as Record<string, unknown>;
  assertEqual(data.level_saved, "MockLevel", "level_saved");
  assert((data.assets_saved_count as number) > 0, "assets_saved_count > 0");
  assertEqual(data.save_all, true, "save_all");
});

// ---- level_outliner Tests ----

test("level_outliner returns folder tree with actor counts", async () => {
  server.reset();
  await spawnTestActor("W1", "Environment/Walls");
  await spawnTestActor("W2", "Environment/Walls");
  await spawnTestActor("F1", "Environment/Floors");
  await spawnTestActor("NoFolder", "");
  const result = await callTool("level_outliner", {});
  assertEqual(result.success, true, "success");
  const data = result.data as Record<string, unknown>;
  assert((data.folder_count as number) >= 2, "at least 2 folders");
  assert((data.unfoldered_actor_count as number) >= 1, "at least 1 unfoldered");
});

test("level_outliner with root_folder returns subtree only", async () => {
  server.reset();
  await spawnTestActor("W1", "Environment/Walls");
  await spawnTestActor("L1", "Lighting");
  const result = await callTool("level_outliner", { root_folder: "Environment" });
  assertEqual(result.success, true, "success");
  const data = result.data as Record<string, unknown>;
  const folders = data.folders as Array<Record<string, unknown>>;
  for (const f of folders) {
    assertIncludes(f.path as string, "Environment", "folder should be under Environment");
  }
  assertEqual(data.root_folder, "Environment", "root_folder echoed back");
});

// ---- viewport_screenshot Tests ----

test("viewport_screenshot returns file path and camera state", async () => {
  server.reset();
  const result = await callTool("viewport_screenshot", {});
  assertEqual(result.success, true, "success");
  const data = result.data as Record<string, unknown>;
  assert(typeof data.filepath === "string", "filepath is a string");
  assertIncludes(data.filepath as string, "MCPBridge", "path contains MCPBridge");
  assert(data.camera_location !== undefined, "camera_location present");
  assert(data.camera_rotation !== undefined, "camera_rotation present");
});

test("viewport_screenshot with custom resolution passes resolution through", async () => {
  server.reset();
  const result = await callTool("viewport_screenshot", {
    resolution: { width: 3840, height: 2160 },
  });
  assertEqual(result.success, true, "success");
  const data = result.data as Record<string, unknown>;
  const res = data.resolution as { width: number; height: number };
  assertEqual(res.width, 3840, "width");
  assertEqual(res.height, 2160, "height");
});

test("viewport_screenshot with custom filename uses that filename", async () => {
  server.reset();
  const result = await callTool("viewport_screenshot", {
    filename: "my_capture.png",
  });
  assertEqual(result.success, true, "success");
  const data = result.data as Record<string, unknown>;
  assertIncludes(data.filepath as string, "my_capture.png", "custom filename in path");
});

// ---- viewport_camera Tests ----

test("viewport_camera with location only is accepted", async () => {
  server.reset();
  const result = await callTool("viewport_camera", {
    location: [100, 200, 300],
  });
  assertEqual(result.success, true, "success");
  const data = result.data as Record<string, unknown>;
  const loc = data.location as { x: number; y: number; z: number };
  assertEqual(loc.x, 100, "x");
  assertEqual(loc.y, 200, "y");
  assertEqual(loc.z, 300, "z");
});

test("viewport_camera with rotation only is accepted", async () => {
  server.reset();
  const result = await callTool("viewport_camera", {
    rotation: [-30, 45, 0],
  });
  assertEqual(result.success, true, "success");
  const data = result.data as Record<string, unknown>;
  const rot = data.rotation as { pitch: number; yaw: number; roll: number };
  assertEqual(rot.pitch, -30, "pitch");
  assertEqual(rot.yaw, 45, "yaw");
});

test("viewport_camera with no params is rejected by Zod", async () => {
  const tool = toolMap.get("viewport_camera")!;
  const result = tool.inputSchema.safeParse({});
  assert(!result.success, "Should reject empty params");
});

// ---- viewport_mode Tests ----

test("viewport_mode with each valid mode string succeeds", async () => {
  server.reset();
  const modes = ["perspective", "top", "bottom", "front", "back", "left", "right"];
  for (const mode of modes) {
    const result = await callTool("viewport_mode", { mode });
    assertEqual(result.success, true, `success for mode ${mode}`);
    const data = result.data as Record<string, unknown>;
    assertEqual(data.mode, mode, `mode echoed for ${mode}`);
  }
});

test("viewport_mode with invalid mode is rejected by Zod", async () => {
  const tool = toolMap.get("viewport_mode")!;
  const result = tool.inputSchema.safeParse({ mode: "isometric" });
  assert(!result.success, "Should reject invalid mode");
});

// ---- viewport_focus Tests ----

test("viewport_focus returns camera state and actor bounds", async () => {
  server.reset();
  await spawnTestActor("FocusTarget", "", { x: 500, y: 500, z: 100 });
  const result = await callTool("viewport_focus", { actor_name: "FocusTarget" });
  assertEqual(result.success, true, "success");
  const data = result.data as Record<string, unknown>;
  assertEqual(data.focused_on, "FocusTarget", "focused_on");
  assert(data.camera_location !== undefined, "camera_location present");
  assert(data.actor_bounds !== undefined, "actor_bounds present");
});

test("viewport_focus with nonexistent actor returns error", async () => {
  server.reset();
  const result = await callTool("viewport_focus", { actor_name: "Ghost" });
  assertEqual(result.success, false, "success");
  assertIncludes(result.error as string, "not found", "error mentions not found");
  assertIncludes(result.error as string, "level_actors", "error suggests level_actors");
});

// ---- viewport_render_mode Tests ----

test("viewport_render_mode returns mode alongside result", async () => {
  server.reset();
  const result = await callTool("viewport_render_mode", { mode: "wireframe" });
  assertEqual(result.success, true, "success");
  const data = result.data as Record<string, unknown>;
  assertEqual(data.render_mode, "wireframe", "render_mode");
});

test("viewport_render_mode with invalid mode is rejected by Zod", async () => {
  const tool = toolMap.get("viewport_render_mode")!;
  const result = tool.inputSchema.safeParse({ mode: "xray" });
  assert(!result.success, "Should reject invalid mode");
});

test("viewport_render_mode accepts collision mode", async () => {
  server.reset();
  const result = await callTool("viewport_render_mode", { mode: "collision" });
  assertEqual(result.success, true, "success");
  const data = result.data as Record<string, unknown>;
  assertEqual(data.render_mode, "collision", "render_mode");
});

// ---- viewport_bounds Tests ----

test("viewport_bounds returns all expected camera state fields", async () => {
  server.reset();
  const result = await callTool("viewport_bounds", {});
  assertEqual(result.success, true, "success");
  const data = result.data as Record<string, unknown>;
  assert(data.camera_location !== undefined, "camera_location present");
  assert(data.camera_rotation !== undefined, "camera_rotation present");
  assert(data.is_perspective !== undefined, "is_perspective present");
});

// ---- viewport_fit Tests ----

test("viewport_fit with specific actor names", async () => {
  server.reset();
  await spawnTestActor("FitA", "", { x: 0, y: 0, z: 0 });
  await spawnTestActor("FitB", "", { x: 1000, y: 0, z: 0 });
  const result = await callTool("viewport_fit", { actor_names: ["FitA", "FitB"] });
  assertEqual(result.success, true, "success");
  const data = result.data as Record<string, unknown>;
  assertEqual(data.fitted_count, 2, "fitted_count");
  assert(data.combined_bounds !== undefined, "combined_bounds present");
});

test("viewport_fit with empty actor_names fits all", async () => {
  server.reset();
  await spawnTestActor("AllA", "", { x: 0, y: 0, z: 0 });
  await spawnTestActor("AllB", "", { x: 500, y: 500, z: 0 });
  const result = await callTool("viewport_fit", {});
  assertEqual(result.success, true, "success");
  const data = result.data as Record<string, unknown>;
  assertEqual(data.fitted_count, 2, "fitted all actors");
});

test("viewport_fit with custom padding value", async () => {
  server.reset();
  await spawnTestActor("PadA", "", { x: 0, y: 0, z: 0 });
  const result = await callTool("viewport_fit", { actor_names: ["PadA"], padding: 2.0 });
  assertEqual(result.success, true, "success");
  const data = result.data as Record<string, unknown>;
  assertEqual(data.padding, 2.0, "padding");
});

// ---- viewport_look_at Tests ----

test("viewport_look_at with actor_name", async () => {
  server.reset();
  await spawnTestActor("LookTarget", "", { x: 1000, y: 0, z: 0 });
  const result = await callTool("viewport_look_at", { actor_name: "LookTarget" });
  assertEqual(result.success, true, "success");
  const data = result.data as Record<string, unknown>;
  assert(data.camera_location !== undefined, "camera_location present");
  assert(data.camera_rotation !== undefined, "camera_rotation present");
  assert(data.target_location !== undefined, "target_location present");
});

test("viewport_look_at with location coordinates", async () => {
  server.reset();
  const result = await callTool("viewport_look_at", { location: [500, 500, 100] });
  assertEqual(result.success, true, "success");
  const data = result.data as Record<string, unknown>;
  const target = data.target_location as { x: number; y: number; z: number };
  assertEqual(target.x, 500, "target x");
  assertEqual(target.y, 500, "target y");
  assertEqual(target.z, 100, "target z");
});

test("viewport_look_at with neither target is rejected by Zod", async () => {
  const tool = toolMap.get("viewport_look_at")!;
  const result = tool.inputSchema.safeParse({});
  assert(!result.success, "Should reject empty params");
});

// ---- Connection Error Tests ----

test("level tool handles connection error gracefully", async () => {
  const deadClient = new UnrealClient({ port: 19999, timeout: 1000 });
  const deadTools = createLevelTools(deadClient);
  const tool = deadTools.find((t) => t.name === "level_actors")!;
  const result = await tool.handler({});
  const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
  assertEqual(parsed.success, false, "success");
  assertIncludes(parsed.error as string, "Connection failed", "error message");
});

test("viewport tool handles connection error gracefully", async () => {
  const deadClient = new UnrealClient({ port: 19999, timeout: 1000 });
  const deadTools = createViewportTools(deadClient);
  const tool = deadTools.find((t) => t.name === "viewport_bounds")!;
  const result = await tool.handler({});
  const parsed = JSON.parse(result.content[0].text) as Record<string, unknown>;
  assertEqual(parsed.success, false, "success");
  assertIncludes(parsed.error as string, "Connection failed", "error message");
});

// ---- Run ----

async function run(): Promise<void> {
  await setup();

  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log(`  PASS  ${t.name}`);
    } catch (err) {
      failed++;
      console.log(`  FAIL  ${t.name}`);
      console.log(`        ${(err as Error).message}`);
    }
  }

  await teardown();

  console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("Test runner crashed:", err);
  process.exit(1);
});
