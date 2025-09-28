import { CommandHandler, CommandContext } from "./types";
import { sessionPlayerCache } from "../sessionPlayerCache";

const INDEXER_URL = "https://indexer.mud.redstonechain.com/q";
const WORLD_ADDRESS = "0x253eb85B3C953bFE3827CC14a151262482E7189C";
const POSITION_TABLE = "EntityPosition";
const ENERGY_TABLE = "Energy";

function encodePlayerEntityId(address: string): `0x${string}` {
  const prefix = "01";
  const clean = address.toLowerCase().replace(/^0x/, "");
  return `0x${prefix}${clean.padEnd(64 - prefix.length, "0")}` as `0x${string}`;
}

function decodePlayerEntityId(entityId: string): string {
  // Remove 0x prefix and the 01 prefix, then add 0x back
  const withoutPrefix = entityId.slice(4); // Remove "0x01"
  const paddedAddress = withoutPrefix.slice(0, 40); // Take first 40 chars (20 bytes)
  return `0x${paddedAddress}`;
}

// Add retry logic for flaky 500s
async function queryWithRetry(query: string, tag: string, tries = 2) {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const response = await fetch(INDEXER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([{ address: WORLD_ADDRESS, query }]),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      return await response.json();
    } catch (e: unknown) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      if (!/HTTP 500|No space left on device/i.test(msg)) break;
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  throw lastErr;
}

export class ScanCommand implements CommandHandler {
  name = "scan";
  description = "Scan for nearby players and cache results for explore command";

  async execute(context: CommandContext, ...args: string[]): Promise<void> {
    try {
      const radius = args[0] ? parseInt(args[0]) : 30;
      
      // Get player position
      const entityId = encodePlayerEntityId(context.address);
      const posQuery = `SELECT "x","y","z" FROM "${POSITION_TABLE}" WHERE "entityId"='${entityId}'`;
      const posJson = await queryWithRetry(posQuery, "position");
      
      const posRows = posJson?.result?.[0];
      if (!Array.isArray(posRows) || posRows.length < 2) {
        throw new Error("No position found. Try 'spawn' first.");
      }
      
      const [posCols, posVals] = posRows;
      const pos = Object.fromEntries(posCols.map((k: string, i: number) => [k, posVals[i]]));
      const { x, y, z } = { x: Number(pos.x ?? 0), y: Number(pos.y ?? 0), z: Number(pos.z ?? 0) };
      
      window.dispatchEvent(new CustomEvent("worker-log", {
        detail: `🔍 Scanning ${radius} blocks around (${x}, ${y}, ${z})...`
      }));
      
      // Step 1: Test with the same pattern as health.ts
      const testQuery = `SELECT energy, drainRate, lastUpdatedTime FROM "${ENERGY_TABLE}" WHERE entityId = '${entityId}'`;
      const testJson = await queryWithRetry(testQuery, "test");
      console.log('Test query result:', testJson);
      
      // Step 2: Try the exact pattern from look.ts
      const positionQuery = `SELECT x, y, z FROM "${POSITION_TABLE}" WHERE entityId = '${entityId}'`;
      const positionJson = await queryWithRetry(positionQuery, "positions");
      console.log('Position query result:', positionJson);
      
      // If that works, try getting other players with a simpler query
      const otherPlayersQuery = `SELECT entityId, x, y, z FROM "${POSITION_TABLE}" LIMIT 10`;
      const otherPlayersJson = await queryWithRetry(otherPlayersQuery, "otherPlayers");
      console.log('Other players result:', otherPlayersJson);
      
      const positionRows = otherPlayersJson?.result?.[0];
      if (!Array.isArray(positionRows) || positionRows.length < 2) {
        sessionPlayerCache.addScanResults(x, y, z, radius, []);
        window.dispatchEvent(new CustomEvent("worker-log", {
          detail: `🔍 No players found in position table. Results cached for explore command.`
        }));
        return;
      }
      
      const [positionCols, ...positionPlayerRows] = positionRows;
      const players = [];
      
      // Step 2: For each entity, check if it's a player and in range
      for (const row of positionPlayerRows) {
        const positionData = Object.fromEntries(positionCols.map((k: string, i: number) => [k, row[i]]));
        const entityId = positionData.entityid as string; // Note: lowercase 'entityid'
        
        // Skip non-player entities (players start with 0x01)
        if (!entityId.startsWith('0x01')) continue;
        if (entityId === encodePlayerEntityId(context.address)) continue; // Skip self
        
        const px = Number(positionData.x);
        const py = Number(positionData.y);
        const pz = Number(positionData.z);
        
        // Check if in range
        if (px >= x - radius && px <= x + radius &&
            py >= y - radius && py <= y + radius &&
            pz >= z - radius && pz <= z + radius) {
          
          // Get energy for this player
          try {
            const energyQuery = `SELECT energy FROM "${ENERGY_TABLE}" WHERE entityId = '${entityId}'`;
            const energyJson = await queryWithRetry(energyQuery, "energy");
            const energyRows = energyJson?.result?.[0];
            
            let energy = 0;
            if (Array.isArray(energyRows) && energyRows.length >= 2) {
              const [energyCols, energyVals] = energyRows;
              const energyData = Object.fromEntries(energyCols.map((k: string, i: number) => [k, energyVals[i]]));
              energy = Number(energyData.energy || 0);
            }
            
            const isAlive = energy > 0;
            const eoaAddress = decodePlayerEntityId(entityId);
            
            players.push({
              entityId,
              eoaAddress,
              x: px, y: py, z: pz,
              energy,
              isAlive,
              scannedAt: Date.now()
            });
          } catch (e) {
            console.log(`Failed to get energy for ${entityId}:`, e);
          }
        }
      }
      
      // Cache the results
      sessionPlayerCache.addScanResults(x, y, z, radius, players);
      
      // Display results
      const sortedPlayers = players.sort((a, b) => {
        const distA = Math.sqrt((a.x - x) ** 2 + (a.y - y) ** 2 + (a.z - z) ** 2);
        const distB = Math.sqrt((b.x - x) ** 2 + (b.y - y) ** 2 + (b.z - z) ** 2);
        return distA - distB;
      });
      
      const aliveCount = players.filter(p => p.isAlive).length;
      const deadCount = players.length - aliveCount;
      
      const report = sortedPlayers.map(p => {
        const distance = Math.sqrt((p.x - x) ** 2 + (p.y - y) ** 2 + (p.z - z) ** 2);
        const status = p.isAlive ? `💚 Alive (${p.energy} energy)` : "💀 Dead";
        const coords = `(${p.x}, ${p.y}, ${p.z})`;
        
        return `  ${p.eoaAddress} at ${coords} - ${distance.toFixed(1)} blocks - ${status}`;
      }).join('\n');
      
      const summary = `🔍 Scan Complete (${radius} block radius)
📊 Found: ${aliveCount} alive, ${deadCount} dead players
📍 Scan center: (${x}, ${y}, ${z})
⏰ Results cached for this session - use 'scan' to refresh

${aliveCount + deadCount > 0 ? 'Nearby Players:' : 'No players detected in scan area.'}
${report}

💡 Player indicators now visible in 'explore' command within scanned area.`;

      window.dispatchEvent(new CustomEvent("worker-log", {
        detail: summary
      }));
      
    } catch (error) {
      window.dispatchEvent(new CustomEvent("worker-log", {
        detail: `❌ Scan failed: ${error}`
      }));
    }
  }
}

















