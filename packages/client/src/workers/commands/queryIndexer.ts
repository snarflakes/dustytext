// queryIndexer.ts
const INDEXER_URL = "https://indexer.mud.redstonechain.com/q";
const WORLD_ADDRESS = "0x253eb85B3C953bFE3827CC14a151262482E7189C";

type IndexerRow = unknown[];

export async function queryIndexer(sql: string, tag?: string): Promise<IndexerRow[]> {
  // Some indexers require lowercase address; harmless even if not.
  const address = WORLD_ADDRESS.toLowerCase();

  // Small backoff for 500s
  const attempt = async () => {
    const res = await fetch(INDEXER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ address, query: sql }]),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} — ${text || "no body"} — SQL(${tag || "query"}): ${sql}`);
    }
    const json = await res.json();
    const table = json?.result?.[0];
    if (!Array.isArray(table)) {
      throw new Error(`Indexer payload not a table — SQL(${tag || "query"}): ${sql}`);
    }
    return table;
  };

  // retry 500/502/503/504 a couple times
  for (let i = 0; i < 3; i++) {
    try {
      return await attempt();
    } catch (e: unknown) {
      const msg = String(e);
      if (/HTTP 5\d\d/.test(msg) && i < 2) {
        await new Promise(r => setTimeout(r, 250 * (i + 1)));
        continue;
      }
      throw e;
    }
  }
  throw new Error("unreachable");
}
