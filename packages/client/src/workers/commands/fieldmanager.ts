import { encodeFunctionData } from "viem";
import { CommandHandler, CommandContext } from "./types";
import { getForceFieldInfoForPlayer, getForceFieldInfo, ForceFieldInfo } from "./sense";
import IWorldAbi from "@dust/world/out/IWorld.sol/IWorld.abi";
import { queryIndexer } from "./queryIndexer";

/* ---------------------- World / Indexer ---------------------- */
const WORLD_ADDRESS  = "0x253eb85B3C953bFE3827CC14a151262482E7189C";
const INDEXER_URL    = "https://indexer.mud.redstonechain.com/q";
const POSITION_TABLE = "EntityPosition";
const ZERO_ENTITY_ID = "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;

/* ---------------------- Types / helpers ---------------------- */
type Hex32 = `0x${string}`;
type Vec3  = [number, number, number];

function encodePlayerEntityId(address: string): Hex32 {
  const prefix = "01";
  const clean  = address.toLowerCase().replace(/^0x/, "");
  return `0x${prefix}${clean.padEnd(64 - prefix.length, "0")}` as Hex32;
}

function asNumber(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

async function sqlOne<T = Record<string, unknown>>(query: string): Promise<T | null> {
  const res = await fetch(INDEXER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ address: WORLD_ADDRESS, query }]),
  });
  if (!res.ok) return null;

  const json = (await res.json()) as { result?: [[string[], (string | number | null)[]]] };
  const rows = json.result?.[0];
  if (!Array.isArray(rows) || rows.length < 2) return null;

  const [cols, vals] = rows;
  return Object.fromEntries(cols.map((k, i) => [k, vals[i]])) as T;
}

async function fetchPlayerBlock(address: string): Promise<Vec3 | null> {
  const pid = encodePlayerEntityId(address);
  const q   = `SELECT "x","y","z" FROM "${POSITION_TABLE}" WHERE "entityId"='${pid}'`;
  const row = await sqlOne<{ x: number | string | null; y: number | string | null; z: number | string | null }>(q);
  if (!row) return null;
  const x = Math.floor(asNumber(row.x) ?? 0);
  const y = Math.floor(asNumber(row.y) ?? 0);
  const z = Math.floor(asNumber(row.z) ?? 0);
  return [x, y, z];
}

/* ---------------------- Block entityId encoder ---------------------- */
const BYTES_32_BITS = 256n;
const TYPE_BITS     = 8n;
const ID_BITS       = BYTES_32_BITS - TYPE_BITS; // 248
const VEC3_BITS     = 96n;
const ENTITY_TYPE_BLOCK = 0x03;

function toU32(n: number): bigint {
  return BigInt.asUintN(32, BigInt(n));
}
function packVec3([x, y, z]: Vec3): bigint {
  return (toU32(x) << 64n) | (toU32(y) << 32n) | toU32(z);
}
function encode(type: number, data: bigint): Hex32 {
  const v   = (BigInt(type) << ID_BITS) | data;
  const hex = v.toString(16).padStart(64, "0");
  return (`0x${hex}`) as Hex32;
}
function encodeCoord(type: number, coord: Vec3): Hex32 {
  return encode(type, packVec3(coord) << (ID_BITS - VEC3_BITS));
}
function encodeBlock(pos: Vec3): Hex32 {
  return encodeCoord(ENTITY_TYPE_BLOCK, pos);
}

