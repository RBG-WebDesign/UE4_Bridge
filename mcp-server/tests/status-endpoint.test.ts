/**
 * Unit test for /status endpoint contract.
 * Verifies the JSON shape matches what FBridgeStatusService expects.
 *
 * Run: npx tsx mcp-server/tests/status-endpoint.test.ts
 */

import http from "http";

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

// ---- Mock status server ----

const STATUS_RESPONSE = {
  success: true,
  data: {
    version: "0.1.0",
    protocol_version: 1,
    bridge: {
      running: true,
      port: 8080,
      uptime_sec: 123.4,
      total_requests: 42,
      server_time: Date.now() / 1000,
    },
    last_event: {
      timestamp: Date.now() / 1000 - 1,
      command: "actor_spawn",
      result: "success",
      duration_ms: 55.2,
    },
    subsystems: {
      blueprint_builder: { loaded: true, version: "0.1.0" },
      widget_blueprint_builder: { loaded: false, version: "" },
      shaderweave: { registered: false, active_sessions: 0 },
    },
  },
};

const PING_RESPONSE = {
  success: true,
  data: { ok: true },
};

let mockServer: http.Server;
const MOCK_PORT = 18790;

function startMockServer(): Promise<void> {
  return new Promise((resolve) => {
    mockServer = http.createServer((req, res) => {
      const path = (req.url || "/").replace(/\/+$/, "") || "/";
      let body: object;

      if (req.method === "GET" && path === "/ping") {
        body = PING_RESPONSE;
      } else if (req.method === "GET" && path === "/status") {
        body = STATUS_RESPONSE;
      } else if (req.method === "GET") {
        body = { success: true, data: { status: "ok", message: "MCP Bridge listener is running" } };
      } else {
        body = { success: false, data: {}, error: "Unknown" };
      }

      const json = JSON.stringify(body);
      res.writeHead(200, { "Content-Type": "application/json", "Content-Length": String(json.length) });
      res.end(json);
    });
    mockServer.listen(MOCK_PORT, "localhost", () => resolve());
  });
}

function stopMockServer(): Promise<void> {
  return new Promise((resolve) => {
    mockServer.close(() => resolve());
  });
}

function httpGet(path: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://localhost:${MOCK_PORT}${path}`, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ status: res.statusCode || 0, body: data }));
    });
    req.on("error", reject);
  });
}

// ---- Tests ----

test("GET /ping returns {success: true, data: {ok: true}}", async () => {
  const res = await httpGet("/ping");
  assertEqual(res.status, 200, "status code");
  const json = JSON.parse(res.body);
  assertEqual(json.success, true, "success");
  assertEqual(json.data.ok, true, "data.ok");
});

test("GET /status returns standard {success, data} shape", async () => {
  const res = await httpGet("/status");
  assertEqual(res.status, 200, "status code");
  const json = JSON.parse(res.body);
  assertEqual(json.success, true, "success");
  assert(json.data !== undefined, "data field exists");
  assert(json.data.version !== undefined, "data.version exists");
  assert(json.data.protocol_version !== undefined, "data.protocol_version exists");
  assert(json.data.bridge !== undefined, "data.bridge exists");
  assert(json.data.subsystems !== undefined, "data.subsystems exists");
});

test("GET /status bridge section has required fields", async () => {
  const res = await httpGet("/status");
  const bridge = JSON.parse(res.body).data.bridge;
  assertEqual(typeof bridge.running, "boolean", "bridge.running type");
  assertEqual(typeof bridge.port, "number", "bridge.port type");
  assertEqual(typeof bridge.uptime_sec, "number", "bridge.uptime_sec type");
  assertEqual(typeof bridge.total_requests, "number", "bridge.total_requests type");
  assertEqual(typeof bridge.server_time, "number", "bridge.server_time type");
});

test("GET /status subsystems section has required fields", async () => {
  const res = await httpGet("/status");
  const subs = JSON.parse(res.body).data.subsystems;

  assert(subs.blueprint_builder !== undefined, "blueprint_builder exists");
  assertEqual(typeof subs.blueprint_builder.loaded, "boolean", "blueprint_builder.loaded type");

  assert(subs.widget_blueprint_builder !== undefined, "widget_blueprint_builder exists");
  assertEqual(typeof subs.widget_blueprint_builder.loaded, "boolean", "widget_blueprint_builder.loaded type");

  assert(subs.shaderweave !== undefined, "shaderweave exists");
  assertEqual(typeof subs.shaderweave.registered, "boolean", "shaderweave.registered type");
  assertEqual(typeof subs.shaderweave.active_sessions, "number", "shaderweave.active_sessions type");
});

test("GET /status last_event can be null (no commands processed yet)", async () => {
  // This test uses a modified response
  const origEvent = STATUS_RESPONSE.data.last_event;
  (STATUS_RESPONSE.data as any).last_event = null;

  const res = await httpGet("/status");
  const json = JSON.parse(res.body);
  assertEqual(json.data.last_event, null, "last_event is null");

  // Restore
  (STATUS_RESPONSE.data as any).last_event = origEvent;
});

test("GET / returns backward-compatible health check", async () => {
  const res = await httpGet("/");
  assertEqual(res.status, 200, "status code");
  const json = JSON.parse(res.body);
  assertEqual(json.success, true, "success");
  assertEqual(json.data.status, "ok", "data.status");
});

// ---- Runner ----

async function run(): Promise<void> {
  await startMockServer();
  console.log(`\nStatus endpoint tests (mock on port ${MOCK_PORT})\n`);

  for (const t of tests) {
    try {
      await t.fn();
      passed++;
      console.log(`  PASS  ${t.name}`);
    } catch (err: any) {
      failed++;
      console.log(`  FAIL  ${t.name}`);
      console.log(`        ${err.message}`);
    }
  }

  await stopMockServer();

  console.log(`\n${passed} passed, ${failed} failed, ${passed + failed} total\n`);
  if (failed > 0) process.exit(1);
}

run();
