import { encodeFunctionData, parseAbi } from 'viem';
import { CommandHandler, CommandContext } from './types';
import { coordToChunkCoord, chunkCommit, packCoord96 } from './chunkCommit';

const INDEXER_URL = "https://indexer.mud.redstonechain.com/q";
const WORLD_ADDRESS = '0x253eb85B3C953bFE3827CC14a151262482E7189C';
const POSITION_TABLE = "EntityPosition";

const mineAbi = parseAbi([
  // With tool
  'function mineUntilDestroyed(bytes32 caller, uint96 coord, uint16 toolSlot, bytes extraData) returns (bytes32)',
  // Without tool
  'function mineUntilDestroyed(bytes32 caller, uint96 coord, bytes extraData) returns (bytes32)',
]);

function encodePlayerEntityId(address: string): `0x${string}` {
  const prefix = "01";
  const clean = address.toLowerCase().replace(/^0x/, "");
  return `0x${prefix}${clean.padEnd(64 - prefix.length, "0")}` as `0x${string}`;
}

async function mineWithOptionalTool(
  sessionClient: { sendTransaction: (args: { to: `0x${string}`, data: `0x${string}`, gas: bigint }) => Promise<string> },
  worldAddress: `0x${string}`,
  params: {
    caller: `0x${string}`;
    packedCoord: bigint;
    selectedToolSlot: number;
    hasToolEquipped: boolean;
    extraData: `0x${string}`;
    gas: bigint;
  }
) {
  const { caller, packedCoord, selectedToolSlot, hasToolEquipped, extraData, gas } = params;
  
  let data: `0x${string}`;
  
  if (hasToolEquipped) {
    // Use 4-argument version with tool
    data = encodeFunctionData({
      abi: mineAbi,
      functionName: 'mineUntilDestroyed',
      args: [caller, packedCoord, selectedToolSlot, extraData],
    });
  } else {
    // Use 3-argument version without tool
    console.log('[mine] Selected tool slot', selectedToolSlot, 'is empty — using 3-arg overload to prevent short-circuit.');
    data = encodeFunctionData({
      abi: mineAbi,
      functionName: 'mineUntilDestroyed',
      args: [caller, packedCoord, extraData],
    });
  }
  
  return sessionClient.sendTransaction({ to: worldAddress, data, gas });
}

