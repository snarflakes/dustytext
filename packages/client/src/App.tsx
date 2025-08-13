import { AccountButton, useSessionClient } from "@latticexyz/entrykit/internal";
import { runCommand, setSessionClient } from "./workers";
import { useState, useEffect, useRef } from "react";
import { useAccount, useBalance } from "wagmi";
import { formatUnits } from "viem";
import { chainId, getWorldAddress } from "./common";
import "./app.css";

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
  const [log, setLog] = useState<string[]>([
    "🧱 Welcome to Dusty Text MUD",
    "Type 'help' for available commands"
  ]);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState<string[]>([]);
  const historyIndexRef = useRef<number>(0);
  const terminalRef = useRef<HTMLDivElement>(null);

  const { address, isConnected } = useAccount();
  const { data: balanceData } = useBalance({ address, chainId });
  const { data: sessionClient, error: sessionError, isLoading: sessionLoading } = useSessionClient();

  // Listen for worker events
  useEffect(() => {
    const handleWorkerLog = (event: CustomEvent) => {
      setLog(prev => [...prev, event.detail]);
    };

    window.addEventListener("worker-log", handleWorkerLog as EventListener);
    return () => window.removeEventListener("worker-log", handleWorkerLog as EventListener);
  }, []);

  // Enhanced EntryKit debugging and session client sharing
  useEffect(() => {
    // Share session client globally when available
    if (sessionClient) {
      window.__entryKitSessionClient = sessionClient as unknown as typeof window.__entryKitSessionClient;
      setSessionClient(sessionClient as unknown as Parameters<typeof setSessionClient>[0]);
      console.log('Session client shared globally:', sessionClient);
    } else {
      setSessionClient(null); // Clear when not available
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
  }, [sessionClient, sessionError, sessionLoading]);

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

  const handleCommand = (e: React.FormEvent) => {
    e.preventDefault();
    const command = input.trim().toLowerCase();
    if (!command) return;
    
    setLog(prev => [...prev, `> ${command}`]);
    setHistory(prev => [...prev, command]);
    historyIndexRef.current = history.length + 1;
    setInput('');

    if (!isConnected) {
      setLog(prev => [...prev, '🔒 Please connect your wallet first']);
      return;
    }

    // Game commands using workers
    if (command === 'spawn') {
      runCommand('spawn');
    } else if (command === 'look' || command === 'l') {
      runCommand('look');
    } else if (command === 'health' || command === 'hp') {
      runCommand('health');
    } else if (command === 'explore') {
      runCommand('explore');
    } else if (command === 'help' || command === 'h') {
      runCommand('help');
    } else if (command.startsWith('move ') || ['north', 'n', 'south', 's', 'east', 'e', 'west', 'w'].includes(command)) {
      const direction = command.startsWith('move ') ? command.split(' ')[1] : command;
      console.log(`Move command: ${direction}, Address: ${address}`);
      runCommand(`move ${direction}`);
    }
    // Game commands
    else if (command === 'players' || command === 'who') {
      setLog(prev => [...prev, `👥 Player data not available without sync`]);
    } else if (command === 'balance' || command === 'bal') {
      const formatted = balanceData
        ? `${parseFloat(formatUnits(balanceData.value, 18)).toFixed(5)} ETH`
        : 'Loading...';
      setLog(prev => [...prev, `💰 Balance: ${formatted}`]);
    } else if (command === 'debug' || command === 'd') {
      setLog(prev => [...prev, `🔍 Debug info:`]);
      setLog(prev => [...prev, `  Address: ${address}`]);
      setLog(prev => [...prev, 
        '📖 Available commands:',
        '  Movement: north/n, south/s, east/e, west/w',
        '  Game: look/l, players/who, balance/bal',
        '  System: help/h, clear',
        '  Debug: debug/d'
      ]);
    } else if (command === 'clear' || command === 'cls') {
      setLog([]);
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
    }
  }, [log]);

  return (
    <>
      <div className="mud-container">
        {/* Header */}
        <div className="mud-header-row">
          <h1 className="mud-title">🧱 Dusty Text MUD</h1>
          <div className="flex items-center gap-4">
            {isConnected && balanceData && (
              <div className="text-sm">
                💰 {parseFloat(formatUnits(balanceData.value, 18)).toFixed(5)} ETH
              </div>
            )}
            <AccountButton />
          </div>
        </div>

        {/* Game Area */}
        <div className="mud-terminal">
          {/* Terminal */}
          <div 
            ref={terminalRef}
            className="terminal"
          >
            {log.map((line, i) => (
              <div key={i}>{line}</div>
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






























