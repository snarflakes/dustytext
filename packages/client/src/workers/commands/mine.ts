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
  async execute(context: CommandContext, target?: string): Promise<void> {
    const maxRetries = 3;
    
    // Wait for indexer to be up-to-date before starting
    await new Promise(resolve => setTimeout(resolve, 2500));
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const entityId = encodePlayerEntityId(context.address);

        // Get player position
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
        let mineY = y;
        if (target === 'down') {
          mineY = y - 1; // Mine the block below
        }

        // Only commit chunks for player position and mining position
        const playerChunk = coordToChunkCoord(x, y, z);
        const mineChunk = coordToChunkCoord(x, mineY, z);
        
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

        const packedCoord = packCoord96(x, mineY, z);

        console.log('Mine command - mining at:', { x, y: mineY, z });
        console.log('Mine command - entityId:', entityId);
        console.log('Mine command - packed coord:', packedCoord.toString(16));

        // Use the new mining function with tool support
        const txHash = await mineWithOptionalTool(context.sessionClient, WORLD_ADDRESS, {
          caller: entityId,
          packedCoord,
          selectedToolSlot: 0,
          hasToolEquipped: false,
          extraData: '0x',
          gas: 300000n,
        });

        const targetText = target === 'down' ? ' down' : (target ? ` ${target}` : '');
        const positionText = target === 'down' ? `(${x}, ${mineY}, ${z})` : `(${x}, ${y}, ${z})`;
        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: `✅ Mining${targetText} completed at ${positionText}. Tx: ${txHash}` 
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
        
        // Check for "Object is not mineable" error
        if (errorMessage.includes('Object is not mineable') || 
            errorMessage.includes('4f626a656374206973206e6f74206d696e6561626c6500000000000000000000')) {
          window.dispatchEvent(new CustomEvent("worker-log", { 
            detail: `❌ There is nothing to mine at your feet.` 
          }));
          return;
        }
        
        if (errorMessage.includes('Chunk commitment expired') || 
            errorMessage.includes('4368756e6b20636f6d6d69746d656e7420657870697265640000000000000000')) {
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
}




































