import { Dir, ScanSummary } from './types';
import { extractLatestScanFromLog } from '../scans/digest';

// Cache for storing recent scan results
const scanCache = new Map<Dir, ScanSummary>();

export function cacheScanSummary(summary: ScanSummary): void {
  scanCache.set(summary.dir, summary);
}

export function getCachedScan(dir: Dir): ScanSummary | undefined {
  return scanCache.get(dir);
}

export function clearScanCache(): void {
  scanCache.clear();
}

// Extract and cache scan from recent log output
export function updateScanFromLog(logLines: string[], dir?: Dir): ScanSummary | undefined {
  const summary = extractLatestScanFromLog(logLines, dir);
  if (summary) {
    cacheScanSummary(summary);
  }
  return summary;
}

// Get all cached scans for debugging
export function getAllCachedScans(): Map<Dir, ScanSummary> {
  return new Map(scanCache);
}
