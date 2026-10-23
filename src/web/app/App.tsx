import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { SourceNameSchema, type SourceName } from '../../shared/protocol.ts';
import { OfficeEngine } from '../game/engine.ts';
import { messages } from '../i18n/index.ts';
import { ActivityLog } from './components/ActivityLog.tsx';
import { Button } from './components/Button.tsx';
import { MapControls } from './components/MapControls.tsx';
import { PersonCard } from './components/PersonCard.tsx';
import { TeamPanel } from './components/TeamPanel.tsx';
import { TopBar } from './components/TopBar.tsx';
import { useOfficeFeed } from './use-office-feed.ts';

const DESKTOP_QUERY = '(min-width: 1024px)';
/** Room the office keeps clear of the HUD at the sides that hold no measured bar. */
const SIDE_INSET = { desktop: { left: 16, right: 372 }, mobile: { left: 8, right: 8 } };

function initialSource(): SourceName {
  const parsed = SourceNameSchema.safeParse(
    new URLSearchParams(window.location.search).get('source'),
  );
  return parsed.success ? parsed.data : 'live';
}

function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const media = window.matchMedia(query);
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches);
}

function useNow(everyMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}

export function App() {
  const [engine] = useState(() => new OfficeEngine());
  const [source, setSource] = useState<SourceName>(initialSource);
  const [sheetOpen, setSheetOpen] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const hud = useSyncExternalStore(engine.subscribe, engine.getHud);
  const status = useOfficeFeed(engine, source);
  const now = useNow(1000);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    engine.mount(canvas);
    return () => {
      engine.destroy();
    };
  }, [engine]);

  const headerRef = useRef<HTMLElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const stackRef = useRef<HTMLDivElement>(null);
  const cardOpen = hud.selectedId !== null;
  useEffect(() => {
    const header = headerRef.current;
    const footer = footerRef.current;
    const stack = stackRef.current;
    if (!header || !footer || !stack) return;
    // The top bar wraps to more rows on narrow screens; fit the office below whatever it takes.
    const update = () => {
      const fit = {
        ...SIDE_INSET[desktop ? 'desktop' : 'mobile'],
        top: header.offsetHeight,
        bottom: footer.offsetHeight + 16,
      };
      // Centring on someone also clears their card: beside it on desktop, above it on phones.
      const focus = desktop
        ? { ...fit, left: cardOpen ? stack.offsetWidth + 32 : fit.left }
        : { ...fit, bottom: stack.offsetHeight + 16 };
      engine.setInsets(fit, focus);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(header);
    observer.observe(footer);
    observer.observe(stack);
    return () => {
      observer.disconnect();
    };
  }, [engine, desktop, cardOpen]);

  const changeSource = (next: SourceName) => {
    const url = new URL(window.location.href);
    if (next === 'live') url.searchParams.delete('source');
    else url.searchParams.set('source', next);
    window.history.replaceState(null, '', url);
    setSource(next);
  };

  const focus = (id: string) => {
    engine.focus(id);
    setSheetOpen(false);
  };

  const selected = hud.people.find((person) => person.id === hud.selectedId);
  const panel = (
    <TeamPanel
      people={hud.people}
      rooms={hud.rooms}
      now={now}
      selectedId={hud.selectedId}
      source={source}
      onSelect={focus}
      onTryDemo={() => changeSource('demo')}
    />
  );
  const controls = (
    <MapControls
      showNames={hud.showNames}
      autoFit={hud.autoFit}
      onZoom={(direction) => engine.zoom(direction)}
      onFit={() => engine.fit()}
      onToggleNames={() => engine.toggleNames()}
    />
  );

  return (
    <main className="relative h-dvh w-full overflow-hidden select-none">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 size-full cursor-grab"
        aria-label={messages.app.title}
      />

      <TopBar
        headerRef={headerRef}
        status={status}
        source={source}
        people={hud.people}
        onSourceChange={changeSource}
        onFocus={focus}
      />

      {desktop ? (
        <>
          <aside className="panel absolute top-20 right-4 bottom-4 flex w-[340px] flex-col overflow-hidden">
            <h2 className="border-b-2 border-ink bg-panel-raised px-4 py-2 text-base font-bold text-cream">
              {messages.panel.team}
            </h2>
            <div className="min-h-0 flex-1 overflow-y-auto">{panel}</div>
          </aside>
          <div
            ref={stackRef}
            className="pointer-events-none absolute bottom-4 left-4 flex w-[min(420px,calc(100%-400px))] flex-col gap-3"
          >
            {/* The card tells the selected story; the log would only crowd it. */}
            {!selected ? <ActivityLog log={hud.log} now={now} /> : null}
            {selected ? (
              <div className="pointer-events-auto">
                <PersonCard
                  person={selected}
                  people={hud.people}
                  now={now}
                  onClose={() => engine.select(null)}
                  onFocus={focus}
                />
              </div>
            ) : null}
            <div ref={footerRef} className="flex">
              {controls}
            </div>
          </div>
        </>
      ) : (
        <div
          ref={stackRef}
          className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-2 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]"
        >
          {!sheetOpen && !selected ? <ActivityLog log={hud.log.slice(0, 1)} now={now} /> : null}
          {selected && !sheetOpen ? (
            <div className="pointer-events-auto">
              <PersonCard
                person={selected}
                people={hud.people}
                now={now}
                onClose={() => engine.select(null)}
                onFocus={focus}
              />
            </div>
          ) : null}
          {sheetOpen ? (
            <section
              className="panel pointer-events-auto flex max-h-[60dvh] flex-col overflow-hidden"
              aria-label={messages.panel.team}
            >
              <div className="flex items-center justify-between border-b-2 border-ink bg-panel-raised px-3 py-1">
                <h2 className="text-base font-bold text-cream">{messages.panel.team}</h2>
                <Button variant="ghost" onClick={() => setSheetOpen(false)}>
                  {messages.panel.hide}
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">{panel}</div>
            </section>
          ) : null}
          <div ref={footerRef} className="flex items-center justify-between gap-2">
            {controls}
            {!sheetOpen ? (
              <Button
                variant="quiet"
                className="pointer-events-auto"
                onClick={() => setSheetOpen(true)}
              >
                {messages.panel.show}
              </Button>
            ) : null}
          </div>
        </div>
      )}
    </main>
  );
}
