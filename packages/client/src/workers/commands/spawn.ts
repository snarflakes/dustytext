import { encodeFunctionData, createPublicClient, http, Hex } from 'viem';
import { redstone } from 'viem/chains';
import { CommandHandler, CommandContext } from './types';
import IWorldAbi from "@dust/world/out/IWorld.sol/IWorld.abi";

const SPAWN_CONTRACT = '0x253eb85b3c953bfe3827cc14a151262482e7189c';

export class SpawnCommand implements CommandHandler {
  async execute(context: CommandContext): Promise<void> {
    const maxRetries = 5;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const publicClient = createPublicClient({
          chain: redstone,
          transport: http()
        });

        const currentBlock = await publicClient.getBlockNumber();
        const blockNumber = currentBlock - BigInt(2); // Keep at 2 for now

        const spawnCoord = await publicClient.readContract({
          address: SPAWN_CONTRACT,
          abi: IWorldAbi,
          functionName: 'getRandomSpawnCoord',
          args: [blockNumber, context.address as Hex]
        });

        const data = encodeFunctionData({
          abi: IWorldAbi,
          functionName: 'randomSpawn',
          args: [blockNumber, spawnCoord as bigint]
        });

        const txHash = await context.sessionClient.sendTransaction({
          to: SPAWN_CONTRACT,
          data,
          gas: 200000n,
        });

        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: `You blink into existence... born unto a blockchain. You are now in the matrix. Now type "look" or "help" to guide you.✅ Spawn completed: ${txHash}` 
        }));
        return;
        
      } catch (error) {
        if (attempt === maxRetries) {
          window.dispatchEvent(new CustomEvent("worker-log", { 
            detail: `❌ Spawn failed after ${maxRetries} attempts: ${error}` 
          }));
        } else {
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
  }
}

