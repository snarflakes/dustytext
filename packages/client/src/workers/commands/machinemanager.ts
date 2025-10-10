import { encodeFunctionData } from "viem";
import { CommandHandler, CommandContext } from "./types";
import { getForceFieldInfoForPlayer } from "./sense";
import IWorldAbi from "@dust/world/out/IWorld.sol/IWorld.abi";
import { queryIndexer } from "./queryIndexer";
import { resourceToHex } from "@latticexyz/common";

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
export class ClaimMachineCommand implements CommandHandler {
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
          const entityQuery = `SELECT "groupId" FROM "dfprograms_1__EntityAccessGrou" WHERE "entityId"='${machine}'`;

          console.log(`[claimmachine-check] Querying for machine access group: ${entityQuery}`);

          const entityRes = await fetch(INDEXER_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify([{ address: WORLD_ADDRESS, query: entityQuery }]),
          });

          let hasAccessGroup = false;
          console.log(`[claimmachine-check] HTTP response status: ${entityRes.status}`);

          if (entityRes.ok) {
            const entityJson = await entityRes.json();
            console.log(`[claimmachine-check] Response JSON:`, entityJson);
            const entityRows = entityJson?.result?.[0];
            hasAccessGroup = Array.isArray(entityRows) && entityRows.length >= 2;
            console.log(`[claimmachine-check] Has access group: ${hasAccessGroup}`);
          } else {
            const errorText = await entityRes.text();
            console.log(`[claimmachine-check] HTTP error: ${entityRes.status} - ${errorText}`);
          }

          if (!hasAccessGroup) {
            window.dispatchEvent(new CustomEvent<string>("worker-log", {
              detail: `❌ You aren't standing on a machine block with access control. No changes made.`,
            }));
            return;
          }
        }
        
        // If we get here, there's a machine block to claim
        // Continue with the claiming logic...
      } catch (error) {
        window.dispatchEvent(new CustomEvent<string>("worker-log", {
          detail: `❌ Error checking location: ${error}. No changes made.`,
        }));
        return;
      }
    }
    
    try {
      // Parse coordinates if provided: "claimmachine x y z"
      let targetPos: Vec3 | null = null;

      if (args.length > 0) {
        const coords = args.map(Number);
        if (coords.length === 3 && coords.every((n: number) => !isNaN(n))) {
          targetPos = [coords[0], coords[1], coords[2]];
        }
      }

      let machine: `0x${string}`;
      let coordsForLog: Vec3 | null = null;

      if (targetPos) {
        // Coordinates provided - always treat as spawntile/machine block coordinates
        // (even if there's a force field covering the area, we want the spawntile at those coordinates)
        console.log(`[claimmachine] Working directly with spawntile at provided coordinates: ${targetPos}`);
        coordsForLog = targetPos;
        machine = encodeBlock(coordsForLog);
        console.log(`[claimmachine] Using provided coordinates for spawntile: ${machine} at (${coordsForLog[0]}, ${coordsForLog[1]}, ${coordsForLog[2]})`);
      } else {
        // No coordinates provided - check current location for force field or machine block
        console.log(`[claimmachine] Getting force field info for player: ${context.address}`);
        const ff = await getForceFieldInfoForPlayer(context.address);

        console.log(`[claimmachine] Force field info:`, {
          active: ff.active,
          forceField: ff.forceField,
          fragmentId: ff.fragmentId,
          owner: ff.owner,
          reason: ff.reason
        });

        if (ff.forceField !== ZERO_ENTITY_ID) {
          // Use the existing machine entity
          machine = ff.forceField;
          console.log(`[claimmachine] Using existing force field entity: ${machine}`);
        } else {
          // Fall back to block beneath the player
          const pos = await fetchPlayerBlock(context.address);
          if (!pos) throw new Error("No position found — try 'spawn' first.");
          coordsForLog = [pos[0], pos[1] - 1, pos[2]];
          machine = encodeBlock(coordsForLog);
          console.log(`[claimmachine] Using encoded block entity: ${machine} at (${coordsForLog[0]}, ${coordsForLog[1]}, ${coordsForLog[2]})`);
        }
      }

      // Get the session address that's actually making transactions
      const sessionAddress = typeof context.sessionClient.account === 'string'
        ? context.sessionClient.account
        : context.sessionClient.account.address;

      // Get the EOA address
      const eoaAddress = (context.sessionClient as any).userAddress || context.address;

      // DefaultProgramSy system ID in dfprograms_1 namespace
      const DEFAULT_PROGRAM_SYSTEM_ID = resourceToHex({
        type: "system",
        namespace: "dfprograms_1",
        name: "DefaultProgramSy",
      }) as `0x${string}`;

      console.log(`[claimmachine] Generated system ID: ${DEFAULT_PROGRAM_SYSTEM_ID} (length: ${DEFAULT_PROGRAM_SYSTEM_ID.length})`);

      // First, try to get the groupId for this machine entity
      const entityQuery = `SELECT "groupId" FROM "dfprograms_1__EntityAccessGrou" WHERE "entityId"='${machine}'`;

      console.log(`[claimmachine] Querying for access group: ${entityQuery}`);

      const entityRes = await fetch(INDEXER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([{ address: WORLD_ADDRESS, query: entityQuery }]),
      });

      let groupId: string | null = null;

      console.log(`[claimmachine] HTTP response status: ${entityRes.status}`);

      if (entityRes.ok) {
        const entityJson = await entityRes.json();
        console.log(`[claimmachine] Response JSON:`, entityJson);
        const entityRows = entityJson?.result?.[0];
        if (Array.isArray(entityRows) && entityRows.length >= 2) {
          const [, ...entityValues] = entityRows;
          groupId = entityValues[0] as string;
          console.log(`[claimmachine] Found groupId: ${groupId}`);
        } else {
          console.log(`[claimmachine] No group data found in response`);
        }
      } else {
        const errorText = await entityRes.text();
        console.log(`[claimmachine] HTTP error: ${entityRes.status} - ${errorText}`);
      }

      if (!groupId) {
        // No access group found for this machine entity ID
        const coordsText = coordsForLog ? `(${coordsForLog.join(', ')})` : 'at this location';
        throw new Error(`No access group found for machine ${coordsText}. This machine either doesn't exist, isn't set up for access control, or you don't have permission to access it.`);
      } else {
        console.log(`[claimmachine] Found existing group: ${groupId}`);

        // Check who the actual owner of this group is
        const ownerQuery = `SELECT "owner" FROM "dfprograms_1__AccessGroupOwner" WHERE "groupId"='${groupId}'`;
        console.log(`[claimmachine] Checking group owner: ${ownerQuery}`);

        const ownerRes = await fetch(INDEXER_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify([{ address: WORLD_ADDRESS, query: ownerQuery }]),
        });

        let actualOwner: string | null = null;
        if (ownerRes.ok) {
          const ownerJson = await ownerRes.json();
          const ownerRows = ownerJson?.result?.[0];
          if (Array.isArray(ownerRows) && ownerRows.length >= 2) {
            actualOwner = ownerRows[1][0] as string;
            console.log(`[claimmachine] Actual group owner: ${actualOwner}`);
          }
        }

        // Check if the session address is already a member of this group
        const sessionBytes32 = encodePlayerEntityId(sessionAddress);
        const memberQuery = `SELECT "hasAccess" FROM "dfprograms_1__AccessGroupMembe" WHERE "groupId"='${groupId}' AND "member"='${sessionBytes32}'`;

        console.log(`[claimmachine] Checking if session address is already a member: ${memberQuery}`);

        const memberRes = await fetch(INDEXER_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify([{ address: WORLD_ADDRESS, query: memberQuery }]),
        });

        if (memberRes.ok) {
          const memberJson = await memberRes.json();
          const memberRows = memberJson?.result?.[0];
          if (Array.isArray(memberRows) && memberRows.length >= 2) {
            const hasAccess = memberRows[1][0]; // Get the hasAccess value
            console.log(`[claimmachine] Session address already has access: ${hasAccess}`);

            if (hasAccess) {
              window.dispatchEvent(new CustomEvent<string>("worker-log", {
                detail: `✅ You already have access to this machine (group ${groupId}). Adding EOA address as additional member...`,
              }));
            }
          }
        }

        // Check if EOA address is already a member
        console.log(`[claimmachine] context.address: ${context.address}`);
        console.log(`[claimmachine] sessionAddress: ${sessionAddress}`);
        console.log(`[claimmachine] eoaAddress: ${eoaAddress}`);
        const eoaBytes32 = encodePlayerEntityId(eoaAddress);
        console.log(`[claimmachine] eoaBytes32: ${eoaBytes32}`);
        console.log(`[claimmachine] sessionBytes32: ${sessionBytes32}`);
        const eoaMemberQuery = `SELECT "hasAccess" FROM "dfprograms_1__AccessGroupMembe" WHERE "groupId"='${groupId}' AND "member"='${eoaBytes32}'`;

        console.log(`[claimmachine] Checking if EOA address is already a member: ${eoaMemberQuery}`);

        const eoaMemberRes = await fetch(INDEXER_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify([{ address: WORLD_ADDRESS, query: eoaMemberQuery }]),
        });

        let eoaHasAccess = false;
        if (eoaMemberRes.ok) {
          const eoaMemberJson = await eoaMemberRes.json();
          const eoaMemberRows = eoaMemberJson?.result?.[0];
          if (Array.isArray(eoaMemberRows) && eoaMemberRows.length >= 2) {
            eoaHasAccess = eoaMemberRows[1][0]; // Get the hasAccess value
            console.log(`[claimmachine] EOA address already has access: ${eoaHasAccess}`);
          }
        }

        // If both addresses already have access, we're done
        if (eoaHasAccess) {
          window.dispatchEvent(new CustomEvent<string>("worker-log", {
            detail: `✅ Both session and EOA addresses already have access to this machine (group ${groupId}). No changes needed.`,
          }));
          return;
        }

        // Check if we have permission to modify this group
        if (actualOwner !== sessionBytes32 && actualOwner !== eoaBytes32) {
          throw new Error(`You don't own this access group. Owner: ${actualOwner}, Session: ${sessionBytes32}, EOA: ${eoaBytes32}`);
        }
      }

      // Use numeric group ID (not bytes32) and include caller parameter
      const groupIdNumeric = Number(groupId);
      const callerBytes32 = encodePlayerEntityId(sessionAddress);
      console.log(`[claimmachine] Using groupId ${groupIdNumeric}, caller: ${callerBytes32}`);

      // Step 1: Add session address as member (using caller, groupId, member, allowed signature)
      const setMembershipCallData = encodeFunctionData({
        abi: [{
          type: "function",
          name: "setMembership",
          inputs: [
            { name: "caller", type: "bytes32" },
            { name: "groupId", type: "uint256" },
            { name: "member", type: "address" },
            { name: "allowed", type: "bool" }
          ],
          outputs: [],
          stateMutability: "nonpayable"
        }],
        functionName: "setMembership",
        args: [callerBytes32, BigInt(groupIdNumeric), sessionAddress, true],
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

      // Step 2: Add EOA address as member (using caller, groupId, member, allowed signature)
      const setMembershipCallDataEOA = encodeFunctionData({
        abi: [{
          type: "function",
          name: "setMembership",
          inputs: [
            { name: "caller", type: "bytes32" },
            { name: "groupId", type: "uint256" },
            { name: "member", type: "address" },
            { name: "allowed", type: "bool" }
          ],
          outputs: [],
          stateMutability: "nonpayable"
        }],
        functionName: "setMembership",
        args: [callerBytes32, BigInt(groupIdNumeric), eoaAddress as `0x${string}`, true],
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
        : `machine ${machine}`;

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
          detail: "❌ The target isn't a smart entity. Make sure you're targeting a machine block."
        }));
        return;
      }
      window.dispatchEvent(new CustomEvent("worker-log", { detail: `❌ claimmachine failed: ${msg}` }));
    }
  }
}
