
import { encodeFunctionData } from 'viem';
import { CommandHandler, CommandContext } from './types';
import { coordToChunkCoord, initChunkCommit, fulfillChunkCommit } from './chunkCommit';
import { addToQueue, queueSizeByAction } from "../../commandQueue";
import { parseTuplesFromArgs, looksLikeJsonCoord } from "../../utils/coords";
import IWorldAbi from "@dust/world/out/IWorld.sol/IWorld.abi";

const INDEXER_URL = "https://indexer.mud.redstonechain.com/q";
const WORLD_ADDRESS = '0x253eb85B3C953bFE3827CC14a151262482E7189C';
const POSITION_TABLE = "EntityPosition";

function encodePlayerEntityId(address: string): `0x${string}` {
  const prefix = "01";
  const clean = address.toLowerCase().replace(/^0x/, "");
  return `0x${prefix}${clean.padEnd(64 - prefix.length, "0")}` as `0x${string}`;
}

async function hitWithOptionalTool(
  sessionClient: { sendTransaction: (args: { to: `0x${string}`, data: `0x${string}`, gas: bigint }) => Promise<string> },
  worldAddress: `0x${string}`,
  params: {
    caller: `0x${string}`;
    target: `0x${string}`;
    selectedToolSlot: number;
    hasToolEquipped: boolean;
    extraData: `0x${string}`;
    gas: bigint;
  }
) {
  const { caller, target, selectedToolSlot, hasToolEquipped, extraData, gas } = params;
  
  let data: `0x${string}`;
  
  if (hasToolEquipped) {
    data = encodeFunctionData({
      abi: IWorldAbi,
      functionName: 'hitPlayer',
      args: [caller, target, selectedToolSlot, extraData],
    });
  } else {
    console.log('[hit] No tool equipped — using 3-arg overload.');
    data = encodeFunctionData({
      abi: IWorldAbi,
      functionName: 'hitPlayer',
      args: [caller, target, extraData],
    });
  }
  
  return sessionClient.sendTransaction({ to: worldAddress, data, gas });
}

async function findPlayerAtCoordinate(x: number, y: number, z: number): Promise<string | null> {
  // Query for any entity at the given coordinate (not just in EntityPosition table)
  const query = `SELECT "entityId" FROM "${POSITION_TABLE}" WHERE "x" = ${x} AND "y" = ${y} AND "z" = ${z}`;
  
  console.log(`[hit] Searching for entities at (${x}, ${y}, ${z})`);
  
  const response = await fetch(INDEXER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ address: WORLD_ADDRESS, query }]),
  });

  if (!response.ok) {
    console.log(`[hit] Query failed: ${response.status}`);
    return null;
  }

  const result = await response.json();
  console.log(`[hit] Query result:`, result);
  
  const rows = result?.result?.[0];
  if (!Array.isArray(rows) || rows.length < 2) {
    console.log(`[hit] No entities found at coordinates`);
    return null;
  }

  const [, vals] = rows;
  const entities = vals.map((row: string) => {
    return row; // Each row is the entityId string itself
  });

  console.log(`[hit] Found entities:`, entities);

  // Find player entities (they start with "01" prefix)
  const playerEntities = entities.filter((entityId: string) => entityId.startsWith('0x01'));
  
  console.log(`[hit] Player entities:`, playerEntities);
  
  return playerEntities.length > 0 ? playerEntities[0] : null;
}

export class HitCommand implements CommandHandler {
  async execute(context: CommandContext, ...args: string[]): Promise<void> {
    const maxRetries = 3;
    const tuples = parseTuplesFromArgs(args);
    
    if (tuples.length > 0 && !looksLikeJsonCoord(args[0])) {
      addToQueue("hit", tuples, "ai");
      const n = queueSizeByAction("hit");
      window.dispatchEvent(new CustomEvent("worker-log", {
        detail: `✅ Queued ${tuples.length} hit target(s). (${n} queued). Type 'done' to execute.`
      }));
      return;
    }

    // Parse coordinates from JSON (from explore clicks) or default to player feet
    let coords: { x: number, y: number, z: number } | undefined;
    
    if (args.length > 0) {
      console.log('Hit command - received args:', args);
      try {
        const parsed = JSON.parse(args[0]);
        if (parsed && typeof parsed.x === 'number' && typeof parsed.y === 'number' && typeof parsed.z === 'number') {
          coords = parsed;
          console.log('Hit command - parsed coordinates:', coords);
        }
      } catch {
        window.dispatchEvent(new CustomEvent("worker-log", {
          detail: `❌ Invalid coordinates. Use 'explore' to find and click on players to hit.`
        }));
        return;
      }
    }

    // If no coordinates provided, target the block at player's feet
    if (!coords) {
      const entityId = encodePlayerEntityId(context.address);
      
      const posQuery = `SELECT "x", "y", "z" FROM "${POSITION_TABLE}" WHERE "entityId" = '${entityId}'`;
      const posRes = await fetch(INDEXER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([{ address: WORLD_ADDRESS, query: posQuery }]),
      });

      if (!posRes.ok) {
        throw new Error(`Position fetch failed: ${posRes.status}`);
      }

      const posJson = await posRes.json();
      const posRows = posJson?.result?.[0];
      if (!Array.isArray(posRows) || posRows.length < 2) {
        throw new Error("No position found. Try 'spawn' first.");
      }

      const [posCols, posVals] = posRows;
      const pos = Object.fromEntries(posCols.map((k: string, i: number) => [k, posVals[i]]));
      
      coords = {
        x: Number(pos.x ?? 0),
        y: Number(pos.y ?? 0) - 2, // Hit at block below feet
        z: Number(pos.z ?? 0)
      };
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const entityId = encodePlayerEntityId(context.address);

        // Find player at target coordinates
        const targetEntityId = await findPlayerAtCoordinate(coords.x, coords.y, coords.z);
        
        if (!targetEntityId) {
          window.dispatchEvent(new CustomEvent("worker-log", {
            detail: `❌ No player found at (${coords.x}, ${coords.y}, ${coords.z}).`
          }));
          return;
        }

        // Check if trying to hit self
        if (targetEntityId === entityId) {
          window.dispatchEvent(new CustomEvent("worker-log", {
            detail: `❌ You cannot hit yourself.`
          }));
          return;
        }

        // Get player position for chunk commits
        const posQuery = `SELECT "x", "y", "z" FROM "${POSITION_TABLE}" WHERE "entityId" = '${entityId}'`;
        const posRes = await fetch(INDEXER_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify([{ address: WORLD_ADDRESS, query: posQuery }]),
        });

