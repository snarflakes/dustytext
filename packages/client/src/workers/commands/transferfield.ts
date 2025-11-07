import { encodeFunctionData } from "viem";
import { CommandHandler, CommandContext } from "./types";
import { getForceFieldInfoForPlayer, getForceFieldInfo, ForceFieldInfo } from "./sense";
import IWorldAbi from "@dust/world/out/IWorld.sol/IWorld.abi";
import { resourceToHex } from "@latticexyz/common";

/* ---------------------- World / Indexer ---------------------- */
const WORLD_ADDRESS  = "0x253eb85B3C953bFE3827CC14a151262482E7189C";
const INDEXER_URL    = "https://indexer.mud.redstonechain.com/q";
const ZERO_ENTITY_ID = "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;

/* ---------------------- Types / helpers ---------------------- */
type Hex32 = `0x${string}`;
type Vec3  = [number, number, number];

function encodePlayerEntityId(address: string): Hex32 {
  const prefix = "01";
  const clean  = address.toLowerCase().replace(/^0x/, "");
  return `0x${prefix}${clean.padEnd(64 - prefix.length, "0")}` as Hex32;
}

function encodeCoord(entityType: number, pos: Vec3): Hex32 {
  const x = BigInt(pos[0]);
  const y = BigInt(pos[1]);
  const z = BigInt(pos[2]);
  const entityTypeBig = BigInt(entityType);
  
  const packed = (entityTypeBig << 192n) | (x << 128n) | (y << 64n) | z;
  return `0x${packed.toString(16).padStart(64, "0")}` as Hex32;
}

const ENTITY_TYPE_BLOCK = 3;

function encodeBlock(pos: Vec3): Hex32 {
  return encodeCoord(ENTITY_TYPE_BLOCK, pos);
}

async function fetchPlayerBlock(address: string): Promise<Vec3 | null> {
  const playerEntityId = encodePlayerEntityId(address);
  const query = `SELECT "x", "y", "z" FROM "EntityPosition" WHERE "entityId"='${playerEntityId}'`;
  
  const res = await fetch(INDEXER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ address: WORLD_ADDRESS, query }]),
  });

  if (!res.ok) return null;
  
  const json = await res.json();
  const rows = json?.result?.[0];
  if (!Array.isArray(rows) || rows.length < 2) return null;
  
  const [x, y, z] = rows[1];
  return [Number(x), Number(y), Number(z)];
}

/* ---------------------- Command ---------------------- */
export class TransferFieldCommand implements CommandHandler {
  async execute(context: CommandContext, ...args: string[]): Promise<void> {
    try {
      // Parse coordinates if provided: "transferfield x y z"
      let targetPos: Vec3 | null = null;
      
      if (args.length >= 3) {
        const coords = args.map(Number);
        if (coords.length === 3 && coords.every((n: number) => !isNaN(n))) {
          targetPos = [coords[0], coords[1], coords[2]];
        }
      }

      let ff: ForceFieldInfo;
      if (targetPos) {
        console.log(`[transferfield] Getting force field info for coordinates: ${targetPos}`);
        ff = await getForceFieldInfo(targetPos);
      } else {
        console.log(`[transferfield] Getting force field info for player: ${context.address}`);
        ff = await getForceFieldInfoForPlayer(context.address);
      }

      console.log(`[transferfield] Force field info:`, {
        active: ff.active,
        forceField: ff.forceField,
        fragmentId: ff.fragmentId,
        owner: ff.owner,
        reason: ff.reason
      });

      let machine: `0x${string}`;
      let coordsForLog: Vec3 | null = null;

      if (ff.forceField !== ZERO_ENTITY_ID) {
        machine = ff.forceField;
        console.log(`[transferfield] Using existing force field entity: ${machine}`);
      } else {
        const pos = await fetchPlayerBlock(context.address);
        if (!pos) throw new Error("No position found — try 'spawn' first.");
        coordsForLog = [pos[0], pos[1] - 1, pos[2]];
        machine = encodeBlock(coordsForLog);
        console.log(`[transferfield] Using encoded block entity: ${machine} at (${coordsForLog[0]}, ${coordsForLog[1]}, ${coordsForLog[2]})`);
      }

      const sessionAddress = typeof context.sessionClient.account === 'string'
        ? context.sessionClient.account
        : context.sessionClient.account.address;

      const eoaAddress = (context.sessionClient as any).userAddress || context.address;

      const DEFAULT_PROGRAM_SYSTEM_ID = resourceToHex({
        type: "system",
        namespace: "dfprograms_1",
        name: "DefaultProgramSy",
      }) as `0x${string}`;

      // Get the groupId for this machine entity
      const entityQuery = `SELECT "groupId" FROM "dfprograms_1__EntityAccessGrou" WHERE "entityId"='${machine}'`;
      console.log(`[transferfield] Querying for access group: ${entityQuery}`);

      const entityRes = await fetch(INDEXER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([{ address: WORLD_ADDRESS, query: entityQuery }]),
      });

      let groupId: string | null = null;
      if (entityRes.ok) {
        const entityJson = await entityRes.json();
        const entityRows = entityJson?.result?.[0];
        if (Array.isArray(entityRows) && entityRows.length >= 2) {
          groupId = entityRows[1][0] as string;
        }
      }

      if (!groupId) {
        throw new Error("No access group found for this force field. Cannot transfer ownership.");
      }

      console.log(`[transferfield] Found group: ${groupId}`);

      // Check current owner
      const ownerQuery = `SELECT "owner" FROM "dfprograms_1__AccessGroupOwner" WHERE "groupId"='${groupId}'`;
      console.log(`[transferfield] Checking group owner: ${ownerQuery}`);

      const ownerRes = await fetch(INDEXER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([{ address: WORLD_ADDRESS, query: ownerQuery }]),
      });

