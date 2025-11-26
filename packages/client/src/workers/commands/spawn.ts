import { encodeFunctionData } from 'viem';
import { CommandHandler, CommandContext } from './types';
import IWorldAbi from "@dust/world/out/IWorld.sol/IWorld.abi";

// Add packCoord96 function
function packCoord96(x: number, y: number, z: number): bigint {
  const ux = BigInt(x >>> 0);
  const uy = BigInt(y >>> 0);
  const uz = BigInt(z >>> 0);
  return (ux << 64n) | (uy << 32n) | uz;
}

const WORLD_ADDRESS = '0x253eb85b3c953bfe3827cc14a151262482e7189c' as const;
const POSITION_TABLE = "EntityPosition";

// DRAND helpers
type DrandResponse = { round: number; signature: string };

async function getLatestRound(): Promise<bigint> {
  const r = await fetch('https://api.drand.sh/v2/beacons/evmnet/rounds/latest');
  const data: DrandResponse = await r.json();
  return BigInt(data.round);
}

async function fetchDrandData(
  roundNumber: bigint
): Promise<{ signature: [bigint, bigint]; roundNumber: bigint }> {
  const r = await fetch(`https://api.drand.sh/v2/beacons/evmnet/rounds/${roundNumber}`);
  const data: DrandResponse = await r.json();
  const sig = data.signature; // 128 hex chars
  const sig1 = BigInt('0x' + sig.slice(0, 64));
  const sig2 = BigInt('0x' + sig.slice(64, 128));
  return { signature: [sig1, sig2], roundNumber: BigInt(data.round) };
}

