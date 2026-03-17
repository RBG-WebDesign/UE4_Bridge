# Unreal MCP Bridge

Local tooling bridge that lets Claude Code control and automate Unreal Engine 4.27's editor through the Model Context Protocol.

Claude Code sends structured commands. The MCP server translates them. A Python listener inside UE4 executes them against the editor's live API. Results flow back.

## Quick Start

See [docs/SETUP.md](docs/SETUP.md) for the full setup walkthrough.

### Prerequisites
- UE4.27 (Epic Games Launcher install)
- Node.js 18+
- Python Editor Script Plugin enabled in your UE4 project

### Install
```bash
npm install
npm run build
```

### Wire Up
1. Copy `unreal-plugin/Content/Python/` into your UE4 project's `Content/Python/` folder
2. Restart the UE4 editor (the listener starts automatically)
3. Test: `curl -X POST http://localhost:8080 -H "Content-Type: application/json" -d '{"command":"ping"}'`

### Connect Claude Code
The `.mcp.json` at the project root handles this automatically. Open Claude Code in this directory and it will discover the MCP server.

## Architecture

```
Claude Code  -->  MCP Server (TypeScript, stdio)  -->  Python Listener (HTTP, localhost:8080)  -->  UE4 Python API
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full system design.

## Documentation
- [Setup Guide](docs/SETUP.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Tool Reference](docs/TOOL_REFERENCE.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