/* ---------------------- Ownership Checking ---------------------- */
async function checkOwnership(address: string): Promise<string[]> {
  const results: string[] = [];
  
  try {
    // Use the correct table name with namespace prefix
    const ownerBytes32 = encodePlayerEntityId(address);
    const ownershipQuery = `SELECT "groupId" FROM "dfprograms_1__AccessGroupOwner" WHERE "owner"='${ownerBytes32}'`;
    const ownershipRows = await queryIndexer(ownershipQuery, "ownership");
    
    if (ownershipRows && ownershipRows.length > 1) { // Skip header row
      const groups = ownershipRows.slice(1).map(row => row[0] as string); // Skip first row (headers)
      results.push(`  Groups Owned: ${groups.length} groups`);
      
      // For each group, get the entity details
      for (const groupId of groups) {
        results.push(`    Group: ${groupId}`);
        
        // Get members with access to this group
        const memberQuery = `SELECT "member", "hasAccess" FROM "dfprograms_1__AccessGroupMembe" WHERE "groupId"='${groupId}' AND "hasAccess"=true`;
        const memberRows = await queryIndexer(memberQuery, "members");
        
        if (memberRows && memberRows.length > 1) {
          const members = memberRows.slice(1).map(row => row[0] as string);
          if (members.length > 0 && members[0]) {
            results.push(`      Members with access: ${members.length}`);
            for (const member of members) {
              results.push(`        ${member}`);
            }
          } else {
            results.push(`      No members with access found`);
          }
        } else {
          results.push(`      No members with access found`);
        }
        
        // Get entities in this group - using correct table name with namespace
        const entityQuery = `SELECT "entityId" FROM "dfprograms_1__EntityAccessGrou" WHERE "groupId"='${groupId}'`;
        const entityRows = await queryIndexer(entityQuery, "entities");
        
        if (entityRows && entityRows.length > 1) { // Skip header row
          const entities = entityRows.slice(1).map(row => row[0] as string); // Skip first row (headers)
          
          for (const entityId of entities) {
            try {
              const coords = decodeBlockCoordinates(entityId as Hex32);
              
              // Check if this entity has energy
              const energyQuery = `SELECT "energy" FROM "Energy" WHERE "entityId"='${entityId}'`;
              const energyRows = await queryIndexer(energyQuery, "energy");
              
              let energyStatus = "❓ Unknown";
              if (energyRows && energyRows.length > 1) {
                const energy = Number(energyRows[1][0]); // Skip header, get first data row
                energyStatus = energy > 0 ? `⚡ ${energy} energy` : "💀 No energy";
              }
              
              results.push(`      Entity: ${entityId} at (${coords[0]}, ${coords[1]}, ${coords[2]}) - ${energyStatus}`);
            } catch (e) {
              results.push(`      Entity: ${entityId} (coordinate decode failed)`);
            }
          }
        } else {
          results.push(`      No entities found in group`);
        }
      }
    } else {
      results.push(`  Groups Owned: 0 groups (no forcefields owned)`);
    }
  } catch (error) {
    results.push(`  Groups Owned: Query failed - ${error}`);
    results.push(`  This likely means you don't own any forcefields yet`);
  }
  
  return results;
}

// Helper function to decode block coordinates from entityId
function decodeBlockCoordinates(entityId: Hex32): Vec3 {
  const bigIntValue = BigInt(entityId);
  const entityType = Number(bigIntValue >> ID_BITS);
  
  if (entityType !== ENTITY_TYPE_BLOCK) {
    throw new Error(`Not a block entity (type: ${entityType})`);
  }
  
  const data = bigIntValue & ((1n << ID_BITS) - 1n);
  const coordData = data >> (ID_BITS - VEC3_BITS);
  
  const x = Number((coordData >> 64n) & 0xFFFFFFFFn);
  const y = Number((coordData >> 32n) & 0xFFFFFFFFn);
  const z = Number(coordData & 0xFFFFFFFFn);
  
  // Convert from unsigned to signed 32-bit
  const toSigned32 = (n: number) => n > 0x7FFFFFFF ? n - 0x100000000 : n;
  
  return [toSigned32(x), toSigned32(y), toSigned32(z)];
}

