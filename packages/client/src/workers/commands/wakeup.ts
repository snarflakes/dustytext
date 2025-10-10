// wakeup.ts
import { encodeFunctionData } from "viem";
import { CommandHandler, CommandContext } from "./types";
import { queryIndexer } from "./queryIndexer";
import IWorldAbi from "@dust/world/out/IWorld.sol/IWorld.abi";

// Keep consistent with queryIndexer.ts (single source of truth is best)
const WORLD_ADDRESS = "0x253eb85B3C953bFE3827CC14a151262482E7189C";

// --- Table names used by the indexer ---
const ENTITY_POS_TABLE = "EntityPosition";

// ---------- helpers ----------
function encodePlayerEntityId(address: string): `0x${string}` {
  const prefix = "01";
  const clean = address.toLowerCase().replace(/^0x/, "");
  return `0x${prefix}${clean.padEnd(64 - prefix.length, "0")}` as `0x${string}`;
}

function packCoord96(x: number, y: number, z: number): bigint {
  // Pack coordinates into uint96 (32 bits each)
  const xBig = BigInt(x) & 0xffffffffn;
  const yBig = BigInt(y) & 0xffffffffn;
  const zBig = BigInt(z) & 0xffffffffn;
  return (xBig << 64n) | (yBig << 32n) | zBig;
}

// ---------- indexer I/O ----------
async function getPlayerPosition(entityId: `0x${string}`) {
  const sql = `SELECT "x","y","z" FROM "${ENTITY_POS_TABLE}" WHERE "entityId"='${entityId}'`;
  const rows = await queryIndexer(sql, "wakeup_getPlayerPosition");
  if (rows.length < 2) return null;
  const r = rows[1];
  return {
    x: parseInt(r[0] as string, 10),
    y: parseInt(r[1] as string, 10),
    z: parseInt(r[2] as string, 10),
  };
}

// ---------- main command ----------
export class WakeupCommand implements CommandHandler {
  async execute(context: CommandContext, ...args: string[]): Promise<void> {
    const log = (detail: string) =>
      window.dispatchEvent(new CustomEvent("worker-log", { detail }));

    try {
      const caller = encodePlayerEntityId(context.address);
      let spawnCoord: bigint;

      // Check if coordinates were provided as arguments
      if (args.length >= 3) {
        const x = parseInt(args[0], 10);
        const y = parseInt(args[1], 10);
        const z = parseInt(args[2], 10);
        
        if (isNaN(x) || isNaN(y) || isNaN(z)) {
          log("❌ Invalid coordinates. Usage: wakeup [x y z]");
          return;
        }
        
        spawnCoord = packCoord96(x, y, z);
        log(`You focus on waking up at (${x}, ${y}, ${z})...`);
      } else {
        // Get current position for spawn coordinate
        log("You stir from your slumber...");
        const pos = await getPlayerPosition(caller);
        
        if (!pos) {
          log("❌ Could not determine your position. Try 'wakeup x y z' with specific coordinates, or 'spawn' first.");
          return;
        }

        spawnCoord = packCoord96(pos.x, pos.y, pos.z);
        log(`Waking up at your current position (${pos.x}, ${pos.y}, ${pos.z})...`);
      }

      // Encode and send the wakeup() call
      const data = encodeFunctionData({
        abi: IWorldAbi,
        functionName: "wakeup",
        args: [
          caller,
          spawnCoord,
          "0x" as `0x${string}`, // extraData (none)
        ],
      });

      const txHash = await context.sessionClient.sendTransaction({
        to: WORLD_ADDRESS,
        data,
        gas: 300000n,
      });

      log(`☀️ Ready for a new day! Tx: ${txHash}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      
      // Check for "Player is not in a bed" error
      if (msg.includes('506c61796572206973206e6f7420696e20612062656400000000000000000000') ||
          msg.includes('Player is not in a bed')) {
        window.dispatchEvent(
          new CustomEvent("worker-log", { detail: `❌ You are not currently sleeping in a bed. Use 'sleep' first to lie down in a nearby bed, then 'wakeup' to get out of it.` })
        );
        return;
      }
      
      // Check for gas limit error
      if (msg.includes('0x34a44dbe') || 
          msg.includes('gas limit too low')) {
        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: `❌ You are out of gas. Click Orange Square in the top right corner and "Top Up" Gas.` 
        }));
        return;
      }
      
      // Check for energy error (player is dead)
      if (msg.includes('Entity has no energy') || 
          msg.includes('456e7469747920686173206e6f20656e65726779000000000000000000000000')) {
        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: `💀 You are dead. Remember your energy depletes every minute (even while away) and more so with every move you make... "Spawn" to be reborn into new life.` 
        }));
        return;
      }
      
      window.dispatchEvent(
        new CustomEvent("worker-log", { detail: `❌ Wakeup failed: ${msg}` })
      );
    }
  }
}

