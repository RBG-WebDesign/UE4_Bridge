#!/usr/bin/env node
/**
 * Multi-agent orchestrator for Claude Code CLI.
 *
 * Spawns and manages parallel subagent processes using `claude -p`.
 * Tracks state via task-queue.md and decisions.md.
 *
 * Usage:
 *   node orchestrator.mjs "Your task description here"
 *
 * Options (env vars):
 *   MAX_PARALLEL=3          Max concurrent subagents
 *   MAX_AGENT_MINUTES=10    Anti-compaction timeout per agent
 *   CLAUDE_CMD=claude       Path to claude CLI binary
 */

import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";

// ─── Config ────────────────────────────────────────────────────────────────────

const MAX_PARALLEL = parseInt(process.env.MAX_PARALLEL || "3", 10);
const MAX_AGENT_MS = parseInt(process.env.MAX_AGENT_MINUTES || "10", 10) * 60_000;
const CLAUDE_CMD = process.env.CLAUDE_CMD || "claude";
const IS_WINDOWS = process.platform === "win32";
const WORK_DIR = process.cwd();
const TASK_QUEUE_PATH = join(WORK_DIR, "task-queue.md");
const DECISIONS_PATH = join(WORK_DIR, "decisions.md");
const LOG_DIR = join(WORK_DIR, ".orchestrator");

// ─── ANSI Colors ───────────────────────────────────────────────────────────────

const RST = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const MAGENTA = "\x1b[35m";
const CYAN = "\x1b[36m";
const WHITE = "\x1b[37m";

const AGENT_COLORS = [CYAN, GREEN, YELLOW, MAGENTA, BLUE];

function agentColor(id) {
  return AGENT_COLORS[id % AGENT_COLORS.length];
}

function log(msg) {
  const ts = new Date().toLocaleTimeString("en-US", { hour12: false });
  console.log(`${DIM}[${ts}]${RST} ${BOLD}${WHITE}[orchestrator]${RST} ${msg}`);
}

function agentLog(id, name, msg) {
  const ts = new Date().toLocaleTimeString("en-US", { hour12: false });
  const c = agentColor(id);
  const label = name.length > 30 ? name.slice(0, 27) + "..." : name;
  console.log(`${DIM}[${ts}]${RST} ${c}[agent-${id}:${label}]${RST} ${msg}`);
}

function errorLog(msg) {
  const ts = new Date().toLocaleTimeString("en-US", { hour12: false });
  console.log(`${DIM}[${ts}]${RST} ${RED}${BOLD}[ERROR]${RST} ${msg}`);
}

// ─── State ─────────────────────────────────────────────────────────────────────

/** @type {{ id: number, name: string, prompt: string, status: string, result?: string, error?: string, attempts: number }[]} */
let tasks = [];
let nextTaskId = 1;
let nextAgentId = 1;

/** @type {Map<number, { proc: import('child_process').ChildProcess, task: typeof tasks[0], output: string, startTime: number, agentId: number }>} */
const activeAgents = new Map();

/** Resolvers waiting for any agent to finish */
let completionResolvers = [];

// ─── Markdown State Files ──────────────────────────────────────────────────────

function writeTaskQueue() {
  const lines = ["# Task Queue\n", `> Last updated: ${new Date().toISOString()}\n`];

  const sections = [
    ["Active", tasks.filter((t) => t.status === "active")],
    ["Pending", tasks.filter((t) => t.status === "pending")],
    ["Completed", tasks.filter((t) => t.status === "completed")],
    ["Failed", tasks.filter((t) => t.status === "failed")],
  ];

  for (const [title, items] of sections) {
    lines.push(`\n## ${title}\n`);
    if (items.length === 0) {
      lines.push("_none_\n");
    } else {
      for (const t of items) {
        const check = t.status === "completed" ? "x" : " ";
        const suffix = t.error ? ` -- ERROR: ${t.error}` : "";
        lines.push(`- [${check}] **Task ${t.id}:** ${t.name}${suffix}`);
      }
      lines.push("");
    }
  }

  writeFileSync(TASK_QUEUE_PATH, lines.join("\n"));
}

function appendDecision(heading, body) {
  const entry = `\n### ${heading}\n_${new Date().toISOString()}_\n\n${body}\n`;
  appendFileSync(DECISIONS_PATH, entry);
}

function initDecisions(taskDescription) {
  writeFileSync(
    DECISIONS_PATH,
    `# Decisions Log\n\nOrchestrator session started: ${new Date().toISOString()}\n\n**Task:** ${taskDescription}\n`
  );
}

