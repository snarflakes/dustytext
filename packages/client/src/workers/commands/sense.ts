// sense.ts (typed)
import { CommandHandler, CommandContext } from "./types";
import { createCoordLinkHTML } from "../../utils/tileLinksHtml";

/* ---------------------- Env / constants ---------------------- */
const INDEXER_URL   = "https://indexer.mud.redstonechain.com/q";
const WORLD_ADDRESS = "0x253eb85B3C953bFE3827CC14a151262482E7189C";
const POSITION_TABLE = "EntityPosition";

/* ---------------------- Types ---------------------- */
type Hex32 = `0x${string}`;
type Vec3 = [number, number, number];

interface IndexerRowObj {
  [key: string]: string | number | null | undefined;
}
interface IndexerJsonShape {
  result?: [[string[], (string | number | null)[]]];
}

interface PositionRow extends IndexerRowObj {
  x: number | string | null;
  y: number | string | null;
  z: number | string | null;
}

interface FragmentRow extends IndexerRowObj {
  forceField: Hex32 | null;
  forceFieldCreatedAt: number | string | null;
  extraDrainRate: number | string | null;
}

interface MachineRow extends IndexerRowObj {
  createdAt: number | string | null;
}

// type ForceFieldOnlyRow = { forceField: Hex32 | null } & IndexerRowObj;

export type ForceFieldInfo = {
  active: boolean;
  fragmentId: Hex32;
  forceField: Hex32;
  extraDrainRate: bigint | null;
  forceFieldCreatedAt: bigint | null;
  machineCreatedAt: bigint | null;
  owner?: string | null;
  reason?: string;
};

/* ---------------------- EntityId / encoding ---------------------- */
const BYTES_32_BITS = 256n;
const TYPE_BITS     = 8n;
const ID_BITS       = BYTES_32_BITS - TYPE_BITS; // 248
const VEC3_BITS     = 96n;
const ENTITY_TYPE_FRAGMENT = 0x02; // confirmed by your sample

let FRAGMENT_SHIFT: number | null = null; // auto-discovered: 16/32/64

const ZERO_ENTITY_ID: Hex32 = `0x${"00".repeat(32)}`;

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
function encodeFragment(frag: Vec3): Hex32 {
  return encodeCoord(ENTITY_TYPE_FRAGMENT, frag);
}
function decodePosition(entityId: Hex32): Vec3 {
  const value = BigInt(entityId);
  const data = value & ((1n << ID_BITS) - 1n);
  const packedCoord = data >> (ID_BITS - VEC3_BITS);
  
  const z = Number(BigInt.asIntN(32, packedCoord & 0xFFFFFFFFn));
  const y = Number(BigInt.asIntN(32, (packedCoord >> 32n) & 0xFFFFFFFFn));
  const x = Number(BigInt.asIntN(32, (packedCoord >> 64n) & 0xFFFFFFFFn));
  
  return [x, y, z];
}
function toFragmentCoordWithShift([x, y, z]: Vec3, shift: number): Vec3 {
  const s = 1 << shift;
  const fd = (n: number) => Math.floor(n / s);
  return [fd(x), fd(y), fd(z)];
}
function toFragmentCoord(pos: Vec3): Vec3 {
  if (FRAGMENT_SHIFT == null) throw new Error("FRAGMENT_SHIFT unresolved");
  return toFragmentCoordWithShift(pos, FRAGMENT_SHIFT);
}
function encodePlayerEntityId(address: string): Hex32 {
  const prefix = "01";
  const clean = address.toLowerCase().replace(/^0x/, "");
  return (`0x${prefix}${clean.padEnd(64 - prefix.length, "0")}`) as Hex32;
}

/* ---------------------- Indexer helpers (typed) ---------------------- */
async function sqlOne<T extends IndexerRowObj>(query: string): Promise<T | null> {
  const res = await fetch(INDEXER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ address: WORLD_ADDRESS, query }]),
  });
  if (!res.ok) return null;

  const json = (await res.json()) as IndexerJsonShape;
  const rows = json.result?.[0];
  if (!Array.isArray(rows) || rows.length < 2) return null;

  const [cols, vals] = rows;
  const objEntries = cols.map((k, i) => [k, vals[i]]);
  // single row only (indexer returns one row for our WHERE)
  return Object.fromEntries(objEntries) as T;
}

function asNumber(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}
function asBigInt(v: number | string | null | undefined): bigint | null {
  if (v === null || v === undefined) return null;
  try { return BigInt(String(v)); } catch { return null; }
}
function asHex32(v: string | null | undefined): Hex32 {
  if (typeof v === "string" && v.startsWith("0x")) return v.toLowerCase() as Hex32;
  return ZERO_ENTITY_ID;
}

