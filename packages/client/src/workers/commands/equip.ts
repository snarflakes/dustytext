
import { CommandHandler, CommandContext } from './types';
import { OBJECT_TYPES } from '../../objectTypes';

const INDEXER_URL = "https://indexer.mud.redstonechain.com/q";
const WORLD_ADDRESS = '0x253eb85B3C953bFE3827CC14a151262482E7189C';
const INVENTORY_SLOT_TABLE = "InventorySlot";

// Remove the incomplete OBJECT_TYPES definition from here

function encodePlayerEntityId(address: string): `0x${string}` {
  const prefix = "01";
  const clean = address.toLowerCase().replace(/^0x/, "");
  return `0x${prefix}${clean.padEnd(64 - prefix.length, "0")}` as `0x${string}`;
}

function normalize(s: string) {
        return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}
function splitTokens(s: string) {
  // Split camelCase & separators so "WaterBucket" ~ "water bucket"
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
  .filter(Boolean);
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

      // --- Find matching tool (backwards-compatible, name-only) ---
      
      // 1) Try exact normalized match first
      const normQuery = normalize(toolName);
      let tool = inventory.find(i => normalize(i.objectType) === normQuery);

      // 2) If user typed multiple words (e.g., "water bucket"), require all tokens
      if (!tool) {
        const qTokens = splitTokens(toolName);
        if (qTokens.length > 1) {
          // Prefer items that contain all query tokens
          const allTokenMatch = inventory.find(i => {
            const t = splitTokens(i.objectType);
            return qTokens.every(tok => t.includes(tok));
          });
          if (allTokenMatch) tool = allTokenMatch;
        }
      }

      // 3) Special nudge: if query contains "water", prefer names with "water" over plain "bucket"
      if (!tool && /water/i.test(toolName)) {
        const watery = inventory.find(i => /water/i.test(i.objectType) && /bucket/i.test(i.objectType));
        if (watery) tool = watery;
      }

      // 4) Fallback to your original fuzzy includes (keeps legacy behavior)
      if (!tool) {
        tool = inventory.find(item =>
          item.objectType.toLowerCase().includes(toolName.toLowerCase()) ||
          toolName.toLowerCase().includes(item.objectType.toLowerCase())
        );
      }

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

// Add export function to get currently equipped tool
export function getEquippedTool(): EquippedTool | null {
  return (globalThis as typeof globalThis & { equippedTool: EquippedTool | null }).equippedTool || null;
}

// Add export function to check if a tool is equipped
export function isToolEquipped(): boolean {
  const tool = getEquippedTool();
  return tool !== null;
}

// Add export function to get equipped tool name/type
export function getEquippedToolName(): string | null {
  const tool = getEquippedTool();
  return tool ? tool.type : null;
}