export async function showOwnershipInfo(EOAaddress?: string): Promise<void> {
  // Get session client and address directly
  const sessionClient = window.__entryKitSessionClient;
  if (!sessionClient?.sendTransaction) {
    window.dispatchEvent(new CustomEvent<string>("worker-log", {
      detail: `❌ Session client not available`,
    }));
    return;
  }

  // Get session address
  const sessionAddress = typeof sessionClient.account === 'string' 
    ? sessionClient.account 
    : (sessionClient.account as any)?.address || sessionClient.account;

  window.dispatchEvent(new CustomEvent<string>("worker-log", {
    detail: `🔍 Forcefield Ownership Info: <a href="https://explorer.mud.dev/redstone/worlds/0x253eb85B3C953bFE3827CC14a151262482E7189C/interact?expanded=dfprograms_1%2C0x7379646670726f6772616d735f31000044656661756c7450726f6772616d5379#0x7379646670726f6772616d735f31000044656661756c7450726f6772616d5379-0x8ff8e1a737b51f40f0ae94887be459cc8f46449901826a6fe0516fe6bd14fead" target="_blank" rel="noopener noreferrer" style="text-decoration: underline; font-weight: bold; font-style: italic;"><b><i><u>Update Here</u></i></b></a>`,
  }));
  
  // Check session address
  window.dispatchEvent(new CustomEvent<string>("worker-log", {
    detail: `Session Address: ${sessionAddress} (${encodePlayerEntityId(sessionAddress)})`,
  }));
  
  const sessionResults = await checkOwnership(sessionAddress);
  sessionResults.forEach(line => {
    window.dispatchEvent(new CustomEvent<string>("worker-log", { detail: line }));
  });
  
  // Check EOA address if provided
  if (EOAaddress) {
    window.dispatchEvent(new CustomEvent<string>("worker-log", {
      detail: `EOA Address: ${EOAaddress}`,
    }));
    
    const eoaResults = await checkOwnership(EOAaddress);
    eoaResults.forEach(line => {
      window.dispatchEvent(new CustomEvent<string>("worker-log", { detail: line }));
    });
  }
}

/* ---------------------- Command ---------------------- */
export class ClaimFieldCommand implements CommandHandler {
  async execute(context: CommandContext, ...args: string[]): Promise<void> {
    // If no args, check current location first
    if (args.length === 0) {
      try {
        // Check if player is in a force field or on a machine block
        const ff = await getForceFieldInfoForPlayer(context.address);
        
        if (ff.forceField === ZERO_ENTITY_ID) {
          // No force field found, check if standing on a machine block
          const pos = await fetchPlayerBlock(context.address);
          if (!pos) {
            window.dispatchEvent(new CustomEvent<string>("worker-log", {
              detail: `❌ You float amongst the stars. Try 'spawn' first.`,
            }));
            return;
          }
          
          const blockBeneath: Vec3 = [pos[0], pos[1] - 1, pos[2]];
          const machine = encodeBlock(blockBeneath);
          
          // Check if this block has an access group (is a machine)
          const entityQuery = `SELECT "groupId" FROM "EntityAccessGrou" WHERE "entityId"='${machine}'`;
          const entityRes = await fetch(INDEXER_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify([{ address: WORLD_ADDRESS, query: entityQuery }]),
          });
          
          const entityJson = await entityRes.json();
          const entityRows = entityJson?.result?.[0];
          
          if (!Array.isArray(entityRows) || entityRows.length < 2) {
            window.dispatchEvent(new CustomEvent<string>("worker-log", {
              detail: `❌ Your session address doesn't don't own a forcefield, you aren't standing in a forcefield, and you are not standing on a machine block. No changes made.`,
            }));
            return;
          }
        }
        
        // If we get here, there's either a force field or a machine block to claim
        // Continue with the claiming logic...
      } catch (error) {
        window.dispatchEvent(new CustomEvent<string>("worker-log", {
          detail: `❌ Error checking location: ${error}. No changes made.`,
        }));
        return;
      }
    }
    
    try {
      // Parse coordinates if provided: "claimfield x y z"
      let targetPos: Vec3 | null = null;
      
      if (args.length > 0) {
        const coords = args.map(Number);
        if (coords.length === 3 && coords.every((n: number) => !isNaN(n))) {
          targetPos = [coords[0], coords[1], coords[2]];
        }
      }

      let ff: ForceFieldInfo;
      if (targetPos) {
        ff = await getForceFieldInfo(targetPos);
      } else {
        ff = await getForceFieldInfoForPlayer(context.address);
      }

      let machine: `0x${string}`;
      let coordsForLog: Vec3 | null = null;

      if (ff.forceField !== ZERO_ENTITY_ID) {
        // Use the existing machine entity
        machine = ff.forceField;
      } else {
        // No force field detected yet — fall back to block beneath the player
        const pos = await fetchPlayerBlock(context.address);
        if (!pos) throw new Error("No position found — try 'spawn' first.");
        coordsForLog = [pos[0], pos[1] - 1, pos[2]];
        machine = encodeBlock(coordsForLog);
      }

      // Get the session address that's actually making transactions
      const sessionAddress = typeof context.sessionClient.account === 'string' 
        ? context.sessionClient.account 
        : context.sessionClient.account.address;
      
      // First, get the groupId for this machine entity
      const entityQuery = `SELECT "groupId" FROM "EntityAccessGrou" WHERE "entityId"='${machine}'`;
      const entityRes = await fetch(INDEXER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([{ address: WORLD_ADDRESS, query: entityQuery }]),
      });
      
