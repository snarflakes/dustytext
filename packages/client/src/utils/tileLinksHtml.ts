const TILE_SIZE = 512;
const BASE = "https://alpha.dustproject.org/api/assets/map/surface";

function worldToTile(x: number, z: number, zoom: number) {
  const zClamped = Math.max(0, Math.min(4, Math.floor(zoom)));
  const scale = 2 ** zClamped;
  const pixelX = x * scale;
  const pixelY = z * scale;
  const tileX = Math.floor(pixelX / TILE_SIZE);
  const tileY = Math.floor(pixelY / TILE_SIZE);
  return { tileX, tileY, zoom: zClamped };
}

function tileUrl(x: number, z: number, zoom: number) {
  const { tileX, tileY, zoom: zc } = worldToTile(x, z, zoom);
  return `${BASE}/${tileX}/${tileY}/${zc}/tile`;
}

export function createCoordLinkHTML(x: number, y: number, z: number, zoom: number = 1): string {
  const url = tileUrl(x, z, zoom);
  return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-sky-400 hover:underline whitespace-nowrap" title="Click to download tile image">(${x}, ${y}, ${z})</a>`;
}

export function createCoordOnclickHTML(x: number, y: number, z: number, zoom: number = 1): string {
  const url = tileUrl(x, z, zoom);
  const filename = `tile_${x}_${y}_${z}_z${zoom}.png`;
  
  return `<span class="text-sky-400 hover:underline whitespace-nowrap cursor-pointer" title="Click to download tile, you will have to SAVE or open as PNG" onclick="
    const a = document.createElement('a');
    a.href = '${url}';
    a.download = '${filename}';
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  ">(${x}, ${y}, ${z})</span>`;
}


