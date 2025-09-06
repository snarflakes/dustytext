import { createPublicClient, http } from "viem";
import { redstone } from "viem/chains";

type Vec3 = [number, number, number];

const INDEXER_URL = "https://indexer.mud.redstonechain.com/q";
const WORLD_ADDRESS = "0x253eb85B3C953bFE3827CC14a151262482E7189C";
const SEED_GROWTH_TABLE = "SeedGrowth";

// Self-contained encodeBlock function (matching explore.ts)
const BYTES_32_BITS = 256n;
const ENTITY_TYPE_BITS = 8n;
const ENTITY_ID_BITS = BYTES_32_BITS - ENTITY_TYPE_BITS; // 248
const VEC3_BITS = 96n;
const ENTITY_TYPE_BLOCK = 0x03; // matches EntityTypes.Block

function toU32(n: number): bigint {
  return BigInt.asUintN(32, BigInt(n)); // two's complement pack for int32
}

function packVec3([x, y, z]: Vec3): bigint {
  const X = toU32(x), Y = toU32(y), Z = toU32(z);
  return (X << 64n) | (Y << 32n) | Z; // 96 bits
}

function encode(entityType: number, data: bigint): `0x${string}` {
  return `0x${((BigInt(entityType) << ENTITY_ID_BITS) | data).toString(16).padStart(64, '0')}` as `0x${string}`;
}

function encodeBlock(pos: Vec3): `0x${string}` {
  const packed = packVec3(pos);
  return encode(ENTITY_TYPE_BLOCK, packed << (ENTITY_ID_BITS - VEC3_BITS));
}

export async function isFullyGrown(
  seedPos: Vec3,
  latestTimestamp?: bigint
): Promise<boolean> {
  try {
    const entityId = encodeBlock(seedPos);
    console.log(`Checking growth for WheatSeed at ${seedPos} with entityId: ${entityId}`);
    
    // Get current timestamp if not provided
    if (!latestTimestamp) {
      const publicClient = createPublicClient({
        chain: redstone,
        transport: http(),
      });
      const block = await publicClient.getBlock({ blockTag: "latest" });
      latestTimestamp = block.timestamp;
    }

    console.log(`Current timestamp: ${latestTimestamp}`);

    // Query SeedGrowth table
    const query = `SELECT fullyGrownAt FROM "${SEED_GROWTH_TABLE}" WHERE entityId = '${entityId}'`;
    
    const response = await fetch(INDEXER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ address: WORLD_ADDRESS, query }])
    });

    if (!response.ok) {
      console.log('Growth check: HTTP request failed');
      return false; // Assume not grown if we can't check
    }

    const result = await response.json();
    console.log('Growth check result:', JSON.stringify(result, null, 2));
    
    const table = result?.result?.[0];
    
    if (!Array.isArray(table) || table.length < 2) {
      console.log('Growth check: No growth record found');
      return false; // No growth record means it's not grown yet
    }

    const [columns, values] = table;
    const row = Object.fromEntries(columns.map((key: string, i: number) => [key, values[i]]));
    
    const fullyGrownAtRaw = row.fullygrownat ?? row.fullyGrownAt ?? "0";
    const fullyGrownAt = BigInt(fullyGrownAtRaw);
    console.log(`fullyGrownAt: ${fullyGrownAt}, current: ${latestTimestamp}`);
    
    // If fullyGrownAt is 0, the seed hasn't started growing yet
    if (fullyGrownAt === 0n) {
      console.log('Growth check: fullyGrownAt is 0, not grown');
      return false;
    }
    
    // Seed is grown if current time >= fullyGrownAt
    const isGrown = latestTimestamp >= fullyGrownAt;
    console.log(`Growth check result: ${isGrown}`);
    return isGrown;
    
  } catch (error) {
    console.warn('Growth check failed:', error);
    return false; // Assume not grown on error
  }
}





