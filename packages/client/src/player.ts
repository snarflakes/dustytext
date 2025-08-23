import { useEffect, useState } from "react";
const INDEXER_URL = "https://indexer.mud.redstonechain.com/q";
const WORLD_ADDRESS = "0x253eb85B3C953bFE3827CC14a151262482E7189C";
const ENERGY_TABLE = "Energy";

type Cell = string | number | null;
type Header = string[];
type Table = (Header | Cell[])[];

interface SqlApiResponse {
  result?: Table[];
}

// Helper: send SQL with timeout
async function runSql<T = SqlApiResponse>(body: unknown, timeoutMs = 8000): Promise<T> {
  const ac = new AbortController();
  const id = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(INDEXER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(id);
  }
}

// Helper: extract rows (skip header)
function rowsFrom(table?: Table): Cell[][] {
  if (!Array.isArray(table) || table.length < 2) return [];
  return table.slice(1) as Cell[][];
}

// 👥 Hook to get total living players
export function useLivingPlayersCount() {
  const [livingPlayers, setLivingPlayers] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        
        const pageSize = 500;
        let offset = 0;
        let total = 0;
        let rows: Cell[][] = [];

        do {
          const query = `
            SELECT "entityId"
            FROM "${ENERGY_TABLE}"
            WHERE "energy" > 0
            ORDER BY "entityId"
            LIMIT ${pageSize} OFFSET ${offset}
          `;

          const json = await runSql<SqlApiResponse>([{ address: WORLD_ADDRESS, query }], 8000);
          const table = json.result?.[0];
          rows = rowsFrom(table);

          total += rows.length;
          offset += pageSize;

          // small delay to avoid hammering the API
          await new Promise((r) => setTimeout(r, 50));
        } while (rows.length === pageSize);

        if (!cancelled) {
          setLivingPlayers(total);
          console.log("[players] total alive:", total);
        }
      } catch (e) {
        console.error("[players] paged count failed:", e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return livingPlayers;
}

declare global {
  interface Window {
    __entryKitSessionClient?: {
      account: `0x${string}`;
      sendTransaction?: (params: {
        to: `0x${string}`;
        data: `0x${string}`;
        gas: bigint;
      }) => Promise<string>;
      [key: string]: unknown; // Allow additional properties
    };
    ethereum?: {
      request: (args: { method: string }) => Promise<string[]>;
    };
    entryKit?: {
      getSessionClient: () => Promise<{
        account: `0x${string}`;
        sendTransaction: (params: {
          to: `0x${string}`;
          data: `0x${string}`;
          gas: bigint;
        }) => Promise<string>;
      }>;
    };
  }
}