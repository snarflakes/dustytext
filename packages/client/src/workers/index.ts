// src/commands/index.ts
import { commandQueue } from '../commandQueue';
import { getCommand } from './commands/registry';
import { recordExecutedCommand } from "./ai/runtime";

interface SessionClient {
  account: { address: `0x${string}` };
  sendTransaction: (params: { to: `0x${string}`; data: `0x${string}`; gas: bigint }) => Promise<string>;
  [key: string]: unknown;
}

// Store session client reference
let globalSessionClient: SessionClient | null = null;

// Add rate limiting
let lastCommandTime = 0;
const COMMAND_COOLDOWN = 100; // Reduced from 1000ms to 100ms

async function getSessionClient() {
  if (!globalSessionClient) {
    throw new Error("Session client not initialized");
  }
  return {
    address: globalSessionClient.account.address,
    sessionClient: globalSessionClient
  };
}

export function setSessionClient(sessionClient: SessionClient | null) {
  globalSessionClient = sessionClient;
  if (sessionClient) {
    // Also set on window for backward compatibility
    (window as unknown as { __entryKitSessionClient?: SessionClient }).__entryKitSessionClient = sessionClient;
  }
}

export async function runCommand(command: string): Promise<void> {
  const now = Date.now();
  if (now - lastCommandTime < COMMAND_COOLDOWN) {
    console.log(`Command ${command} rate limited`);
    return;
  }
  lastCommandTime = now;
  
  commandQueue.enqueue(() => runWorkerCommand(command));
}

async function runWorkerCommand(command: string): Promise<void> {
  console.log(`runWorkerCommand called with: "${command}"`);
  
  const { address, sessionClient } = await getSessionClient();
  const context = { address, sessionClient };

  // Parse command and arguments
  const parts = command.split(' ');
  const commandName = parts[0];
  const args = parts.slice(1);
  
  console.log(`Parsed commandName: "${commandName}", args:`, args);

  // Don't show "You start to..." message for look and health commands
  if (commandName !== 'look' && commandName !== 'health') {
    window.dispatchEvent(new CustomEvent("worker-log", { 
      detail: `You start to ${command} ...` 
    }));
  }

  // Handle special cases for backward compatibility
  if (['north', 'south', 'east', 'west'].includes(commandName)) {
    const moveCommand = getCommand('move');
    if (moveCommand) {
      await moveCommand.execute(context, commandName);
      return;
    }
  }

  // Get and execute command
  const handler = getCommand(commandName);
  console.log(`Looking for command: ${commandName}, found: ${!!handler}`);
  
  if (!handler) {
    window.dispatchEvent(new CustomEvent("worker-log", { 
      detail: `❓ Unknown command: ${command}` 
   }));
   return;
  }

  try {
    await handler.execute(context, ...args);
    
    // Record only successful, non-control commands
    if (!commandName.startsWith("ai")) {
      recordExecutedCommand(command);
    }
  } catch (err) {
    window.dispatchEvent(new CustomEvent("worker-log", { 
      detail: `⚠️ Command error: ${err instanceof Error ? err.message : String(err)}`
    }));
  }
}
