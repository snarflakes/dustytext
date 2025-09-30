import { AccountButton, useSessionClient } from "@latticexyz/entrykit/internal";
import { runCommand, setSessionClient } from "./workers";
import { useState, useEffect, useRef, useCallback } from "react";
import { useAccount, useBalance } from "wagmi";
import { formatUnits } from "viem";
import { chainId, getWorldAddress } from "./common";
import "tailwindcss/tailwind.css";
import "./app.css"; // Add this import for the clickable block styles
import { useLivingPlayersCount } from "./player";
import { getHealthStatus, HealthStatus } from './workers/commands/health';
import { isSetupActive as isInRegisterAISetup } from './workers/commands/registerAI';
import { getAIConfig } from "./workers/commands/registerAI";
import { setAIActive } from "./workers/ai/runtime";
import { appendAILog } from "./workers/ai/runtime";
import { getEquippedToolName } from "./workers/commands/equip";
import { getForceFieldInfoForPlayer } from './workers/commands/sense';

declare global {
  interface Window {
    __entryKitSessionClient?: {
      account: `0x${string}`;
      sendTransaction?: (params: {
        to: `0x${string}`;
        data: `0x${string}`;
        gas: bigint;
      }) => Promise<string>;
      [key: string]: unknown; // Allow additional properties
    };
    ethereum?: {
      request: (args: { method: string }) => Promise<string[]>;
    };
    entryKit?: {
      getSessionClient: () => Promise<{
        account: `0x${string}`;
        sendTransaction: (params: {
          to: `0x${string}`;
          data: `0x${string}`;
          gas: bigint;
        }) => Promise<string>;
      }>;
    };
  }
}

