import { CommandHandler, CommandContext } from './types';

const INDEXER_URL = "https://indexer.mud.redstonechain.com/q";
const WORLD_ADDRESS = "0x253eb85B3C953bFE3827CC14a151262482E7189C";
const ENERGY_TABLE = "Energy";

const SPAWN_ENERGY = 245280000000000000n; // Energy at spawn

const encodePlayerEntityId = (address: string): `0x${string}` => {
  const prefix = "01";
  const cleanAddress = address.toLowerCase().replace(/^0x/, "");
  const padded = cleanAddress.padEnd(64 - prefix.length, "0");
  return `0x${prefix}${padded}` as `0x${string}`;
};

export class HealthCommand implements CommandHandler {
  async execute(context: CommandContext): Promise<void> {
    try {
      const entityId = encodePlayerEntityId(context.address);
      
      const query = `
        SELECT energy, drainRate, lastUpdatedTime
        FROM "${ENERGY_TABLE}"
        WHERE entityId = '${entityId}'
      `;

      const response = await fetch(INDEXER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([{ address: WORLD_ADDRESS, query }])
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

      const result = await response.json();
      const table = result?.result?.[0];
      
      if (!Array.isArray(table) || table.length < 2) {
        throw new Error("No energy record found for this entity.");
      }

      const columns = table[0];
      const values = table[1];
      const row = Object.fromEntries(columns.map((key: string, i: number) => [key, values[i]]));

      const energy = BigInt(row.energy ?? 0);
      const drainRate = BigInt(row.drainRate ?? 0);
      const lastUpdatedTime = BigInt(row.lastUpdatedTime ?? 0);

      // Calculate percentage of spawn energy (can exceed 100%)
      const percentage = Number((energy * 100n) / SPAWN_ENERGY);

      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: `❤️ Energy: ${energy.toString()} (${percentage.toFixed(1)}%), 💧 Drain Rate: ${drainRate.toString()}, ⏱️ Last Updated: ${lastUpdatedTime.toString()}` 
      }));
    } catch (error) {
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: `❌ Health check failed: ${error}` 
      }));
    }
  }
}






