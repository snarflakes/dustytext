import { encodeFunctionData, parseAbi } from 'viem';
import { CommandHandler, CommandContext } from './types';

const WORLD_ADDRESS = '0x253eb85B3C953bFE3827CC14a151262482E7189C';

const MOVE_ABI = parseAbi([
  'function moveDirections(bytes32 caller, uint8[] directions)',
]);

const INDEXER_URL = "https://indexer.mud.redstonechain.com/q";
const POSITION_TABLE = "EntityPosition";

function encodePlayerEntityId(address: string): `0x${string}` {
  const prefix = "01";
  const clean = address.toLowerCase().replace(/^0x/, "");
  return `0x${prefix}${clean.padEnd(64 - prefix.length, "0")}` as `0x${string}`;
}

async function getPlayerPosition(entityId: string): Promise<{x: number, y: number, z: number} | null> {
  try {
    const query = `SELECT "x", "y", "z" FROM "${POSITION_TABLE}" WHERE "entityId" = '${entityId}'`;
    const response = await fetch(INDEXER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ address: WORLD_ADDRESS, query }]),
    });

    if (!response.ok) return null;

    const result = await response.json();
    const rows = result?.result?.[0];
    if (!Array.isArray(rows) || rows.length < 2) return null;

    const [cols, vals] = rows;
    const pos = Object.fromEntries(cols.map((k: string, i: number) => [k, vals[i]]));
    return { x: Number(pos.x ?? 0), y: Number(pos.y ?? 0), z: Number(pos.z ?? 0) };
  } catch {
    return null;
  }
}

const directionToEnum: Record<string, number> = {
  north: 5, // Try West enum for North (Z movement)
  east: 0,  // North enum moves east (X+) - keep
  south: 4, // South enum for South (Z movement)  
  west: 1,  // East enum moves west (X-) - keep
};

export class MoveCommand implements CommandHandler {
  async execute(context: CommandContext, direction: string): Promise<void> {
    try {
      const directionEnum = directionToEnum[direction.toLowerCase()];
      if (directionEnum === undefined) {
        throw new Error(`Invalid direction: ${direction}`);
      }

      const entityId = encodePlayerEntityId(context.address);
      
      // Get position before move
      const beforePos = await getPlayerPosition(entityId);

      const data = encodeFunctionData({
        abi: MOVE_ABI,
        functionName: 'moveDirections',
        args: [entityId, [directionEnum]],
      });

      const txHash = await context.sessionClient.sendTransaction({
        to: WORLD_ADDRESS,
        data,
        gas: 100000n,
      });
      
      // Wait for indexer to update
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Get position after move and check elevation change
      const afterPos = await getPlayerPosition(entityId);
      let elevationMessage = "";
      
      if (beforePos && afterPos) {
        const elevationChange = afterPos.y - beforePos.y;
        if (elevationChange < 0) {
          const drop = Math.abs(elevationChange);
          if (drop === 1) {
            elevationMessage = " (you step downwards)";
          } else if (drop === 2) {
            elevationMessage = " (you jump down)";
          } else if (drop >= 3) {
            elevationMessage = " (You scramble with your footing and fall downwards and take damage)";
          }
        }
      }

      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: `✅ Move ${direction} completed${elevationMessage}. Tx: ${txHash}` 
      }));

      // Automatically look after successful move (no additional delay needed)
      const { getCommand } = await import('./registry');
      const lookCommand = getCommand('look');
      if (lookCommand) {
        await lookCommand.execute(context);
      }
    } catch (error) {
      const errorMessage = String(error);
      
      // Check for gas limit error
      if (errorMessage.includes('gas limit too low')) {
        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: `❌ You are out of gas. Click Orange Square in the top right corner and "Top Up" Gas.` 
        }));
        return;
      }
      
      // Check for energy error (player is dead)
      if (errorMessage.includes('Entity has no energy') || 
          errorMessage.includes('456e7469747920686173206e6f20656e65726779000000000000000000000000')) {
        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: `💀 You are dead. Remember your energy depletes every minute (even while away) and more so with every move you make... "Spawn" to be reborn into new life.` 
        }));
        return;
      }
      
      // Check for simulation revert error (blocked path)
      if (errorMessage.includes('reverted during simulation with reason: 0xbeb9cbe')) {
        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: `❌ Something blocks your way. --Explore-- to see what is stopping you.` 
        }));
        
        // Auto-execute explore command
        const { getCommand } = await import('./registry');
        const exploreCommand = getCommand('explore');
        if (exploreCommand) {
          await exploreCommand.execute(context);
        }
        return;
      }
      
      // For debugging - comment out to hide full error details
      // window.dispatchEvent(new CustomEvent("worker-log", { 
      //   detail: `❌ Move failed: ${error}` 
      // }));
      
      // Generic error message
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: `❌ Move failed: ${error}` 
      }));
    }
  }
}






