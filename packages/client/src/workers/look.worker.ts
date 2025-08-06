// src/commands/look.worker.ts

import { getTerrainBlockType } from "../terrain";
import { objectNamesById } from "../objects";
import { createPublicClient, http, type Transport, type Chain } from "viem";
import { redstone } from "viem/chains";

const publicClient = createPublicClient<Transport, Chain, undefined>({
  chain: redstone,
  transport: http(),
});

const INDEXER_URL = "https://indexer.mud.redstonechain.com/q";
const WORLD_ADDRESS = "0x253eb85B3C953bFE3827CC14a151262482E7189C";
const POSITION_TABLE = "EntityPosition";
const ORIENTATION_TABLE = "EntityOrientation";

let playerAddress: `0x${string}` = "0x0000000000000000000000000000000000000000";

function encodePlayerEntityId(address: string): `0x${string}` {
  const prefix = "01";
  const clean = address.toLowerCase().replace(/^0x/, "");
  return `0x${prefix}${clean.padEnd(64 - prefix.length, "0")}` as `0x${string}`;
}

async function getPlayerPosition(): Promise<{ x: number; y: number; z: number }> {
  const entityId = encodePlayerEntityId(playerAddress);

  const query = `
    SELECT "x", "y", "z"
    FROM "${POSITION_TABLE}"
    WHERE "entityId" = '${entityId}'
  `;

  const res = await fetch(INDEXER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ address: WORLD_ADDRESS, query }]),
  });

  const json = await res.json();
  const rows = json?.result?.[0];

  if (!Array.isArray(rows) || rows.length < 2) {
    throw new Error("No position found for player. Try 'spawn' first.");
  }

  const [cols, vals] = rows;
  const pos = Object.fromEntries(cols.map((k: string, i: number) => [k, vals[i]]));

  console.log("[look] Position result:", pos);

  return {
    x: Number(pos.x ?? 0),
    y: Number(pos.y ?? 0),
    z: Number(pos.z ?? 0),
  };
}

async function getPlayerOrientation(): Promise<{ label: string; value: number }> {
  const entityId = encodePlayerEntityId(playerAddress);

  const query = `
    SELECT "orientation"
    FROM "${ORIENTATION_TABLE}"
    WHERE "entityId" = '${entityId}'
  `;

  try {
    const res = await fetch(INDEXER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ address: WORLD_ADDRESS, query }]),
    });

    const json = await res.json();
    const rows = json?.result?.[0];

    if (!Array.isArray(rows) || rows.length < 2) {
      console.warn("[look] Orientation missing, defaulting to north");
      return { label: "north", value: 0 };
    }

    const [cols, vals] = rows;
    const index = cols.indexOf("orientation");
    if (index === -1 || vals[index] === null || vals[index] === undefined) {
      console.warn("[look] Orientation null/undefined, defaulting to north");
      return { label: "north", value: 0 };
    }

    const raw = Number(vals[index]);
    const label = ["north", "east", "south", "west"][raw] ?? "unknown";
    return { label, value: raw };
  } catch (e) {
    console.warn("[look] Orientation query failed:", e);
    return { label: "north", value: 0 };
  }
}

async function look() {
  console.log("[look] Look function started");
  try {
    console.log("[look] Getting player position...");
    const { x, y, z } = await getPlayerPosition();
    console.log("[look] Position:", { x, y, z });
    
    console.log("[look] Getting player orientation...");
    const orientation = await getPlayerOrientation();
    console.log("[look] Orientation:", orientation);
    
    const vx = x;
    const vy = y - 1;
    const vz = z;

    const INT32_MIN = -2_147_483_648;
    const INT32_MAX = 2_147_483_647;

    if ([vx, vy, vz].some(n => n < INT32_MIN || n > INT32_MAX)) {
      throw new Error(`Coordinates must be within int32 range: (${vx}, ${vy}, ${vz})`);
    }

    console.log("[look] Checking getTerrainBlockType at:", { x: vx, y: vy, z: vz });
    const blockType = await getTerrainBlockType(publicClient, WORLD_ADDRESS, [vx, vy, vz]);

    console.log("[look] BlockType result:", blockType);

    const blockName = typeof blockType === "number" && objectNamesById[blockType];

    const label = blockName
      ? `You are standing on ${blockName}.`
      : "Unexplored terrain. Try 'explore'.";

    const msg = `You are at (${x}, ${y}, ${z}), facing ${orientation.label} (${orientation.value}). ${label}`;
    postMessage({ type: "done", message: msg, status: "success" });
  } catch (err) {
    postMessage({ type: "done", message: `Look failed: ${(err as Error).message}` , status: "error" });
  }
}

self.onmessage = (event) => {
  console.log("[look] Worker received message:", event.data);
  if (event.data?.type === "init" && event.data.address) {
    playerAddress = event.data.address as `0x${string}`;
    console.log("[look] Starting look with address:", playerAddress);
    look();
  }
};
