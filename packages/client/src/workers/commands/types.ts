export interface SessionClient {
  account: { address: `0x${string}` } | `0x${string}`;
  sendTransaction: (params: { to: `0x${string}`; data: `0x${string}`; gas: bigint }) => Promise<string>;
  [key: string]: unknown;
}

export interface CommandContext {
  address: string;
  sessionClient: SessionClient;
}

export interface CommandHandler {
  execute(context: CommandContext, ...args: string[]): Promise<void>;
}