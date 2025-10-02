import { encodeFunctionData } from 'viem';
import { CommandHandler, CommandContext } from './types';
import IWorldAbi from "@dust/world/out/IWorld.sol/IWorld.abi";

const WORLD_ADDRESS = '0x253eb85b3c953bfe3827cc14a151262482e7189c' as const;

// DRAND helpers
type DrandResponse = { round: number; signature: string };

async function getLatestRound(): Promise<bigint> {
  const r = await fetch('https://api.drand.sh/v2/beacons/evmnet/rounds/latest');
  const data: DrandResponse = await r.json();
  return BigInt(data.round);
}

async function fetchDrandData(
  roundNumber: bigint
): Promise<{ signature: [bigint, bigint]; roundNumber: bigint }> {
  const r = await fetch(`https://api.drand.sh/v2/beacons/evmnet/rounds/${roundNumber}`);
  const data: DrandResponse = await r.json();
  const sig = data.signature; // 128 hex chars
  const sig1 = BigInt('0x' + sig.slice(0, 64));
  const sig2 = BigInt('0x' + sig.slice(64, 128));
  return { signature: [sig1, sig2], roundNumber: BigInt(data.round) };
}

export class SpawnCommand implements CommandHandler {
  async execute(context: CommandContext): Promise<void> {
    const maxRetries = 5;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Use any DRAND round from the last ~1 minute: try latest, then latest-1
        const latest = await getLatestRound();
        const candidateRounds = [latest, latest - 1n];

        let txHash: string | null = null;
        let lastErr: unknown = null;

        for (const round of candidateRounds) {
          try {
            const drand = await fetchDrandData(round);

            // Contract recomputes spawn from drand+sender; second arg is ignored
            const data = encodeFunctionData({
              abi: IWorldAbi,
              functionName: 'randomSpawn', // randomSpawn(DrandData drand, Vec3 spawnCoord)
              args: [drand, 0n],
            });

            txHash = await context.sessionClient.sendTransaction({
              to: WORLD_ADDRESS,
              data,
              gas: 220000n,
            });
            break; // success
          } catch (e) {
            lastErr = e;
            continue; // try next recent round
          }
        }

        if (!txHash) throw lastErr ?? new Error('Spawn failed for recent rounds');

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
