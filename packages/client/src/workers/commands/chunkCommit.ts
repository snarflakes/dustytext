import { encodeFunctionData } from 'viem';
import IWorldAbi from "@dust/world/out/IWorld.sol/IWorld.abi";

const CHUNK_SIZE = 16;
const DRAND_ROUND_INTERVAL = 30000; // 30 seconds per round in milliseconds

interface DrandResponse {
  round: number;
  randomness: string;
  signature: string;
}

export function coordToChunkCoord(x: number, y: number, z: number) {
  const cx = Math.floor(x / CHUNK_SIZE);
  const cy = Math.floor(y / CHUNK_SIZE);
  const cz = Math.floor(z / CHUNK_SIZE);
  return { cx, cy, cz };
}

export function packCoord96(x: number, y: number, z: number): bigint {
  const ux = BigInt(x >>> 0);
  const uy = BigInt(y >>> 0);
  const uz = BigInt(z >>> 0);
  return (ux << 64n) | (uy << 32n) | uz;
}

export async function getFutureRound(): Promise<bigint> {
  try {
    // Get current round
    const response = await fetch('https://api.drand.sh/v2/beacons/evmnet/rounds/latest');
    const data: DrandResponse = await response.json();
    
    // Calculate round that will be available in 1 minute (2 rounds ahead)
    const futureRound = data.round + 2;
    return BigInt(futureRound);
  } catch (error) {
    console.warn('Failed to fetch current drand round, using estimated:', error);
    // Fallback: estimate based on current time
    const now = Date.now();
    const estimatedRound = Math.floor(now / DRAND_ROUND_INTERVAL) + 2;
    return BigInt(estimatedRound);
  }
}

export async function initChunkCommit(
  sessionClient: { sendTransaction: (args: { to: `0x${string}`, data: `0x${string}`, gas: bigint }) => Promise<string> },
  worldAddress: `0x${string}`,
  callerEntityId: `0x${string}`,
  cx: number, cy: number, cz: number,
  gas: bigint = 150000n
) {
  const chunkPacked = packCoord96(cx, cy, cz);
  const futureRound = await getFutureRound();
  
  const data = encodeFunctionData({
    abi: IWorldAbi,
    functionName: 'initChunkCommit',
    args: [callerEntityId, chunkPacked, futureRound],
  });
  
  try {
    return await sessionClient.sendTransaction({ to: worldAddress, data, gas });
  } catch (error) {
    const errorMessage = String(error);
    if (errorMessage.includes('Existing chunk commitment') || 
        errorMessage.includes('4578697374696e67206368756e6b20636f6d6d69746d656e74')) {
      console.log('Chunk already committed, skipping...');
      return '0x0000000000000000000000000000000000000000000000000000000000000000';
    }
    throw error;
  }
}

async function fetchDrandDataForRound(roundNumber: bigint): Promise<{ signature: [bigint, bigint], roundNumber: bigint }> {
  try {
    const response = await fetch(`https://api.drand.sh/v2/beacons/evmnet/rounds/${roundNumber}`);
    const data: DrandResponse = await response.json();
    
    const sigHex = data.signature;
    const sig1 = BigInt('0x' + sigHex.slice(0, 64));
    const sig2 = BigInt('0x' + sigHex.slice(64, 128));
    
    return {
      signature: [sig1, sig2],
      roundNumber: BigInt(data.round)
    };
  } catch (error) {
    console.warn(`Failed to fetch drand data for round ${roundNumber}:`, error);
    return {
      signature: [0n, 0n],
      roundNumber: roundNumber
    };
  }
}

export async function fulfillChunkCommit(
  sessionClient: { sendTransaction: (args: { to: `0x${string}`, data: `0x${string}`, gas: bigint }) => Promise<string> },
  worldAddress: `0x${string}`,
  cx: number, cy: number, cz: number,
  committedRound: bigint,
  gas: bigint = 150000n
) {
  const chunkPacked = packCoord96(cx, cy, cz);
  
  // Fetch drand data for the specific committed round
  const drandData = await fetchDrandDataForRound(committedRound);
  
  const data = encodeFunctionData({
    abi: IWorldAbi,
    functionName: 'fulfillChunkCommit',
    args: [chunkPacked, drandData],
  });
  
  return await sessionClient.sendTransaction({ to: worldAddress, data, gas });
}

