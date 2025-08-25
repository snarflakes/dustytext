import { CommandHandler, CommandContext } from './types';

const INDEXER_URL = "https://indexer.mud.redstonechain.com/q";
const WORLD_ADDRESS = '0x253eb85B3C953bFE3827CC14a151262482E7189C';
const INVENTORY_SLOT_TABLE = "InventorySlot";

// Import OBJECT_TYPES from the correct location
const OBJECT_TYPES: Record<number, string> = {
  21: "Grass",
  22: "Dirt",
  51: "BirchLog",
  56: "DarkOakLog", 
  58: "OakLeaf",
  83: "SwitchGrass",
  84: "VinesBush",
  86: "HempBush",
  127: "DarkOakPlanks",
  134: "WheatSeed",
  32774: "WoodenAxe",
  32775: "CopperAxe",
  32776: "IronAxe",
  32777: "GoldAxe",
  32778: "DiamondAxe",
  32779: "NeptuniumAxe",
  32768: "WoodenPick",
  32769: "CopperPick",
  32770: "IronPick",
  32771: "GoldPick",
  32772: "DiamondPick",
  32773: "NeptuniumPick",
  32783: "WoodenHoe",
  32788: "Bucket",
  32789: "WaterBucket",

  // Add more as needed
};

function encodePlayerEntityId(address: string): `0x${string}` {
  const prefix = "01";
  const clean = address.toLowerCase().replace(/^0x/, "");
  return `0x${prefix}${clean.padEnd(64 - prefix.length, "0")}` as `0x${string}`;
}

async function getPlayerInventory(entityId: `0x${string}`) {
  const query = `SELECT "slot", "entityId", "objectType", "amount" FROM "${INVENTORY_SLOT_TABLE}" WHERE "owner" = '${entityId}'`;
  
  const response = await fetch(INDEXER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ address: WORLD_ADDRESS, query }])
  });

  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const result = await response.json();
  return result?.result?.[0] || [];
}

interface EquippedTool {
  slot: number;
  type: string;
  name: string;
}

declare global {
  interface Window {
    equippedTool: EquippedTool | null;
  }
  // eslint-disable-next-line no-var
  var equippedTool: EquippedTool | null;
}

// Add this line to make the global available
(globalThis as typeof globalThis & { equippedTool: EquippedTool | null }).equippedTool = 
  (globalThis as typeof globalThis & { equippedTool: EquippedTool | null }).equippedTool || null;

export class EquipCommand implements CommandHandler {
  async execute(context: CommandContext, ...args: string[]): Promise<void> {
    try {
      const toolName = args.join(' ').trim();
      if (!toolName) {
        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: "❓ Usage: equip <tool name> (e.g., 'equip wooden axe')" 
        }));
        return;
      }

      const entityId = encodePlayerEntityId(context.address);
      const inventoryRows = await getPlayerInventory(entityId);
      
      if (!Array.isArray(inventoryRows) || inventoryRows.length < 2) {
        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: "❌ Inventory is empty or unavailable" 
        }));
        return;
      }

      // Parse inventory
      const inventory = inventoryRows.slice(1).map((row: unknown[]) => ({
        slot: parseInt(row[0] as string),
        objectType: OBJECT_TYPES[parseInt(row[2] as string)] || `Unknown(${row[2]})`,
        objectTypeId: parseInt(row[2] as string),
        amount: parseInt(row[3] as string)
      }));

      console.log('Inventory items:', inventory);
      console.log('Looking for tool:', toolName);

      // Find matching tool
      const tool = inventory.find(item => 
        item.objectType.toLowerCase().includes(toolName.toLowerCase()) ||
        toolName.toLowerCase().includes(item.objectType.toLowerCase())
      );

      if (!tool) {
        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: `❌ Tool "${toolName}" not found in inventory. Available items: ${inventory.map(i => `${i.objectType}(${i.objectTypeId})`).join(', ')}` 
        }));
        return;
      }

      // Store equipped tool info globally
      (globalThis as typeof globalThis & { equippedTool: EquippedTool | null }).equippedTool = {
        slot: tool.slot,
        type: tool.objectType,
        name: toolName
      };

      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: `⚒️ Equipped ${tool.objectType} from slot ${tool.slot}` 
      }));

    } catch (error) {
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: `❌ Equip failed: ${error}` 
      }));
    }
  }
}








