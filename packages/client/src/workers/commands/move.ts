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
  north: 5, n: 5,
  east: 0, e: 0,
  south: 4, s: 4,
  west: 1, w: 1,
  up: 2, u: 2,
  down: 3, d: 3,
};

const diagonalDirections: Record<string, number[]> = {
  northeast: [5, 0], ne: [5, 0],
  northwest: [5, 1], nw: [5, 1],
  southeast: [4, 0], se: [4, 0],
  southwest: [4, 1], sw: [4, 1],
};

type DirectionCode = 0 | 1 | 2 | 3 | 4 | 5;
const D = { East: 0, West: 1, Up: 2, Down: 3, South: 4, North: 5 } as const;

async function trySmartMove(
  context: CommandContext, 
  entityId: `0x${string}`, 
  primaryDirection: DirectionCode,
  directionName: string
): Promise<{ txHash: string; message: string }> {
  const plans = [
    { dirs: [primaryDirection], desc: directionName },
    { dirs: [D.Down, primaryDirection], desc: `down then ${directionName}` },
    { dirs: [D.Up, primaryDirection], desc: `up then ${directionName}` },
    { dirs: [D.Up, D.Up, primaryDirection], desc: `up twice then ${directionName}` }
  ];

  for (const plan of plans) {
    try {
      console.log(`Trying smart move plan: ${plan.desc}, directions: ${plan.dirs}`);
      const data = encodeFunctionData({
        abi: MOVE_ABI,
        functionName: 'moveDirections',
        args: [entityId, plan.dirs],
      });

      const txHash = await context.sessionClient.sendTransaction({
        to: WORLD_ADDRESS,
        data,
        gas: 100000n,
      });

      console.log(`Smart move plan succeeded: ${plan.desc}`);
      return { txHash, message: plan.desc };
    } catch (error) {
      const errorStr = String(error);
      console.log(`Smart move plan failed: ${plan.desc}, error: ${errorStr}`);
      if (!errorStr.includes('reverted during simulation')) {
        throw error;
      }
      // Continue to next plan if simulation reverted
    }
  }

  throw new Error('All movement plans failed');
}

async function trySmartMoveDiagonal(
  context: CommandContext, 
  entityId: `0x${string}`, 
  directions: DirectionCode[],
  directionName: string
): Promise<{ txHash: string; message: string }> {
  const plans = [
    { dirs: directions, desc: directionName },
    { dirs: [D.Down, ...directions], desc: `down then ${directionName}` },
    { dirs: [D.Up, ...directions], desc: `up then ${directionName}` },
    { dirs: [D.Up, D.Up, ...directions], desc: `up twice then ${directionName}` },
    // Try stepping up between diagonal moves
    { dirs: [directions[0], D.Up, directions[1]], desc: `${directionName} with step up` }
  ];

  for (const plan of plans) {
    try {
      console.log(`Trying diagonal smart move plan: ${plan.desc}, directions: ${plan.dirs}`);
      const data = encodeFunctionData({
        abi: MOVE_ABI,
        functionName: 'moveDirections',
        args: [entityId, plan.dirs],
      });

      const txHash = await context.sessionClient.sendTransaction({
        to: WORLD_ADDRESS,
        data,
        gas: 100000n,
      });

      console.log(`Diagonal smart move plan succeeded: ${plan.desc}`);
      return { txHash, message: plan.desc };
    } catch (error) {
      const errorStr = String(error);
      console.log(`Diagonal smart move plan failed: ${plan.desc}, error: ${errorStr}`);
      if (!errorStr.includes('reverted during simulation')) {
        throw error;
      }
    }
  }

  throw new Error('All diagonal movement plans failed');
}

export class MoveCommand implements CommandHandler {
  async execute(context: CommandContext, direction: string): Promise<void> {
    try {
      const lowerDirection = direction.toLowerCase();
      let directionEnums: number[];
      
      // Declare variables at the top
      const entityId = encodePlayerEntityId(context.address);
      const beforePos = await getPlayerPosition(entityId);
      let txHash: string;
      let moveDescription = direction;
      
      // Check if it's a diagonal direction
      if (diagonalDirections[lowerDirection]) {
        directionEnums = diagonalDirections[lowerDirection];
        
        // Use smart move for diagonal directions
        try {
          const result = await trySmartMoveDiagonal(context, entityId, directionEnums as DirectionCode[], direction);
          txHash = result.txHash;
          moveDescription = result.message;
        } catch (smartMoveError) {
          // Fall back to regular diagonal move
          const data = encodeFunctionData({
            abi: MOVE_ABI,
            functionName: 'moveDirections',
            args: [entityId, directionEnums],
          });

          txHash = await context.sessionClient.sendTransaction({
            to: WORLD_ADDRESS,
            data,
            gas: 100000n,
          });
        }
      } else {
        // Single cardinal direction
        const directionEnum = directionToEnum[lowerDirection];
        if (directionEnum === undefined) {
          throw new Error(`Invalid direction: ${direction}`);
        }
        directionEnums = [directionEnum];

        // Try smart move for horizontal directions only (exclude Up=2 and Down=3)
        const useSmartMove = directionEnums.length === 1 && 
          [0, 1, 4, 5].includes(directionEnums[0]);

        if (useSmartMove) {
          try {
            const result = await trySmartMove(context, entityId, directionEnums[0] as DirectionCode, direction);
            txHash = result.txHash;
            moveDescription = result.message;
          } catch (smartMoveError) {
            // Fall back to regular move if smart move fails
            const data = encodeFunctionData({
              abi: MOVE_ABI,
              functionName: 'moveDirections',
              args: [entityId, directionEnums],
            });

            txHash = await context.sessionClient.sendTransaction({
              to: WORLD_ADDRESS,
              data,
              gas: 100000n,
            });
          }
        } else {
          // Regular move for up/down - no smart move needed
          const data = encodeFunctionData({
            abi: MOVE_ABI,
            functionName: 'moveDirections',
            args: [entityId, directionEnums],
          });

          txHash = await context.sessionClient.sendTransaction({
            to: WORLD_ADDRESS,
            data,
            gas: 100000n,
          });
        }
      }
      
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
        detail: `✅ Move ${moveDescription} completed${elevationMessage}. Tx: ${txHash}` 
      }));

      // Automatically look after successful move
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
      if (errorMessage.includes('reverted during simulation with reason: 0xbeb9cbe') ||
          errorMessage.includes('reverted during simulation with reason: 0xfdde54e2e15f95e5')) {
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
      
      // Generic error message
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: `❌ Move failed: ${error}` 
      }));
    }
  }
}






