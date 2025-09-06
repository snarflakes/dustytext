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
  console.log(`Running command: ${command}`);
  
  // Try multiple sources for session client
  const sessionClient = globalSessionClient || (window.__entryKitSessionClient as SessionClient | undefined);
  console.log('Session client from global:', globalSessionClient);
  console.log('Session client from window:', window.__entryKitSessionClient);
  console.log('Final session client:', sessionClient);
  
  if (!sessionClient?.sendTransaction) {
    window.dispatchEvent(new CustomEvent("worker-log", { 
      detail: "❌ Session client not available. Please connect wallet." 
    }));
    return;
  }

  // Debug session client
  console.log('Session client keys:', Object.keys(sessionClient));
  console.log('sendTransaction type:', typeof sessionClient.sendTransaction);
  console.log('Account object:', sessionClient.account);
  console.log('Account type:', typeof sessionClient.account);
  
  // Get current address - handle both string and object formats
  let address: string;
  if (typeof sessionClient.account === 'string') {
    address = sessionClient.account;
  } else if (sessionClient.account?.address) {
    address = sessionClient.account.address;
  } else {
    address = '';
  }
  
  console.log('Final address:', address);
  
  if (!address) {
    window.dispatchEvent(new CustomEvent("worker-log", { 
      detail: "❌ No wallet address available." 
    }));
    return;
  }

  const context = { address, sessionClient };

  // Parse command and arguments
  const parts = command.split(' ');
  const commandName = parts[0];
  const args = parts.slice(1);

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


  const NON_CLEARING = new Set(["done","mine","water","build","fill","till","move","look","health","ai","aiauto","ai_auto","explore","exp"]);
  if (!NON_CLEARING.has(commandName)) {
    try {
      const mod = await import("../commandQueue"); // use unified clear
      if (typeof mod.clearSelection === "function") {
        mod.clearSelection();
      } else {
        // eslint-disable-next-line no-console
        console.debug("[commands/index] clearSelection not exported from commandQueue");
      }
    } catch (e: unknown) {
      // eslint-disable-next-line no-console
      console.debug("[commands/index] clearSelection import skipped:", e);
    }
  }


  // Clear mining queue for any command except 'done'
  //if (commandName !== 'done') {
  //  try {
  //    const { clearSelection } = await import('./commands/explore');
  //    clearSelection();
  //    console.log('Cleared mining selection for non-done command:', commandName);
  //  } catch (error) {
  //    console.log('Failed to clear selection:', error);
      // Ignore if explore module isn't available
  //  }
  //}

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
