import { CommandHandler, CommandContext } from './types';

const INDEXER_URL = "https://indexer.mud.redstonechain.com/q";
const WORLD_ADDRESS = "0x253eb85B3C953bFE3827CC14a151262482E7189C";
const POSITION_TABLE = "EntityPosition";
const MAP_STORAGE_KEY = "dustytext-map-entries";

function encodePlayerEntityId(address: string): `0x${string}` {
  const prefix = "01";
  const clean = address.toLowerCase().replace(/^0x/, "");
  return `0x${prefix}${clean.padEnd(64 - prefix.length, "0")}` as `0x${string}`;
}

interface MapEntry {
  x: number;
  y: number;
  z: number;
  note: string;
  timestamp: number;
}

function getMapEntries(): MapEntry[] {
  try {
    const stored = localStorage.getItem(MAP_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveMapEntries(entries: MapEntry[]): void {
  try {
    localStorage.setItem(MAP_STORAGE_KEY, JSON.stringify(entries));
  } catch (error) {
    console.warn('Failed to save map entries:', error);
  }
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

function getDirectionFromCurrent(currentX: number, currentZ: number, targetX: number, targetZ: number): string {
  const dx = targetX - currentX;
  const dz = targetZ - currentZ;
  
  // Handle exact same position
  if (dx === 0 && dz === 0) return "HERE";
  
  // Determine direction based on dx and dz
  // Note: z- is north, z+ is south
  if (Math.abs(dx) > Math.abs(dz)) {
    // Primarily east/west
    if (dx > 0) {
      if (dz < 0) return "NE";  // east + north (negative z)
      if (dz > 0) return "SE";  // east + south (positive z)
      return "E";
    } else {
      if (dz < 0) return "NW";  // west + north (negative z)
      if (dz > 0) return "SW";  // west + south (positive z)
      return "W";
    }
  } else {
    // Primarily north/south
    if (dz < 0) {  // north (negative z)
      if (dx > 0) return "NE";
      if (dx < 0) return "NW";
      return "N";
    } else {  // south (positive z)
      if (dx > 0) return "SE";
      if (dx < 0) return "SW";
      return "S";
    }
  }
}

export class MapCommand implements CommandHandler {
  async execute(context: CommandContext, ...args: string[]): Promise<void> {
    try {
      const subCommand = args[0]?.toLowerCase();
      
      if (subCommand === 'clear') {
        localStorage.removeItem(MAP_STORAGE_KEY);
        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: "🗺️ Map entries cleared" 
        }));
        return;
      }

      if (args.length === 0) {
        // Get current position for direction calculation
        const playerEntityId = encodePlayerEntityId(context.address);
        const currentPosition = await getPlayerPosition(playerEntityId);
        
        // Display all map entries
        const entries = getMapEntries();
        if (entries.length === 0) {
          window.dispatchEvent(new CustomEvent("worker-log", { 
            detail: "🗺️ No map entries found. Use 'map <note>' to add entries." 
          }));
          return;
        }

        const lines = ["🗺️ Map Entries:"];
        entries.forEach((entry, index) => {
          const date = new Date(entry.timestamp).toLocaleTimeString();
          let directionText = "";
          
          if (currentPosition) {
            const direction = getDirectionFromCurrent(
              currentPosition.x, currentPosition.z, 
              entry.x, entry.z
            );
            directionText = ` *${direction}`;
          }
          
          lines.push(`  ${index + 1}. (${entry.x}, ${entry.y}, ${entry.z})${directionText} - ${entry.note} [${date}]`);
        });

        for (const line of lines) {
          window.dispatchEvent(new CustomEvent("worker-log", { 
            detail: line 
          }));
        }
        return;
      }

      // Add new map entry
      const note = args.join(' ');
      const playerEntityId = encodePlayerEntityId(context.address);
      const position = await getPlayerPosition(playerEntityId);
      
      if (!position) {
        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: "❌ Could not determine your position. Try 'spawn' first." 
        }));
        return;
      }

      const entries = getMapEntries();
      const newEntry: MapEntry = {
        x: position.x,
        y: position.y,
        z: position.z,
        note,
        timestamp: Date.now()
      };

      entries.push(newEntry);
      saveMapEntries(entries);

      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: `🗺️ Map entry added: (${position.x}, ${position.y}, ${position.z}) - ${note}` 
      }));

    } catch (error) {
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: `❌ Map command failed: ${error}` 
      }));
    }
  }
}




