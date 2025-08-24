// packages/client/src/CoordLinkWithPreview.tsx
import React, { useMemo, useRef, useState, useEffect } from "react";

type WorldVec3 = { x: number; y: number; z: number };

type Props = {
  pos: WorldVec3;
  zoom?: 0 | 1 | 2 | 3 | 4;
  label?: string;
  className?: string;
  previewSizePx?: number;
};

const TILE_SIZE = 512;
const BASE = "https://alpha.dustproject.org/api/assets/map/surface";

function worldToTile(x: number, z: number, zoom: number) {
  const zClamped = Math.max(0, Math.min(4, Math.floor(zoom)));
  const scale = 2 ** zClamped; // CRS.Simple scale
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

/** Open a new tab and write a tiny HTML viewer that renders the tile inline. */
function openViewer(url: string, title: string) {
  const win = window.open("", "_blank", "noopener,noreferrer");
  if (!win) {
    // Popup blocked: fall back to navigating current tab (may trigger download)
    window.location.assign(url);
    return;
  }
  const html = `<!doctype html>
<meta charset="utf-8" />
<title>${title}</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  html,body{height:100%}
  body{margin:0;background:#111;color:#eee;display:flex;align-items:center;justify-content:center;font:14px system-ui}
  .wrap{position:relative}
  img{max-width:98vw;max-height:96vh;display:block;outline:1px solid #333;background:#000}
  .err{position:absolute;inset:0;display:none;align-items:center;justify-content:center;text-align:center;padding:16px}
  .meta{position:fixed;bottom:8px;left:8px;opacity:.7;font-size:12px}
</style>
<div class="wrap">
  <img id="tile" src="${url}" alt="tile" referrerpolicy="no-referrer" crossorigin="anonymous"
       onerror="document.getElementById('err').style.display='flex'">
  <div id="err" class="err">
    <div>Failed to load tile.<br><br><code>${url}</code><br><br>Check zoom (0–4) and indices.</div>
  </div>
</div>
<div class="meta">${url}</div>`;
  win.document.write(html);
  win.document.close();
}

export function CoordLinkWithPreview({
  pos,
  zoom = 4,
  label,
  className,
  previewSizePx = 256,
}: Props) {
  const { x, y, z } = pos;

  const url = useMemo(() => tileUrl(x, z, zoom), [x, z, zoom]);

  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const ref = useRef<HTMLAnchorElement | null>(null);

  useEffect(() => {
    if (!open || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const m = 10;
    let left = window.scrollX + r.right + m;
    let top = window.scrollY + r.top;
    const maxLeft = window.scrollX + window.innerWidth - (previewSizePx + m);
    if (left > maxLeft) left = Math.max(window.scrollX + m, window.scrollX + r.left - previewSizePx - m);
    const maxTop = window.scrollY + window.innerHeight - (previewSizePx + m);
    if (top > maxTop) top = maxTop;
    setCoords({ top, left });
  }, [open, previewSizePx]);

  const linkText = label ?? `(${x}, ${y}, ${z})`;

  return (
    <>
      <a
        ref={ref}
        href="#"
        onClick={(e) => {
          e.preventDefault();
          openViewer(url, `Tile (${x},${y},${z}) z=${zoom}`);
        }}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className={className ?? "text-sky-400 hover:underline whitespace-nowrap"}
        title="Click to open tile"
      >
        {linkText}
      </a>

      {open && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-[1000] rounded-xl shadow-2xl ring-1 ring-black/10 bg-black/60 backdrop-blur"
          style={{ top: coords.top, left: coords.left, width: previewSizePx, height: previewSizePx }}
        >
          <img
            src={url}
            alt="tile preview"
            width={previewSizePx}
            height={previewSizePx}
            referrerPolicy="no-referrer"
            crossOrigin="anonymous"
            onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
              e.currentTarget.style.opacity = "0.15";
              e.currentTarget.alt = "Failed to load tile";
            }}
            style={{ display: "block", objectFit: "contain", borderRadius: 12 }}
          />
        </div>
      )}
    </>
  );
}

export default CoordLinkWithPreview;