/* ---------------------- Position ---------------------- */
async function fetchPlayerPosition(address: string): Promise<{ x: number; y: number; z: number } | null> {
  const entityId = encodePlayerEntityId(address);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const q = `SELECT "x","y","z" FROM "${POSITION_TABLE}" WHERE "entityId"='${entityId}'`;
    const row = await sqlOne<PositionRow>(q);
    if (row) {
      const x = asNumber(row.x) ?? 0;
      const y = asNumber(row.y) ?? 0;
      const z = asNumber(row.z) ?? 0;
      return { x, y, z };
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, 900));
  }
  return null;
}



/* ---------------------- Fragment size discovery ---------------------- */
// Reset the cached shift to force rediscovery
FRAGMENT_SHIFT = null;

async function discoverFragmentShift(): Promise<number> {
  console.log(`[sense] Starting fragment shift discovery...`);
  if (FRAGMENT_SHIFT != null) return FRAGMENT_SHIFT;
  
  // Based on official map code: fragmentSize = 8, so shift = 3 (2^3 = 8)
  const correctShift = 3; // 8 blocks per fragment
  console.log(`[sense] Using official fragment size: 8 blocks (shift ${correctShift})`);
  
  FRAGMENT_SHIFT = correctShift;
  return correctShift;
}

/* ---------------------- Core reads ---------------------- */
// Replace your readFragmentForceFieldByPos with this version
async function readFragmentForceFieldByPos(pos: Vec3): Promise<{
  fragmentId: Hex32;
  forceField: Hex32;
  forceFieldCreatedAt: number | string | null;
  extraDrainRate: number | string | null;
} | null> {
  // Ensure we have discovered the fragment shift
  if (FRAGMENT_SHIFT == null) {
    await discoverFragmentShift();
  }
  
  // Calculate the correct fragment ID for this position
  const fragmentCoord = toFragmentCoord(pos);
  const fragmentId = encodeFragment(fragmentCoord);
  
  console.log(`[sense] Looking up fragment for pos ${pos} -> fragmentCoord ${fragmentCoord} -> fragmentId ${fragmentId}`);
  
  const q = `SELECT "forceField","forceFieldCreatedAt","extraDrainRate" FROM "Fragment" WHERE "entityId"='${fragmentId}'`;
  const row = await sqlOne<FragmentRow>(q);
  
  if (row) {
    console.log(`[sense] Found fragment row:`, row);
    return {
      fragmentId: fragmentId,
      forceField: asHex32(row.forceField ?? null),
      forceFieldCreatedAt: row.forceFieldCreatedAt ?? null,
      extraDrainRate: row.extraDrainRate ?? null,
    };
  }
  
  // If not found, let's debug by checking what fragments actually exist
  console.log(`[sense] No fragment found for ${fragmentId}, checking actual fragments...`);
  const debugQuery = `SELECT "entityId" FROM "Fragment" LIMIT 5`;
  const debugRes = await fetch(INDEXER_URL, {
    method: "POST", 
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ address: WORLD_ADDRESS, query: debugQuery }])
  });
  
  if (debugRes.ok) {
    const debugJson = await debugRes.json();
    const debugTable = debugJson?.result?.[0];
    if (Array.isArray(debugTable) && debugTable.length >= 2) {
      const [, ...rows] = debugTable;
      console.log(`[sense] Actual fragment IDs in database:`);
      for (const row of rows.slice(0, 3)) {
        const entityId = row[0] as string;
        try {
          const decoded = decodePosition(entityId as Hex32);
          console.log(`[sense] Fragment ${entityId} -> coords ${decoded}`);
        } catch (e) {
          console.log(`[sense] Fragment ${entityId} -> decode failed:`, e);
        }
      }
    }
  }
  
  return null;
}


async function readMachineCreatedAt(machineId: Hex32): Promise<number | string | null> {
  if (machineId === ZERO_ENTITY_ID) return null;
  const q = `SELECT "createdAt" FROM "Machine" WHERE "entityId"='${machineId}'`;
  const row = await sqlOne<MachineRow>(q);
  return row ? (row.createdAt ?? null) : null;
}

async function readMachineEnergy(machineId: Hex32): Promise<number | null> {
  if (machineId === ZERO_ENTITY_ID) return null;
  const q = `SELECT "energy" FROM "Energy" WHERE "entityId"='${machineId}'`;
  const row = await sqlOne<{ energy: string | number }>(q);
  return row ? Number(row.energy ?? 0) : null;
}