      if (!entityRes.ok) {
        throw new Error("Failed to query entity access group");
      }
      
      const entityJson = await entityRes.json();
      const entityRows = entityJson?.result?.[0];
      if (!Array.isArray(entityRows) || entityRows.length < 2) {
        throw new Error("No access group found for this entity");
      }
      
      const [, ...entityValues] = entityRows;
      const groupId = entityValues[0] as string;

      // DefaultProgramSy system ID in dfprograms_1 namespace
      const DEFAULT_PROGRAM_SYSTEM_ID = "0x737964666070726f6772616d73000000044656661756c7450726f6772616d5379" as const;

      // Step 1: Add session address as member
      const setMembershipCallData = encodeFunctionData({
        abi: [{
          type: "function",
          name: "setMembership",
          inputs: [
            { name: "groupId", type: "bytes32" },
            { name: "member", type: "address" },
            { name: "isMember", type: "bool" }
          ],
          outputs: [],
          stateMutability: "nonpayable"
        }],
        functionName: "setMembership",
        args: [groupId as `0x${string}`, sessionAddress, true],
      });

      const dataSession = encodeFunctionData({
        abi: IWorldAbi,
        functionName: "call",
        args: [DEFAULT_PROGRAM_SYSTEM_ID, setMembershipCallData],
      });

      const sessionTx = await context.sessionClient.sendTransaction({
        to: WORLD_ADDRESS,
        data: dataSession,
        gas: 300_000n,
      }) as `0x${string}`;

      // Step 2: Add EOA address as member
      const setMembershipCallDataEOA = encodeFunctionData({
        abi: [{
          type: "function",
          name: "setMembership",
          inputs: [
            { name: "groupId", type: "bytes32" },
            { name: "member", type: "address" },
            { name: "isMember", type: "bool" }
          ],
          outputs: [],
          stateMutability: "nonpayable"
        }],
        functionName: "setMembership",
        args: [groupId as `0x${string}`, context.address as `0x${string}`, true],
      });

      const dataEOA = encodeFunctionData({
        abi: IWorldAbi,
        functionName: "call",
        args: [DEFAULT_PROGRAM_SYSTEM_ID, setMembershipCallDataEOA],
      });

      const eoaTx = await context.sessionClient.sendTransaction({
        to: WORLD_ADDRESS,
        data: dataEOA,
        gas: 300_000n,
      }) as `0x${string}`;

      const targetTxt = coordsForLog
        ? `machine at (${coordsForLog[0]}, ${coordsForLog[1]}, ${coordsForLog[2]})`
        : `force field station ${machine}`;

      window.dispatchEvent(new CustomEvent<string>("worker-log", {
        detail: `🤝 Added session address as member to ${targetTxt} (group ${groupId}). Tx: ${sessionTx}`,
      }));

      window.dispatchEvent(new CustomEvent<string>("worker-log", {
        detail: `👑 Added EOA address as member to ${targetTxt} (group ${groupId}). Tx: ${eoaTx}`,
      }));

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      if (msg.includes("gas") || msg.includes("0x34a44dbe")) {
        window.dispatchEvent(new CustomEvent("worker-log", {
          detail: "⛽ Gas issue: click the orange square (top-right) and Top Up gas."
        }));
        return;
      }
      if (msg.includes("no energy") || msg.includes("has no energy")) {
        window.dispatchEvent(new CustomEvent("worker-log", { detail: "💀 You are dead. Use 'spawn'." }));
        return;
      }
      if (msg.includes("Target is not a smart entity")) {
        window.dispatchEvent(new CustomEvent("worker-log", {
          detail: "❌ The block beneath you isn't a smart entity. Stand on your force-field station."
        }));
        return;
      }
      window.dispatchEvent(new CustomEvent("worker-log", { detail: `❌ claimfield failed: ${msg}` }));
    }
  }
}
