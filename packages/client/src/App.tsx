import { stash } from "./mud/stash";
import { useRecords } from "@latticexyz/stash/react";
import { AccountButton } from "@latticexyz/entrykit/internal";
import { Direction } from "./common";
import mudConfig from "contracts/mud.config";
import { useMemo, useState, useEffect, useRef } from "react";
import { useWorldContract } from "./mud/useWorldContract";
import { Synced } from "./mud/Synced";
import { useSync } from "@latticexyz/store-sync/react";
import { useAccount, useBalance } from "wagmi";
import { formatUnits } from "viem";
import { chainId } from "./common";

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
  
  const players = useRecords({ stash, table: mudConfig.tables.app__Position });
  const sync = useSync();
  const worldContract = useWorldContract();

  const onMove = useMemo(
    () =>
      sync.data && worldContract
        ? async (direction: Direction) => {
            try {
              setLog(prev => [...prev, `🚶 Moving ${direction}...`]);
              const tx = await worldContract.write.app__move([mudConfig.enums.Direction.indexOf(direction)]);
              await sync.data.waitForTransaction(tx);
              setLog(prev => [...prev, `✅ Moved ${direction} successfully!`]);
            } catch (error) {
              setLog(prev => [...prev, `❌ Move failed: ${error}`]);
            }
          }
        : undefined,
    [sync.data, worldContract],
  );

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

    // Movement commands
    if (['north', 'n', 'up'].includes(command)) {
      onMove?.('North');
    } else if (['south', 's', 'down'].includes(command)) {
      onMove?.('South');
    } else if (['east', 'e', 'right'].includes(command)) {
      onMove?.('East');
    } else if (['west', 'w', 'left'].includes(command)) {
      onMove?.('West');
    } 
    // Game commands
    else if (command === 'look' || command === 'l') {
      const playerCount = players.length;
      setLog(prev => [...prev, `👀 You see a vast digital realm. ${playerCount} players are here.`]);
    } else if (command === 'players' || command === 'who') {
      setLog(prev => [...prev, `👥 ${players.length} players online`]);
      players.forEach((player, i) => {
        setLog(prev => [...prev, `  ${i + 1}. ${player.player} at (${player.x}, ${player.y})`]);
      });
    } else if (command === 'balance' || command === 'bal') {
      const formatted = balanceData
        ? `${parseFloat(formatUnits(balanceData.value, 18)).toFixed(5)} ETH`
        : 'Loading...';
      setLog(prev => [...prev, `💰 Balance: ${formatted}`]);
    } else if (command === 'debug' || command === 'd') {
      setLog(prev => [...prev, `🔍 Debug info:`]);
      setLog(prev => [...prev, `  Address: ${address}`]);
      setLog(prev => [...prev, `  Players synced: ${players.length}`]);
      setLog(prev => [...prev, `  Sync status: ${sync.isSuccess ? 'Connected' : sync.isLoading ? 'Loading' : 'Error'}`]);
      setLog(prev => [...prev, `  World contract: ${worldContract ? 'Ready' : 'Not ready'}`]);
    } else if (command === 'help' || command === 'h') {
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
    if (terminal) terminal.scrollTop = terminal.scrollHeight;
  }, [log]);

  // Add temporary debug logging
  useEffect(() => {
    console.log("🔍 Players data:", players);
    console.log("🔍 Sync status:", sync);
  }, [players, sync]);

  return (
    <>
      <div className="fixed inset-0 flex flex-col bg-black text-green-400 font-mono">
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b border-green-400">
          <h1 className="text-xl font-bold">🧱 Dusty Text MUD</h1>
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
        <div className="flex-1 flex flex-col p-4">
          <Synced
            fallback={({ message, percentage, step }) => (
              <div className="text-center text-yellow-400">
                🔄 {message} ({percentage.toFixed(1)}%) - Step: {step}
              </div>
            )}
          >
            {/* Terminal */}
            <div className="flex-1 flex flex-col">
              <div 
                ref={terminalRef}
                className="flex-1 overflow-y-auto p-2 border border-green-400 bg-black"
              >
                {log.map((line, i) => (
                  <div key={i} className="mb-1">{line}</div>
                ))}
              </div>
              
              {/* Command Input */}
              <form onSubmit={handleCommand} className="mt-2">
                <div className="flex">
                  <span className="text-green-400 mr-2">$</span>
                  <input
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Type a command (help for commands)"
                    className="flex-1 bg-transparent text-green-400 outline-none"
                    autoFocus
                  />
                </div>
              </form>
            </div>
          </Synced>
        </div>
      </div>
    </>
  );
}









