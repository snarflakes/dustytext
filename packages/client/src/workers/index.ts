// src/commands/index.ts
import { commandQueue } from '../commandQueue';
import { getCommand } from './commands/registry';

interface SessionClient {
  account: { address: `0x${string}` };
  sendTransaction: (params: { to: `0x${string}`; data: `0x${string}`; gas: bigint }) => Promise<string>;
  [key: string]: unknown;
}

// Store session client reference
let globalSessionClient: SessionClient | null = null;

// Add rate limiting
let lastCommandTime = 0;
const COMMAND_COOLDOWN = 1000; // 1 second between commands

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

  window.dispatchEvent(new CustomEvent("worker-log", { 
    //detail: `🚀 Starting ${command} for ${address}...`
    detail: `You start to ${command} ...` 
  }));

  const context = { address, sessionClient };

  // Parse command and arguments
  const parts = command.split(' ');
  const commandName = parts[0];
  const args = parts.slice(1);

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
  if (handler) {
    await handler.execute(context, ...args);
  } else {
    window.dispatchEvent(new CustomEvent("worker-log", { 
      detail: `❓ Unknown command: ${command}` 
    }));
  }
}

// Remove these unused functions - they're replaced by the command registry system
// const WORLD_ADDRESS = '0x253eb85B3C953bFE3827CC14a151262482E7189C';
// const MOVE_ABI = [...]
// function directionToEnum(direction: string): number {...}
// async function handleMoveCommand(...) {...}
// async function handleSpawnCommand(...) {...}
// async function handleLookCommand(...) {...}
// async function handleHealthCommand(...) {...}
