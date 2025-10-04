import { encodeFunctionData } from 'viem';
import { CommandHandler, CommandContext } from './types';
import { coordToChunkCoord, initChunkCommit, packCoord96, fulfillChunkCommit, getCurrentRound } from './chunkCommit';
import { addToQueue, queueSizeByAction } from "../../commandQueue";
import { parseTuplesFromArgs, looksLikeJsonCoord } from "../../utils/coords";
import { queryIndexer } from './queryIndexer';
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
  // Add a static method to handle chunk commitments for multiple coordinates
  static async handleChunkCommitments(
    context: CommandContext, 
    coords: Array<{ x: number, y: number, z: number }>
  ): Promise<void> {
    const entityId = encodePlayerEntityId(context.address);
    const chunksToCheck = new Set<string>();
    
    // Collect all unique chunks from all coordinates
    for (const coord of coords) {
      const chunk = coordToChunkCoord(coord.x, coord.y, coord.z);
      chunksToCheck.add(`${chunk.cx},${chunk.cy},${chunk.cz}`);
    }

    console.log(`DEBUG: Checking ${chunksToCheck.size} unique chunks:`, Array.from(chunksToCheck));

    // Handle chunk commitments for all chunks
    for (const chunkKey of chunksToCheck) {
      const [cx, cy, cz] = chunkKey.split(',').map(Number);
      
      console.log(`DEBUG: Checking chunk (${cx},${cy},${cz})`);

      // Query using individual x, y, z columns as shown in the database
      // Based on the screenshot, the table has: x, y, z, blockNumber columns
      const chunkQuery = `SELECT "x", "y", "z", "blockNumber" FROM "ChunkCommitment" WHERE "x" = ${cx} AND "y" = ${cy} AND "z" = ${cz}`;
      console.log(`DEBUG: Query:`, chunkQuery);

      try {
        const chunkRows = await queryIndexer(chunkQuery, `chunk-${cx}-${cy}-${cz}`);
        console.log(`DEBUG: Query result for chunk (${cx},${cy},${cz}):`, chunkRows);

        if (Array.isArray(chunkRows) && chunkRows.length >= 2) {
          const [cols, vals] = chunkRows;
          console.log(`DEBUG: Found commitment - Columns:`, cols);
          console.log(`DEBUG: Values:`, vals);

          const commitment = Object.fromEntries(cols.map((k: unknown, i: number) => [String(k), vals[i]]));
          console.log(`DEBUG: Parsed commitment:`, commitment);

          const blockNumber = Number(commitment.blockNumber || 0);
          console.log(`DEBUG: Chunk (${cx},${cy},${cz}) has blockNumber: ${blockNumber}`);

          // Even if we found a commitment in the database, we need to ensure it's properly fulfilled
          // The "No chunk commitment" error suggests the on-chain state doesn't match the indexer
          console.log(`Chunk (${cx},${cy},${cz}) found in database, but ensuring it's properly fulfilled...`);

          try {
            // Try to fulfill the existing commitment to make sure it's valid
            const currentRound = await getCurrentRound();
            await waitForRoundAvailable(currentRound);
            await fulfillChunkCommit(context.sessionClient, WORLD_ADDRESS, cx, cy, cz, currentRound);
            console.log(`Chunk (${cx},${cy},${cz}) fulfilled successfully`);
          } catch (fulfillError) {
            const errorMessage = String(fulfillError);
            if (errorMessage.includes('Not yet fulfillable') ||
                errorMessage.includes('4e6f74207965742066756c66696c6c61626c6500000000000000000000000000')) {
              console.warn(`Chunk (${cx},${cy},${cz}) not yet fulfillable, will retry during mining`);
            } else if (errorMessage.includes('Existing chunk commitment') ||
                       errorMessage.includes('4578697374696e67206368756e6b20636f6d6d69746d656e74')) {
              console.log(`Chunk (${cx},${cy},${cz}) already has valid commitment`);
            } else {
              console.warn(`Failed to fulfill existing chunk (${cx},${cy},${cz}):`, fulfillError);
              // Re-initialize the chunk commitment
              await initChunkCommit(context.sessionClient, WORLD_ADDRESS, entityId, cx, cy, cz);
              const newRound = await getCurrentRound();
              await waitForRoundAvailable(newRound);
              await fulfillChunkCommit(context.sessionClient, WORLD_ADDRESS, cx, cy, cz, newRound);
              console.log(`Chunk (${cx},${cy},${cz}) re-initialized and fulfilled`);
            }
          }
          continue;

        } else {
          console.log(`DEBUG: No commitment found for chunk (${cx},${cy},${cz})`);
          console.log(`No commitment found for chunk (${cx},${cy},${cz}), initializing...`);

          try {
            await initChunkCommit(context.sessionClient, WORLD_ADDRESS, entityId, cx, cy, cz);
            const committedRound = await getCurrentRound();
            await waitForRoundAvailable(committedRound);
            await fulfillChunkCommit(context.sessionClient, WORLD_ADDRESS, cx, cy, cz, committedRound);
            console.log(`Chunk (${cx},${cy},${cz}) initialized and fulfilled`);
          } catch (error) {
            const errorMessage = String(error);
            // Check for "Not yet fulfillable" error during chunk commitment
            if (errorMessage.includes('Not yet fulfillable') ||
                errorMessage.includes('4e6f74207965742066756c66696c6c61626c6500000000000000000000000000')) {
              console.warn(`Chunk (${cx},${cy},${cz}) not yet fulfillable, will retry during mining`);
              // Don't throw - let mining proceed and handle this during mining attempts
              return;
            }
            console.warn(`Failed to initialize chunk (${cx},${cy},${cz}):`, error);
            throw error;
          }
        }
      } catch (queryError) {
        console.error(`DEBUG: Failed to query chunk (${cx},${cy},${cz}):`, queryError);
        // Skip this chunk if query fails completely
        continue;
      }
    }
  }

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
      const pos = Object.fromEntries(posCols.map((k: unknown, i: number) => [String(k), posVals[i]]));
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

    // Only handle chunk commitments for direct mine commands (not when called from done)
    // If coords are provided (JSON), it means this is being called from done command
    // which already handled chunk commitments globally
    if (!coords) {
      // This is a direct mine command, handle chunk commitments
      const coordsToMine = [{ x: mineX, y: mineY, z: mineZ }];

      try {
        await MineCommand.handleChunkCommitments(context, coordsToMine);
        window.dispatchEvent(new CustomEvent("worker-log", {
          detail: `✅ Chunk commitments handled for mining location`
        }));
      } catch (error) {
        window.dispatchEvent(new CustomEvent("worker-log", {
          detail: `❌ Chunk commitment failed: ${error}`
        }));
        return;
      }
    }



    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
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

        // Check for chunk commitment expired - re-init and retry
        if (errorMessage.includes('Chunk commitment expired') || 
            errorMessage.includes('4368756e6b20636f6d6d69746d656e7420657870697265640000000000000000') ||
            errorMessage.includes('Not within commitment blocks') ||
            errorMessage.includes('4e6f742077697468696e20636f6d6d69746d656e7420626c6f636b7300000000')) {
          
          if (attempt < maxRetries) {
            window.dispatchEvent(new CustomEvent("worker-log", { 
              detail: `⏳ Chunk commitment expired, re-initializing... (${attempt}/${maxRetries})` 
            }));
            
            // Re-init the chunk to reset the 2-minute timer
            try {
              const entityId = encodePlayerEntityId(context.address);
              
              // Extract coordinates from the packedCoord that was used for mining
              let mineX: number, mineY: number, mineZ: number;
              
              if (coords) {
                mineX = coords.x;
                mineY = coords.y;
                mineZ = coords.z;
              } else {
                // Get current player position again
                const pos = await this.getPlayerPosition(entityId);
                mineX = pos.x;
                if (target === 'down') {
                  mineY = pos.y - 1;
                } else if (target === 'up') {
                  mineY = pos.y + 2;
                } else {
                  mineY = pos.y;
                }
                mineZ = pos.z;
              }
              
              const mineChunk = coordToChunkCoord(mineX, mineY, mineZ);
              const [cx, cy, cz] = [mineChunk.cx, mineChunk.cy, mineChunk.cz];
              
              // Check ChunkCommitment table using correct structure
              const chunkQuery = `SELECT "x", "y", "z", "blockNumber" FROM "ChunkCommitment" WHERE "x" = ${cx} AND "y" = ${cy} AND "z" = ${cz}`;
              const chunkRes = await fetch(INDEXER_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify([{ address: WORLD_ADDRESS, query: chunkQuery }]),
              });

              if (!chunkRes.ok) {
                console.error(`Failed to query chunk during retry (${cx},${cy},${cz}): ${chunkRes.status}`);
                throw new Error(`Failed to query chunk commitment`);
              }

              const chunkJson = await chunkRes.json();
              const chunkRows = chunkJson?.result?.[0];

              if (Array.isArray(chunkRows) && chunkRows.length >= 2) {
                const [cols, vals] = chunkRows;
                const commitment = Object.fromEntries(cols.map((k: unknown, i: number) => [String(k), vals[i]]));
                const blockNumber = Number(commitment.blockNumber || 0);
                
                // For now, if chunk exists in table, assume we need to wait
                console.log(`Mine command - chunk (${cx},${cy},${cz}) exists with blockNumber: ${blockNumber}`);
                window.dispatchEvent(new CustomEvent("worker-log", { 
                  detail: `⏳ Chunk commitment exists, waiting before retry...` 
                }));
                await new Promise(resolve => setTimeout(resolve, 5000));
                continue;
              }
              
              console.log(`Mine command - re-init chunk commit (${cx},${cy},${cz})`);
              await initChunkCommit(
                context.sessionClient,
                WORLD_ADDRESS,
                entityId,
                cx, cy, cz
              );
              console.log(`Mine command - re-init done, retrying...`);
              
              // Wait a bit for the new commitment to be ready
              await new Promise(resolve => setTimeout(resolve, 3000));
              continue; // Retry the mining attempt
              
            } catch (reinitError) {
              const reinitMsg = String(reinitError);
              if (reinitMsg.includes('Existing chunk commitment') ||
                  reinitMsg.includes('4578697374696e67206368756e6b20636f6d6d69746d656e74')) {
                // There's an existing commitment, but it's expired. We need to wait for it to be clearable.
                // Chunk commitments can be reset after 10 minutes (600 seconds)
                window.dispatchEvent(new CustomEvent("worker-log", {
                  detail: `⏳ Chunk commitment exists, waiting before retry...`
                }));
                await new Promise(resolve => setTimeout(resolve, 10000)); // Wait longer
                continue;
              } else {
                throw reinitError;
              }
            }
          } else {
            window.dispatchEvent(new CustomEvent("worker-log", { 
              detail: `❌ Mining failed: Chunk commitment expired after retries.` 
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
        
        // Check for "No chunk commitment" error
        if (errorMessage.includes('No chunk commitment') ||
            errorMessage.includes('4e6f206368756e6b20636f6d6d69746d656e7400000000000000000000000000')) {
          if (attempt < maxRetries) {
            window.dispatchEvent(new CustomEvent("worker-log", {
              detail: `⏳ No chunk commitment found, re-initializing... (${attempt}/${maxRetries})`
            }));

            // Re-initialize the chunk commitment
            try {
              const entityId = encodePlayerEntityId(context.address);

              // Extract coordinates from the mining location
              let mineX: number, mineY: number, mineZ: number;

              if (coords) {
                mineX = coords.x;
                mineY = coords.y;
                mineZ = coords.z;
              } else {
                const pos = await this.getPlayerPosition(entityId);
                mineX = pos.x;
                mineY = pos.y;
                mineZ = pos.z;
              }

              const mineChunk = coordToChunkCoord(mineX, mineY, mineZ);
              const [cx, cy, cz] = [mineChunk.cx, mineChunk.cy, mineChunk.cz];

              console.log(`Re-initializing chunk commitment for (${cx},${cy},${cz})`);
              await initChunkCommit(context.sessionClient, WORLD_ADDRESS, entityId, cx, cy, cz);
              const newRound = await getCurrentRound();
              await waitForRoundAvailable(newRound);
              await fulfillChunkCommit(context.sessionClient, WORLD_ADDRESS, cx, cy, cz, newRound);
              console.log(`Chunk (${cx},${cy},${cz}) re-initialized and fulfilled`);

              // Wait a bit for the new commitment to be ready
              await new Promise(resolve => setTimeout(resolve, 3000));
              continue; // Retry the mining attempt

            } catch (reinitError) {
              console.warn(`Failed to re-initialize chunk commitment:`, reinitError);
              throw reinitError;
            }
          } else {
            window.dispatchEvent(new CustomEvent("worker-log", {
              detail: `❌ Mining failed: Could not establish chunk commitment after retries.`
            }));
            return;
          }
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
    const pos = Object.fromEntries(posCols.map((k: unknown, i: number) => [String(k), posVals[i]]));
    return { x: Number(pos.x ?? 0), y: Number(pos.y ?? 0), z: Number(pos.z ?? 0) };
  }
}
