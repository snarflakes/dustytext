import { encodeFunctionData, getAddress, createPublicClient, http } from "viem";
import { CommandHandler, CommandContext } from "./types";
import { redstone } from "viem/chains";
import IWorldAbi from "@dust/world/out/IWorld.sol/IWorld.abi";

const WORLD_ADDRESS = "0x253eb85B3C953bFE3827CC14a151262482E7189C";

// Enhanced ERC20 ABI with decimals
const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view"
  },
  {
    type: "function", 
    name: "transfer",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable"
  },
  {
    type: "function",
    name: "decimals",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view"
  },
  {
    type: "function",
    name: "symbol",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view"
  }
] as const;

const publicClient = createPublicClient({
  chain: redstone,
  transport: http(),
});

export class TransferCommand implements CommandHandler {
  async execute(context: CommandContext, ...args: string[]): Promise<void> {
    try {
      if (!args.length) {
        window.dispatchEvent(new CustomEvent("worker-log", {
          detail: "❌ Usage: transfer <token_address> [amount] - transfers ERC20 tokens from session to EOA"
        }));
        return;
      }

      const tokenAddress = getAddress(args[0]) as `0x${string}`;
      
      // Get session and EOA addresses
      const sessionAddress = typeof context.sessionClient.account === 'string'
        ? context.sessionClient.account
        : context.sessionClient.account.address;
      
      const eoaAddress = (context.sessionClient as any).userAddress || context.address;

      // Get token info
      const [balance, decimals, symbol] = await Promise.all([
        publicClient.readContract({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: "balanceOf",
          args: [sessionAddress as `0x${string}`]
        }),
        publicClient.readContract({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: "decimals"
        }),
        publicClient.readContract({
          address: tokenAddress,
          abi: ERC20_ABI,
          functionName: "symbol"
        })
      ]);

      if (balance === 0n) {
        window.dispatchEvent(new CustomEvent("worker-log", {
          detail: `❌ No ${symbol} tokens to transfer. Session account balance is 0.`
        }));
        return;
      }

      // Parse amount - use specified amount or full balance
      let transferAmount: bigint;
      if (args[1]) {
        // Convert user input to token units (accounting for decimals)
        const userAmount = parseFloat(args[1]);
        transferAmount = BigInt(Math.floor(userAmount * Math.pow(10, decimals)));
        
        if (transferAmount > balance) {
          const balanceFormatted = (Number(balance) / Math.pow(10, decimals)).toFixed(6);
          window.dispatchEvent(new CustomEvent("worker-log", {
            detail: `❌ Insufficient balance. Requested: ${userAmount} ${symbol}, Available: ${balanceFormatted} ${symbol}`
          }));
          return;
        }
      } else {
        // Transfer full balance
        transferAmount = balance;
      }

      const transferAmountFormatted = (Number(transferAmount) / Math.pow(10, decimals)).toFixed(6);

      // Encode transfer call
      const transferData = encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [eoaAddress as `0x${string}`, transferAmount]
      });

      const txHash = await context.sessionClient.sendTransaction({
        to: tokenAddress,
        data: transferData,
        gas: 200000n
      });

      window.dispatchEvent(new CustomEvent("worker-log", {
        detail: `💰 Transferred ${transferAmountFormatted} ${symbol} to EOA ${eoaAddress}. Tx: ${txHash}`
      }));

    } catch (error) {
      const errorMessage = String(error);
      
      // Check for insufficient balance error
      if (errorMessage.includes('0xe450d38c') || 
          errorMessage.includes('ERC20: transfer amount exceeds balance') ||
          errorMessage.includes('transfer amount exceeds balance')) {
        window.dispatchEvent(new CustomEvent("worker-log", {
          detail: `❌ Transfer failed: Insufficient token balance. The session account doesn't have enough tokens to transfer.`
        }));
        return;
      }
      
      // Check for gas limit error
      if (errorMessage.includes('0x34a44dbe') || 
          errorMessage.includes('gas limit too low')) {
        window.dispatchEvent(new CustomEvent("worker-log", {
          detail: `❌ You are out of gas. Click Orange Square in the top right corner and "Top Up" Gas.`
        }));
        return;
      }
      
      // Check for invalid token address
      if (errorMessage.includes('reverted with no reason') ||
          errorMessage.includes('call reverted without message')) {
        window.dispatchEvent(new CustomEvent("worker-log", {
          detail: `❌ Invalid token address or token contract doesn't exist at this address.`
        }));
        return;
      }
      
      // Check for approval/allowance issues
      if (errorMessage.includes('0x94280d62') ||
          errorMessage.includes('ERC20: transfer amount exceeds allowance') ||
          errorMessage.includes('transfer amount exceeds allowance')) {
        window.dispatchEvent(new CustomEvent("worker-log", {
          detail: `❌ Transfer failed: Insufficient allowance. The token may require approval first.`
        }));
        return;
      }
      
      // Check for paused token
      if (errorMessage.includes('0x9e87fac8') ||
          errorMessage.includes('Pausable: paused')) {
        window.dispatchEvent(new CustomEvent("worker-log", {
          detail: `❌ Transfer failed: Token transfers are currently paused by the contract.`
        }));
        return;
      }
      
      // Extract just the first line of error for cleaner display
      const cleanError = errorMessage.split('\n')[0].replace('UserOperationExecutionError: ', '');
      
      window.dispatchEvent(new CustomEvent("worker-log", {
        detail: `❌ Transfer failed: ${cleanError}`
      }));
    }
  }
}