function initLogDir() {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
}

// ─── Claude CLI Wrapper ────────────────────────────────────────────────────────

/**
 * Spawn a claude process with -p flag. Returns a promise that resolves with
 * { result: string, cost: number, duration: number, turns: number, sessionId: string }
 * or rejects on error.
 */
function spawnClaude(prompt, opts = {}) {
  return new Promise((resolve, reject) => {
    // Prompt is delivered via stdin, NOT as a -p positional arg.
    // Passing multi-line prompts as args breaks on Windows due to shell escaping.
    const args = ["-p", "--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions"];

    if (opts.maxTurns) args.push("--max-turns", String(opts.maxTurns));
    if (opts.appendSystemPrompt) args.push("--append-system-prompt", opts.appendSystemPrompt);
    if (opts.resume) args.push("--resume", opts.resume);

    // Unset CLAUDECODE so child process doesn't think it's nested
    const env = { ...process.env };
    delete env.CLAUDECODE;

    const proc = spawn(CLAUDE_CMD, args, {
      cwd: WORK_DIR,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      shell: IS_WINDOWS,  // Windows needs shell to resolve .cmd shims
    });

    // Write prompt to stdin then close -- claude reads from stdin when no positional arg
    proc.stdin.write(prompt);
    proc.stdin.end();

    let output = "";
    let resultData = null;
    let stderrBuf = "";

    const rl = createInterface({ input: proc.stdout, crlfDelay: Infinity });

    rl.on("line", (line) => {
      if (!line.trim()) return;
      try {
        const evt = JSON.parse(line);
        handleStreamEvent(evt, proc, opts);

        // Accumulate assistant text
        if (evt.type === "assistant" && evt.message?.content) {
          for (const block of evt.message.content) {
            if (block.type === "text") {
              output += block.text;
            }
          }
        }

        // Result event = completion. Prefer accumulated output over evt.result
        // because evt.result duplicates the assistant text.
        if (evt.type === "result") {
          resultData = {
            result: output || evt.result,
            cost: evt.total_cost_usd || 0,
            duration: evt.duration_ms || 0,
            turns: evt.num_turns || 0,
            sessionId: evt.session_id || "",
            isError: evt.is_error || false,
          };
        }
      } catch {
        // Not JSON -- might be raw stderr leak or partial line, ignore
      }
    });

    proc.stderr.on("data", (chunk) => {
      stderrBuf += chunk.toString();
    });

    proc.on("close", (code) => {
      if (resultData) {
        resolve({ ...resultData, output, proc });
      } else if (code === 0) {
        resolve({ result: output, output, cost: 0, duration: 0, turns: 0, sessionId: "", isError: false, proc });
      } else {
        reject(new Error(`claude exited with code ${code}: ${stderrBuf.slice(0, 500)}`));
      }
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to spawn claude: ${err.message}`));
    });

    // Attach proc to the promise for external kill
    resolve._proc = proc;
    if (opts.onSpawn) opts.onSpawn(proc);
  });
}

function handleStreamEvent(evt, proc, opts) {
  // Hook for external monitoring
  if (opts.onEvent) opts.onEvent(evt);
}

// ─── Task Decomposition ────────────────────────────────────────────────────────

async function decompose(taskDescription) {
  log("Decomposing task into subtasks...");

  const decompositionPrompt = `You are a task decomposition engine. Your ONLY output is a JSON array. No prose. No markdown. No explanation.

Read CLAUDE.md to understand the project structure, then decompose this task:

${taskDescription}

Output a JSON array where each element is:
{"name":"short name","prompt":"detailed instructions for an agent including file paths","batch":1}

Rules:
- batch 1 runs first, batch 2 runs after batch 1 completes, etc.
- Same-batch tasks run in parallel so they MUST NOT edit the same files
- Include a final verification task in the last batch
- Be specific in prompts: name exact files, functions, and what to change

YOUR ENTIRE RESPONSE MUST BE A SINGLE JSON ARRAY. Example:
[{"name":"Add X to Y","prompt":"Open file Z and add...","batch":1}]`;

  try {
    const { result } = await spawnClaude(decompositionPrompt, { maxTurns: 5 });

    // Extract the first valid JSON array from result.
    // Use a bracket-counting approach since the result may contain duplicated text.
    const arrayStart = result.indexOf("[");
    if (arrayStart === -1) {
      throw new Error("Decomposition did not return a JSON array");
    }

    let depth = 0;
    let arrayEnd = -1;
    for (let i = arrayStart; i < result.length; i++) {
      if (result[i] === "[") depth++;
      else if (result[i] === "]") depth--;
      if (depth === 0) { arrayEnd = i + 1; break; }
    }
    if (arrayEnd === -1) {
      throw new Error("Decomposition returned unterminated JSON array");
    }

    const subtasks = JSON.parse(result.slice(arrayStart, arrayEnd));

    if (!Array.isArray(subtasks) || subtasks.length === 0) {
      throw new Error("Decomposition returned empty or invalid array");
    }

    log(`${GREEN}Decomposed into ${subtasks.length} subtasks across ${Math.max(...subtasks.map((t) => t.batch))} batches${RST}`);

    return subtasks.map((t) => ({
      id: nextTaskId++,
      name: t.name,
      prompt: t.prompt,
      batch: t.batch || 1,
      status: "pending",
      attempts: 0,
    }));
  } catch (err) {
    errorLog(`Decomposition failed: ${err.message}`);
    // Fallback: run the whole task as one subtask
    log(`${YELLOW}Falling back to single-task execution${RST}`);
    return [
      {
        id: nextTaskId++,
        name: "Full task (decomposition failed)",
        prompt: taskDescription,
        batch: 1,
        status: "pending",
        attempts: 0,
      },
    ];
  }
}

// ─── Question Detection & Answering ────────────────────────────────────────────

const QUESTION_PATTERNS = [
  /should I .+\?/i,
  /which (?:approach|option|method|pattern) .+\?/i,
  /I'm (?:not sure|unsure|uncertain) .+/i,
  /unclear (?:whether|if|how) .+/i,
  /do you (?:want|prefer) .+\?/i,
];

function detectQuestions(text) {
  const questions = [];
  for (const pattern of QUESTION_PATTERNS) {
    const match = text.match(pattern);
    if (match) questions.push(match[0]);
  }
  return questions;
}

async function answerQuestion(question, context) {
  log(`${YELLOW}Answering subagent question: "${question.slice(0, 80)}..."${RST}`);

  const answerPrompt = `A subagent working on the UE_Bridge project asked this question:

"${question}"

Context about what the agent is doing: ${context}

Answer the question concisely based on the project's CLAUDE.md, specs, and existing code patterns. Give a direct answer, not a discussion.`;

  try {
    const { result } = await spawnClaude(answerPrompt, { maxTurns: 2 });
    appendDecision(`Question Answered`, `**Q:** ${question}\n**A:** ${result.slice(0, 500)}`);
    return result;
  } catch (err) {
    errorLog(`Failed to answer question: ${err.message}`);
    return null;
  }
}

// ─── Agent Lifecycle ───────────────────────────────────────────────────────────

function launchAgent(task) {
  const agentId = nextAgentId++;
  task.status = "active";
  task.attempts++;
  writeTaskQueue();

  const systemPrompt = `You are subagent ${agentId} in a multi-agent orchestrator.
Shared state files in the project root:
- task-queue.md: current task status (read before starting, do NOT modify)
- decisions.md: decisions and context from other agents (read before starting, do NOT modify)

Your assigned task: "${task.name}"
Complete your task, then summarize what you did in 2-3 sentences at the end.`;

  agentLog(agentId, task.name, `${BOLD}Starting${RST} (attempt ${task.attempts})`);

  let agentOutput = "";
  let agentProc = null;

  const promise = spawnClaude(task.prompt, {
    appendSystemPrompt: systemPrompt,
    onSpawn: (proc) => {
      agentProc = proc;
      activeAgents.set(task.id, {
        proc,
        task,
        output: "",
        startTime: Date.now(),
        agentId,
      });
    },
    onEvent: (evt) => {
      // Accumulate text for monitoring
      if (evt.type === "assistant" && evt.message?.content) {
        for (const block of evt.message.content) {
          if (block.type === "text") {
            agentOutput += block.text;

            // Show first meaningful line of output
            const lines = block.text.split("\n").filter((l) => l.trim());
            if (lines.length > 0 && agentOutput.length < 500) {
              agentLog(agentId, task.name, `${DIM}${lines[0].slice(0, 100)}${RST}`);
            }
          }
        }
      }
    },
  });

  // Anti-compaction timer
  const timer = setTimeout(() => {
    const agent = activeAgents.get(task.id);
    if (agent) {
      agentLog(agentId, task.name, `${YELLOW}Anti-compaction: killing after ${MAX_AGENT_MS / 60_000}min${RST}`);
      agent.proc.kill("SIGTERM");
      // Will be respawned with summary by the completion handler
      agent._antiCompacted = true;
    }
  }, MAX_AGENT_MS);

  promise
    .then((result) => {
      clearTimeout(timer);
      const agent = activeAgents.get(task.id);
      const elapsed = agent ? ((Date.now() - agent.startTime) / 1000).toFixed(1) : "?";

      task.status = "completed";
      task.result = result.result?.slice(0, 1000) || agentOutput.slice(-1000);
      activeAgents.delete(task.id);
      writeTaskQueue();

      const costStr = result.cost > 0 ? ` ($${result.cost.toFixed(4)})` : "";
      agentLog(agentId, task.name, `${GREEN}${BOLD}Completed${RST} ${DIM}(${elapsed}s, ${result.turns} turns${costStr})${RST}`);

      appendDecision(
        `Task ${task.id} Completed: ${task.name}`,
        `${task.result?.slice(0, 500) || "(no output)"}`
      );

      // Check for questions in output (informational, logged to decisions)
      const questions = detectQuestions(agentOutput);
      if (questions.length > 0) {
        appendDecision(
          `Questions from Task ${task.id}`,
          questions.map((q) => `- ${q}`).join("\n")
        );
      }

      notifyCompletion();
    })
    .catch((err) => {
      clearTimeout(timer);
      const agent = activeAgents.get(task.id);

      // Anti-compaction: respawn with summary
      if (agent?._antiCompacted && task.attempts < 3) {
        agentLog(agentId, task.name, `${YELLOW}Respawning with progress summary${RST}`);
        const summary = agentOutput.slice(-2000);
        task.prompt = `Continue this task. Here is what was accomplished so far:\n\n${summary}\n\nOriginal task: ${task.prompt}`;
        task.status = "pending";
        activeAgents.delete(task.id);
        writeTaskQueue();
        notifyCompletion();
        return;
      }

      task.status = "failed";
      task.error = err.message.slice(0, 200);
      activeAgents.delete(task.id);
      writeTaskQueue();

      agentLog(agentId, task.name, `${RED}${BOLD}Failed:${RST} ${RED}${err.message.slice(0, 100)}${RST}`);
      appendDecision(`Task ${task.id} Failed: ${task.name}`, `Error: ${err.message.slice(0, 300)}`);
      notifyCompletion();
    });

  return agentId;
}

function notifyCompletion() {
  for (const resolver of completionResolvers) {
    resolver();
  }
  completionResolvers = [];
}

function waitForAnyCompletion() {
  if (activeAgents.size === 0) return Promise.resolve();
  return new Promise((resolve) => {
    completionResolvers.push(resolve);
  });
}

// ─── Kill idle agents ──────────────────────────────────────────────────────────

function killIdleAgents() {
  // In practice, agents with -p run to completion. This handles edge cases
  // where an agent hangs (no output for a long time).
  const IDLE_THRESHOLD_MS = 5 * 60_000; // 5 min no output

  for (const [taskId, agent] of activeAgents) {
    const elapsed = Date.now() - agent.startTime;
    if (elapsed > IDLE_THRESHOLD_MS && agent.output.length === 0) {
      agentLog(agent.agentId, agent.task.name, `${RED}Killing idle agent (no output for ${(elapsed / 60_000).toFixed(1)}min)${RST}`);
      agent.proc.kill("SIGTERM");
    }
  }
}

// ─── Main Orchestration Loop ───────────────────────────────────────────────────

async function orchestrate(taskDescription) {
  console.log(`\n${BOLD}${WHITE}═══════════════════════════════════════════════════════════════${RST}`);
  console.log(`${BOLD}${WHITE}  Multi-Agent Orchestrator${RST}`);
  console.log(`${BOLD}${WHITE}═══════════════════════════════════════════════════════════════${RST}`);
  console.log(`${DIM}  Max parallel: ${MAX_PARALLEL} | Anti-compaction: ${MAX_AGENT_MS / 60_000}min | PID: ${process.pid}${RST}\n`);

  // Initialize state files
  initDecisions(taskDescription);
  writeFileSync(TASK_QUEUE_PATH, "# Task Queue\n\n_Decomposing..._\n");

  // Step 1: Decompose task
  tasks = await decompose(taskDescription);
  writeTaskQueue();

  log(`Task queue initialized with ${tasks.length} subtasks`);
  for (const t of tasks) {
    log(`  ${DIM}[batch ${t.batch}]${RST} Task ${t.id}: ${t.name}`);
  }
  console.log("");

  // Step 2: Execute batch by batch
  const maxBatch = Math.max(...tasks.map((t) => t.batch));

  for (let batch = 1; batch <= maxBatch; batch++) {
    const batchTasks = tasks.filter((t) => t.batch === batch && t.status === "pending");
    if (batchTasks.length === 0) continue;

    log(`${BOLD}═── Batch ${batch}/${maxBatch} (${batchTasks.length} tasks) ──═${RST}`);
    appendDecision(`Batch ${batch} Started`, `Tasks: ${batchTasks.map((t) => t.name).join(", ")}`);

    // Launch tasks up to MAX_PARALLEL
    let launched = 0;
    for (const task of batchTasks) {
      // Wait if at capacity
      while (activeAgents.size >= MAX_PARALLEL) {
        await waitForAnyCompletion();
      }

      launchAgent(task);
      launched++;

      // Small stagger to avoid rate limits
      if (launched < batchTasks.length) {
        await sleep(2000);
      }
    }

    // Wait for all agents in this batch to finish
    while (activeAgents.size > 0) {
      await waitForAnyCompletion();
    }

    const completed = tasks.filter((t) => t.batch === batch && t.status === "completed").length;
    const failed = tasks.filter((t) => t.batch === batch && t.status === "failed").length;
    log(`${BOLD}Batch ${batch} done:${RST} ${GREEN}${completed} completed${RST}, ${failed > 0 ? `${RED}${failed} failed${RST}` : "0 failed"}\n`);
  }

  // Step 3: Summary
  printSummary();
}

function printSummary() {
  const completed = tasks.filter((t) => t.status === "completed");
  const failed = tasks.filter((t) => t.status === "failed");

  console.log(`\n${BOLD}${WHITE}═══════════════════════════════════════════════════════════════${RST}`);
  console.log(`${BOLD}${WHITE}  Orchestration Complete${RST}`);
  console.log(`${BOLD}${WHITE}═══════════════════════════════════════════════════════════════${RST}`);
  console.log(`  ${GREEN}${BOLD}${completed.length}${RST} completed, ${failed.length > 0 ? `${RED}${BOLD}${failed.length}${RST} failed` : "0 failed"}`);
  console.log(`  ${DIM}Task queue: ${TASK_QUEUE_PATH}${RST}`);
  console.log(`  ${DIM}Decisions:  ${DECISIONS_PATH}${RST}\n`);

  if (failed.length > 0) {
    console.log(`${RED}Failed tasks:${RST}`);
    for (const t of failed) {
      console.log(`  ${RED}- Task ${t.id}: ${t.name}${RST}`);
      console.log(`    ${DIM}${t.error}${RST}`);
    }
    console.log("");
  }

  appendDecision("Orchestration Complete", `${completed.length} completed, ${failed.length} failed out of ${tasks.length} total tasks.`);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Graceful Shutdown ─────────────────────────────────────────────────────────

function shutdown() {
  log(`${YELLOW}Shutting down -- killing ${activeAgents.size} active agents...${RST}`);

  for (const [, agent] of activeAgents) {
    try {
      agent.proc.kill("SIGTERM");
    } catch {}
  }

  // Update state files
  for (const task of tasks) {
    if (task.status === "active") task.status = "pending";
  }
  writeTaskQueue();
  appendDecision("Orchestrator Shutdown", "Graceful shutdown -- active tasks returned to pending.");

  setTimeout(() => process.exit(0), 1000);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// ─── Entry Point ───────────────────────────────────────────────────────────────

const taskDesc = process.argv.slice(2).join(" ");

if (!taskDesc) {
  console.log(`${BOLD}Usage:${RST} node orchestrator.mjs "task description"`);
  console.log(`\n${DIM}Environment variables:${RST}`);
  console.log(`  MAX_PARALLEL=3          Max concurrent subagents`);
  console.log(`  MAX_AGENT_MINUTES=10    Anti-compaction timeout`);
  console.log(`  CLAUDE_CMD=claude       Path to claude CLI`);
  process.exit(1);
}

orchestrate(taskDesc).catch((err) => {
  errorLog(`Fatal: ${err.message}`);
  shutdown();
});
