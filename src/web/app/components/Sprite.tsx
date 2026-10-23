import { useEffect, useRef } from 'react';
import { drawAvatar } from '../../game/gfx/avatar-art.ts';
import { drawStatusBubble, type StatusIcon } from '../../game/gfx/overlay-art.ts';
import type { Pixmap } from '../../game/gfx/pixmap.ts';
import type { Look } from '../../game/sim/persona.ts';
import { toCanvas } from '../../game/render/sprites.ts';

interface Crop {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Shows a crop of a pixel-art sprite at a whole-number zoom. */
function PixmapImage({
  pm,
  crop,
  zoom,
  label,
}: {
  pm: Pixmap;
  crop: Crop;
  zoom: number;
  label?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(
      toCanvas(pm),
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      crop.width,
      crop.height,
    );
  }, [pm, crop.x, crop.y, crop.width, crop.height]);
  return (
    <canvas
      ref={ref}
      width={crop.width}
      height={crop.height}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className="pixelated shrink-0"
      style={{ width: crop.width * zoom, height: crop.height * zoom }}
    />
  );
}

const portraits = new Map<string, Pixmap>();
const glyphs = new Map<StatusIcon, Pixmap>();

export function Portrait({ look, badge, zoom = 2 }: { look: Look; badge: boolean; zoom?: number }) {
  const key = `${JSON.stringify(look)}|${badge}`;
  let pm = portraits.get(key);
  if (!pm) {
    pm = drawAvatar({ look, view: 'front', pose: 'stand', frame: 0, badge });
    portraits.set(key, pm);
  }
  return <PixmapImage pm={pm} crop={{ x: 3, y: 0, width: 20, height: 30 }} zoom={zoom} />;
}

export function StatusGlyph({
  icon,
  zoom = 2,
  label,
}: {
  icon: StatusIcon;
  zoom?: number;
  label?: string;
}) {
  let pm = glyphs.get(icon);
  if (!pm) {
    pm = drawStatusBubble(icon);
    glyphs.set(icon, pm);
  }
  return (
    <PixmapImage
      pm={pm}
      crop={{ x: 0, y: 0, width: pm.width, height: pm.height - 3 }}
      zoom={zoom}
      label={label}
    />
  );
}
