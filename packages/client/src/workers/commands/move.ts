import { encodeFunctionData, parseAbi } from 'viem';
import { CommandHandler, CommandContext } from './types';

const WORLD_ADDRESS = '0x253eb85B3C953bFE3827CC14a151262482E7189C';

const MOVE_ABI = parseAbi([
  'function moveDirections(bytes32 caller, uint8[] directions)',
]);

function encodePlayerEntityId(address: string): `0x${string}` {
  const prefix = "01";
  const clean = address.toLowerCase().replace(/^0x/, "");
  return `0x${prefix}${clean.padEnd(64 - prefix.length, "0")}` as `0x${string}`;
}

const directionToEnum: Record<string, number> = {
  north: 0, // Direction.North
  east: 1,  // Direction.East
  south: 2, // Direction.South
  west: 3,  // Direction.West
};

export class MoveCommand implements CommandHandler {
  async execute(context: CommandContext, direction: string): Promise<void> {
    try {
      const directionEnum = directionToEnum[direction.toLowerCase()];
      if (directionEnum === undefined) {
        throw new Error(`Invalid direction: ${direction}`);
      }

      const entityId = encodePlayerEntityId(context.address);

      const data = encodeFunctionData({
        abi: MOVE_ABI,
        functionName: 'moveDirections',
        args: [entityId, [directionEnum]],
      });

      const txHash = await context.sessionClient.sendTransaction({
        to: WORLD_ADDRESS,
        data,
        gas: 100000n,
      });
      
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: `✅ Move ${direction} completed: ${txHash}` 
      }));
    } catch (error) {
      window.dispatchEvent(new CustomEvent("worker-log", { 
        detail: `❌ Move failed: ${error}` 
      }));
    }
  }
}






