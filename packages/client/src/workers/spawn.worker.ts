// src/commands/spawn.worker.ts
import {
  createPublicClient,
  http,
  encodeFunctionData
} from 'viem';
import { redstone } from 'viem/chains';

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

const MAX_RETRIES = 5;
const BLOCK_WINDOW = 20;
const BLOCK_OFFSET = 2;
const RETRY_DELAY_MS = 1000;

const log = (msg: string) => postMessage({ type: 'log', message: msg });

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

let playerAddress = '0x0000000000000000000000000000000000000000';

self.onmessage = (event) => {
  if (event.data?.type === 'init' && event.data.address) {
    playerAddress = event.data.address;
    spawn().catch(err => {
      postMessage({
        type: 'done',
        message: `Spawn error: ${(err as Error).message}`,
        status: 'error'
      });
    });
  } else if (event.data?.type === 'transaction-success') {
    log(`✅ Transaction successful: ${event.data.txHash}`);
    log(`🔍 Triggering look command...`);
    postMessage({
      type: 'trigger',
      command: 'look'
    });
    postMessage({
      type: 'done',
      message: 'Spawn transaction submitted',
      status: 'success'
    });
  } else if (event.data?.type === 'transaction-error') {
    postMessage({ 
      type: 'done', 
      message: `Spawn failed: ${event.data.error}`, 
      status: 'error' 
    });
  }
};

async function spawn() {
  const publicClient = createPublicClient({
    chain: redstone,
    transport: http()
  });

  log(`👤 Player: ${playerAddress}`);
  log(`🔗 Getting current block...`);

  let attempt = 1;
  let success = false;

  while (attempt <= MAX_RETRIES && !success) {
    log(`🚀 Attempt ${attempt} of ${MAX_RETRIES}`);

    try {
      const currentBlock = await publicClient.getBlockNumber();
      log(`📦 Current block: ${currentBlock}`);
      
      const blockNumber = currentBlock - BigInt(BLOCK_OFFSET);
      const latestBlock = await publicClient.getBlockNumber();

      const blockDiff = Number(latestBlock - blockNumber);
      if (blockDiff > BLOCK_WINDOW || blockDiff < 0) {
        log(`⚠️ Block ${blockNumber} invalid (diff: ${blockDiff}). Retrying...`);
        attempt++;
        await delay(RETRY_DELAY_MS);
        continue;
      }

      log(`🎯 Getting spawn coordinates...`);
      let spawnCoord;
      try {
        spawnCoord = await publicClient.readContract({
          address: SPAWN_CONTRACT,
          abi: abi.getRandomSpawnCoord,
          functionName: 'getRandomSpawnCoord',
          args: [blockNumber.toString(), playerAddress]
        });
        log(`📍 Spawn coord: ${spawnCoord}`);
      } catch (e) {
        log(`❌ Failed to fetch coord: ${(e as Error).message}`);
        attempt++;
        await delay(RETRY_DELAY_MS);
        continue;
      }

      log(`🔧 Encoding transaction data...`);
      const data = encodeFunctionData({
        abi: abi.randomSpawn,
        functionName: 'randomSpawn',
        args: [blockNumber, spawnCoord as bigint]
      });

      log(`🧪 Simulating transaction...`);
      try {
        await publicClient.call({
          account: playerAddress as `0x${string}`,
          to: SPAWN_CONTRACT,
          data
        });
        log(`✅ Simulation successful`);
      } catch (simErr: unknown) {
        const msg = (simErr as Error).message.toLowerCase();
        if (msg.includes("past 20 blocks")) {
          log(`⚠️ Simulation too old. Retrying...`);
          attempt++;
          await delay(RETRY_DELAY_MS);
          continue;
        }
        log(`❌ Simulation failed: ${(simErr as Error).message}`);
        throw simErr;
      }

      log(`📤 Sending transaction...`);
      
      // Send transaction data back to main thread for execution
      postMessage({ 
        type: 'transaction', 
        params: {
          to: SPAWN_CONTRACT,
          data,
          gas: 200000n,
        }
      });

      success = true;
    } catch (err) {
      log(`❌ Attempt ${attempt} failed: ${(err as Error).message}`);
      attempt++;
      if (attempt <= MAX_RETRIES) {
        await delay(RETRY_DELAY_MS);
      }
    }
  }

  if (!success) {
    postMessage({ type: 'done', message: 'Spawn failed after retries.', status: 'error' });
  }
}
