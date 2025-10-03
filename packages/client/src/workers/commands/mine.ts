import { encodeFunctionData } from 'viem';
import { CommandHandler, CommandContext } from './types';
import { coordToChunkCoord, initChunkCommit, packCoord96, fulfillChunkCommit, getCurrentRound } from './chunkCommit';
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
      abi: IWorldAbi,
      functionName: 'mineUntilDestroyed',
      args: [caller, packedCoord, selectedToolSlot, extraData],
    });
  } else {
    // Use 3-argument version without tool
    console.log('[mine] Selected tool slot', selectedToolSlot, 'is empty — using 3-arg overload to prevent short-circuit.');
    data = encodeFunctionData({
      abi: IWorldAbi,
      functionName: 'mineUntilDestroyed',
      args: [caller, packedCoord, extraData],
    });
  }
  
  return sessionClient.sendTransaction({ to: worldAddress, data, gas });
}

// Add these helper functions

async function waitForRoundAvailable(round: bigint, timeoutMs = 90000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`https://api.drand.sh/v2/beacons/evmnet/rounds/${round}`);
      if (r.ok) return;
    } catch {
      // Ignore fetch errors and continue polling
    }
    await new Promise(res => setTimeout(res, 1500));
  }
  throw new Error(`Timed out waiting for drand round ${round} to be available`);
}

export class MineCommand implements CommandHandler {
  async execute(context: CommandContext, ...args: string[]): Promise<void> {
    const maxRetries = 3;
    const tuples = parseTuplesFromArgs(args);
    if (tuples.length > 0 && !looksLikeJsonCoord(args[0])) {
      addToQueue("mine", tuples, "ai"); // e.g. "mine", "water", "build", "fill", "till"
      const n = queueSizeByAction("mine");
      window.dispatchEvent(new CustomEvent("worker-log", {
        detail: `✅ Queued ${tuples.length} mine target(s). (${n} queued). Type 'done' to execute.`
      }));
      return; // skip execute-now — 'done' will run them
    }

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
          if (target === 'down') {
            mineY = y - 1;
          } else if (target === 'up') {
            mineY = y + 2;  // Above your head (you occupy y and y+1)
          } else {
            mineY = y; // default: mine at feet level
          }
          mineZ = z;
        }

        // Only commit chunks for mining position
        const mineChunk = coordToChunkCoord(mineX, mineY, mineZ);
        
        const chunksToCommit = new Set<string>();
        chunksToCommit.add(`${mineChunk.cx},${mineChunk.cy},${mineChunk.cz}`);
        
        // --- INIT all chunks first ---
        for (const chunkKey of chunksToCommit) {
          const [cx, cy, cz] = chunkKey.split(',').map(Number);
          try {
            console.log(`Mine command - init chunk commit (${cx},${cy},${cz})`);
            const initTxHash = await initChunkCommit(
              context.sessionClient,
              WORLD_ADDRESS,
              entityId,
              cx, cy, cz
            );
            console.log(`Mine command - init done:`, initTxHash);
          } catch (e) {
            const msg = String(e);
            if (!msg.includes('Existing chunk commitment')) throw e;
            console.log(`Mine command - chunk (${cx},${cy},${cz}) already committed`);
          }
        }

        // --- WAIT for next available round (any round within 2 minutes) ---
        const currentRound = await getCurrentRound();
        const nextRound = currentRound + 1n;
        console.log(`Mine command - waiting for any round >= ${nextRound} to be available...`);
        await waitForRoundAvailable(nextRound);

        // --- FULFILL all chunks with the same round ---
        const fulfilledChunks = new Set<string>();
        for (const chunkKey of chunksToCommit) {
          if (fulfilledChunks.has(chunkKey)) {
            console.log(`Mine command - chunk ${chunkKey} already fulfilled in this batch, skipping...`);
            continue;
          }
          
          const [cx, cy, cz] = chunkKey.split(',').map(Number);
          try {
            const fulfillTxHash = await fulfillChunkCommit(
              context.sessionClient,
              WORLD_ADDRESS,
              cx, cy, cz,
              nextRound
            );
            console.log(`Mine command - fulfill done:`, fulfillTxHash);
            fulfilledChunks.add(chunkKey);
          } catch (e) {
            const errorMessage = String(e);
            if (errorMessage.includes('Chunk already fulfilled') ||
                errorMessage.includes('4368756e6b20616c72656164792066756c66696c6c6564')) {
              console.log(`Mine command - chunk (${cx},${cy},${cz}) already fulfilled, skipping...`);
              fulfilledChunks.add(chunkKey);
              continue;
            }
            throw e;
          }
        }

