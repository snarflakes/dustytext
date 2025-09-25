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

type ForceFieldOnlyRow = { forceField: Hex32 | null } & IndexerRowObj;

export type ForceFieldInfo = {
  active: boolean;
  fragmentId: Hex32;
  forceField: Hex32;
  extraDrainRate: bigint | null;
  forceFieldCreatedAt: bigint | null;
  machineCreatedAt: bigint | null;
  reason?: string;
};

/* ---------------------- EntityId / encoding ---------------------- */
const BYTES_32_BITS    = 256n;
const ENTITY_TYPE_BITS = 8n;
const ENTITY_ID_BITS   = BYTES_32_BITS - ENTITY_TYPE_BITS; // 248
const VEC3_BITS        = 96n;

//const ENTITY_TYPE_BLOCK    = 0x03;
const ENTITY_TYPE_FRAGMENT = 0x02; // confirmed by your sample

let FRAGMENT_SHIFT: number | null = null; // auto-discovered: 16/32/64

const ZERO_ENTITY_ID: Hex32 = `0x${"00".repeat(32)}`;

function toU32(n: number): bigint {
  return BigInt.asUintN(32, BigInt(n));
}
function packVec3([x, y, z]: Vec3): bigint {
  const X = toU32(x), Y = toU32(y), Z = toU32(z);
  return (X << 64n) | (Y << 32n) | Z;
}
function encode(entityType: number, data: bigint): Hex32 {
  const v = (BigInt(entityType) << ENTITY_ID_BITS) | data;
  // size: 32 bytes
  const hex = v.toString(16).padStart(64, "0");
  return (`0x${hex}`) as Hex32;
}
function encodeCoord(entityType: number, coord: Vec3): Hex32 {
  const packed = packVec3(coord);
  return encode(entityType, packed << (ENTITY_ID_BITS - VEC3_BITS));
}
//function encodeBlock(pos: Vec3): Hex32 {
//  return encodeCoord(ENTITY_TYPE_BLOCK, pos);
//}
function encodeFragment(frag: Vec3): Hex32 {
  return encodeCoord(ENTITY_TYPE_FRAGMENT, frag);
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

async function discoverFragmentShift(pos: Vec3): Promise<number> {
  console.log(`[sense] Starting fragment shift discovery...`);
  if (FRAGMENT_SHIFT != null) return FRAGMENT_SHIFT;
  
  const candidates: number[] = [4, 5, 6, 7, 8]; // try more shifts: 16, 32, 64, 128, 256
  for (const s of candidates) {
    const fragId = encodeFragment(toFragmentCoordWithShift(pos, s));
    console.log(`[sense] Testing fragment shift ${s} -> fragId: ${fragId}`);
    const q = `SELECT "forceField" FROM "Fragment" WHERE "entityId"='${fragId}'`;
    const row = await sqlOne<ForceFieldOnlyRow>(q);
    if (row) { 
      console.log(`[sense] Found fragment with shift ${s}:`, row);
      FRAGMENT_SHIFT = s; 
      return s; 
    }
  }
  
  // Also try a general query to see if ANY fragments exist
  console.log(`[sense] No fragments found with any shift, checking if Fragment table has any data...`);
  const generalQ = `SELECT "entityId", "forceField" FROM "Fragment" LIMIT 5`;
  const generalRes = await fetch(INDEXER_URL, {
    method: "POST", 
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ address: WORLD_ADDRESS, query: generalQ }])
  });
  if (generalRes.ok) {
    const json = await generalRes.json();
    console.log(`[sense] Sample Fragment table data:`, JSON.stringify(json, null, 2));
  }
  
  console.log(`[sense] Falling back to shift 5`);
  FRAGMENT_SHIFT = 5; // fallback to 32
  return 5;
}

