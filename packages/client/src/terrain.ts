import { pad, toBytes, type PublicClient } from "viem";
import { keccak256, getAddress } from "viem";
import { bytesToHex } from "viem";
import type { Hex } from "viem";

export const CHUNK_SIZE = 16;
const DATA_OFFSET = 1;
const EXPECTED_VERSION = 0x00;
const VERSION_PADDING = 1;
const BIOME_PADDING = 1;
const SURFACE_PADDING = 1;

export type ReadonlyVec3 = Readonly<Vec3>;
type Vec3 = [number, number, number];

function voxelToChunkPos([x, y, z]: Vec3): Vec3 {
  return [
    Math.floor(x / CHUNK_SIZE),
    Math.floor(y / CHUNK_SIZE),
    Math.floor(z / CHUNK_SIZE),
  ];
}
export function packVec3([x, y, z]: ReadonlyVec3): bigint {
  const ux = BigInt(x >>> 0);
  const uy = BigInt(y >>> 0);
  const uz = BigInt(z >>> 0);
  return (ux << 64n) | (uy << 32n) | uz;
}



function getChunkSalt(coord: Vec3): Hex {
  return bytesToHex(pad(toBytes(packVec3(coord)), { size: 32 }));
}

function getCreate3Address(opts: {
  from: Hex;
  salt: Hex;
  proxyInitCodeHash?: Hex;
}): Hex {
  const DEFAULT_CREATE3_PROXY_INITCODE_HASH: Hex =
    "0x21c35dbe1b344a2488cf3321d6ce542f8e9f305544ff09e4993a62319a497c1f";

  const proxy = keccak256(
    `0xff${opts.from.slice(2)}${opts.salt.slice(2)}${(opts.proxyInitCodeHash ?? DEFAULT_CREATE3_PROXY_INITCODE_HASH).slice(2)}`
  ).slice(-40);

  const proxyAddress = getAddress(`0x${proxy}`);
  
  const finalAddress = keccak256(
    `0xd6${"94"}${proxyAddress.slice(2)}${"01"}`
  ).slice(-40);

  return getAddress(`0x${finalAddress}`);
}

function mod(a: number, b: number): number {
  return ((a % b) + b) % b;
}

function getRelativeCoord([x, y, z]: Vec3): Vec3 {
  return [mod(x, CHUNK_SIZE), mod(y, CHUNK_SIZE), mod(z, CHUNK_SIZE)];
}

function getBlockIndex([x, y, z]: Vec3): number {
  const [rx, ry, rz] = getRelativeCoord([x, y, z]);
  return (
    VERSION_PADDING +
    BIOME_PADDING +
    SURFACE_PADDING +
    rx * CHUNK_SIZE ** 2 +
    ry * CHUNK_SIZE +
    rz
  );
}

function readBytes1(bytecode: string, offset: number): number {
  const start = 2 + (DATA_OFFSET + offset) * 2;
  const hexByte = bytecode.slice(start, start + 2);
  if (hexByte.length !== 2) throw new Error("ReadOutOfBounds");
  return Number.parseInt(hexByte, 16);
}

async function getChunkBytecode(
  publicClient: PublicClient,
  worldAddress: Hex,
  chunkCoord: Vec3
): Promise<string> {
  const chunkPointer = getCreate3Address({
    from: worldAddress,
    salt: getChunkSalt(chunkCoord),
  });

  const bytecode = await publicClient.getCode({ address: chunkPointer });
  if (!bytecode || bytecode === "0x") {
    throw new Error("Chunk not explored");
  }

  const version = readBytes1(bytecode, 0);
  if (version !== EXPECTED_VERSION) {
    throw new Error("Unsupported chunk encoding version");
  }

  return bytecode;
}

export async function getTerrainBlockType(
  publicClient: PublicClient,
  worldAddress: Hex,
  [x, y, z]: Vec3
): Promise<number> {
  const chunkCoord = voxelToChunkPos([x, y, z]);
  const bytecode = await getChunkBytecode(publicClient, worldAddress, chunkCoord);
  return readBytes1(bytecode, getBlockIndex([x, y, z]));
}