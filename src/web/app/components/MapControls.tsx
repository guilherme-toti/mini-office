import { messages } from '../../i18n/index.ts';
import { Button } from './Button.tsx';

interface MapControlsProps {
  showNames: boolean;
  autoFit: boolean;
  onZoom: (direction: 1 | -1) => void;
  onFit: () => void;
  onToggleNames: () => void;
}

/** A filled or empty box, so a toggle's state never depends on color alone. */
function Check({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-block size-3 rounded-sm border-2 border-current ${on ? 'bg-current' : ''}`}
    />
  );
}

export function MapControls({
  showNames,
  autoFit,
  onZoom,
  onFit,
  onToggleNames,
}: MapControlsProps) {
  return (
    <div className="panel pointer-events-auto flex items-center gap-1 p-1.5">
      <Button
        variant="ghost"
        className="size-10 px-0 text-xl"
        aria-label={messages.controls.zoomOut}
        onClick={() => onZoom(-1)}
      >
        <span aria-hidden>−</span>
      </Button>
      <Button
        variant="ghost"
        className="size-10 px-0 text-xl"
        aria-label={messages.controls.zoomIn}
        onClick={() => onZoom(1)}
      >
        <span aria-hidden>+</span>
      </Button>
      <Button
        variant="ghost"
        onClick={onFit}
        aria-pressed={autoFit}
        className={autoFit ? 'text-cream' : ''}
      >
        <Check on={autoFit} />
        {messages.controls.fit}
      </Button>
      <Button
        variant="ghost"
        onClick={onToggleNames}
        aria-pressed={showNames}
        className={showNames ? 'text-cream' : ''}
      >
        <Check on={showNames} />
        {messages.controls.names}
      </Button>
    </div>
  );
}