        // Remove all the player position recalculation code

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
        //const positionText = `(${mineX}, ${mineY}, ${mineZ})`;
        const toolText = hasToolEquipped ? ` using ${equippedTool.type}` : '';
        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: `✅ Mining${targetText} completed${toolText}. Tx: ${txHash}` 
        }));
        return;
        
        // Auto-look after mining
        // await new Promise(resolve => setTimeout(resolve, 1000));
        // const { getCommand } = await import('./registry');
        // const lookCommand = getCommand('look');
        // if (lookCommand) {
        //  await lookCommand.execute(context);
        //}
        //return;
        
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
            detail: `❌ There is nothing to mine at your feet. You can mine below your feet by typing 'mine down'.` 
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
        
        // Check for gas or execution errors
        if (errorMessage.includes('0x34a44dbe') || 
            errorMessage.includes('gas limit too low')) {
          window.dispatchEvent(new CustomEvent("worker-log", { 
            detail: `❌ You are out of gas. Click Orange Square in the top right corner and "Top Up" Gas.` 
          }));
          return;
        }

        // Check for "Not allowed to mine here" error
        if (errorMessage.includes('4e6f7420616c6c6f77656420746f206d696e6520686572650000000000000000') ||
            errorMessage.includes('Not allowed to mine here')) {
          window.dispatchEvent(new CustomEvent("worker-log", { 
            detail: `🚫 You are not allowed to mine in this location. This area may be protected or restricted.` 
          }));
          return;
        }

        // Check for chunk commitment expired - add better recovery
        if (errorMessage.includes('Chunk commitment expired') || 
            errorMessage.includes('4368756e6b20636f6d6d69746d656e7420657870697265640000000000000000') ||
            errorMessage.includes('Not within commitment blocks') ||
            errorMessage.includes('4e6f742077697468696e20636f6d6d69746d656e7420626c6f636b7300000000')) {
          
          if (attempt < maxRetries) {
            window.dispatchEvent(new CustomEvent("worker-log", { 
              detail: `⏳ Chunk data expired, retrying... (${attempt}/${maxRetries})` 
            }));
            // Wait longer between retries to allow blockchain state to settle
            await new Promise(resolve => setTimeout(resolve, 5000 + (attempt * 2000)));
            continue;
          } else {
            window.dispatchEvent(new CustomEvent("worker-log", { 
              detail: `❌ Mining failed: Chunk data expired after retries. Try again in a few moments.` 
            }));
            return;
          }
        }
        
        // Check for force field permission error
        if (errorMessage.includes('0x08c379a0000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000314f6e6c7920617070726f7665642063616c6c6572732063616e206d696e6520696e2074686520666f726365206669656c64') ||
            errorMessage.includes('Only approved callers can mine in the force field')) {
          window.dispatchEvent(new CustomEvent("worker-log", { 
            detail: `🛡️ This area is protected by a force field and you're not on the approved list. You need permission from the field owner to mine here.` 
          }));
          return;
        }
        
        // Check for "Not yet fulfillable" error
        if (errorMessage.includes('Not yet fulfillable') || 
            errorMessage.includes('4e6f74207965742066756c66696c6c61626c6500000000000000000000000000')) {
          if (attempt < maxRetries) {
            window.dispatchEvent(new CustomEvent("worker-log", { 
              detail: `⏳ Chunk not yet fulfillable, retrying... (${attempt}/${maxRetries})` 
            }));
            await new Promise(resolve => setTimeout(resolve, 3000)); // Wait longer
            continue;
          } else {
            window.dispatchEvent(new CustomEvent("worker-log", { 
              detail: `❌ Mining failed: Chunk not yet fulfillable after retries.` 
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