/* ---------------------- Sense logic ---------------------- */
export async function senseActiveForceFieldAt(pos: Vec3): Promise<{
  active: boolean;
  fragmentId: Hex32;
  forceField: Hex32;
  extraDrainRate?: number | string | null;
  forceFieldCreatedAt?: number | string | null;
  machineCreatedAt?: number | string | null;
  owner?: string | null;
  reason?: string;
}> {
  const frag = await readFragmentForceFieldByPos(pos);
  if (!frag) {
    if (FRAGMENT_SHIFT == null) await discoverFragmentShift();
    return {
      active: false,
      fragmentId: encodeFragment(toFragmentCoord(pos)),
      forceField: ZERO_ENTITY_ID,
      reason: "No fragment row.",
    };
  }

  const { fragmentId, forceField, forceFieldCreatedAt, extraDrainRate } = frag;
  if (forceField === ZERO_ENTITY_ID) {
    return { active: false, fragmentId, forceField, extraDrainRate, forceFieldCreatedAt, machineCreatedAt: null, reason: "No forceField set on fragment." };
  }

  console.log(`[sense] Checking force field ${forceField} for fragment ${fragmentId}`);
  
  const machineCreatedAt = await readMachineCreatedAt(forceField);
  const machineEnergy = await readMachineEnergy(forceField);
  const owner = await getForceFieldOwner(forceField);
  
  console.log(`[sense] Machine createdAt: ${machineCreatedAt}, Fragment forceFieldCreatedAt: ${forceFieldCreatedAt}, Energy: ${machineEnergy}, Owner: ${owner}`);
  
  // Check if the machine exists and timestamps match
  const machineExists = machineCreatedAt != null;
  const timestampsMatch = machineExists && forceFieldCreatedAt != null && String(machineCreatedAt) === String(forceFieldCreatedAt);
  const hasEnergy = machineEnergy != null && machineEnergy > 0;
  
  console.log(`[sense] Machine exists: ${machineExists}, Timestamps match: ${timestampsMatch}, Has energy: ${hasEnergy}`);

  // Force field is active only if machine exists, timestamps match, AND has energy
  const active = machineExists && timestampsMatch && hasEnergy;

  let reason: string | undefined;
  if (!machineExists) {
    reason = "No machine found for this force field.";
  } else if (!timestampsMatch) {
    reason = "CreatedAt mismatch (stale/removed machine?).";
  } else if (!hasEnergy) {
    reason = "Forcefield is present but has been completely depleted.";
  }

  return {
    active,
    fragmentId,
    forceField,
    extraDrainRate,
    forceFieldCreatedAt,
    machineCreatedAt,
    owner,
    reason,
  };
}

export async function senseAtCoord(x: number, y: number, z: number) {
  return senseActiveForceFieldAt([x, y, z]);
}

export async function senseAtPlayer(address: string) {
  const pos = await fetchPlayerPosition(address);
  if (!pos) throw new Error("You float amongst the stars. Try 'spawn' first.");
  return senseActiveForceFieldAt([pos.x, pos.y, pos.z]);
}

/* ---------------------- Reusable API for other commands ---------------------- */
// small cache per fragment to avoid spam
const ffCache = new Map<string, { info: ForceFieldInfo; ts: number }>();

function cacheSet(info: ForceFieldInfo): void {
  ffCache.set(info.fragmentId, { info, ts: Date.now() });
}

export async function getForceFieldInfo(pos: Vec3): Promise<ForceFieldInfo> {
  const r = await senseActiveForceFieldAt(pos);

  const info: ForceFieldInfo = {
    active: r.active,
    fragmentId: r.fragmentId,
    forceField: r.forceField,
    extraDrainRate: asBigInt(r.extraDrainRate ?? null),
    forceFieldCreatedAt: asBigInt(r.forceFieldCreatedAt ?? null),
    machineCreatedAt: asBigInt(r.machineCreatedAt ?? null),
    owner: r.owner,
    reason: r.reason,
  };

  cacheSet(info);
  return info;
}

export async function getForceFieldInfoAtCoord(x: number, y: number, z: number): Promise<ForceFieldInfo> {
  return getForceFieldInfo([x, y, z]);
}

export async function getForceFieldInfoForPlayer(address: string): Promise<ForceFieldInfo> {
  const pos = await fetchPlayerPosition(address);
  if (!pos) throw new Error("You float amongst the stars. Try 'spawn' first.");
  return getForceFieldInfo([pos.x, pos.y, pos.z]);
}

export function invalidateForceFieldFragment(fragmentId: Hex32): void {
  ffCache.delete(fragmentId);
}