        if (!posRes.ok) {
          throw new Error(`Position fetch failed: ${posRes.status}`);
        }

        const posJson = await posRes.json();
        const posRows = posJson?.result?.[0];
        if (!Array.isArray(posRows) || posRows.length < 2) {
          throw new Error("No position found. Try 'spawn' first.");
        }

        const [posCols, posVals] = posRows;
        const pos = Object.fromEntries(posCols.map((k: string, i: number) => [k, posVals[i]]));
        const playerX = Number(pos.x ?? 0);
        const playerY = Number(pos.y ?? 0);
        const playerZ = Number(pos.z ?? 0);

        // Commit chunks for both positions
        const playerChunk = coordToChunkCoord(playerX, playerY, playerZ);
        const targetChunk = coordToChunkCoord(coords.x, coords.y, coords.z);
        
        const chunksToCommit = new Set<string>();
        chunksToCommit.add(`${playerChunk.cx},${playerChunk.cy},${playerChunk.cz}`);
        chunksToCommit.add(`${targetChunk.cx},${targetChunk.cy},${targetChunk.cz}`);
        
        for (const chunkKey of chunksToCommit) {
          const [cx, cy, cz] = chunkKey.split(',').map(Number);
          try {
            await initChunkCommit(context.sessionClient, WORLD_ADDRESS, entityId, cx, cy, cz);
            // Wait and then fulfill - you'll need to implement the same pattern as mine.ts
          } catch (chunkError) {
            const chunkErrorMessage = String(chunkError);
            if (!chunkErrorMessage.includes('Existing chunk commitment')) {
              throw chunkError;
            }
          }
        }

        // Check for equipped tool
        const equippedTool = (globalThis as typeof globalThis & { equippedTool: { slot: number; type: string; name: string } | null }).equippedTool;
        const selectedToolSlot = equippedTool ? equippedTool.slot : 0;
        const hasToolEquipped = !!equippedTool;

        const txHash = await hitWithOptionalTool(context.sessionClient, WORLD_ADDRESS, {
          caller: entityId,
          target: targetEntityId as `0x${string}`,
          selectedToolSlot,
          hasToolEquipped,
          extraData: '0x',
          gas: 300000n,
        });

        const toolText = hasToolEquipped ? ` using ${equippedTool.type}` : '';
        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: `⚔️ Hit player at (${coords.x}, ${coords.y}, ${coords.z})${toolText}. Tx: ${txHash}` 
        }));
        return;
        
      } catch (error) {
        const errorMessage = String(error);
        
        if (errorMessage.includes('Cannot hit yourself')) {
          window.dispatchEvent(new CustomEvent("worker-log", { 
            detail: `❌ You cannot hit yourself.` 
          }));
          return;
        }
        
        if (errorMessage.includes('out of range') || errorMessage.includes('not reachable')) {
          window.dispatchEvent(new CustomEvent("worker-log", { 
            detail: `❌ Target player is too far away to hit.` 
          }));
          return;
        }
        
        if (errorMessage.includes('Entity has no energy')) {
          window.dispatchEvent(new CustomEvent("worker-log", { 
            detail: `💀 You are dead. Spawn to be reborn.` 
          }));
          return;
        }

        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        } else {
          window.dispatchEvent(new CustomEvent("worker-log", { 
            detail: `❌ Hit failed: ${errorMessage}` 
          }));
          return;
        }
      }
    }
  }
}

