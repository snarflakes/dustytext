import { WagmiProvider } from "wagmi";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { ReactNode } from "react";
import { createSyncAdapter } from "@latticexyz/store-sync/internal";
import { SyncProvider } from "@latticexyz/store-sync/react";
import { stash } from "./mud/stash";
import { defineConfig, EntryKitProvider } from "@latticexyz/entrykit/internal";
import { wagmiConfig } from "./wagmiConfig";
import { getWorldAddress, startBlock } from "./common";

const queryClient = new QueryClient();

export type Props = {
  children: ReactNode;
};

export function Providers({ children }: Props) {
  const worldAddress = getWorldAddress();
  
  // Debug: log the chainId to see what it's actually using
  // console.log("Chain ID:", chainId);
  // console.log("World Address:", worldAddress);
  
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <EntryKitProvider config={defineConfig({ chainId: 690, worldAddress })}>
          <SyncProvider
            chainId={690}
            address={worldAddress}
            startBlock={startBlock}
            adapter={createSyncAdapter({ stash })}
            indexerUrl={false}
          >
            {children}
          </SyncProvider>
        </EntryKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}