export class MineCommand implements CommandHandler {
  async execute(context: CommandContext, ...args: string[]): Promise<void> {
    const maxRetries = 3;
    
    // Parse arguments - check if we have coordinates passed as JSON string
    let target: string | undefined;
    let coords: { x: number, y: number, z: number } | undefined;
    
    if (args.length > 0) {
      console.log('Mine command - received args:', args);
      // Check if first arg is JSON coordinates
      try {
        const parsed = JSON.parse(args[0]);
        if (parsed && typeof parsed.x === 'number' && typeof parsed.y === 'number' && typeof parsed.z === 'number') {
          coords = parsed;
          console.log('Mine command - parsed coordinates:', coords);
        } else {
          target = args[0];
          console.log('Mine command - using target:', target);
        }
      } catch {
        target = args[0];
        console.log('Mine command - failed to parse JSON, using target:', target);
      }
    }
    
    // Wait for indexer to be up-to-date before starting
    await new Promise(resolve => setTimeout(resolve, 2500));
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const entityId = encodePlayerEntityId(context.address);

        let mineX: number, mineY: number, mineZ: number;

        if (coords) {
          // Use provided coordinates for remote mining
          mineX = coords.x;
          mineY = coords.y;
          mineZ = coords.z;
        } else {
          // Get player position for traditional mining
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
          const { x, y, z } = { x: Number(pos.x ?? 0), y: Number(pos.y ?? 0), z: Number(pos.z ?? 0) };

          // Determine mining position based on target
          mineX = x;
          mineY = target === 'down' ? y - 1 : y;
          mineZ = z;
        }

        // Only commit chunks for player position and mining position
        const playerPos = coords ? await this.getPlayerPosition(entityId) : { x: mineX, y: mineY, z: mineZ };
        const playerChunk = coordToChunkCoord(playerPos.x, playerPos.y, playerPos.z);
        const mineChunk = coordToChunkCoord(mineX, mineY, mineZ);
        
        const chunksToCommit = new Set<string>();
        chunksToCommit.add(`${playerChunk.cx},${playerChunk.cy},${playerChunk.cz}`);
        chunksToCommit.add(`${mineChunk.cx},${mineChunk.cy},${mineChunk.cz}`);
        
        console.log(`Mine command - committing ${chunksToCommit.size} essential chunks`);
        
        for (const chunkKey of chunksToCommit) {
          const [cx, cy, cz] = chunkKey.split(',').map(Number);
          try {
            const chunkTxHash = await chunkCommit(context.sessionClient, WORLD_ADDRESS, entityId, cx, cy, cz);
            console.log(`Mine command - chunk commit (${cx},${cy},${cz}):`, chunkTxHash);
          } catch (chunkError) {
            const chunkErrorMessage = String(chunkError);
            if (!chunkErrorMessage.includes('Existing chunk commitment')) {
              throw chunkError;
            }
            console.log(`Mine command - chunk (${cx},${cy},${cz}) already committed`);
          }
        }

        const packedCoord = packCoord96(mineX, mineY, mineZ);

        console.log('Mine command - mining at:', { x: mineX, y: mineY, z: mineZ });
        console.log('Mine command - entityId:', entityId);
        console.log('Mine command - packed coord:', packedCoord.toString(16));

        // Check for equipped tool
        const equippedTool = (globalThis as typeof globalThis & { equippedTool: { slot: number; type: string; name: string } | null }).equippedTool;
        const selectedToolSlot = equippedTool ? equippedTool.slot : 0;
        const hasToolEquipped = !!equippedTool;

        // Use the new mining function with tool support
        const txHash = await mineWithOptionalTool(context.sessionClient, WORLD_ADDRESS, {
          caller: entityId,
          packedCoord,
          selectedToolSlot,
          hasToolEquipped,
          extraData: '0x',
          gas: 300000n,
        });

        const targetText = coords ? ` at (${mineX}, ${mineY}, ${mineZ})` : (target === 'down' ? ' down' : (target ? ` ${target}` : ''));
        const positionText = `(${mineX}, ${mineY}, ${mineZ})`;
        const toolText = hasToolEquipped ? ` using ${equippedTool.type}` : '';
        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: `✅ Mining${targetText} completed at ${positionText}${toolText}. Tx: ${txHash}` 
        }));

        // Auto-look after mining
        await new Promise(resolve => setTimeout(resolve, 1000));
        const { getCommand } = await import('./registry');
        const lookCommand = getCommand('look');
        if (lookCommand) {
          await lookCommand.execute(context);
        }
        return;
        
      } catch (error) {
        const errorMessage = String(error);
        
        // Check for "Coordinate is not reachable" error
        if (errorMessage.includes('Coordinate is not reachable') || 
            errorMessage.includes('436f6f7264696e617465206973206e6f7420726561636861626c650000000000')) {
          window.dispatchEvent(new CustomEvent("worker-log", { 
            detail: `❌ That location is beyond your reach or something is blocking your way, try mining blocks above or below it first.` 
          }));
          return;
        }
        
        // Check for "Object is not mineable" error
        if (errorMessage.includes('Object is not mineable') || 
            errorMessage.includes('4f626a656374206973206e6f74206d696e6561626c6500000000000000000000')) {
          window.dispatchEvent(new CustomEvent("worker-log", { 
            detail: `❌ There is nothing to mine at your feet.` 
          }));
          return;
        }
        
        // Check for energy error (player is dead) - multiple formats
        if (errorMessage.includes('Entity has no energy') || 
            errorMessage.includes('456e7469747920686173206e6f20656e65726779000000000000000000000000') ||
            errorMessage.includes('456e7469747920686173206e6f20656e65726779')) {
          window.dispatchEvent(new CustomEvent("worker-log", { 
            detail: `💀 You are dead. Remember your energy depletes every minute (even while away) and more so with every move you make... "Spawn" to be reborn into new life.` 
          }));
          return;
        }
        
        if (errorMessage.includes('Chunk commitment expired') || 
            errorMessage.includes('4368756e6b20636f6d6d69746d656e7420657870697265640000000000000000') ||
            errorMessage.includes('Not within commitment blocks') ||
            errorMessage.includes('4e6f742077697468696e20636f6d6d69746d656e7420626c6f636b7300000000')) {
          if (attempt < maxRetries) {
            window.dispatchEvent(new CustomEvent("worker-log", { 
              detail: `⏳ Chunk data expired, retrying... (${attempt}/${maxRetries})` 
            }));
            await new Promise(resolve => setTimeout(resolve, 2000));
            continue;
          } else {
            window.dispatchEvent(new CustomEvent("worker-log", { 
              detail: `❌ Mining failed: Chunk data expired after retries.` 
            }));
            return;
          }
        }
        
        if (attempt === maxRetries) {
          window.dispatchEvent(new CustomEvent("worker-log", { 
            detail: `❌ Mine failed after ${maxRetries} attempts: ${error}` 
          }));
        }
      }
    }
  }

  private async getPlayerPosition(entityId: string): Promise<{ x: number, y: number, z: number }> {
    const posQuery = `SELECT "x", "y", "z" FROM "${POSITION_TABLE}" WHERE "entityId" = '${entityId}'`;
    const posRes = await fetch(INDEXER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ address: WORLD_ADDRESS, query: posQuery }]),
    });

    const posJson = await posRes.json();
    const posRows = posJson?.result?.[0];
    if (!Array.isArray(posRows) || posRows.length < 2) {
      throw new Error("No position found");
    }

    const [posCols, posVals] = posRows;
    const pos = Object.fromEntries(posCols.map((k: string, i: number) => [k, posVals[i]]));
    return { x: Number(pos.x ?? 0), y: Number(pos.y ?? 0), z: Number(pos.z ?? 0) };
  }
}












































