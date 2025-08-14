import { encodeFunctionData, parseAbi } from 'viem';
import { CommandHandler, CommandContext } from './types';

const INDEXER_URL = "https://indexer.mud.redstonechain.com/q";
const WORLD_ADDRESS = '0x253eb85B3C953bFE3827CC14a151262482E7189C';
const POSITION_TABLE = "EntityPosition";

const mineAbi = parseAbi([
  'function mineUntilDestroyed(bytes32 caller, uint96 coord, uint16 toolSlot, bytes extraData) returns (bytes32)',
]);

function encodePlayerEntityId(address: string): `0x${string}` {
  const prefix = "01";
  const clean = address.toLowerCase().replace(/^0x/, "");
  return `0x${prefix}${clean.padEnd(64 - prefix.length, "0")}` as `0x${string}`;
}

function packCoord96(x: number, y: number, z: number): bigint {
  const ux = BigInt(x >>> 0);
  const uy = BigInt(y >>> 0);
  const uz = BigInt(z >>> 0);
  return (ux << 64n) | (uy << 32n) | uz;
}

export class MineCommand implements CommandHandler {
  async execute(context: CommandContext, target?: string): Promise<void> {
    try {
      const entityId = encodePlayerEntityId(context.address);

      // Get player position
      const posQuery = `SELECT "x", "y", "z" FROM "${POSITION_TABLE}" WHERE "entityId" = '${entityId}'`;
      const posRes = await fetch(INDEXER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([{ address: WORLD_ADDRESS, query: posQuery }]),
      });

      if (!posRes.ok) {
        throw new Error(`Position fetch failed: ${posRes.status}`);
      }

      const posJson = await posRes.json();
      const posRows = posJson?.result?.[0];
      if (!Array.isArray(posRows) || posRows.length < 2) {
        throw new Error("No position found. Try 'spawn' first.");
      }

      const [posCols, posVals] = posRows;
      const pos = Object.fromEntries(posCols.map((k: string, i: number) => [k, posVals[i]]));
      const { x, y, z } = { x: Number(pos.x ?? 0), y: Number(pos.y ?? 0), z: Number(pos.z ?? 0) };

      // Mine the block of the player (not the ground they're standing on)
      const mineY = y ; // Target the ground block instead of surface
      const packedCoord = packCoord96(x, mineY, z);

      console.log('Mine command - mining ground at:', { x, y: mineY, z });
      const toolSlot = 0; // Placeholder - no tool equipped for now
      
      console.log('Mine command - entityId:', entityId);
      console.log('Mine command - player position:', { x, y, z });
      console.log('Mine command - mining coord:', { x, y: mineY, z });
      console.log('Mine command - toolSlot:', toolSlot);
      
      console.log('Mine command - packed coord:', packedCoord.toString(16));
      console.log('Mine command - packed coord decimal:', packedCoord.toString());

      const data = encodeFunctionData({
        abi: mineAbi,
        functionName: 'mineUntilDestroyed',
        args: [entityId, packedCoord, toolSlot, '0x'],
      });

      const txHash = await context.sessionClient.sendTransaction({
        to: WORLD_ADDRESS,
        data,
        gas: 200000n,
      });

      const targetText = target ? ` ${target}` : '';
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: `✅ Mining${targetText} completed at (${x}, ${y}, ${z}). Tx: ${txHash}` 
      }));

      // Auto-look after mining
      await new Promise(resolve => setTimeout(resolve, 1000));
      const { getCommand } = await import('./registry');
      const lookCommand = getCommand('look');
      if (lookCommand) {
        await lookCommand.execute(context);
      }
    } catch (error) {
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: `❌ Mine failed: ${error}` 
      }));
    }
  }
}

















