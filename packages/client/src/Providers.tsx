import { WagmiProvider } from "wagmi";
import { QueryClientProvider, QueryClient } from "@tanstack/react-query";
import { ReactNode } from "react";
import { defineConfig, EntryKitProvider } from "@latticexyz/entrykit/internal";
import { wagmiConfig } from "./wagmiConfig";
import { getWorldAddress } from "./common";

const queryClient = new QueryClient();

export type Props = {
  children: ReactNode;
};

export function Providers({ children }: Props) {
  const worldAddress = getWorldAddress();
  
  console.log("=== Provider Configuration ===");
  console.log("Chain ID:", 690);
  console.log("World Address:", worldAddress);
  
  // Minimal EntryKit config to start
  const entryKitConfig = defineConfig({ 
    chainId: 690, 
    worldAddress
  });
  
  console.log("EntryKit config result:", entryKitConfig);
  console.log("EntryKit config keys:", Object.keys(entryKitConfig));
  
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <EntryKitProvider config={entryKitConfig}>
          {children}
        </EntryKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}






















