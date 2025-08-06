const log = (msg: string) => postMessage({ type: "log", message: `[log] ${msg}` });

const INDEXER_URL = "https://indexer.mud.redstonechain.com/q";
const WORLD_ADDRESS = "0x253eb85B3C953bFE3827CC14a151262482E7189C";
const ENERGY_TABLE = "Energy";

let playerAddress: `0x${string}` = "0x0000000000000000000000000000000000000000";

const encodePlayerEntityId = (address: string): `0x${string}` => {
  log("Encoding player entity ID...");
  const prefix = "01";
  const cleanAddress = address.toLowerCase().replace(/^0x/, "");
  const padded = cleanAddress.padEnd(64 - prefix.length, "0");
  const result = `0x${prefix}${padded}` as `0x${string}`;
  log(`Encoded Entity ID: ${result}`);
  return result;
};

async function getPlayerEnergyFromIndexer() {
  log("Starting getPlayerEnergyFromIndexer()...");

  const entityId = encodePlayerEntityId(playerAddress);
  log(`🧠 Player Address: ${playerAddress}`);
  log(`🧱 EntityId: ${entityId}`);

  const query = `
    SELECT energy, drainRate, lastUpdatedTime
    FROM "${ENERGY_TABLE}"
    WHERE entityId = '${entityId}'
  `;

  try {
    log(`Query:\n${query}`);

    const response = await fetch(INDEXER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([
        {
          address: WORLD_ADDRESS,
          query
        }
      ])
    });

    log(`Fetch response: ${response.status} ${response.statusText}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

    const result = await response.json();
    log(`Parsed response: ${JSON.stringify(result)}`);

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

    log(`❤️ Energy: ${energy.toString()}`);
    log(`💧 Drain Rate: ${drainRate.toString()}`);
    log(`⏱️ Last Updated: ${lastUpdatedTime.toString()} (Unix)`);

    postMessage({ type: "done", message: "Player health fetched.", status: "success" });
  } catch (err) {
    const message = (err as Error).message;
    log(`❌ Error: ${message}`);
    postMessage({ type: "done", message: `Energy fetch failed: ${message}`, status: "error" });
  }
}

self.onmessage = (event) => {
  log("Received init message.");
  if (event.data?.type === "init" && event.data.address) {
    playerAddress = event.data.address as `0x${string}`;
    log(`Set playerAddress: ${playerAddress}`);
    getPlayerEnergyFromIndexer();
  }
};