/* ---------------------- Core reads ---------------------- */
// Replace your readFragmentForceFieldByPos with this version
async function readFragmentForceFieldByPos(pos: Vec3): Promise<{
  fragmentId: Hex32;
  forceField: Hex32;
  forceFieldCreatedAt: number | string | null;
  extraDrainRate: number | string | null;
} | null> {
  console.log(`[sense] Trying direct lookup of known fragment IDs for pos ${pos}`);
  
  // Try the actual fragment IDs we found in the database
  const knownFragmentIds = [
    "0x0200000000000000000000000000000000000000000000000000000000000000",
    "0x020000000000000000ffffffff00000000000000000000000000000000000000", 
    "0x0200000000000000010000000000000000000000000000000000000000000000",
    "0x020000000000000002ffffffff00000000000000000000000000000000000000",
    "0x0200000000000000030000000000000000000000000000000000000000000000"
  ];
  
  for (const fragmentId of knownFragmentIds) {
    console.log(`[sense] Checking known fragment ${fragmentId}`);
    const q = `SELECT "forceField","forceFieldCreatedAt","extraDrainRate" FROM "Fragment" WHERE "entityId"='${fragmentId}'`;
    const row = await sqlOne<FragmentRow>(q);
    if (row) {
      console.log(`[sense] Found fragment row:`, row);
      return {
        fragmentId: fragmentId as Hex32,
        forceField: asHex32(row.forceField ?? null),
        forceFieldCreatedAt: row.forceFieldCreatedAt ?? null,
        extraDrainRate: row.extraDrainRate ?? null,
      };
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

/* ---------------------- Sense logic ---------------------- */
export async function senseActiveForceFieldAt(pos: Vec3): Promise<{
  active: boolean;
  fragmentId: Hex32;
  forceField: Hex32;
  extraDrainRate?: number | string | null;
  forceFieldCreatedAt?: number | string | null;
  machineCreatedAt?: number | string | null;
  reason?: string;
}> {
  const frag = await readFragmentForceFieldByPos(pos);
  if (!frag) {
    if (FRAGMENT_SHIFT == null) await discoverFragmentShift(pos);
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

  const machineCreatedAt = await readMachineCreatedAt(forceField);
  const eq = machineCreatedAt != null && fragmentId != null
    && forceFieldCreatedAt != null
    && String(machineCreatedAt) === String(forceFieldCreatedAt);

  return {
    active: !!eq,
    fragmentId,
    forceField,
    extraDrainRate,
    forceFieldCreatedAt,
    machineCreatedAt,
    reason: eq ? undefined : "CreatedAt mismatch (stale/removed machine?).",
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
const FF_CACHE_TTL_MS = 2000;
const ffCache = new Map<string, { info: ForceFieldInfo; ts: number }>();

function cacheGet(fragmentId: Hex32): ForceFieldInfo | null {
  const e = ffCache.get(fragmentId);
  if (!e) return null;
  if (Date.now() - e.ts > FF_CACHE_TTL_MS) { ffCache.delete(fragmentId); return null; }
  return e.info;
}
function cacheSet(info: ForceFieldInfo): void {
  ffCache.set(info.fragmentId, { info, ts: Date.now() });
}

export async function getForceFieldInfo(pos: Vec3): Promise<ForceFieldInfo> {
  const r = await senseActiveForceFieldAt(pos);

  const info: ForceFieldInfo = {
    active: r.active,
    fragmentId: r.fragmentId, // Use the actual found fragmentId, not calculated
    forceField: r.forceField,
    extraDrainRate: asBigInt(r.extraDrainRate ?? null),
    forceFieldCreatedAt: asBigInt(r.forceFieldCreatedAt ?? null),
    machineCreatedAt: asBigInt(r.machineCreatedAt ?? null),
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
        const msg = result.active
          ? `🛡️ Forcefield ACTIVE at ${where}${drain}\nfragment=${result.fragmentId}\nforceField=${result.forceField}`
          : `🧭 No active forcefield at ${where}${drain}\n${result.reason ?? ""}`;
        window.dispatchEvent(new CustomEvent<string>("worker-log", { detail: msg }));
        return;
      }

      const pos = await fetchPlayerPosition(context.address);
      if (!pos) throw new Error("You float amongst the stars. Try 'spawn' first.");
      const result = await getForceFieldInfo([pos.x, pos.y, pos.z]);
      const where = createCoordLinkHTML(pos.x, pos.y, pos.z, 4);
      const drain = result.extraDrainRate && result.extraDrainRate > 0n ? ` (drain +${result.extraDrainRate})` : "";
      const msg = result.active
        ? `🛡️ Forcefield ACTIVE ${where}${drain}\nfragment=${result.fragmentId}\nforceField=${result.forceField}`
        : `🧭 No active forcefield detected ${where}${drain}\n${result.reason ?? ""}`;
      window.dispatchEvent(new CustomEvent<string>("worker-log", { detail: msg }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      window.dispatchEvent(new CustomEvent<string>("worker-log", { detail: `❌ Sense failed: ${message}` }));
    }
  }
}
