// council.ts
import { encodeFunctionData, getAddress } from "viem";
import { CommandHandler, CommandContext } from "./types";
import IWorldAbi from "@dust/world/out/IWorld.sol/IWorld.abi";

// Same world constant you use elsewhere
const WORLD_ADDRESS = "0x253eb85B3C953bFE3827CC14a151262482E7189C";

// ✅ bytes32 System ResourceId for dustforge/DelegationSystem
// ("sy" type + namespace "dustforge" + name "DelegationSystem")
const SYSID_DUSTFORGE_DELEGATION =
  "0x737964757374666f726765000000000044656c65676174696f6e53797374656d" as const;

// Minimal ABI for the inner system call
const DELEGATION_ABI = [
  {
    type: "function",
    name: "setDelegation",
    stateMutability: "nonpayable",
    inputs: [{ name: "delegate", type: "address" }],
    outputs: [],
  },
] as const;

export class DelegateCommand implements CommandHandler {
  async execute(context: CommandContext, ...args: string[]): Promise<void> {
    const log = (detail: string) =>
      window.dispatchEvent(new CustomEvent("worker-log", { detail }));

    try {
      if (!args?.length) {
        log("❌ Usage: delegate <address> or delegate clear");
        return;
      }

      const addressArg = args[0].trim();
      
      let delegateAddr: `0x${string}`;
      let isClearing = false;
      
      if (addressArg === "clear") {
        // Clear delegation by setting to zero address
        delegateAddr = "0x0000000000000000000000000000000000000000";
        isClearing = true;
      } else {
        // Normalizes and validates the address (throws if invalid)
        delegateAddr = getAddress(addressArg) as `0x${string}`;
      }

      // 1) Encode inner system calldata: dustforge/DelegationSystem.setDelegation(address)
      const innerData = encodeFunctionData({
        abi: DELEGATION_ABI,
        functionName: "setDelegation",
        args: [delegateAddr],
      });

      // 2) Wrap with World.call(systemId, callData)  <-- only TWO args according to your IWorld ABI
      const worldCall = encodeFunctionData({
        abi: IWorldAbi,
        functionName: "call",
        args: [SYSID_DUSTFORGE_DELEGATION, innerData as `0x${string}`],
      });

      // 3) Send tx via your session client (same pattern as sleep.ts)
      const txHash = await context.sessionClient.sendTransaction({
        to: WORLD_ADDRESS,
        data: worldCall,
        gas: 300000n,
      });

      if (isClearing) {
        log(`✅ Delegation cleared. Tx: ${txHash}`);
      } else {
        log(`✅ Delegation set to ${delegateAddr}. Tx: ${txHash}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      window.dispatchEvent(
        new CustomEvent("worker-log", { detail: `❌ Delegation failed: ${msg}` })
      );
    }
  }
}
