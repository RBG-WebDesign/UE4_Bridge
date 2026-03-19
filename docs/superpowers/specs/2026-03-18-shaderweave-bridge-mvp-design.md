# ShaderWeave 4.27 Bridge MVP -- Design Spec

Status: Ready for Implementation (Bridge MVP)

Push HLSL into UE4.27 Material Custom Expression nodes over HTTP and get compile feedback back. Bridge-first MVP that proves the core push/compile/feedback loop before any graph editor UI exists.

## Product Context

ShaderWeave is a planned browser-based visual HLSL editor for UE4.27, inspired by Kweave (PCGEx's visual HLSL editor for UE5 PCG GPU compute). UE4.27 does not have PCG GPU nodes, so ShaderWeave targets Material Custom Expressions (Mode A) and plugin shader assets (Mode B, future).

This spec covers the bridge layer only -- the part that lives inside UE_Bridge and handles communication between a future web app and the running UE4.27 editor.

## Scope

### In scope (this spec)

- `/shaderweave/v1/*` URL namespace in the existing UE_Bridge Python listener
- Push HLSL code to a Material Custom Expression node by GUID
- Pull current code and input configuration from a Custom Expression
- List materials containing Custom Expression nodes
- Compile feedback with structured error reporting
- Dry run mode (compile without permanent mutation)
- Validate endpoint (enforced dry run)
- Auto-backup before non-dry-run pushes
- Status endpoint for bridge capability discovery

### Out of scope (future phases)

- Web graph editor (React Flow, node library, HLSL generation)
- Plugin shader mode (`.usf` generation, Mode B)
- WebSocket live connection
- C++ bridge replacement
- Cloud saves, collaboration, version history
- Material Function export
- Auto-push / debounce logic (client-side concern)

## Integration Model

**Approach B with planned evolution toward C.**

ShaderWeave is its own repo and product. UE_Bridge is extended with new endpoints but owns no ShaderWeave domain logic beyond transport and UE4 execution.

- **Now (B):** Python HTTP handlers in UE_Bridge, `/shaderweave/v1/*` URL namespace
- **Later (C):** Dedicated C++ UE4 plugin with WebSocket server, same URL/message contracts

The frontend builds against a `ShaderTargetAPI` abstraction. When the backend swaps from Python HTTP to C++ WebSocket, the frontend does not change.

## URL Namespace

All ShaderWeave endpoints live under `/shaderweave/v1/`. This is a separate URL namespace from the existing `POST /` command router. The existing MCP tools are completely untouched.

```
POST /shaderweave/v1/push       -- push HLSL to a Custom Expression
POST /shaderweave/v1/pull       -- read current state of a Custom Expression
POST /shaderweave/v1/validate   -- compile without mutation (enforced dry run)
GET  /shaderweave/v1/targets    -- list materials with Custom Expressions
GET  /shaderweave/v1/status     -- bridge health and capabilities
```

## Target Resolution

Every request that touches a material uses this target object:

```json
{
  "target": {
    "type": "material_custom",
    "materialPath": "/Game/Materials/M_Test",
    "expressionGuid": "A1B2C3D4-E5F6-7890-ABCD-EF1234567890"
  }
}
```

- `type`: always `"material_custom"` in v1. Present for forward-compat with plugin shader mode.
- `materialPath`: must start with `/`. Validated server-side.
- `expressionGuid`: identifies the specific `UMaterialExpressionCustom` node. Stable across node reordering. GUID comparison is case-insensitive after normalizing both sides to uppercase.

If the GUID does not match any Custom Expression in the material, the error response includes all available Custom Expression GUIDs and their descriptions.

Supports multiple Custom Expression nodes per material from day one.

## Data Contracts

### POST /shaderweave/v1/push

**Request:**

```json
{
  "target": {
    "type": "material_custom",
    "materialPath": "/Game/Materials/M_Test",
    "expressionGuid": "..."
  },
  "code": "return sin(Time) * 0.5 + 0.5;",
  "inputs": [
    { "name": "Time", "type": "float" }
  ],
  "outputType": "float",
  "dryRun": false
}
```

- `code`: HLSL body string. Required. Must not be empty. Maximum 64KB.
- `inputs`: array of `{name, type}`. Required (can be empty array). Order is preserved exactly. Each input name must be a valid HLSL identifier (`^[a-zA-Z_][a-zA-Z0-9_]*$`), must not be an HLSL reserved keyword, and must be unique within the array (case-sensitive uniqueness).
- `outputType`: one of `"float"`, `"float2"`, `"float3"`, `"float4"`. Required. Lowercase only.
- `dryRun`: if true, inject code, compile, capture result, then restore original code/inputs/outputType. Material state is byte-for-byte identical to pre-call state after restore. Default false.

Input types: `"float"`, `"float2"`, `"float3"`, `"float4"`, `"texture2d"`. Lowercase only. `texture2d` support is subject to engine API verification during implementation. `samplerstate` is deferred to post-MVP.

**Response (compile success):**

```json
{
  "success": true,
  "data": {
    "materialPath": "/Game/Materials/M_Test",
    "expressionGuid": "...",
    "compiled": true,
    "compileTimeMs": 87,
    "codeHash": "a1b2c3d4e5f6...",
    "backupId": "20260318-143022-A1B2",
    "dryRun": false,
    "errors": [],
    "warnings": []
  }
}
```

**Response (compile failure):**

```json
{
  "success": true,
  "data": {
    "materialPath": "/Game/Materials/M_Test",
    "expressionGuid": "...",
    "compiled": false,
    "compileTimeMs": 42,
    "codeHash": "a1b2c3d4e5f6...",
    "backupId": "20260318-143022-A1B2",
    "dryRun": false,
    "errors": [
      {
        "line": 3,
        "mappedLine": 1,
        "message": "undeclared identifier 'Timee'"
      }
    ],
    "warnings": []
  }
}
```

Key distinction: `success: true` means the push operation itself worked. `compiled: false` means the shader had errors. A transport or resolution failure is `success: false`. A shader compile error is `success: true, compiled: false`.

Compile failure does NOT roll back the push. The material now contains the pushed code. The user inspects errors and iterates.

`backupId` is null for dry run pushes. `codeHash` is SHA-1 hex of the code string.

`line` is relative to generated shader code (UE4 wraps Custom Expression code internally). `mappedLine` is a best-effort approximation of the line in the user's input code. Both may be null if line info is unavailable.

v1 diagnostics are best-effort and must never block the push response. If compile status can be determined but detailed diagnostics cannot, return `compiled: false` with an empty `errors` array and a warning explaining that detailed diagnostics were unavailable.

### POST /shaderweave/v1/pull

**Request:**

```json
{
  "target": {
    "type": "material_custom",
    "materialPath": "/Game/Materials/M_Test",
    "expressionGuid": "..."
  }
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "materialPath": "/Game/Materials/M_Test",
    "expressionGuid": "...",
    "description": "Custom_0",
    "code": "return sin(Time) * 0.5 + 0.5;",
    "inputs": [
      { "name": "Time", "type": "float" }
    ],
    "outputType": "float",
    "lastBackupId": "20260318-143022-A1B2"
  }
}
```

`lastBackupId` is the most recent backup for this expression, or null if none exists.

### POST /shaderweave/v1/validate

**Request:** Same payload as push.

**Response:** Same format as push response. Always behaves as dry run. Never permanently mutates the material. `backupId` is always null. This is the "compile without consequences" endpoint.

### GET /shaderweave/v1/targets

**Request:** No body. Optional query param `?materialPath=/Game/Materials/M_Test` to filter to a single material.

**Response:**

```json
{
  "success": true,
  "data": {
    "targets": [
      {
        "materialPath": "/Game/Materials/M_Test",
        "materialName": "M_Test",
        "expressions": [
          {
            "guid": "...",
            "description": "Custom_0",
            "inputCount": 2,
            "outputType": "float3"
          }
        ]
      }
    ],
    "count": 1,
    "hasMore": false
  }
}
```

Without filter: scans `/Game/` for materials containing at least one Custom Expression. Hard cap at 200 materials. Enumeration order is not guaranteed. `hasMore: true` if more results exist beyond the cap. Note: the unfiltered scan loads each material asset to inspect expressions, which can be slow on large projects. The filtered query param is recommended for normal use. The unfiltered scan is a convenience for discovery and should not be called in tight loops.

### GET /shaderweave/v1/status

**Response:**

```json
{
  "success": true,
  "data": {
    "bridge": "connected",
    "transport": "python-http",
    "engineVersion": "4.27.2",
    "shaderweaveVersion": "0.1.0",
    "capabilities": ["material_custom"]
  }
}
```

## Error Format

ShaderWeave error responses use a structured error object with `code`, `message`, and `details` fields. This intentionally differs from the existing MCP command router convention (which uses a plain error string). The structured format gives clients machine-readable error codes for programmatic handling. All error responses use this shape:

```json
{
  "success": false,
  "data": {},
  "error": {
    "code": "EXPRESSION_NOT_FOUND",
    "message": "Custom Expression with GUID '...' not found in material '/Game/Materials/M_Test'",
    "details": {
      "available": [{"guid": "...", "description": "Custom_0"}]
    }
  }
}
```

### Error Codes

Request-level failures only. Compile failures are NOT error codes -- they live inside the successful response body as diagnostics.

| Code | When |
|---|---|
| `INVALID_PAYLOAD` | Missing or malformed fields |
| `INVALID_INPUT_NAME` | Name fails HLSL identifier rules or is a reserved keyword |
| `INVALID_TYPE` | Input or output type not in allowed set |
| `MATERIAL_NOT_FOUND` | materialPath does not resolve to a material asset |
| `EXPRESSION_NOT_FOUND` | GUID does not match any Custom Expression in the material |
| `RESTORE_FAILED` | Dry run restore did not complete cleanly |
| `INTERNAL_ERROR` | Unexpected exception |

## Python Architecture

### File Layout

```
unreal-plugin/Content/Python/mcp_bridge/
  shaderweave/
    __init__.py
    router.py              -- URL dispatch for /shaderweave/v1/*
    service.py             -- orchestration (push, pull, targets, validate, status)
    material_custom.py     -- UE4 Material Custom Expression operations
    backup.py              -- in-memory backup store
    validation.py          -- input name/type validation, type mapping
    errors.py              -- structured error types and codes
    types.py               -- internal dataclasses (PushRequest, ResolvedTarget, etc.)
```

Separate package under `mcp_bridge/`. Isolated from existing `handlers/`. When moving to C++, delete this package and nothing else changes.

### Listener Changes

Minimal changes to `listener.py`. The existing `do_POST` does not inspect `self.path` -- it treats all POSTs as `{command, params}` payloads. The existing `do_GET` returns a static health check for all paths. Both need path-aware routing.

**do_POST change:** The ShaderWeave path check must come first. The existing command router runs as the `else` branch. Without this guard, a POST to `/shaderweave/v1/push` would fall through to the command router and fail with "Missing 'command' field".

```python
def do_POST(self) -> None:
    if self.path.startswith("/shaderweave/"):
        return self._handle_shaderweave()
    # ... existing command router logic unchanged (handles POST /)
```

**do_GET change:** ShaderWeave GET routes are checked first. The existing health check stays as the `else` branch for `GET /` and any other non-shaderweave path.

```python
def do_GET(self) -> None:
    if self.path.startswith("/shaderweave/"):
        return self._handle_shaderweave()
    # ... existing health check logic unchanged
```

**`_handle_shaderweave()` shared by both do_POST and do_GET:**
1. Parse URL path (strip query string) and query params into clean dicts
2. Determine method (GET or POST)
3. Parse JSON body (for POST) or empty dict (for GET)
4. Queue a game-thread call to `shaderweave.router.route(method, path, body, query)`
5. Wait for result via the existing event mechanism
6. Return JSON response

GET requests to `/shaderweave/v1/targets` and `/shaderweave/v1/status` also go through the game-thread queue (they read material state).

**CORS:** For browser-based access, `/shaderweave/v1/*` responses need `Access-Control-Allow-Origin: *` and related headers. An `OPTIONS` preflight handler is also needed. This can be added in Pass 1 or deferred to when the web app is built, but the need is noted here.

### Router (shaderweave/router.py)

Thin dispatch. No Unreal logic. Receives normalized method, path, body, query.

```python
ROUTES = {
    ("POST", "/shaderweave/v1/push"):     service.push,
    ("POST", "/shaderweave/v1/pull"):     service.pull,
    ("POST", "/shaderweave/v1/validate"): service.validate,
    ("GET",  "/shaderweave/v1/targets"):  service.list_targets,
    ("GET",  "/shaderweave/v1/status"):   service.status,
}
```

### Internal Types (shaderweave/types.py)

Dataclasses for internal communication. Not serialized directly to JSON.

```python
@dataclass
class InputSpec:
    name: str
    type: str  # validated, lowercase

@dataclass
class PushRequest:
    material_path: str
    expression_guid: str
    code: str
    inputs: List[InputSpec]
    output_type: str
    dry_run: bool

@dataclass
class ResolvedTarget:
    material: object        # UMaterial reference
    expression: object      # UMaterialExpressionCustom reference
    material_path: str
    expression_guid: str
    description: str

@dataclass
class ExpressionSnapshot:
    code: str
    inputs: List[InputSpec]
    output_type: str
    code_hash: str          # for debug assertions on restore

@dataclass
class CompileResult:
    compiled: bool
    errors: List[CompileError]
    warnings: List[CompileWarning]
    compile_time_ms: int
    raw_messages: List[str]  # optional, for debugging

@dataclass
class CompileError:
    line: Optional[int]
    mapped_line: Optional[int]
    message: str

@dataclass
class CompileWarning:
    line: Optional[int]
    mapped_line: Optional[int]
    message: str

@dataclass
class BackupEntry:
    backup_id: str
    material_path: str
    expression_guid: str
    code: str
    inputs: List[InputSpec]
    output_type: str
    timestamp: str
```

### Service Layer (shaderweave/service.py)

Orchestration only. Calls helpers for each phase. Does not contain UE4 API calls directly.

**push(payload):**
1. Build `PushRequest` from payload via `validation.validate_push_payload(payload)`
2. Resolve target: `material_custom.resolve_target(request)` -> `ResolvedTarget`
3. Snapshot current state: `material_custom.snapshot_expression(target.expression)` -> `ExpressionSnapshot`
4. If not dry_run: create backup via `backup_store.create(snapshot, target)`
5. Apply new state (inside try/finally for dry run safety):
   - `material_custom.apply_to_expression(target.expression, request)`
   - `material_custom.recompile_material(target.material)` -> `CompileResult`
6. If dry_run (in finally block):
   - `material_custom.restore_expression(target.expression, snapshot)`
   - `material_custom.recompile_material(target.material)` (restore compiled state)
   - Verify restore by comparing current state against snapshot, log loudly on mismatch
7. Compute code_hash (SHA-1 of request.code)
8. Format and return response

```python
def push(payload):
    req = validation.validate_push_payload(payload)
    target = material_custom.resolve_target(req.material_path, req.expression_guid)
    original = material_custom.snapshot_expression(target.expression)

    backup_id = None
    if not req.dry_run:
        backup_id = backup_store.create(original, target)

    compile_result = None
    apply_error = None
    try:
        material_custom.apply_to_expression(target.expression, req)
        compile_result = material_custom.recompile_material(target.material)
    except Exception as e:
        apply_error = e
    finally:
        if req.dry_run:
            try:
                material_custom.restore_expression(target.expression, original)
                material_custom.recompile_material(target.material)
            except Exception as restore_err:
                # Restore failed -- log loudly but do not mask the original error
                log_error("[ShaderWeave] Dry run restore failed: %s", restore_err)
                raise ShaderWeaveError("RESTORE_FAILED", str(restore_err))
            # Verify restore fidelity
            current = material_custom.snapshot_expression(target.expression)
            if current.code_hash != original.code_hash:
                log_warning("[ShaderWeave] Restore verification failed: code hash mismatch")

    # If apply/recompile raised an exception (not a compile error, an actual crash)
    if apply_error is not None:
        raise ShaderWeaveError("INTERNAL_ERROR", f"Push failed: {apply_error}")

    # compile_result may be None if recompile raised -- handled above
    return format_push_response(req, target, compile_result, backup_id)
```

**Exception vs compile failure:** If `recompile_material` raises a Python exception (not a shader compile error but an actual crash), this is an `INTERNAL_ERROR`. Shader compile failures are returned normally as `success: true, compiled: false`. The distinction: exceptions are infrastructure problems, compile failures are user code problems.

**Dry-run restore failure:** If restore or the restore recompile throws, the request returns `RESTORE_FAILED`. The material may be in an inconsistent state. The original compile result is lost. This is the worst-case scenario and should be rare.

**pull(payload):**
1. Validate target fields
2. Resolve target
3. Read state: `material_custom.read_expression_state(target.expression)`
4. Look up last backup ID for this expression
5. Return

**validate(payload):**
1. Build `PushRequest` with `dry_run` forced to `True`
2. Delegate to push orchestration
3. `backupId` is always null in response

**list_targets(query):**
1. If `materialPath` in query: load single material, find Custom Expressions
2. If no filter: scan `/Game/` for material assets only (not instances), filter to those with Custom Expressions
3. Hard cap 200 materials, early exit once reached
4. Enumeration order is not guaranteed
5. Return with `hasMore` flag

**status():**
1. Return static bridge info plus engine version from `unreal.SystemLibrary`

### Material Custom Expression Operations (shaderweave/material_custom.py)

UE4-specific logic. The only file in this package that imports `unreal`.

**resolve_target(material_path, expression_guid) -> ResolvedTarget:**
- Load material via `EditorAssetLibrary.load_asset(material_path)`
- Verify it is a `Material` (not `MaterialInstanceConstant`)
- Iterate `material.get_editor_property("expressions")`
- For each, check `isinstance(expr, unreal.MaterialExpressionCustom)`
- Compare `str(expr.get_editor_property("material_expression_guid")).upper()` against `expression_guid.upper()`
- On match, return `ResolvedTarget` dataclass
- On miss, collect all Custom Expression GUIDs + descriptions for error

**snapshot_expression(expr) -> ExpressionSnapshot:**
- Read `expr.get_editor_property("code")`
- Read inputs array (names + types)
- Read output type
- Compute code_hash (SHA-1) for debug assertions

**apply_to_expression(expr, request):**
- `expr.set_editor_property("code", request.code)`
- Rebuild inputs: if exact array element mutation is unreliable in UE4.27 Python, reconstruct the entire inputs array from plain Python data and set it back as a whole. Input order from the request is preserved exactly.
- Set output type via engine enum mapping

**restore_expression(expr, snapshot):**
- Apply snapshot.code, snapshot.inputs, snapshot.output_type back to the expression
- Same mechanism as apply_to_expression

**recompile_material(material) -> CompileResult:**
- Record start time
- Trigger recompile via `material.post_edit_change()` or `MaterialEditingLibrary.recompile_material()` (verify which is available in UE4.27)
- Record end time for compile_time_ms
- Capture compile errors via one of three strategies (in priority order):
  1. Direct API if available (check material compile status properties)
  2. Log capture (hook output log before compile, filter for shader error patterns, unhook after)
  3. Stats check on material error state post-compile
- Return structured CompileResult
- If compile status can be determined but detailed diagnostics cannot, return `compiled: false` with empty `errors` and a warning

**read_expression_state(expr) -> dict:**
- Read code, inputs, output type, description
- Return as dict for pull response

**Type mapping:**

```python
OUTPUT_TYPE_MAP = {
    "float":  "CMOT_Float1",   # verify exact enum name in UE4.27
    "float2": "CMOT_Float2",
    "float3": "CMOT_Float3",
    "float4": "CMOT_Float4",
}

INPUT_TYPE_MAP = {
    "float":        "FunctionInput_Scalar",
    "float2":       "FunctionInput_Vector2",
    "float3":       "FunctionInput_Vector3",
    "float4":       "FunctionInput_Vector4",
    "texture2d":    "FunctionInput_Texture2D",
    # "samplerstate" deferred to post-MVP -- no clear EFunctionInputType mapping in UE4.27
}
```

Exact enum names are subject to UE4.27 verification. The validation layer maps user strings to validated tokens before the engine layer receives them.

### Validation (shaderweave/validation.py)

**Type validation:**

```python
VALID_INPUT_TYPES = {"float", "float2", "float3", "float4", "texture2d"}
# "samplerstate" deferred to post-MVP verification
VALID_OUTPUT_TYPES = {"float", "float2", "float3", "float4"}
```

All lowercase. Reject anything not in the set.

**Input name validation:**
- Must match `^[a-zA-Z_][a-zA-Z0-9_]*$`
- Must not be in the reserved names list. This list includes HLSL keywords and built-in type names that would cause confusing behavior as Custom Expression input names (not a complete HLSL reserved word list, but names that conflict with common shader identifiers): `float`, `float2`, `float3`, `float4`, `float2x2`, `float3x3`, `float4x4`, `int`, `uint`, `bool`, `half`, `double`, `void`, `return`, `if`, `else`, `for`, `while`, `do`, `switch`, `case`, `break`, `continue`, `struct`, `class`, `true`, `false`, `discard`, `in`, `out`, `inout`, `uniform`, `sampler`, `texture`, `static`, `const`, `extern`, `register`, `cbuffer`, `tbuffer`, `matrix`, `SamplerState`, `Texture2D`
- Unique within the inputs array (case-sensitive)

**Payload validation:**
- `validate_push_payload(payload)` -> `PushRequest` or raises `ShaderWeaveError`
- `validate_pull_payload(payload)` -> validated target fields
- Empty `code` string is invalid for push/validate

### Backup Store (shaderweave/backup.py)

```python
class BackupStore:
    MAX_BACKUPS = 200

    def create(self, snapshot, target) -> str:
        """Create backup from snapshot. Returns backupId. Evicts oldest if at cap."""

    def get(self, backup_id) -> Optional[BackupEntry]:
        """Retrieve backup by ID."""

    def get_latest_for_expression(self, material_path, expression_guid) -> Optional[str]:
        """Return most recent backupId for this expression."""

    def clear(self) -> None:
        """Clear all backups (called on listener restart)."""
```

`backupId` format: `YYYYMMDD-HHMMSS-MMM-<first4ofGUID>` (includes milliseconds to avoid collisions during rapid iteration). Each non-dry-run push creates a new backup. No deduplication. Memory-only in v1 -- no disk persistence. Cleared on listener restart. Oldest-first eviction at 200 cap.

### Error Types (shaderweave/errors.py)

```python
class ShaderWeaveError(Exception):
    def __init__(self, code: str, message: str, details: dict = None): ...

    def to_response(self) -> dict:
        return {
            "success": False,
            "data": {},
            "error": {
                "code": self.code,
                "message": self.message,
                "details": self.details or {}
            }
        }
```

Service layer catches `ShaderWeaveError` and converts to response. Unexpected exceptions become `INTERNAL_ERROR`.

### Transaction Handling

Non-dry-run push operations are wrapped in a UE4 transaction (`@transactional("ShaderWeave Push")`). UE4's built-in undo reverts the push.

Dry-run operations are NOT transactional. They snapshot, apply, compile, restore. No undo entry created.

Failed compile does NOT roll back the push. The material contains the pushed code. The user inspects errors and iterates from there.

Pull, targets, validate, and status are read-only. No transaction needed.

### Logging

Every push/validate request logs:
- material path
- expression GUID
- dry run flag
- compile success/failure
- compile time (ms)
- backup ID if created

Log prefix: `[ShaderWeave]`

## Implementation Risk Areas

### Risk 1: Input array manipulation (HIGH)

`UMaterialExpressionCustom` inputs in UE4.27 Python bindings may not support straightforward array manipulation. The implementation is allowed to reconstruct the entire inputs array from plain Python data and set it back as a whole.

### Risk 2: Compile error capture (MEDIUM)

Structured compile errors may not be directly accessible via Python API. Fallback is log scraping with pattern matching. Worst case: boolean compiled/not-compiled with empty error details and a warning.

### Risk 3: GUID access (MEDIUM)

`material_expression_guid` property access needs verification. If UE4.27 does not expose GUIDs cleanly via Python, fallback to expression index + description matching (less stable but functional).

### Risk 4: Output type enum (LOW)

Exact enum names for Custom Expression output types may differ from documented UE5 names. Verify at implementation time.

### Risk 5: Recompile trigger (LOW)

The exact API to trigger material recompile and get feedback needs verification. `post_edit_change()` should work but may not provide compile diagnostics.

## Pass Structure

### Pass 1: Listener routing + status endpoint

**Scope:** listener.py path detection, shaderweave/__init__.py, shaderweave/router.py, shaderweave/service.py (status only), shaderweave/errors.py

**Goal:** `GET /shaderweave/v1/status` returns bridge info. Unknown routes return structured errors.

**Test:** curl to `/shaderweave/v1/status` returns JSON. curl to `/shaderweave/v1/nonexistent` returns error. Existing `POST /` commands still work unchanged.

**Success criteria:**
- Status endpoint responds correctly
- Existing MCP tools unaffected
- Path routing works for both GET and POST
- Query param parsing works

### Pass 2: Target discovery

**Scope:** shaderweave/material_custom.py (resolve_target, list Custom Expressions), shaderweave/types.py (ResolvedTarget), service.py (list_targets, pull)

**Goal:** `GET /shaderweave/v1/targets` lists materials with Custom Expression nodes. `POST /shaderweave/v1/pull` reads a specific expression's state.

**Test:** Create a material in UE4 with a Custom Expression node. curl to `/targets` shows it. curl to `/pull` with correct GUID returns code and inputs.

**Success criteria:**
- Discovers Custom Expressions across materials
- GUID resolution works (case-insensitive comparison)
- Pull returns code, inputs, outputType, description
- Error on invalid GUID includes available alternatives

**Engine risk:** GUID property access, expression type filtering.

### Pass 3: Push with compile feedback

**Scope:** shaderweave/validation.py, shaderweave/types.py (PushRequest, CompileResult, etc.), service.py (push), material_custom.py (apply, recompile), backup.py

**Goal:** `POST /shaderweave/v1/push` updates a Custom Expression's code, inputs, and output type. Material recompiles. Compile result returned with timing.

**Test:** Push valid HLSL via curl, observe material update in UE4. Push broken HLSL, get compile error in response.

**Success criteria:**
- Code appears in the Custom Expression node in UE4
- Input pins update correctly
- Material recompiles
- Compile success/failure correctly reported
- compileTimeMs is present and reasonable
- codeHash is correct
- Backup created with valid backupId
- Input name and type validation rejects bad values

**Engine risk:** Input array rebuilding, recompile trigger, error capture.

### Pass 4: Dry run + validate

**Scope:** service.py (dry run path, validate endpoint), material_custom.py (snapshot, restore), types.py (ExpressionSnapshot)

**Goal:** `dryRun: true` compiles but restores original state. `/validate` works as enforced dry run.

**Test:** Push with dryRun, verify material code is unchanged after. Call `/validate` with broken HLSL, get errors, verify no mutation.

**Success criteria:**
- Material state is identical before and after dry run
- Restore verification logs on mismatch (but does not fail request)
- Validate endpoint returns compile results
- No backup created for dry run
- No undo entry for dry run
- Second recompile after restore succeeds

**Engine risk:** Restore fidelity, second recompile after restore.

### Pass 5: Transaction support + error hardening

**Scope:** Transaction wrapping for non-dry-run pushes, error handling polish, edge cases

**Goal:** Non-dry-run pushes are undoable via UE4 undo. All error paths return structured responses.

**Test:** Push code, Ctrl+Z in UE4, verify original code restored. Hit every error path (bad GUID, bad material, bad type, bad name, empty code).

**Success criteria:**
- Ctrl+Z in UE4 reverts a non-dry-run push
- Every error code returns correctly with structured format
- No unhandled exceptions leak to client
- Backup eviction works at cap

## MCP Layer (optional, after bridge passes complete)

The ShaderWeave bridge endpoints are designed for direct HTTP access from a web app. MCP tool wrappers are optional but can be added for Claude Code integration.

If added:

### TypeScript tools (mcp-server/src/tools/shaderweave.ts)

- `shaderweave_push` -- push HLSL to Custom Expression
- `shaderweave_pull` -- read Custom Expression state
- `shaderweave_validate` -- dry-run compile check
- `shaderweave_targets` -- list available targets
- `shaderweave_status` -- bridge health check

These would send HTTP to the `/shaderweave/v1/*` endpoints (not through the command router). `shaderweave_push` added to `modifyingCommands` in `index.ts`.

This layer is NOT part of the MVP passes above.

## UE4 Engine Types Referenced

### Material
- UMaterial
- UMaterialExpressionCustom
- UMaterialEditingLibrary (if available in UE4.27)

### Properties accessed on UMaterialExpressionCustom
- `code` (FString) -- the HLSL body
- `inputs` (TArray of FCustomInput) -- input pins with name and type
- `output_type` (ECustomMaterialOutputType) -- return type enum
- `material_expression_guid` (FGuid) -- stable identifier
- `desc` (FString) -- node description string (exposed as `desc` in UE4 Python, returned as `description` in API responses)

### Compilation
- `UMaterial::PostEditChange()` or equivalent
- Shader compiler output/log messages

## Definition of Done (MVP)

The bridge MVP is complete when all of these work via curl:

1. `GET /shaderweave/v1/status` returns bridge info with transport type
2. `GET /shaderweave/v1/targets` lists materials with Custom Expressions
3. `POST /shaderweave/v1/pull` returns current code/inputs for a target
4. `POST /shaderweave/v1/push` with valid HLSL updates the material and compiles successfully
5. `POST /shaderweave/v1/push` with broken HLSL returns structured compile errors
6. `POST /shaderweave/v1/push` with `dryRun: true` compiles but restores original state
7. `POST /shaderweave/v1/validate` works as enforced dry run with no mutation
8. Ctrl+Z in UE4 reverts a non-dry-run push
9. Invalid targets, types, and names return structured error responses with correct codes
