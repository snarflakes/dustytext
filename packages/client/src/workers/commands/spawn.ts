import { encodeFunctionData, createPublicClient, http } from 'viem';
import { redstone } from 'viem/chains';
import { CommandHandler, CommandContext } from './types';

const SPAWN_CONTRACT = '0x253eb85b3c953bfe3827cc14a151262482e7189c';

const abi = {
  getRandomSpawnCoord: [
    {
      name: 'getRandomSpawnCoord',
      type: 'function',
      inputs: [
        { name: 'blockNumber', type: 'uint256' },
        { name: 'player', type: 'address' }
      ],
      outputs: [{ name: '', type: 'uint96' }],
      stateMutability: 'view'
    }
  ],
  randomSpawn: [
    {
      name: 'randomSpawn',
      type: 'function',
      inputs: [
        { name: 'blockNumber', type: 'uint256' },
        { name: 'spawnCoord', type: 'uint96' }
      ],
      outputs: [],
      stateMutability: 'nonpayable'
    }
  ]
};

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
          abi: abi.getRandomSpawnCoord,
          functionName: 'getRandomSpawnCoord',
          args: [blockNumber.toString(), context.address]
        });

        const data = encodeFunctionData({
          abi: abi.randomSpawn,
          functionName: 'randomSpawn',
          args: [blockNumber, spawnCoord as bigint]
        });

        const txHash = await context.sessionClient.sendTransaction({
          to: SPAWN_CONTRACT,
          data,
          gas: 200000n,
        });

        window.dispatchEvent(new CustomEvent("worker-log", { 
          detail: `You blink into existence... born unto a blockchain. You are now in the matrix. ✅ Spawn completed: ${txHash}` 
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