export function App() {
  const livingPlayers = useLivingPlayersCount();
  const [healthStatus, setHealthStatus] = useState<HealthStatus | null>(null);
  const [equippedTool, setEquippedTool] = useState<string | null>(null);

  const [log, setLog] = useState<string[]>([
    "<i>Welcome to Dusty Text</i>",
    "Type 'spawn' to enter the world! Type 'look' to see your surroundings. Type 'help' for all available commands."
  ]);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const historyIndexRef = useRef<number>(0);
  const terminalRef = useRef<HTMLDivElement>(null);

  const { address, isConnected } = useAccount();
  const { data: balanceData } = useBalance({ address, chainId });
  const { data: sessionClient, error: sessionError, isLoading: sessionLoading } = useSessionClient();

  const [aiOn, setAiOn] = useState(false);
  const aiOnRef = useRef(false);                 // track latest value to avoid stale closures
  useEffect(() => { aiOnRef.current = aiOn; }, [aiOn]);

  const aiTimerRef = useRef<number | null>(null);

  const tickAI = useCallback(() => {
    // bail out if AI was turned off after this timer was scheduled
    //if (!aiOnRef.current) return;

    runCommand("ai auto");
    const delay = getAIConfig()?.rateLimit ?? 1000;
    aiTimerRef.current = window.setTimeout(() => {
      if (aiOnRef.current) tickAI();             // only loop if still ON
    }, delay);
  }, []);                                        // uses only stable refs/functions

  const startAI = useCallback(() => {
    if (aiOnRef.current) return;
    setAiOn(true);
    setAIActive(true);
    window.dispatchEvent(new CustomEvent("worker-log", { detail: "🤖 AI mode ON" }));
    tickAI();
  }, [tickAI]);

  const stopAI = useCallback(() => {
    setAiOn(false);
    setAIActive(false);
    if (aiTimerRef.current != null) {
      clearTimeout(aiTimerRef.current);
      aiTimerRef.current = null;
    }
    window.dispatchEvent(new CustomEvent("worker-log", { detail: "🛑 AI mode OFF" }));
  }, []);

  // ✅ ONE worker-log effect (UI + AI buffer)
  useEffect(() => {
    const stripHtml = (s: string) => s.replace(/<[^>]*>/g, "");
    const onWorkerLog = (e: Event) => {
      const ce = e as CustomEvent<string>;
      const line = String(ce.detail ?? "");
      setLog(prev => [...prev, line]);      // update terminal
      appendAILog(stripHtml(line));         // feed AI buffer
    };

    window.addEventListener("worker-log", onWorkerLog as EventListener);
    return () => window.removeEventListener("worker-log", onWorkerLog as EventListener);
  }, []);

// Execute AI-suggested commands (only when AI is ON)
  useEffect(() => {
    const onAICommand = (e: Event) => {
      const ev = e as CustomEvent<{ command: string; source: "AI" }>;
      const cmd = String(ev.detail?.command ?? "").trim();
      if (!cmd) return;

      // Optional safety: don’t execute if AI was turned off between emit & handle
      if (!aiOnRef.current) return;

      // If the AI produced a speaking line (starts with a single apostrophe),
      // convert it to your speak command.
      if (cmd.startsWith("'")) {
        const message = cmd.slice(1).trim();
      //tag AI speaking line  
        appendAILog(`[AI_SAY] ${message}`);
        if (!message) return; // ignore empty speech like just "'"
        runCommand(`speak ${message}`);
        return;
      }

      // Otherwise, execute the command as-is
      runCommand(cmd);
    };

    window.addEventListener("ai-command", onAICommand as EventListener);
    return () => window.removeEventListener("ai-command", onAICommand as EventListener);
  }, []);

  // Enhanced EntryKit debugging and session client sharing
  useEffect(() => {
    // Share session client globally when available
    if (sessionClient) {
      window.__entryKitSessionClient = sessionClient as unknown as typeof window.__entryKitSessionClient;
      setSessionClient(sessionClient as unknown as Parameters<typeof setSessionClient>[0]);
      console.log('Session client shared globally:', sessionClient);
      
      // Auto-execute health command on startup
      if (address) {
        setTimeout(() => {
          runCommand('health');
        }, 1000);
      }
    } else {
      setSessionClient(null);
    }
    
    const checkEntryKit = () => {
      console.log('=== EntryKit Debug ===');
      console.log('EntryKit available:', !!window.entryKit);
      console.log('Session client:', sessionClient);
      console.log('Session error:', sessionError);
      console.log('Session loading:', sessionLoading);
      console.log('Navigator online:', navigator.onLine);
      console.log('Current URL:', window.location.href);
      console.log('Chain ID from config:', chainId);
      console.log('World address:', getWorldAddress());
      
      // Only test RPC if online
      if (navigator.onLine) {
        fetch('https://rpc.redstonechain.com', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'eth_chainId',
            params: [],
            id: 1
          })
        }).then(res => res.json())
          .then(data => console.log('RPC test response:', data))
          .catch(err => console.log('RPC test error:', err));
      } else {
        console.log('Skipping RPC test - offline');
      }
    };
    
    checkEntryKit();
  }, [sessionClient, sessionError, sessionLoading, address]);

  useEffect(() => {
    // Test multiple endpoints to isolate the issue
    const testConnectivity = async () => {
      console.log('=== Connectivity Test ===');
      console.log('Navigator online:', navigator.onLine);
      
      // Test basic connectivity
      try {
        const response = await fetch('https://httpbin.org/get');
        console.log('httpbin.org test:', response.ok ? 'SUCCESS' : 'FAILED');
      } catch (err) {
        console.log('httpbin.org test: FAILED', err);
      }
      
      // Test Redstone RPC
      try {
        const response = await fetch('https://rpc.redstonechain.com', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'eth_chainId',
            params: [],
            id: 1
          })
        });
        const data = await response.json();
        console.log('Redstone RPC test:', data);
      } catch (err) {
        console.log('Redstone RPC test: FAILED', err);
      }
    };
    
    testConnectivity();
  }, []);

  // Health status polling - use session client address instead of wagmi address
  useEffect(() => {
    console.log('Health polling useEffect triggered', { sessionClient, isConnected });
    
    // Get address from session client instead of wagmi
    const sessionAddress = sessionClient?.account?.address || 
                          (typeof sessionClient?.account === 'string' ? sessionClient.account : null);
    
    if (!sessionAddress || !isConnected) {
      console.log('Health polling skipped - no session address or not connected');
      return;
    }
    
    const updateHealth = async () => {
      console.log('updateHealth called for session address:', sessionAddress);
      try {
        const status = await getHealthStatus(sessionAddress);
        console.log('Health status received:', status);
        // Only update if we got valid data (not a fetch error)
        if (status.isAlive || status.lifePercentage > 0 || status.energy > 0n) {
          setHealthStatus(status);
        }
      } catch (error) {
        console.log('Health status fetch failed, keeping previous status:', error);
        // Don't update healthStatus on error - keep previous value
      }
    };
    
    // Initial load
    updateHealth();
    
    // Update every 60 seconds
    const interval = setInterval(updateHealth, 60000);
    console.log('Health polling interval set:', interval);
    return () => {
      console.log('Health polling interval cleared');
      clearInterval(interval);
    };
  }, [sessionClient, isConnected]);

  // Update equipped tool when equip/unequip commands are executed
  useEffect(() => {
    const updateEquippedTool = () => {
      const toolName = getEquippedToolName();
      setEquippedTool(toolName);
    };

    const onWorkerLog = (e: Event) => {
      const ce = e as CustomEvent<string>;
      const line = String(ce.detail ?? "");
      
      // Update equipped tool when we see equip/unequip messages
      if (line.includes("⚒️ Equipped") || line.includes("⚒️ Unequipped")) {
        updateEquippedTool();
      }
    };

    // Initial check
    updateEquippedTool();

    window.addEventListener("worker-log", onWorkerLog as EventListener);
    return () => window.removeEventListener("worker-log", onWorkerLog as EventListener);
  }, []);

  const handleCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = input.trim();
    const command = raw.toLowerCase(); // routing only

    // If we're mid registerai wizard, forward RAW (preserve casing)
    if (isInRegisterAISetup()) {
      setLog(prev => [...prev, `> [input received]`]);  // mask: don’t show secrets
      runCommand(`registerai ${raw}`);
      setInput('');
      return;
    }

    // Not in wizard: show exactly what user typed
    //setLog(prev => [...prev, `> ${raw}`]);

    // Starting/continuing registerai on a single line
    if (command.startsWith('registerai')) {
      const args = raw.slice('registerai'.length).trim(); // peel from RAW
      runCommand(`registerai ${args}`);
      setInput('');
      return;
    }

    if (!command) return;
    
    setLog(prev => [...prev, `> ${command}`]);
    setHistory(prev => [...prev, command]);
    historyIndexRef.current = history.length + 1;
    setInput('');

    if (!isConnected) {
      setLog(prev => [...prev, '🔒 Please connect your wallet first. Click "Sign In" in top corner ']);
      return;
    }

    // Check if we're in registerai setup FIRST - before any other command parsing
    if (isInRegisterAISetup()) {
      runCommand(`registerai ${command}`);
      return;
    }

    // Game commands using workers
    if (command === 'spawn') {
      runCommand('spawn');
    } else if (command === 'look' || command === 'l') {
      runCommand('look');
    } else if (command === 'health' || command === 'hp') {
      runCommand('health');
    } else if (command === 'explore' || command === 'exp') {
      runCommand('explore');

    } else if (command.startsWith('explore ') || command.startsWith('exp ')) {
      // forward EVERYTHING after the verb so explore can parse order-agnostic
      const tail = command.replace(/^(explore|exp)\s+/i, "");
      runCommand(`explore ${tail}`);
    
    } else if (command.startsWith('registerai')) {
      const args = command.split(' ').slice(1);
      runCommand(`registerai ${args.join(' ')}`);
    } else if (command.startsWith('customai')) {
      const args = command.split(' ').slice(1);
      runCommand(`customai ${args.join(' ')}`);
    } else if (command.startsWith('ai ') || command === 'ai') {
      runCommand(command);
    } else if (command.startsWith('move ') || ['north', 'n', 'south', 's', 'east', 'e', 'west', 'w', 'northeast', 'ne', 'northwest', 'nw', 'southeast', 'se', 'southwest', 'sw', 'up', 'u', 'down'].includes(command)) {
      if (command.startsWith('move ')) {
        // Handle "move w w w w w" or "move nw nw nw"
        const directions = command.split(' ').slice(1); // Remove 'move' and get all directions
        runCommand(`move ${directions.join(' ')}`);
      } else {
        // Handle single direction commands like "w" or "nw"
        runCommand(`move ${command}`);
      }
    } else if (command === 'survey') {
      runCommand('survey');
    } else if (command === 'water' || command.startsWith('water ')) {
      runCommand(command.trim());
    } else if (command === 'done' || command === 'd') {
      runCommand('done');
    } else if (command === 'eat') {
      runCommand('eat');
    } else if (command === 'sense' || command.startsWith('sense ')) {
      runCommand(command.trim());
    } else if (command === 'help' || command === 'h') {
      runCommand('help');
    } else if (command === 'mine' || command.startsWith('mine ')) {
      runCommand(command.trim());
    } else if (command === 'inventory' || command === 'inv' || command === 'i') {
      runCommand('inventory');
    } else if (command.startsWith('craft ')) {
      const itemName = command.substring(6); // Remove 'craft ' prefix
      runCommand(`craft ${itemName}`);
    } else if (command.startsWith('equip ')) {
      const toolName = command.substring(6); // Remove 'equip ' prefix
      runCommand(`equip ${toolName}`);
    } else if (command === 'unequip') {
      runCommand('unequip');
    } else if (command === 'energize' || command.startsWith('energize ')) {
      runCommand(command.trim());
    } else if (command === 'hit' || command.startsWith('hit ')) {
      runCommand(command.trim());
    } else if (command === 'till' || command.startsWith('till ')) {
      runCommand(command.trim());
    } else if (command === 'fill' || command.startsWith('fill ')) {
      runCommand(command.trim());
    } else if (command === 'build' || command.startsWith('build ')) {
      runCommand(command.trim());
    } else if (command === 'plant' || command.startsWith('plant ')) {
      runCommand(command.trim());
    } else if (command === 'projectfield' || command === 'pf') {
      runCommand('projectfield');
    } else if (command === 'claimfield' || command === 'cf' || command.startsWith('claimfield ') || command.startsWith('cf ')) {
      runCommand(command.trim());
    } else if (command === 'sleep') {
      runCommand('sleep');
    } else if (command === 'scan' || command.startsWith('scan ')) {
      runCommand(command.trim());
    } else if (command === 'loot' || command.startsWith('loot ')) {
      runCommand(command.trim());            
    } else if (command === 'chest' || command === 'look in chest') {
      runCommand('chest');
    } else if (command.startsWith("'")) {

      // Handle speak command directly - remove the leading quote
      const message = command.substring(1);
      if (!message.trim()) {
        setLog(prev => [...prev, "❓ What do you want to say? Use: 'your message here"]);
      } else {
        appendAILog(`[PLAYER_SAY] ${message}`);   // tag human speech for model
        setLog(prev => [...prev, `<span class="speak-prefix">You say,</span> <span class="speak-message">"${message}"</span>`]);
      }
    } else if (command === 'players' || command === 'who') {
      setLog(prev => [...prev, `👥 Player data not available without sync`]);
    } else if (command === 'balance' || command === 'bal') {
      const formatted = balanceData
        ? `${parseFloat(formatUnits(balanceData.value, 18)).toFixed(5)} ETH`
        : 'Loading...';
      setLog(prev => [...prev, `💰 Balance: ${formatted}`]);
    } else if (command === 'debug' || command === 'd') {
      setLog(prev => [...prev, `🔍 Debug info:`]);
      setLog(prev => [...prev, `  EOA Address: ${address}`]);
      
      // Show session address if available
      if (sessionClient?.account) {
        const sessionAddress = typeof sessionClient.account === 'string' 
          ? sessionClient.account 
          : sessionClient.account.address;
        setLog(prev => [...prev, `  Session Address: ${sessionAddress}`]);
        
        // Check for forcefields owned by session address
        try {
          const sessionForceFieldInfo = await getForceFieldInfoForPlayer(sessionAddress);
          if (sessionForceFieldInfo.active) {
            setLog(prev => [...prev, `  Session Forcefield: ACTIVE (${sessionForceFieldInfo.forceField})`]);
          } else {
            setLog(prev => [...prev, `  Session Forcefield: NO forcefields owned by this session address`]);
          }
        } catch (error) {
          setLog(prev => [...prev, `  Session Forcefield: NO forcefields owned by this session address`]);
        }
      }
      
      // Check for forcefields owned by EOA address
      if (address) {
        try {
          const eoaForceFieldInfo = await getForceFieldInfoForPlayer(address);
          if (eoaForceFieldInfo.active) {
            setLog(prev => [...prev, `  EOA Forcefield: ACTIVE (${eoaForceFieldInfo.forceField})`]);
          } else {
            setLog(prev => [...prev, `  EOA Forcefield: NO forcefields owned by this EOA address`]);
          }
        } catch (error) {
          setLog(prev => [...prev, `  EOA Forcefield: NO forcefields owned by this EOA address`]);
        }
      } else {
        setLog(prev => [...prev, `  EOA Forcefield: No EOA address available`]);
      }
    } else if (command === 'clear' || command === 'cls') {
      setLog([]);
    } else if (command.startsWith('attach ')) {
      const args = command.split(' ').slice(1);
      runCommand(`attach ${args.join(' ')}`);
    } else if (command.startsWith('detach ')) {
      runCommand(command);
    } else if (command === 'delegate' || command.startsWith('delegate ')) {
      runCommand(command);
    } else {
      setLog(prev => [...prev, `🤖 Unknown command: ${command}. Type 'help' for commands.`]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      historyIndexRef.current = Math.max(0, historyIndexRef.current - 1);
      setInput(history[historyIndexRef.current] || '');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      historyIndexRef.current = Math.min(history.length, historyIndexRef.current + 1);
      setInput(history[historyIndexRef.current] || '');
    }
  };

  useEffect(() => {
    const terminal = terminalRef.current;
    if (terminal) {
      // Force scroll to bottom
      setTimeout(() => {
        terminal.scrollTop = terminal.scrollHeight;
      }, 0);

      // Add click handler for clickable blocks
      const handleClick = (event: Event) => {
        const target = event.target as HTMLElement;
        if (target.classList.contains('clickable-block')) {
          const blockData = target.getAttribute('data-block');
          const blockId = target.getAttribute('data-id');
          
          if (blockData && blockId) {
            window.dispatchEvent(new CustomEvent('block-click', {
              detail: { blockData, blockId }
            }));
          }
        }
      };

      terminal.addEventListener('click', handleClick);
      
      return () => {
        terminal.removeEventListener('click', handleClick);
      };
    }
  }, [log]);

  useEffect(() => {
    console.log('Latest log entry:', log[log.length - 1]);
  }, [log]);

  return (
    <>
      <div className="mud-container">
        {/* Header */}
        <div className="mud-header-row">
          <div className="mud-title">
            <img 
              src="/dusttext logosmallest.png" 
              alt="Dusty Text" 
              style={{ height: '48px', width: 'auto' }}
            />
          </div>
          <div className="flex items-center gap-4">
            <div className="text-sm">
              🤚 {equippedTool || 'None'}
            </div>
            {healthStatus && healthStatus.isAlive && (
              <div className="text-sm">
                ❤️ {healthStatus.lifePercentage.toFixed(1)}%
              </div>
            )}
            {healthStatus && !healthStatus.isAlive && (
              <div className="text-sm">
                💀 Dead
              </div>
            )}
            {livingPlayers !== null &&(
             <div className="text-sm">👥 {livingPlayers} players alive</div>
          )}
            
            {isConnected && balanceData && (
              <div className="text-sm">
                💰 {parseFloat(formatUnits(balanceData.value, 18)).toFixed(5)} ETH
              </div>
            )}
            <img 
              src="/bevel embossdeep.png" 
              alt={aiOn ? "Stop AI" : "Start AI"}
              onClick={() => (aiOn ? stopAI() : startAI())}
              style={{ 
                height: '56px', 
                width: 'auto', 
                cursor: 'pointer',
                transition: 'opacity 0.2s ease'
              }}
              onMouseEnter={(e) => e.currentTarget.style.opacity = '0.8'}
              onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
              title={aiOn ? "🛑 Stop AI" : "🤖 Start AI"}
            />
            <a 
              href="https://forcefields.pateldhvani.com/" 
              target="_blank" 
              rel="noopener noreferrer"
              style={{ 
                fontSize: '24px',
                textDecoration: 'none',
                cursor: 'pointer',
                transition: 'opacity 0.2s ease'
              }}
              onMouseEnter={(e) => e.currentTarget.style.opacity = '0.8'}
              onMouseLeave={(e) => e.currentTarget.style.opacity = '1'}
              title="View Force Fields Map"
            >
              🌍
            </a>
            <AccountButton />
          </div>
        </div>

        {/* Decorative Separator */}
        <div className="separator-row">
          <div className="separator-line"></div>
          <div className="separator-icons">✦ ✧ ✦</div>
          <div className="separator-line"></div>
        </div>

        {/* Game Area */}
        <div className="mud-terminal">
          {/* Terminal */}
          <div 
            ref={terminalRef}
            className="terminal"
          >
            {log.map((line, i) => (
              <div 
                key={i} 
                dangerouslySetInnerHTML={{ __html: line }}
              />
            ))}
          </div>
          
          {/* Command Input */}
          <form onSubmit={handleCommand} className="command-form">
            <div className="flex">
              <span style={{ color: 'limegreen', marginRight: '8px' }}>$</span>
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a command (help for commands)"
                className="mud-input"
                autoFocus
              />
            </div>
          </form>
        </div>
      </div>
    </>
  );
}






























