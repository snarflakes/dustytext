import { type Hex, type PublicClient, pad, toBytes, keccak256, getAddress, bytesToHex } from "viem";
import { CHUNK_SIZE, packVec3 } from "./terrain";

type Vec3 = [number, number, number];
type ReadonlyVec3 = Readonly<Vec3>;

const bytecodeCache = new Map<string, string>();
const DATA_OFFSET = 1;
const EXPECTED_VERSION = 0x00;

function voxelToChunkPos([x, y, z]: Vec3): Vec3 {
  return [
    Math.floor(x / CHUNK_SIZE),
    Math.floor(y / CHUNK_SIZE),
    Math.floor(z / CHUNK_SIZE),
  ];
}

function getChunkSalt(coord: ReadonlyVec3): Hex {
  return bytesToHex(pad(toBytes(packVec3(coord)), { size: 32 }));
}

function getCreate3Address(opts: { from: Hex; salt: Hex }): Hex {
  const DEFAULT_CREATE3_PROXY_INITCODE_HASH: Hex =
    "0x21c35dbe1b344a2488cf3321d6ce542f8e9f305544ff09e4993a62319a497c1f";

  const proxy = keccak256(
    `0xff${opts.from.slice(2)}${opts.salt.slice(2)}${DEFAULT_CREATE3_PROXY_INITCODE_HASH.slice(2)}`
  ).slice(-40);

  const proxyAddress = getAddress(`0x${proxy}`);
  
  const finalAddress = keccak256(
    `0xd6${"94"}${proxyAddress.slice(2)}${"01"}`
  ).slice(-40);

  return getAddress(`0x${finalAddress}`);
}

function getCacheKey(worldAddress: Hex, [x, y, z]: ReadonlyVec3): string {
  return `${worldAddress}:${x},${y},${z}`;
}

function readBytes1(bytecode: string, offset: number): number {
  if (!bytecode || bytecode === "0x")
    throw new Error("InvalidPointer: no bytecode found");

  const start = 2 + (DATA_OFFSET + offset) * 2;
  const hexByte = bytecode.slice(start, start + 2);
  if (hexByte.length !== 2) throw new Error("ReadOutOfBounds");

  return Number.parseInt(hexByte, 16);
}

async function getChunkBytecode(
  publicClient: PublicClient,
  worldAddress: Hex,
  chunkCoord: ReadonlyVec3,
): Promise<string> {
  const chunkPointer = getCreate3Address({
    from: worldAddress,
    salt: getChunkSalt(chunkCoord),
  });

  const bytecode = await publicClient.getCode({ address: chunkPointer });
  if (!bytecode) throw new Error("Chunk not explored");

  const version = readBytes1(bytecode, 0);
  if (version !== EXPECTED_VERSION) {
    throw new Error("Unsupported chunk encoding version");
  }

  return bytecode;
}

export async function getBiome(
  worldAddress: Hex,
  publicClient: PublicClient,
  [x, y, z]: Vec3,
): Promise<number> {
  const chunkCoord = voxelToChunkPos([x, y, z]);
  const cacheKey = getCacheKey(worldAddress, chunkCoord);

  let bytecode = bytecodeCache.get(cacheKey);
  if (!bytecode) {
    bytecode = await getChunkBytecode(publicClient, worldAddress, chunkCoord);
    bytecodeCache.set(cacheKey, bytecode);
  }

  return readBytes1(bytecode, 1); // Biome is at offset 1
}
