import { encodeFunctionData, parseAbi } from 'viem';
import { CommandHandler, CommandContext } from './types';

const INDEXER_URL = "https://indexer.mud.redstonechain.com/q";
const WORLD_ADDRESS = '0x253eb85B3C953bFE3827CC14a151262482E7189C';
const POSITION_TABLE = "EntityPosition";

const fillAbi = parseAbi([
  'function fillBucket(bytes32 caller, uint96 waterCoord, uint16 bucketSlot) returns (bytes32)',
]);

function encodePlayerEntityId(address: string): `0x${string}` {
  const prefix = "01";
  const clean = address.toLowerCase().replace(/^0x/, "");
  return `0x${prefix}${clean.padEnd(64 - prefix.length, "0")}` as `0x${string}`;
}

function packCoord96(x: number, y: number, z: number): bigint {
  const X = BigInt.asUintN(32, BigInt(x));
  const Y = BigInt.asUintN(32, BigInt(y)); 
  const Z = BigInt.asUintN(32, BigInt(z));
  return (X << 64n) | (Y << 32n) | Z;
}

export class FillCommand implements CommandHandler {
  async execute(context: CommandContext): Promise<void> {
    try {
      const entityId = encodePlayerEntityId(context.address);
      
      // Check for equipped bucket
      const equippedTool = (globalThis as typeof globalThis & { equippedTool: { slot: number; type: string; name: string } | null }).equippedTool;
      
      if (!equippedTool || !equippedTool.type.toLowerCase().includes('bucket')) {
        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: "❌ You must equip a bucket to fill with water. Use 'equip bucket' first." 
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

      // Target water at current Y level (where player is standing in water)
      const waterCoord = packCoord96(x, y, z);

      const data = encodeFunctionData({
        abi: fillAbi,
        functionName: 'fillBucket',
        args: [entityId, waterCoord, equippedTool.slot],
      });

      const txHash = await context.sessionClient.sendTransaction({
        to: WORLD_ADDRESS,
        data,
        gas: 300000n,
      });

      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: `💧 Filled ${equippedTool.type} with water at (${x}, ${y}, ${z}). Tx: ${txHash}` 
      }));

    } catch (error) {
      const errorMessage = String(error);
      
      if (errorMessage.includes('Not water')) {
        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: "❌ You must be standing in water to fill a bucket." 
        }));
      } else if (errorMessage.includes('Must use an empty Bucket')) {
        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: "❌ You must equip an empty bucket to fill with water." 
        }));
      } else {
        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: `❌ Fill failed: ${error}` 
        }));
      }
    }
  }
}
