import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawn, execSync, execFile } from "node:child_process";

// Windows Alert Helper
function showWindowsAlert(title, message, iconType = "error") {
  if (process.platform !== "win32") return;
  const code = iconType === "error" ? 16 : 48;
  const escapedMessage = String(message).replace(/"/g, '""').replace(/\r?\n/g, '" & vbCrLf & "');
  const escapedTitle = String(title).replace(/"/g, '""');
  const vbsCode = `vbscript:Execute("msgbox ""${escapedMessage}"", ${code}, ""${escapedTitle}""")(window.close)`;
  execFile("mshta", [vbsCode], () => {});
}

const SCRATCH_DIR = path.join(os.homedir(), ".gemini", "antigravity", "scratch");
const LOG_FILE = path.join(SCRATCH_DIR, "broker.log");

function writeToLogFile(level, message) {
  try {
    if (!fs.existsSync(SCRATCH_DIR)) {
      fs.mkdirSync(SCRATCH_DIR, { recursive: true });
    }
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] [${level}] ${message}\n`;
    fs.appendFileSync(LOG_FILE, line, "utf8");
    // Limit log file size to ~500KB
    const stats = fs.statSync(LOG_FILE);
    if (stats.size > 500 * 1024) {
      const content = fs.readFileSync(LOG_FILE, "utf8");
      const truncated = content.slice(content.length - 250 * 1024);
      fs.writeFileSync(LOG_FILE, truncated, "utf8");
    }
  } catch (e) {
    // Ignore logging errors to prevent crash loops
  }
}

// Global console hooks to log to file and pop up dialog boxes for all errors/warnings
const originalConsoleLog = console.log;
console.log = function(...args) {
  originalConsoleLog.apply(console, args);
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  writeToLogFile("INFO", msg);
};

const originalConsoleError = console.error;
console.error = function(...args) {
  originalConsoleError.apply(console, args);
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  writeToLogFile("ERROR", msg);
  showWindowsAlert("Bridge Error", msg, "error");
};

const originalConsoleWarn = console.warn;
console.warn = function(...args) {
  originalConsoleWarn.apply(console, args);
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  writeToLogFile("WARN", msg);
  showWindowsAlert("Bridge Warning", msg, "warning");
};

// Dynamic Configuration paths
const CAM_HOME = path.join(os.homedir(), ".qexow-cam");
const CONFIG_FILE = path.join(CAM_HOME, "config.json");
const TOKEN_FILE = path.join(CAM_HOME, "secrets", "local-api-token");
const MAPPINGS_FILE = path.join(SCRATCH_DIR, "broker_mappings.json");
const BRAIN_DIR = path.join(os.homedir(), ".gemini", "antigravity", "brain");

const AGENT_NAME = "antigravity";
let lastProcessedMessageId = null;
let isProcessing = false;
let isChecking = false;

// Auto-Discovery of AGY Path
function resolveAgyPath() {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
  const agyExePath = path.join(localAppData, "Programs", "Antigravity", "resources", "bin", "language_server.exe");
  if (fs.existsSync(agyExePath)) return agyExePath;
  return "language_server.exe"; // Fallback to system PATH
}

const AGY_EXE = resolveAgyPath();

// Bootstrap / Auto-Discovery / OAuth Phase
function bootstrapEnvironment() {
  console.log(`\n==================================================`);
  console.log(`[BOOTSTRAP] Verifying Codex and Antigravity Environments...`);
  console.log(`==================================================`);

  // 1. Verify Antigravity CLI (agy)
  try {
    execSync('agy --version', { stdio: 'ignore' });
  } catch (e) {
    console.error(`[BOOTSTRAP] Antigravity CLI ('agy') not found in PATH.`);
    console.log(`[BOOTSTRAP] Please download the Antigravity Desktop App and ensure 'agy' is added to your PATH.`);
    console.log(`[BOOTSTRAP] Make sure the language server exists at: ${AGY_EXE}`);
  }

  // 2. Verify Antigravity Auth
  try {
    console.log(`[BOOTSTRAP] Checking Antigravity OAuth...`);
    const agyStatus = execSync('agy status', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    if (agyStatus.toLowerCase().includes('unauthenticated') || agyStatus.toLowerCase().includes('login required')) {
      throw new Error("Needs login");
    }
  } catch (e) {
    console.warn(`[BOOTSTRAP] WARNING: Antigravity OAuth missing or expired. Run 'agy login' in a terminal or click 'Login' in the tray status window.`);
  }

  // 3. Verify Codex CLI
  try {
    console.log(`[BOOTSTRAP] Checking Codex CLI...`);
    execSync('codex --version', { stdio: 'ignore' });
  } catch (e) {
    console.error(`[BOOTSTRAP] Codex CLI ('codex') not found in PATH.`);
    console.log(`[BOOTSTRAP] To install, run: npm install -g @openai/codex-cli`);
  }

  // 4. Verify Codex Auth
  try {
    console.log(`[BOOTSTRAP] Checking Codex OAuth...`);
    execSync('codex whoami', { stdio: 'ignore' });
  } catch (e) {
    console.warn(`[BOOTSTRAP] WARNING: Codex OAuth missing or expired. Run 'codex login' in a terminal or click 'Login' in the tray status window.`);
  }

  // 5. Inject CAM Skills for Antigravity and Codex
  console.log(`[BOOTSTRAP] Injecting CAM messaging skills into Antigravity global directory...`);
  installAntigravitySkills();
  console.log(`[BOOTSTRAP] Injecting CAM messaging skills into Codex global directory...`);
  installCodexSkills();

  // 6. Verify CAM CLI
  try {
    console.log(`[BOOTSTRAP] Checking Qexow CAM CLI...`);
    execSync('cam --version', { stdio: 'ignore' });
  } catch (e) {
    console.warn(`[BOOTSTRAP] WARNING: CAM CLI ('cam') not found in PATH.`);
    console.warn(`[BOOTSTRAP] Please ensure you have downloaded and run the Qexow CAM Windows Installer.`);
    console.warn(`[BOOTSTRAP] The broker will continue polling, but injection may fail until CAM is installed.`);
  }

  // Determine local development CAM path dynamically
  const scriptDir = typeof __dirname !== 'undefined' ? __dirname : path.dirname(process.argv[1] || '.');
  const devCamPath = path.resolve(scriptDir, "..", "qexow-cam", "cam.cmd");
  if (!fs.existsSync(devCamPath)) {
    // Also check old name for backward-compat during transition
    const legacyPath = path.resolve(scriptDir, "..", "codex-agent-manager", "cam.cmd");
    if (fs.existsSync(legacyPath)) Object.assign({devCamPath: legacyPath});
  }
  const camCmd = fs.existsSync(devCamPath) ? `"${devCamPath}"` : 'cam';

  // Dynamic Antigravity agent registration is handled automatically by daemon active thread sync

  // 8. Verify CAM Daemon Status
  try {
    console.log(`[BOOTSTRAP] Checking CAM Daemon status...`);
    const camStatus = execSync(`${camCmd} daemon status`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    if (camStatus.toLowerCase().includes('stopped') || camStatus.toLowerCase().includes('not running')) {
      console.log(`[BOOTSTRAP] CAM Daemon is stopped. Attempting to start it...`);
      execSync(`${camCmd} daemon start`, { stdio: 'ignore' });
    }
  } catch (e) {
    console.warn(`[BOOTSTRAP] WARNING: Could not verify CAM daemon status. Make sure the CAM daemon is running in the background.`);
  }

  console.log(`[BOOTSTRAP] Environment Verification Complete!\n`);
}

function installAntigravitySkills() {
  const skillsDir = path.join(os.homedir(), ".gemini", "antigravity", "skills");
  const camSkillDir = path.join(skillsDir, "qexow-cam-messaging");
  
  if (!fs.existsSync(camSkillDir)) {
    fs.mkdirSync(camSkillDir, { recursive: true });
  }

  const sourcePs1 = path.join(SCRATCH_DIR, "Send-AgentMessage.ps1");
  const destPs1 = path.join(camSkillDir, "Send-AgentMessage.ps1");

  if (fs.existsSync(sourcePs1)) {
    fs.copyFileSync(sourcePs1, destPs1);
  } else {
    const defaultPs1 = `
param (
    [string]$TargetAgent,
    [string]$MessageText
)

$tokenFile = "$env:USERPROFILE\\.qexow-cam\\secrets\\local-api-token"
$configFile = "$env:USERPROFILE\\.qexow-cam\\config.json"

if (-not (Test-Path $tokenFile)) {
    Throw "CAM token file not found at $tokenFile. Fallbacks are disabled."
}
if (-not (Test-Path $configFile)) {
    Throw "CAM config file not found at $configFile. Fallbacks are disabled."
}

$token = (Get-Content $tokenFile -Raw).Trim()
$config = Get-Content $configFile -Raw | ConvertFrom-Json
if (-not $config.port) {
    Throw "CAM port configuration is missing in $configFile. Fallbacks are disabled."
}
$port = $config.port

$body = @{
    targetAgent = $TargetAgent
    message = $MessageText
    sourceAgent = "antigravity"
} | ConvertTo-Json

$response = Invoke-RestMethod -Uri "http://127.0.0.1:$port/send" -Method Post -Headers @{ Authorization = "Bearer $token" } -Body $body -ContentType "application/json"
$response | ConvertTo-Json -Depth 5
`;
    fs.writeFileSync(destPs1, defaultPs1.trim(), "utf8");
  }

  const skillDef = {
    name: "cam_send_message",
    description: "Send a message to another agent via the Qexow CAM (CAM) protocol. Use this to respond to incoming requests from other agents.",
    entrypoint: "pwsh.exe -File .\\Send-AgentMessage.ps1 -TargetAgent \"{{TargetAgent}}\" -MessageText \"{{MessageText}}\"",
    parameters: {
      type: "object",
      properties: {
        TargetAgent: { type: "string", description: "The name of the target agent to send the message to." },
        MessageText: { type: "string", description: "The text body of the message." }
      },
      required: ["TargetAgent", "MessageText"]
    }
  };

  fs.writeFileSync(path.join(camSkillDir, "skill.json"), JSON.stringify(skillDef, null, 2), "utf8");
  console.log(`[BOOTSTRAP] Skill 'cam_send_message' successfully installed at ${camSkillDir}`);

  // Install Check Inbox Skill
  const inboxSkillDir = path.join(skillsDir, "qexow-cam-inbox");
  if (!fs.existsSync(inboxSkillDir)) {
    fs.mkdirSync(inboxSkillDir, { recursive: true });
  }

  const inboxPs1 = `
param (
    [int]$WaitSeconds = 20
)

$tokenFile = "$env:USERPROFILE\\.qexow-cam\\secrets\\local-api-token"
$configFile = "$env:USERPROFILE\\.qexow-cam\\config.json"

if (-not (Test-Path $tokenFile)) {
    Throw "CAM token file not found at $tokenFile. Fallbacks are disabled."
}
if (-not (Test-Path $configFile)) {
    Throw "CAM config file not found at $configFile. Fallbacks are disabled."
}

$token = (Get-Content $tokenFile -Raw).Trim()
$config = Get-Content $configFile -Raw | ConvertFrom-Json
if (-not $config.port) {
    Throw "CAM port configuration is missing in $configFile. Fallbacks are disabled."
}
$port = $config.port

$uri = "http://127.0.0.1:$port/inbox?agent=antigravity"
if ($WaitSeconds -gt 0) {
    $uri += "&wait=$WaitSeconds"
}

$response = Invoke-RestMethod -Uri $uri -Method Get -Headers @{ Authorization = "Bearer $token" }
$response | ConvertTo-Json -Depth 5
`;
  
  fs.writeFileSync(path.join(inboxSkillDir, "Check-AgentMessages.ps1"), inboxPs1.trim(), "utf8");

  const inboxSkillDef = {
    name: "cam_check_inbox",
    description: "Check your Qexow CAM inbox for any pending messages from other agents. Set WaitSeconds to block and wait for a response if none are currently available.",
    entrypoint: "pwsh.exe -File .\\Check-AgentMessages.ps1 -WaitSeconds {{WaitSeconds}}",
    parameters: {
      type: "object",
      properties: {
        WaitSeconds: { type: "integer", description: "Optional. Number of seconds to block and wait for a message if the inbox is currently empty (up to 30). Defaults to 20." }
      },
      required: []
    }
  };

  fs.writeFileSync(path.join(inboxSkillDir, "skill.json"), JSON.stringify(inboxSkillDef, null, 2), "utf8");
  console.log(`[BOOTSTRAP] Skill 'cam_check_inbox' successfully installed at ${inboxSkillDir}`);
}

function installCodexSkills() {
  const skillsDir = path.join(os.homedir(), ".codex", "skills");
  const camSkillDir = path.join(skillsDir, "qexow-cam-messaging");
  const scriptsDir = path.join(camSkillDir, "scripts");

  if (!fs.existsSync(scriptsDir)) {
    fs.mkdirSync(scriptsDir, { recursive: true });
  }

  const skillMd = `---
name: qexow-cam-messaging
description: Send and receive messages to/from other agents using the Qexow CAM protocol.
---
# Instructions

You are connected to the Qexow CAM messaging fabric. You can communicate with other agents (including \`antigravity\`) by running local scripts.

## Sending a Message
To send a message to another agent:
1. Run the PowerShell script \`./scripts/Send-AgentMessage.ps1\` with the following parameters:
   - \`-TargetAgent\`: The name of the agent you want to message (e.g., \`antigravity\`).
   - \`-MessageText\`: The body of your message.
   - \`-SourceAgent\`: Your agent name (e.g., \`coder-bot\`).

**Example CLI call:**
\`\`\`powershell
pwsh -File "$env:USERPROFILE\\.codex\\skills\\qexow-cam-messaging\\scripts\\Send-AgentMessage.ps1" -TargetAgent "antigravity" -MessageText "Hello" -SourceAgent "coder-bot"
\`\`\`

## Checking Your Inbox
To check for incoming messages:
1. Run the PowerShell script \`./scripts/Check-AgentMessages.ps1\` with the following parameters:
   - \`-AgentName\`: Your agent name (e.g., \`coder-bot\`).
   - \`-WaitSeconds\`: (Optional) The number of seconds to block and wait for a response if your inbox is currently empty (defaults to 20, up to 30).

**Example CLI call:**
\`\`\`powershell
pwsh -File "$env:USERPROFILE\\.codex\\skills\\qexow-cam-messaging\\scripts\\Check-AgentMessages.ps1" -AgentName "coder-bot" -WaitSeconds 15
\`\`\`
`;

  const sendPs1 = `
param (
    [string]$TargetAgent,
    [string]$MessageText,
    [string]$SourceAgent
)

$tokenFile = "$env:USERPROFILE\\.qexow-cam\\secrets\\local-api-token"
$configFile = "$env:USERPROFILE\\.qexow-cam\\config.json"

if (-not (Test-Path $tokenFile)) {
    Throw "CAM token file not found at $tokenFile. Fallbacks are disabled."
}
if (-not (Test-Path $configFile)) {
    Throw "CAM config file not found at $configFile. Fallbacks are disabled."
}

$token = (Get-Content $tokenFile -Raw).Trim()
$config = Get-Content $configFile -Raw | ConvertFrom-Json
if (-not $config.port) {
    Throw "CAM port configuration is missing in $configFile. Fallbacks are disabled."
}
$port = $config.port

$body = @{
    targetAgent = $TargetAgent
    message = $MessageText
    sourceAgent = $SourceAgent
} | ConvertTo-Json

$response = Invoke-RestMethod -Uri "http://127.0.0.1:$port/send" -Method Post -Headers @{ Authorization = "Bearer $token" } -Body $body -ContentType "application/json"
$response | ConvertTo-Json -Depth 5
`;

  const checkPs1 = `
param (
    [string]$AgentName,
    [int]$WaitSeconds = 20
)

$tokenFile = "$env:USERPROFILE\\.qexow-cam\\secrets\\local-api-token"
$configFile = "$env:USERPROFILE\\.qexow-cam\\config.json"

if (-not (Test-Path $tokenFile)) {
    Throw "CAM token file not found at $tokenFile. Fallbacks are disabled."
}
if (-not (Test-Path $configFile)) {
    Throw "CAM config file not found at $configFile. Fallbacks are disabled."
}

$token = (Get-Content $tokenFile -Raw).Trim()
$config = Get-Content $configFile -Raw | ConvertFrom-Json
if (-not $config.port) {
    Throw "CAM port configuration is missing in $configFile. Fallbacks are disabled."
}
$port = $config.port

$uri = "http://127.0.0.1:$port/inbox?agent=$AgentName"
if ($WaitSeconds -gt 0) {
    $uri += "&wait=$WaitSeconds"
}

$response = Invoke-RestMethod -Uri $uri -Method Get -Headers @{ Authorization = "Bearer $token" }
$response | ConvertTo-Json -Depth 5
`;

  fs.writeFileSync(path.join(camSkillDir, "SKILL.md"), skillMd.trim(), "utf8");
  fs.writeFileSync(path.join(scriptsDir, "Send-AgentMessage.ps1"), sendPs1.trim(), "utf8");
  fs.writeFileSync(path.join(scriptsDir, "Check-AgentMessages.ps1"), checkPs1.trim(), "utf8");
  console.log(`[BOOTSTRAP] Codex global CAM skills successfully installed/updated at ${camSkillDir}`);
}

// Helpers to get CAM config and token
function getCamConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    throw new Error(`[BROKER] Configuration file not found at ${CONFIG_FILE}. Make sure Qexow CAM is configured.`);
  }
  const data = fs.readFileSync(CONFIG_FILE, "utf8");
  const config = JSON.parse(data);
  if (!config.port) {
    throw new Error(`[BROKER] Port configuration is missing in ${CONFIG_FILE}.`);
  }
  return config;
}

function getCamToken() {
  if (!fs.existsSync(TOKEN_FILE)) {
    throw new Error(`[BROKER] Local API token file not found at ${TOKEN_FILE}. Make sure CAM daemon has initialized.`);
  }
  return fs.readFileSync(TOKEN_FILE, "utf8").trim();
}

// Load/Save mappings
function loadMappings() {
  try {
    if (!fs.existsSync(SCRATCH_DIR)) fs.mkdirSync(SCRATCH_DIR, { recursive: true });
    if (fs.existsSync(MAPPINGS_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(MAPPINGS_FILE, "utf8"));
      if (parsed && typeof parsed === "object") {
        if ("conversations" in parsed) {
          return parsed;
        } else {
          // Backward compatibility conversion:
          return {
            conversations: parsed,
            lastProcessedMessageId: null
          };
        }
      }
    }
  } catch (e) {}
  return { conversations: {}, lastProcessedMessageId: null };
}

function saveMappings(mappings) {
  try {
    if (!fs.existsSync(SCRATCH_DIR)) fs.mkdirSync(SCRATCH_DIR, { recursive: true });
    const tmpFile = `${MAPPINGS_FILE}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(mappings, null, 2), "utf8");
    fs.renameSync(tmpFile, MAPPINGS_FILE);
  } catch (e) {
    console.error("[BROKER] Error saving mappings:", e.message);
  }
}

// Run language_server.exe
function runAgyCommand(args) {
  return new Promise((resolve, reject) => {
    const fullArgs = ["agentapi", ...args];
    console.log(`[AGY CLI] Running ${AGY_EXE} ${fullArgs.join(" ")}`);
    const child = spawn(AGY_EXE, fullArgs, {
      cwd: SCRATCH_DIR,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (code !== 0) {
        return reject(new Error(`Exit code ${code}. Stderr: ${stderr}`));
      }
      try {
        const parsed = JSON.parse(stdout);
        resolve(parsed);
      } catch (e) {
        reject(new Error(`Failed to parse response JSON: ${e.message}. Raw: ${stdout}`));
      }
    });
  });
}

// Watch transcript.jsonl natively
async function pollAgyTranscript(conversationId, startByte = 0) {
  const logDir = path.join(BRAIN_DIR, conversationId, ".system_generated", "logs");
  const logFile = path.join(logDir, "transcript.jsonl");
  console.log(`[BROKER] Watching transcript: ${logFile} from byte ${startByte}`);

  let attempts = 0;
  while (!fs.existsSync(logDir) && attempts < 20) {
    await new Promise(r => setTimeout(r, 500));
    attempts++;
  }

  if (!fs.existsSync(logDir)) {
    throw new Error(`Directory ${logDir} was never created.`);
  }

  return new Promise((resolve, reject) => {
    let watcher;
    let fallbackInterval;

    const cleanup = () => {
      clearTimeout(timeout);
      if (watcher) {
        try { watcher.close(); } catch (e) {}
      }
      if (fallbackInterval) {
        clearInterval(fallbackInterval);
      }
    };

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timeout waiting for Antigravity response"));
    }, 120000); // 2 min timeout

    const checkFile = () => {
      if (!fs.existsSync(logFile)) return;
      try {
        const currentSize = fs.statSync(logFile).size;
        if (currentSize > startByte) {
          const buffer = Buffer.alloc(currentSize - startByte);
          const fd = fs.openSync(logFile, "r");
          fs.readSync(fd, buffer, 0, buffer.length, startByte);
          fs.closeSync(fd);
          
          startByte = currentSize; // update startByte
          
          const text = buffer.toString("utf8");
          const lines = text.split(/\r?\n/).filter(Boolean);
          for (const line of lines) {
            try {
              const step = JSON.parse(line);
              if (step.source === "MODEL" && step.type === "PLANNER_RESPONSE" && step.status === "DONE") {
                cleanup();
                console.log(`[BROKER] Found Antigravity response: "${step.content}"`);
                resolve(step.content);
                return;
              }
            } catch (e) {}
          }
        }
      } catch (e) {
        // file might be locked temporarily or deleted
      }
    };

    // Initial check
    checkFile();

    // Setup fs.watch
    try {
      watcher = fs.watch(logDir, (eventType, filename) => {
        if (filename !== "transcript.jsonl") return;
        checkFile();
      });
    } catch (watchErr) {
      console.warn(`[BROKER] Failed to initialize fs.watch: ${watchErr.message}. Falling back entirely to polling.`);
    }

    // Setup fallback polling
    fallbackInterval = setInterval(checkFile, 1000);
  });
}

// Send message natively to CAM via REST
async function sendCamResponse(targetAgent, messageText, sourceAgent = AGENT_NAME) {
  const config = getCamConfig();
  const token = getCamToken();
  const url = `http://127.0.0.1:${config.port}/send`;

  console.log(`[CAM API] Sending reply from ${sourceAgent} back to ${targetAgent}...`);
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    },
    body: JSON.stringify({
      targetAgent: targetAgent,
      message: messageText,
      sourceAgent: sourceAgent
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Failed to send response via API: ${response.status} ${err}`);
  }
  
  const json = await response.json();
  console.log(`[CAM API] Successfully delivered message!`);
  return json;
}

// Process an incoming Codex message
async function processMessage(msg, currentAgents = []) {
  isProcessing = true;
  console.log(`\n--- [NEW INCOMING MESSAGE] ---`);
  console.log(`ID: ${msg.messageId}`);
  console.log(`To: ${msg.targetAgent}`);
  console.log(`From: ${msg.sourceAgent} @ ${msg.sourceNode}`);
  console.log(`Body: "${msg.body}"`);
  console.log(`-----------------------------`);

  try {
    const mappingsObj = loadMappings();
    let conversationId = null;

    // Check if target is a dynamic Antigravity agent in the CAM registry
    const targetAgentObj = currentAgents.find(a => a.name === msg.targetAgent);
    if (!targetAgentObj || !targetAgentObj.threadId) {
      throw new Error(`Routing Error: Target agent '${msg.targetAgent}' is not registered or is missing a valid conversation ID.`);
    }
    conversationId = targetAgentObj.threadId;
    console.log(`[BROKER] Dynamic routing matched conversation: ${conversationId} for agent: ${msg.targetAgent}`);

    let startByte = 0;
    console.log(`[BROKER] Reusing conversation: ${conversationId}`);
    const logFile = path.join(BRAIN_DIR, conversationId, ".system_generated", "logs", "transcript.jsonl");
    if (fs.existsSync(logFile)) startByte = fs.statSync(logFile).size;
    
    await runAgyCommand(["send-message", conversationId, msg.body]);

    const reply = await pollAgyTranscript(conversationId, startByte);
    await sendCamResponse(msg.sourceAgent, reply, msg.targetAgent);

  } catch (error) {
    console.error(`[BROKER] Error processing message:`, error.message);
  } finally {
    isProcessing = false;
  }
}

// Main polling function natively calling /agents to get all agents
async function checkInbox() {
  if (isChecking || isProcessing) return;
  isChecking = true;

  try {
    const config = getCamConfig();
    const token = getCamToken();
    const url = `http://127.0.0.1:${config.port}/agents`;

    const res = await fetch(url, {
      headers: { "Authorization": `Bearer ${token}` }
    });

    if (!res.ok) {
      console.error("[BROKER] Fetch agents error:", res.status, await res.text());
      return;
    }
    
    const data = await res.json();
    if (!data.agents || !Array.isArray(data.agents)) return;

    // Filter agents belonging to Antigravity
    const agyAgents = data.agents.filter(a => a.threadSource === "antigravity" || a.name === "antigravity");
    const mappingsObj = loadMappings();

    if (!mappingsObj.processedMessageIds) {
      mappingsObj.processedMessageIds = [];
      if (mappingsObj.lastProcessedMessageId) {
        mappingsObj.processedMessageIds.push(mappingsObj.lastProcessedMessageId);
      }
    }
    const processedSet = new Set(mappingsObj.processedMessageIds);

    for (const agent of agyAgents) {
      if (!agent.lastDelivery) continue;
      const msg = agent.lastDelivery;
      
      if (!processedSet.has(msg.messageId)) {
        console.log(`[BROKER] New message detected for agent ${agent.name}: ${msg.messageId}`);
        
        // Add to processed set immediately to prevent duplicate runs
        processedSet.add(msg.messageId);
        mappingsObj.processedMessageIds = Array.from(processedSet);
        mappingsObj.lastProcessedMessageId = msg.messageId;
        saveMappings(mappingsObj);
        
        await processMessage(msg, data.agents);
        break; // Process one message per poll cycle
      }
    }

  } catch (e) {
    console.error("[BROKER] Check inbox error:", e.message);
  } finally {
    isChecking = false;
  }
}

console.log(`\n==================================================`);
console.log(`[BROKER] Antigravity-Qexow Broker Daemon starting (Bootstrapper Mode)...`);
console.log(`==================================================\n`);

// Run the bootstrapper logic
bootstrapEnvironment();

// Perform initial check to set baseline
checkInbox();

// Poll every 1.5 seconds
setInterval(checkInbox, 1500);
