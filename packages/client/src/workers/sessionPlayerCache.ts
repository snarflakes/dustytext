interface CachedPlayer {
  entityId: string;
  eoaAddress: string;
  x: number;
  y: number;
  z: number;
  energy: number;
  isAlive: boolean;
  scannedAt: number;
}

class SessionPlayerCache {
  private players = new Map<string, CachedPlayer>();
  private positionIndex = new Map<string, string[]>(); // "x,y,z" -> entityIds[]
  private scanCenter: { x: number; y: number; z: number } | null = null;
  private scanRadius = 0;
  private lastScanTime = 0;

  addScanResults(centerX: number, centerY: number, centerZ: number, radius: number, players: CachedPlayer[]) {
    // Clear old data
    this.players.clear();
    this.positionIndex.clear();
    
    // Store new scan parameters
    this.scanCenter = { x: centerX, y: centerY, z: centerZ };
    this.scanRadius = radius;
    this.lastScanTime = Date.now();
    
    // Index all players
    for (const player of players) {
      this.players.set(player.entityId, player);
      
      const posKey = `${player.x},${player.y},${player.z}`;
      if (!this.positionIndex.has(posKey)) {
        this.positionIndex.set(posKey, []);
      }
      this.positionIndex.get(posKey)!.push(player.entityId);
    }
    
    console.log(`[SessionCache] Cached ${players.length} players from scan`);
  }

  getPlayersAt(x: number, y: number, z: number): CachedPlayer[] {
    // Only return data if this position was within our scan area
    if (!this.isPositionInScanArea(x, y, z)) {
      return [];
    }
    
    const posKey = `${x},${y},${z}`;
    const entityIds = this.positionIndex.get(posKey) || [];
    return entityIds.map(id => this.players.get(id)!).filter(Boolean);
  }

  private isPositionInScanArea(x: number, y: number, z: number): boolean {
    if (!this.scanCenter) return false;
    
    const distance = Math.sqrt(
      (x - this.scanCenter.x) ** 2 + 
      (y - this.scanCenter.y) ** 2 + 
      (z - this.scanCenter.z) ** 2
    );
    
    return distance <= this.scanRadius;
  }

  hasScanData(): boolean {
    return this.players.size > 0;
  }

  getScanInfo(): { center: { x: number; y: number; z: number } | null; radius: number; playerCount: number; scanTime: number } {
    return {
      center: this.scanCenter,
      radius: this.scanRadius,
      playerCount: this.players.size,
      scanTime: this.lastScanTime
    };
  }

  clear() {
    this.players.clear();
    this.positionIndex.clear();
    this.scanCenter = null;
    this.scanRadius = 0;
    this.lastScanTime = 0;
  }
}

export const sessionPlayerCache = new SessionPlayerCache();
