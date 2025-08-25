import { encodeFunctionData, parseAbi } from 'viem';
import { CommandHandler, CommandContext } from './types';
import { packCoord96 } from './chunkCommit';

const INDEXER_URL = "https://indexer.mud.redstonechain.com/q";
const WORLD_ADDRESS = '0x253eb85B3C953bFE3827CC14a151262482E7189C';
const POSITION_TABLE = "EntityPosition";

const buildAbi = parseAbi([
  'function build(bytes32 caller, uint96 coord, uint16 slot, bytes extraData) returns (bytes32)',
]);

function encodePlayerEntityId(address: string): `0x${string}` {
  const prefix = "01";
  const clean = address.toLowerCase().replace(/^0x/, "");
  return `0x${prefix}${clean.padEnd(64 - prefix.length, "0")}` as `0x${string}`;
}

export class BuildCommand implements CommandHandler {
  async execute(context: CommandContext): Promise<void> {
    try {
      const entityId = encodePlayerEntityId(context.address);
      
      // Check for equipped block/item
      const equippedTool = (globalThis as typeof globalThis & { equippedTool: { slot: number; type: string; name: string } | null }).equippedTool;
      
      if (!equippedTool) {
        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: "❌ You must equip a block or item to build. Use 'equip <item>' first." 
        }));
        return;
      }

      // Get player position
      const posQuery = `SELECT "x", "y", "z" FROM "${POSITION_TABLE}" WHERE "entityId" = '${entityId}'`;
      const posRes = await fetch(INDEXER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([{ address: WORLD_ADDRESS, query: posQuery }]),
      });

      if (!posRes.ok) {
        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: "❌ Could not get position" 
        }));
        return;
      }

      const posJson = await posRes.json();
      const posRows = posJson?.result?.[0];
      if (!Array.isArray(posRows) || posRows.length < 2) {
        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: "❌ No position found" 
        }));
        return;
      }

      const [posCols, posVals] = posRows;
      const pos = Object.fromEntries(posCols.map((k: string, i: number) => [k, posVals[i]]));
      const x = Number(pos.x ?? 0);
      const y = Number(pos.y ?? 0);
      const z = Number(pos.z ?? 0);

      // Build at y + 1 (above player)
      const buildX = x;
      const buildY = y;
      const buildZ = z;
      const packedCoord = packCoord96(buildX, buildY, buildZ);

      console.log(`Building at coordinates: (${buildX}, ${buildY}, ${buildZ})`);
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: `🔍 Attempting to build ${equippedTool.type} at (${buildX}, ${buildY}, ${buildZ})...` 
      }));

      const data = encodeFunctionData({
        abi: buildAbi,
        functionName: 'build',
        args: [entityId, packedCoord, equippedTool.slot, '0x'],
      });

      const txHash = await context.sessionClient.sendTransaction({
        to: WORLD_ADDRESS,
        data,
        gas: 300000n,
      });

      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: `🏗️ Built ${equippedTool.type} at (${x}, ${y}, ${z}). Tx: ${txHash}` 
      }));

      // Auto-look after building
      await new Promise(resolve => setTimeout(resolve, 1000));
      const { getCommand } = await import('./registry');
      const lookCommand = getCommand('look');
      if (lookCommand) {
        await lookCommand.execute(context);
      }

    } catch (error) {
      const errorMessage = String(error);
      
      // Check for blocked path error (same as move command)
      if (errorMessage.includes('0xfdde54e2d7cc093a') || 
          errorMessage.includes('reverted during simulation with reason: 0xfdde54e2d7cc093a')) {
        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: "❌ Cannot build here - space is already occupied or blocked." 
        }));
        return;
      }
      
      if (errorMessage.includes('Cannot build non-block object')) {
        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: "❌ You can only build with block items, not tools or other objects." 
        }));
      } else if (errorMessage.includes('Can only build on air or water')) {
        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: "❌ Cannot build here - space is already occupied." 
        }));
      } else if (errorMessage.includes('Cannot build where there are dropped objects')) {
        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: "❌ Cannot build where items are on the ground." 
        }));
      } else if (errorMessage.includes('Cannot build on a movable entity')) {
        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: "❌ Cannot build where an entity is standing." 
        }));
      } else {
        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: `❌ Build failed: ${error}` 
        }));
      }
    }
  }
}




