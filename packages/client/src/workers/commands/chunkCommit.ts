import { encodeFunctionData } from 'viem';
import IWorldAbi from "@dust/world/out/IWorld.sol/IWorld.abi";

const CHUNK_SIZE = 16;

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

export async function initChunkCommit(
  sessionClient: { sendTransaction: (args: { to: `0x${string}`, data: `0x${string}`, gas: bigint }) => Promise<string> },
  worldAddress: `0x${string}`,
  callerEntityId: `0x${string}`,
  cx: number, cy: number, cz: number,
  gas: bigint = 150000n
) {
  const chunkPacked = packCoord96(cx, cy, cz);
  const data = encodeFunctionData({
    abi: IWorldAbi,
    functionName: 'initChunkCommit',
    args: [callerEntityId, chunkPacked],
  });
  
  try {
    return await sessionClient.sendTransaction({ to: worldAddress, data, gas });
  } catch (error) {
    const errorMessage = String(error);
    // Check for existing chunk commitment in various forms
    if (errorMessage.includes('Existing chunk commitment') || 
        errorMessage.includes('4578697374696e67206368756e6b20636f6d6d69746d656e74')) {
      // Chunk already committed, return a fake success hash
      console.log('Chunk already committed, skipping...');
      return '0x0000000000000000000000000000000000000000000000000000000000000000';
    }
    throw error;
  }
}

// Keep the old function for backward compatibility if needed
export async function chunkCommit(
  sessionClient: { sendTransaction: (args: { to: `0x${string}`, data: `0x${string}`, gas: bigint }) => Promise<string> },
  worldAddress: `0x${string}`,
  callerEntityId: `0x${string}`,
  cx: number, cy: number, cz: number,
  gas: bigint = 150000n
) {
  return initChunkCommit(sessionClient, worldAddress, callerEntityId, cx, cy, cz, gas);
}