export class SpawnCommand implements CommandHandler {
  async execute(context: CommandContext, ...args: string[]): Promise<void> {
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        let txHash: string | undefined;
        let lastErr: any;

        // Check if spawn tile entity ID was provided
        let spawnTileEntityId: `0x${string}` | undefined;
        let spawnEnergy = 245280000000000000n; // Default spawn energy
        
        if (args.length >= 1 && args[0].startsWith('0x') && args[0].length === 66) {
          spawnTileEntityId = args[0] as `0x${string}`;
          
          if (args.length >= 2) {
            const energyArg = parseInt(args[1], 10);
            if (!isNaN(energyArg) && energyArg >= 0) {
              spawnEnergy = BigInt(energyArg);
            }
          }
          
          window.dispatchEvent(new CustomEvent("worker-log", {
            detail: `🎯 Spawning to specific spawn tile: ${spawnTileEntityId} with energy: ${spawnEnergy}`
          }));
        }

        if (spawnTileEntityId) {
          // Query spawn tile coordinates from indexer
          let tileCoords = { x: 0, y: 0, z: 0 };
          
          try {
            const posQuery = `SELECT "x", "y", "z" FROM "${POSITION_TABLE}" WHERE "entityId" = '${spawnTileEntityId}'`;
            const posRes = await fetch('https://indexer.mud.redstonechain.com/q', {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify([{ address: WORLD_ADDRESS, query: posQuery }]),
            });

            if (posRes.ok) {
              const posJson = await posRes.json();
              const posRows = posJson?.result?.[0];
              if (Array.isArray(posRows) && posRows.length >= 2) {
                const [cols, vals] = posRows;
                const xIdx = cols.indexOf('x');
                const yIdx = cols.indexOf('y');
                const zIdx = cols.indexOf('z');
                if (xIdx !== -1 && yIdx !== -1 && zIdx !== -1) {
                  tileCoords = {
                    x: Number(vals[xIdx]) || 0,
                    y: Number(vals[yIdx]) || 0,
                    z: Number(vals[zIdx]) || 0
                  };
                }
              }
            }
          } catch (e) {
            console.log('Failed to query spawn tile position:', e);
          }

          const spawnCoord = packCoord96(tileCoords.x, tileCoords.y + 1, tileCoords.z);

          const data = encodeFunctionData({
            abi: IWorldAbi,
            functionName: 'spawn',
            args: [spawnTileEntityId, spawnCoord, spawnEnergy, "0x"],
          });

          try {
            txHash = await context.sessionClient.sendTransaction({
              to: WORLD_ADDRESS,
              data,
              gas: 220000n,
            });
            
            if (!txHash) throw new Error('Spawn to tile failed - no transaction hash returned');
          } catch (spawnError) {
            const errorStr = String(spawnError);
            
            // Check for gas estimation failures
            if (errorStr.includes('Max retries reached for getting call data gas') ||
                errorStr.includes('callGasLimit:                   0') ||
                errorStr.includes('preVerificationGas:             0')) {
              window.dispatchEvent(new CustomEvent("worker-log", {
                detail: `❌ Gas estimation failed. This is usually a network issue. Wait a moment and try again, check your connection, or perhaps you need to 'wakeup'?`
              }));
              return;
            }
            
            // Check for "Player already spawned" error
            if (errorStr.includes('506c6179657220616c726561647920737061776e656400000000000000000000') ||
                errorStr.includes('Player already spawned')) {
              window.dispatchEvent(new CustomEvent("worker-log", {
                detail: `❌ You are already alive! You can only spawn when you're dead. Use other commands to move around.`
              }));
              return;
            }
            
            // Check for "Spawn energy too high" error
            if (errorStr.includes('537061776e20656e6572677920746f6f20686967680000000000000000000000') ||
                errorStr.includes('Spawn energy too high')) {
              window.dispatchEvent(new CustomEvent("worker-log", {
                detail: `❌ Spawn energy too high for this tile. Try: spawn ${spawnTileEntityId} 100000000000000000`
              }));
              return;
            }
            
            // Check for "Not enough RAID" error
            if (errorStr.includes('4e6f7420656e6f75676820524149440000000000000000000000000000000000') ||
                errorStr.includes('Not enough RAID')) {
              window.dispatchEvent(new CustomEvent("worker-log", {
                detail: `❌ Spawn to tile failed: Not enough RAID tokens. This spawn tile requires RAID tokens in your wallet to spawn here. Try a different spawn tile or acquire RAID tokens first.`
              }));
              return;
            }
            
            // Show the full error for debugging token gating and other requirements
            window.dispatchEvent(new CustomEvent("worker-log", {
              detail: `❌ Spawn to tile failed: ${errorStr}`
            }));
            return;
          }
        } else {
          // Original random spawn logic
          const latest = await getLatestRound();
          const candidateRounds = [latest, latest - 1n];

          for (const round of candidateRounds) {
            try {
              const drand = await fetchDrandData(round);

              const data = encodeFunctionData({
                abi: IWorldAbi,
                functionName: 'randomSpawn',
                args: [drand, 0n],
              });

              txHash = await context.sessionClient.sendTransaction({
                to: WORLD_ADDRESS,
                data,
                gas: 220000n,
              });
              break;
            } catch (e) {
              lastErr = e;
              continue;
            }
          }
        }

        if (!txHash) throw lastErr ?? new Error('Spawn failed');

        window.dispatchEvent(new CustomEvent("worker-log", {
          detail: `You blink into existence... born unto a blockchain. You are now in the matrix. Now type "look" or "help" to guide you.✅ Spawn completed: ${txHash}`
        }));
        return;

      } catch (error) {
        const errorMessage = String(error);
        
        // Check for gas estimation failures
        if (errorMessage.includes('Max retries reached for getting call data gas') ||
            errorMessage.includes('callGasLimit:                   0') ||
            errorMessage.includes('preVerificationGas:             0')) {
          window.dispatchEvent(new CustomEvent("worker-log", {
            detail: `❌ Gas estimation failed. This is usually a network issue. Wait a moment and try again, check your connection, or perhaps you need to 'wakeup'?`
          }));
          return;
        }
        
        if (attempt === maxRetries) {
          window.dispatchEvent(new CustomEvent("worker-log", {
            detail: `❌ Spawn failed after ${maxRetries} attempts: ${error}`
          }));
        } else {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
  }
}