      let currentOwner: string | null = null;
      if (ownerRes.ok) {
        const ownerJson = await ownerRes.json();
        const ownerRows = ownerJson?.result?.[0];
        if (Array.isArray(ownerRows) && ownerRows.length >= 2) {
          currentOwner = ownerRows[1][0] as string;
        }
      }

      const sessionBytes32 = encodePlayerEntityId(sessionAddress);
      const eoaBytes32 = encodePlayerEntityId(eoaAddress);

      // Verify session account is the current owner
      if (currentOwner !== sessionBytes32) {
        throw new Error(`Session account is not the owner of this force field. Current owner: ${currentOwner}, Session: ${sessionBytes32}`);
      }

      // Check if EOA is already the owner
      if (currentOwner === eoaBytes32) {
        window.dispatchEvent(new CustomEvent<string>("worker-log", {
          detail: `✅ EOA address is already the owner of this force field (group ${groupId}). No transfer needed.`,
        }));
        return;
      }

      const groupIdNumeric = Number(groupId);
      const callerBytes32 = encodePlayerEntityId(sessionAddress);

      // Transfer ownership using setOwner function
      const setOwnerCallData = encodeFunctionData({
        abi: [{
          type: "function",
          name: "setOwner",
          inputs: [
            { name: "caller", type: "bytes32" },
            { name: "groupId", type: "uint256" },
            { name: "newOwner", type: "bytes32" }
          ],
          outputs: [],
          stateMutability: "nonpayable"
        }],
        functionName: "setOwner",
        args: [callerBytes32, BigInt(groupIdNumeric), eoaBytes32],
      });

      const data = encodeFunctionData({
        abi: IWorldAbi,
        functionName: "call",
        args: [DEFAULT_PROGRAM_SYSTEM_ID, setOwnerCallData],
      });

      const txHash = await context.sessionClient.sendTransaction({
        to: WORLD_ADDRESS,
        data,
        gas: 300_000n,
      }) as `0x${string}`;

      const targetTxt = coordsForLog
        ? `machine at (${coordsForLog[0]}, ${coordsForLog[1]}, ${coordsForLog[2]})`
        : `force field station ${machine}`;

      window.dispatchEvent(new CustomEvent<string>("worker-log", {
        detail: `👑 Transferred ownership of ${targetTxt} (group ${groupId}) from session to EOA address. Tx: ${txHash}`,
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
      window.dispatchEvent(new CustomEvent("worker-log", { detail: `❌ transferfield failed: ${msg}` }));
    }
  }
}
