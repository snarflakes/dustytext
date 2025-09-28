
import { encodeFunctionData, toHex } from 'viem';
import { CommandHandler, CommandContext } from './types';
import IWorldAbi from "@dust/world/out/IWorld.sol/IWorld.abi";
import { objectNamesById } from '../../objects';

const INDEXER_URL = "https://indexer.mud.redstonechain.com/q";
const WORLD_ADDRESS = '0x253eb85B3C953bFE3827CC14a151262482E7189C';
const POSITION_TABLE = "EntityPosition";
const INVENTORY_SLOT_TABLE = "InventorySlot";

// Use official Dust entity encoding
const BYTES_32_BITS = 256n;
const ENTITY_TYPE_BITS = 8n;
const ENTITY_ID_BITS = BYTES_32_BITS - ENTITY_TYPE_BITS;
const VEC3_BITS = 96n;

const EntityTypes = {
  Player: 0x01,
  Block: 0x03,
} as const;

function encode(entityType: number, data: bigint): `0x${string}` {
  return toHex((BigInt(entityType) << ENTITY_ID_BITS) | data, { size: 32 });
}

function packVec3([x, y, z]: [number, number, number]): bigint {
  const ux = BigInt(x >>> 0);
  const uy = BigInt(y >>> 0);
  const uz = BigInt(z >>> 0);
  return (ux << 64n) | (uy << 32n) | uz;
}

function encodeCoord(entityType: number, coord: [number, number, number]): `0x${string}` {
  const packedCoord = packVec3(coord);
  return encode(entityType, packedCoord << (ENTITY_ID_BITS - VEC3_BITS));
}

function encodePlayerEntityId(address: string): `0x${string}` {
  const prefix = "01";
  const clean = address.toLowerCase().replace(/^0x/, "");
  return `0x${prefix}${clean.padEnd(64 - prefix.length, "0")}` as `0x${string}`;
}

function encodeBlock(coord: [number, number, number]): `0x${string}` {
  return encodeCoord(EntityTypes.Block, coord);
}

async function getPlayerPosition(entityId: `0x${string}`) {
  const query = `SELECT "x", "y", "z" FROM "${POSITION_TABLE}" WHERE "entityId" = '${entityId}'`;
  
  const response = await fetch(INDEXER_URL, {
    method: "POST", 
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ address: WORLD_ADDRESS, query }])
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const result = await response.json();
  const rows = result?.result?.[0];
  
  if (!Array.isArray(rows) || rows.length < 2) return null;

  const [columns, ...values] = rows;
  const position = values[0];
  if (!position) return null;

  return {
    x: Number(position[columns.indexOf("x")]),
    y: Number(position[columns.indexOf("y")]), 
    z: Number(position[columns.indexOf("z")])
  };
}

async function getBlockInventory(blockEntityId: `0x${string}`) {
  const query = `SELECT "slot", "objectType", "amount" FROM "${INVENTORY_SLOT_TABLE}" WHERE "owner" = '${blockEntityId}'`;
  
  const response = await fetch(INDEXER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ address: WORLD_ADDRESS, query }])
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const result = await response.json();
  const rows = result?.result?.[0];
  
  if (!Array.isArray(rows) || rows.length < 2) return [];

  const [columns, ...values] = rows;
  return values.map(row => ({
    slot: Number(row[columns.indexOf("slot")]),
    objectType: Number(row[columns.indexOf("objectType")]),
    amount: Number(row[columns.indexOf("amount")])
  }));
}

// Add debug function to see what's actually in InventorySlot
async function debugInventoryTable() {
  const query = `SELECT "owner", "slot", "entityId", "objectType", "amount" FROM "${INVENTORY_SLOT_TABLE}" LIMIT 20`;
  
  const response = await fetch(INDEXER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ address: WORLD_ADDRESS, query }])
  });

  const result = await response.json();
  console.log('DEBUG: InventorySlot table sample:', result?.result?.[0]);
  return result?.result?.[0];
}

export class LootCommand implements CommandHandler {
  async execute(context: CommandContext): Promise<void> {
    try {
      // Debug first to see what's in the table
      await debugInventoryTable();
      
      const playerEntityId = encodePlayerEntityId(context.address);
      
      const position = await getPlayerPosition(playerEntityId);
      if (!position) {
        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: "❌ Could not determine your position" 
        }));
        return;
      }

      const blockEntityId = encodeBlock([position.x, position.y, position.z]);
      
      console.log('Loot: Player position:', position);
      console.log('Loot: Block entity ID:', blockEntityId);

      const blockItems = await getBlockInventory(blockEntityId);
      console.log('Loot: Block items found:', blockItems);
      
      if (blockItems.length === 0) {
        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: "📦 No items to loot at this position" 
        }));
        return;
      }

      // Try loot function instead of transfer
      // Create Vec3 coordinate instead of block entity ID
      const data = encodeFunctionData({
        abi: IWorldAbi,
        functionName: 'pickupAll',
        args: [playerEntityId, packVec3([position.x, position.y, position.z])],
      });

      const txHash = await context.sessionClient.sendTransaction({
        to: WORLD_ADDRESS,
        data,
        gas: 300000n,
      });

      const itemList = blockItems.map(item => {
        const objectName = objectNamesById[item.objectType] || `Unknown(${item.objectType})`;
        return `${item.amount}x ${objectName}`;
      }).join(', ');

      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: `📦 Looted ${itemList}. Tx: ${txHash}` 
      }));

    } catch (error) {
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: `❌ Loot failed: ${String(error)}` 
      }));
    }
  }
}

