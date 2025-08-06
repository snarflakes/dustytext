import { encodeFunctionData, parseAbi } from 'viem';
import { CommandHandler, CommandContext } from './types';

const WORLD_ADDRESS = '0x253eb85B3C953bFE3827CC14a151262482E7189C';

const MOVE_ABI = parseAbi([
  'function move(address caller, uint256 packedDirections)',
]);

const directionToContractIndex: Record<string, number> = {
  north: 5, // -Z
  south: 4, // +Z
  east: 0,  // +X
  west: 1,  // -X
  up: 2,    // +Y
  down: 3,  // -Y
};

function packDirections(directions: string[]): bigint {
  if (directions.length > 50) {
    throw new Error('Too many directions: max 50 allowed');
  }

  let packed = BigInt(0);

  for (let i = 0; i < directions.length; i++) {
    const dirIdx = directionToContractIndex[directions[i]];
    if (dirIdx === undefined) {
      throw new Error(`Invalid direction: ${directions[i]}`);
    }
    packed |= BigInt(dirIdx) << BigInt(i * 5);
  }

  packed |= BigInt(directions.length) << 250n;
  return packed;
}

export class MoveCommand implements CommandHandler {
  async execute(context: CommandContext, direction: string): Promise<void> {
    try {
      const packed = packDirections([direction]);

      const data = encodeFunctionData({
        abi: MOVE_ABI,
        functionName: 'move',
        args: [context.address as `0x${string}`, packed],
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




