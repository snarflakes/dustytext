import { CommandHandler, CommandContext } from './types';
import { objectNamesById } from '../../objects';

const INDEXER_URL = "https://indexer.mud.redstonechain.com/q";
const WORLD_ADDRESS = '0x253eb85B3C953bFE3827CC14a151262482E7189C';
const INVENTORY_SLOT_TABLE = "InventorySlot";

function encodePlayerEntityId(address: string): `0x${string}` {
  const prefix = "01";
  const clean = address.toLowerCase().replace(/^0x/, "");
  return `0x${prefix}${clean.padEnd(64 - prefix.length, "0")}` as `0x${string}`;
}

export class InventoryCommand implements CommandHandler {
  async execute(context: CommandContext): Promise<void> {
    try {
      const entityId = encodePlayerEntityId(context.address);
      
      const query = `SELECT "slot", "entityId", "objectType", "amount" FROM "${INVENTORY_SLOT_TABLE}" WHERE "owner" = '${entityId}'`;
      
      const response = await fetch(INDEXER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([{ address: WORLD_ADDRESS, query }])
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const result = await response.json();
      const rows = result?.result?.[0];
      
      if (!Array.isArray(rows) || rows.length < 2) {
        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: "📦 Inventory is empty" 
        }));
        return;
      }

      const [columns, ...values] = rows;
      const items = values.map(row => Object.fromEntries(columns.map((col: string, i: number) => [col, row[i]])));
      
      const itemList = items.map(item => {
        const objectType = Number(item.objectType);
        const objectName = objectNamesById[objectType] || `Unknown(${objectType})`;
        const amount = item.amount || 1;
        return `Slot ${item.slot}: ${amount}x ${objectName}`;
      }).join('\n  ');
      
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: `📦 You fiddle around with your large burlap sack and find:\n  ${itemList}` 
      }));
    } catch (error) {
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: `❌ Inventory check failed: ${error}` 
      }));
    }
  }
}