/* ---------------------- Command wrapper ---------------------- */
export class SenseCommand implements CommandHandler {
  async execute(context: CommandContext, ...args: string[]): Promise<void> {
    try {
      if (args.length === 3) {
        const x = Number(args[0]), y = Number(args[1]), z = Number(args[2]);
        if ([x, y, z].some((n) => Number.isNaN(n))) {
          throw new Error("Usage: sense [x y z]  (omit coords to sense where you stand)");
        }
        const result = await getForceFieldInfo([x, y, z]);
        const where = createCoordLinkHTML(x, y, z, 4);
        const drain = result.extraDrainRate && result.extraDrainRate > 0n ? ` (drain +${result.extraDrainRate})` : "";
        const ownerInfo = result.owner ? `\nOwner: ${result.owner}` : "\nOwner: Unowned or custom owner contract";
        const msg = result.active
          ? `🛡️ Forcefield ACTIVE at ${where}${drain}${ownerInfo}\nfragment=${result.fragmentId}\nforceField=${result.forceField}`
          : `🧭 No active forcefield at ${where}${drain}${ownerInfo}\n${result.reason ?? ""}`;
        window.dispatchEvent(new CustomEvent<string>("worker-log", { detail: msg }));
        return;
      }

      const pos = await fetchPlayerPosition(context.address);
      if (!pos) throw new Error("You float amongst the stars. Try 'spawn' first.");
      const result = await getForceFieldInfo([pos.x, pos.y, pos.z]);
      const where = createCoordLinkHTML(pos.x, pos.y, pos.z, 4);
      const drain = result.extraDrainRate && result.extraDrainRate > 0n ? ` (drain +${result.extraDrainRate})` : "";
      const ownerInfo = result.owner ? `\nOwner: ${result.owner}` : "\nOwner: Unowned or custom owner contract";
      const msg = result.active
        ? `🛡️ Forcefield ACTIVE ${where}${drain}${ownerInfo}\nfragment=${result.fragmentId}\nforceField=${result.forceField}`
        : `🧭 No active forcefield detected ${where}${drain}${ownerInfo}\n${result.reason ?? ""}`;
      window.dispatchEvent(new CustomEvent<string>("worker-log", { detail: msg }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      window.dispatchEvent(new CustomEvent<string>("worker-log", { detail: `❌ Sense failed: ${message}` }));
    }
  }
}

// Remove unused function
// async function fetchMachinePosition(machineId: Hex32): Promise<{ x: number; y: number; z: number } | null> {
//   const q = `SELECT "x","y","z" FROM "${POSITION_TABLE}" WHERE "entityId"='${machineId}'`;
//   const row = await sqlOne<{ x: number | string | null; y: number | string | null; z: number | string | null }>(q);
//   if (row) {
//     const x = asNumber(row.x) ?? 0;
//     const y = asNumber(row.y) ?? 0;
//     const z = asNumber(row.z) ?? 0;
//     return { x, y, z };
//   }
//   return null;
// }

async function getForceFieldOwner(entityId: Hex32): Promise<string | null> {
  try {
    console.log(`[sense] Getting owner for entity: ${entityId}`);
    
    // Try to get access group for the force field entity ID directly
    const groupQuery = `SELECT "groupId" FROM "dfprograms_1__EntityAccessGrou" WHERE "entityId"='${entityId}'`;
    const groupRes = await fetch(INDEXER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ address: WORLD_ADDRESS, query: groupQuery }]),
    });
    
    if (!groupRes.ok) {
      console.log(`[sense] No access group found for force field (this is normal for unowned force fields)`);
      return null;
    }
    
    const groupJson = await groupRes.json();
    const groupRows = groupJson?.result?.[0];
    if (!Array.isArray(groupRows) || groupRows.length < 2) {
      console.log(`[sense] No group data found`);
      return null;
    }
    
    const [, ...groupValues] = groupRows;
    const groupId = groupValues[0] as string;
    
    if (!groupId) {
      console.log(`[sense] Empty group ID`);
      return null;
    }
    
    console.log(`[sense] Found access group: ${groupId}`);
    
    // Get the owner of this access group
    const ownerQuery = `SELECT "owner" FROM "dfprograms_1__AccessGroupOwner" WHERE "groupId"='${groupId}'`;
    const ownerRes = await fetch(INDEXER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ address: WORLD_ADDRESS, query: ownerQuery }]),
    });
    
    if (!ownerRes.ok) {
      console.log(`[sense] Owner query failed: ${ownerRes.status}`);
      return null;
    }
    
    const ownerJson = await ownerRes.json();
    const ownerRows = ownerJson?.result?.[0];
    if (!Array.isArray(ownerRows) || ownerRows.length < 2) {
      console.log(`[sense] No owner data found`);
      return null;
    }
    
    const [, ...ownerValues] = ownerRows;
    const owner = ownerValues[0] as string;
    
    console.log(`[sense] Found owner: ${owner}`);
    return owner || null;
    
  } catch (error) {
    console.error(`[sense] Error getting force field owner:`, error);
    return null;
  }
}
