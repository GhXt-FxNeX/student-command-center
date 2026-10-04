import { useEffect, useState } from "react";
import type { ReactNode, SVGProps } from "react";
import { Link } from "react-router-dom";
import { Card, EmptyState } from "@/components/Card";
import { Callout, FieldMessage } from "@/components/ui/Callout";
import { Button, buttonClass } from "@/components/ui/Button";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { SkeletonBar } from "@/components/ui/Skeleton";
import { PageContainer } from "@/components/ui/PageHeader";
import {
  getSpotifyPlaybackState,
  getSpotifySavedAlbums,
  getSpotifySavedShows,
  getSpotifySavedTracks,
  getSpotifyPlaylists,
  getSpotifyStatus,
  spotifyNextTrack,
  spotifyPause,
  spotifyPlay,
  spotifyPlayContext,
  spotifyPlayTrack,
  spotifyPreviousTrack,
  spotifySetVolume,
} from "@/lib/ipc/spotify";
import type {
  SpotifyAlbum,
  SpotifyPlaybackState,
  SpotifyPlaylist,
  SpotifyShow,
  SpotifyStatus,
  SpotifyTrack,
} from "@/types";

type Tab = "playlists" | "tracks" | "albums" | "podcasts";

const TAB_OPTIONS: { value: Tab; label: string }[] = [
  { value: "playlists", label: "Playlists" },
  { value: "tracks", label: "Saved Tracks" },
  { value: "albums", label: "Saved Albums" },
  { value: "podcasts", label: "Podcasts" },
];

const CARD_FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-text";

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function artistNames(artists: { name: string }[]): string {
  return artists.map((a) => a.name).join(", ");
}

// ---- Icons (local, same stroke/fill style as Pomodoro's transport icons) ----

function MusicNoteIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M8 14.5V5l8-1.5v9.5" />
      <circle cx="6" cy="14.5" r="2" />
      <circle cx="14" cy="13" r="2" />
    </svg>
  );
}

function PlayIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" {...props}>
      <path d="M6.5 4.3v11.4a.6.6 0 0 0 .92.5l9-5.7a.6.6 0 0 0 0-1l-9-5.7a.6.6 0 0 0-.92.5Z" />
    </svg>
  );
}

function PauseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" {...props}>
      <rect x="5" y="4" width="3.6" height="12" rx="1" />
      <rect x="11.4" y="4" width="3.6" height="12" rx="1" />
    </svg>
  );
}

function SkipIcon({ flip, ...props }: SVGProps<SVGSVGElement> & { flip?: boolean }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" style={flip ? { transform: "scaleX(-1)" } : undefined} {...props}>
      <path d="M4.5 4.8v10.4a.5.5 0 0 0 .8.4l7-5.2a.5.5 0 0 0 0-.8l-7-5.2a.5.5 0 0 0-.8.4Z" />
      <rect x="14" y="4.5" width="2.2" height="11" rx="1" />
    </svg>
  );
}

function VolumeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3.5 8v4h3l4 3.2V4.8L6.5 8h-3Z" />
      <path d="M13.5 7.5a3.6 3.6 0 0 1 0 5" />
    </svg>
  );
}

function ExternalIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M8 5H5.5A1.5 1.5 0 0 0 4 6.5v8A1.5 1.5 0 0 0 5.5 16h8a1.5 1.5 0 0 0 1.5-1.5V12" />
      <path d="M11 4h5v5M16 4l-6.5 6.5" />
    </svg>
  );
}

// ---- Small presentational helpers ----

/** Album/playlist/show artwork, or a neutral placeholder when Spotify
 * returned no image (some playlists and shows genuinely have none). */
function Art({ url, className = "" }: { url: string | undefined; className?: string }) {
  if (url) return <img src={url} alt="" className={`object-cover ${className}`} />;
  return (
    <div className={`flex items-center justify-center bg-bg text-text-secondary ${className}`}>
      <MusicNoteIcon className="w-1/3 h-1/3" />
    </div>
  );
}

/** "Open in Spotify" — a sibling of the main play button (not nested inside
 * it, which is invalid HTML for an <a> in a <button>), revealed on hover or
 * keyboard focus so it doesn't clutter every card. */
function ExternalLink({ url, className = "" }: { url: string | null; className?: string }) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className={`flex items-center justify-center w-7 h-7 rounded-full bg-surface/90 border border-border text-text-secondary hover:text-text opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity ${CARD_FOCUS} ${className}`}
      title="Open in Spotify"
      aria-label="Open in Spotify"
    >
      <ExternalIcon className="w-3.5 h-3.5" />
    </a>
  );
}

function MediaCard({
  imageUrl,
  title,
  subtitle,
  externalUrl,
  disabled,
  onPlay,
}: {
  imageUrl: string | undefined;
  title: string;
  subtitle: string;
  externalUrl: string | null;
  disabled: boolean;
  onPlay: () => void;
}) {
  return (
    <div className="group relative rounded-card border border-border bg-surface transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md motion-reduce:hover:translate-y-0">
      <button
        onClick={onPlay}
        disabled={disabled}
        aria-label={`Play ${title}`}
        className={`block w-full text-left p-2.5 rounded-card disabled:opacity-40 ${CARD_FOCUS}`}
      >
        <div className="relative mb-2.5">
          <Art url={imageUrl} className="w-full aspect-square rounded-md" />
          <span
            aria-hidden
            className="absolute bottom-2 right-2 w-9 h-9 rounded-full bg-accent-fill text-white flex items-center justify-center shadow-md opacity-0 translate-y-1 group-hover:opacity-100 group-hover:translate-y-0 group-focus-within:opacity-100 group-focus-within:translate-y-0 transition-all duration-150 motion-reduce:transition-none"
          >
            <PlayIcon className="w-4 h-4 ml-0.5" />
          </span>
        </div>
        <p className="text-sm font-medium truncate">{title}</p>
        <p className="text-xs text-text-secondary truncate mt-0.5">{subtitle}</p>
      </button>
      <ExternalLink url={externalUrl} className="absolute top-4 right-4" />
    </div>
  );
}

function MediaGridSkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="rounded-card border border-border bg-surface p-2.5">
          <SkeletonBar className="w-full aspect-square" />
          <SkeletonBar className="h-3.5 w-3/4 mt-3" />
          <SkeletonBar className="h-3 w-1/2 mt-2" />
        </div>
      ))}
    </div>
  );
}

function TrackListSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <SkeletonBar className="w-10 h-10 shrink-0" />
          <div className="flex-1 space-y-2">
            <SkeletonBar className="h-3.5 w-1/2" />
            <SkeletonBar className="h-3 w-1/3" />
          </div>
          <SkeletonBar className="h-3 w-8" />
        </div>
      ))}
    </div>
  );
}

/** Three little bars that bounce while a track is actually playing. */
function PlayingBars({ active }: { active: boolean }) {
  const bar = `w-0.5 rounded-full bg-accent ${active ? "animate-pulse motion-reduce:animate-none" : ""}`;
  return (
    <span className="flex items-end gap-0.5 h-3.5 shrink-0" aria-label={active ? "Playing" : "Paused"}>
      <span className={`${bar} h-2`} />
      <span className={`${bar} h-3.5`} style={{ animationDelay: "150ms" }} />
      <span className={`${bar} h-2.5`} style={{ animationDelay: "300ms" }} />
    </span>
  );
}

/** Owns its own 1s tick so the seconds counter doesn't re-render the whole
 * page (every card in the grid below) while music plays. Interpolates from
 * the last polled position — read-only, there's no seek command to fake. */
function PlaybackProgress({
  playback,
  fetchedAt,
}: {
  playback: SpotifyPlaybackState & { item: SpotifyTrack };
  fetchedAt: number;
}) {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!playback.isPlaying) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [playback.isPlaying]);

  if (playback.progressMs === null) return null;
  const duration = playback.item.durationMs;
  const elapsed = Math.min(duration, playback.progressMs + (playback.isPlaying ? Date.now() - fetchedAt : 0));
  const pct = duration > 0 ? Math.min(100, (elapsed / duration) * 100) : 0;

  return (
    <div className="flex items-center gap-2 mt-3">
      <span className="text-[11px] text-text-secondary tabular-nums w-9 text-right">{formatDuration(elapsed)}</span>
      <div
        className="flex-1 h-1 rounded-full bg-border overflow-hidden"
        role="progressbar"
        aria-label="Track progress"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={Math.round(elapsed)}
      >
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-1000 ease-linear motion-reduce:transition-none"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[11px] text-text-secondary tabular-nums w-9">{formatDuration(duration)}</span>
    </div>
  );
}

const TRANSPORT_BTN =
  "w-9 h-9 rounded-full flex items-center justify-center text-text-secondary hover:text-text hover:bg-bg transition-all duration-150 active:scale-90 motion-reduce:active:scale-100 disabled:opacity-40 disabled:pointer-events-none";

function PageShell({ children }: { children: ReactNode }) {
  return <PageContainer size="wide">{children}</PageContainer>;
}

export function SpotifyPage() {
  const [status, setStatus] = useState<SpotifyStatus | null>(null);
  const [statusLoaded, setStatusLoaded] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("playlists");

  const [playlists, setPlaylists] = useState<SpotifyPlaylist[] | null>(null);
  const [tracks, setTracks] = useState<SpotifyTrack[] | null>(null);
  const [albums, setAlbums] = useState<SpotifyAlbum[] | null>(null);
  const [shows, setShows] = useState<SpotifyShow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [playback, setPlayback] = useState<SpotifyPlaybackState | null>(null);
  const [playbackFetchedAt, setPlaybackFetchedAt] = useState(0);
  const [playbackBusy, setPlaybackBusy] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  function checkStatus() {
    setStatusLoaded(false);
    setStatusError(null);
    getSpotifyStatus()
      .then(setStatus)
      .catch((e) => setStatusError(String(e)))
      .finally(() => setStatusLoaded(true));
  }

  useEffect(() => {
    checkStatus();
  }, []);

  function loadTab(t: Tab) {
    setLoadError(null);
    const fail = (e: unknown) => setLoadError(String(e));
    if (t === "playlists") getSpotifyPlaylists().then(setPlaylists).catch(fail);
    else if (t === "tracks") getSpotifySavedTracks().then(setTracks).catch(fail);
    else if (t === "albums") getSpotifySavedAlbums().then(setAlbums).catch(fail);
    else getSpotifySavedShows().then(setShows).catch(fail);
  }

  useEffect(() => {
    if (!status?.connected) return;
    setLoadError(null);
    const needsLoad =
      (tab === "playlists" && !playlists) ||
      (tab === "tracks" && !tracks) ||
      (tab === "albums" && !albums) ||
      (tab === "podcasts" && !shows);
    if (needsLoad) loadTab(tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.connected, tab, playlists, tracks, albums, shows]);

  function refreshPlayback() {
    getSpotifyPlaybackState()
      .then((p) => {
        setPlayback(p);
        setPlaybackFetchedAt(Date.now());
      })
      .catch((e) => setPlaybackError(String(e)));
  }

  useEffect(() => {
    if (!status?.connected) return;
    refreshPlayback();
    // Playback state isn't pushed by Spotify — poll while this page is
    // open so the now-playing bar stays roughly current without the user
    // having to manually refresh after every skip/pause.
    const interval = setInterval(refreshPlayback, 10_000);
    return () => clearInterval(interval);
  }, [status?.connected]);

  async function withPlaybackBusy(action: () => Promise<void>) {
    setPlaybackBusy(true);
    setPlaybackError(null);
    try {
      await action();
      // Spotify Connect takes a beat to actually start once told to play,
      // so an immediate refresh often still shows the old state — a
      // short delay makes the now-playing bar reflect reality rather
      // than a stale snapshot.
      setTimeout(refreshPlayback, 700);
    } catch (e) {
      setPlaybackError(String(e));
    } finally {
      setPlaybackBusy(false);
    }
  }

  // ---- Connection states ----

  if (!statusLoaded) {
    return (
      <PageShell>
        <SkeletonBar className="h-7 w-28" />
        <Card>
          <div className="flex items-center gap-4">
            <SkeletonBar className="w-16 h-16 shrink-0" />
            <div className="flex-1 space-y-2">
              <SkeletonBar className="h-4 w-1/3" />
              <SkeletonBar className="h-3 w-1/4" />
            </div>
          </div>
        </Card>
        <MediaGridSkeleton />
      </PageShell>
    );
  }

  if (statusError) {
    return (
      <PageShell>
        <h1 className="text-2xl font-semibold tracking-tight">Spotify</h1>
        <Callout
          tone="error"
          title="Couldn't check your Spotify connection"
          action={
            <Button variant="secondary" onClick={checkStatus}>
              Try again
            </Button>
          }
        >
          {statusError}
        </Callout>
      </PageShell>
    );
  }

  if (!status?.connected) {
    return (
      <PageShell>
        <h1 className="text-2xl font-semibold tracking-tight">Spotify</h1>
        <Card className="py-10 flex flex-col items-center text-center">
          <span className="w-14 h-14 rounded-full bg-accent-soft text-accent-text flex items-center justify-center mb-4">
            <MusicNoteIcon className="w-7 h-7" />
          </span>
          <p className="font-medium">Spotify isn't connected</p>
          <p className="text-sm text-text-secondary mt-1 max-w-md">
            Connect your Spotify account to browse your playlists, saved tracks, albums and podcasts here, and
            control playback without switching apps.
          </p>
          <Link to="/settings/spotify" className={buttonClass("primary", "md", "mt-5")}>
            Connect in Settings
          </Link>
        </Card>
      </PageShell>
    );
  }

  // ---- Connected ----

  const nowPlaying = playback?.item ? (playback as SpotifyPlaybackState & { item: SpotifyTrack }) : null;
  const volume = playback?.device?.volumePercent;

  return (
    <PageShell>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Spotify</h1>
        {status.displayName && (
          <p className="text-text-secondary text-sm mt-0.5 flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Connected as {status.displayName}
          </p>
        )}
      </div>

      {nowPlaying ? (
        <Card className="animate-fade-slide-in">
          <div className="flex items-center gap-4 flex-wrap">
            <Art url={nowPlaying.item.album.images[0]?.url} className="w-16 h-16 rounded-md shrink-0" />
            <div className="min-w-0 flex-1 basis-48">
              <div className="flex items-center gap-2">
                <PlayingBars active={nowPlaying.isPlaying} />
                <p className="font-medium truncate">{nowPlaying.item.name}</p>
              </div>
              <p className="text-sm text-text-secondary truncate">
                {artistNames(nowPlaying.item.artists)}
                {nowPlaying.device ? ` · ${nowPlaying.device.name}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => withPlaybackBusy(spotifyPreviousTrack)}
                disabled={playbackBusy}
                className={`${TRANSPORT_BTN} ${CARD_FOCUS}`}
                aria-label="Previous track"
              >
                <SkipIcon flip className="w-4 h-4" />
              </button>
              <button
                onClick={() => withPlaybackBusy(nowPlaying.isPlaying ? spotifyPause : spotifyPlay)}
                disabled={playbackBusy}
                className={`w-11 h-11 rounded-full bg-accent-fill text-white hover:bg-accent-fill-hover active:bg-accent-fill-active flex items-center justify-center shadow-sm transition-all duration-150 active:scale-90 motion-reduce:active:scale-100 disabled:opacity-40 disabled:pointer-events-none ${CARD_FOCUS}`}
                aria-label={nowPlaying.isPlaying ? "Pause" : "Play"}
              >
                {nowPlaying.isPlaying ? <PauseIcon className="w-5 h-5" /> : <PlayIcon className="w-5 h-5 ml-0.5" />}
              </button>
              <button
                onClick={() => withPlaybackBusy(spotifyNextTrack)}
                disabled={playbackBusy}
                className={`${TRANSPORT_BTN} ${CARD_FOCUS}`}
                aria-label="Next track"
              >
                <SkipIcon className="w-4 h-4" />
              </button>
            </div>
            {volume !== null && volume !== undefined && (
              <div className="flex items-center gap-2 shrink-0 text-text-secondary">
                <VolumeIcon className="w-4 h-4" />
                <input
                  type="range"
                  min={0}
                  max={100}
                  defaultValue={volume}
                  onMouseUp={(e) => withPlaybackBusy(() => spotifySetVolume(Number((e.target as HTMLInputElement).value)))}
                  onKeyUp={(e) => withPlaybackBusy(() => spotifySetVolume(Number((e.target as HTMLInputElement).value)))}
                  onTouchEnd={(e) => withPlaybackBusy(() => spotifySetVolume(Number((e.target as HTMLInputElement).value)))}
                  className="w-24 accent-accent"
                  aria-label="Volume"
                />
              </div>
            )}
          </div>
          <PlaybackProgress playback={nowPlaying} fetchedAt={playbackFetchedAt} />
          {playbackError && <FieldMessage className="mt-2">{playbackError}</FieldMessage>}
        </Card>
      ) : playbackError ? (
        <Callout tone="error" title="Couldn't control Spotify playback">
          {playbackError}
        </Callout>
      ) : (
        <Card className="flex items-center gap-4">
          <span className="w-12 h-12 rounded-full bg-bg text-text-secondary flex items-center justify-center shrink-0">
            <MusicNoteIcon className="w-6 h-6" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium">Nothing playing</p>
            <p className="text-xs text-text-secondary mt-0.5">
              Pick something below to play it on whichever Spotify device is active (phone, desktop app,
              speaker). If nothing's open anywhere, open Spotify on a device first — this app can't produce
              audio on its own, only tell an existing session what to play, like any Spotify remote.
            </p>
          </div>
        </Card>
      )}

      <SegmentedControl ariaLabel="Spotify library" options={TAB_OPTIONS} value={tab} onChange={setTab} />

      {loadError && (
        <Callout
          tone="error"
          title="Couldn't load this list from Spotify"
          action={
            <Button variant="secondary" onClick={() => loadTab(tab)}>
              Try again
            </Button>
          }
        >
          {loadError}
        </Callout>
      )}

      <div key={tab} className="animate-fade-slide-in">
        {tab === "playlists" &&
          (!playlists ? (
            loadError ? null : <MediaGridSkeleton />
          ) : playlists.length === 0 ? (
            <Card>
              <EmptyState title="No playlists" description="Playlists you follow or create on Spotify will show up here." />
            </Card>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {playlists.map((p) => (
                <MediaCard
                  key={p.id}
                  imageUrl={p.images[0]?.url}
                  title={p.name}
                  subtitle={`${p.tracks.total} tracks`}
                  externalUrl={p.externalUrls?.spotify ?? null}
                  disabled={playbackBusy}
                  onPlay={() => withPlaybackBusy(() => spotifyPlayContext(`spotify:playlist:${p.id}`))}
                />
              ))}
            </div>
          ))}

        {tab === "tracks" &&
          (!tracks ? (
            loadError ? null : (
              <Card>
                <TrackListSkeleton />
              </Card>
            )
          ) : tracks.length === 0 ? (
            <Card>
              <EmptyState title="No saved tracks" description="Tracks you save on Spotify will show up here." />
            </Card>
          ) : (
            <Card>
              <div className="divide-y divide-border">
                {tracks.map((t) => {
                  const isCurrent = playback?.item?.id === t.id;
                  return (
                    <div key={t.id} className="group relative flex items-center gap-1">
                      <button
                        onClick={() => withPlaybackBusy(() => spotifyPlayTrack(`spotify:track:${t.id}`))}
                        disabled={playbackBusy}
                        aria-label={`Play ${t.name}`}
                        className={`flex-1 min-w-0 flex items-center gap-3 py-2 px-2 -mx-2 rounded-md text-left transition-colors hover:bg-bg disabled:opacity-40 ${CARD_FOCUS}`}
                      >
                        <Art url={t.album.images[0]?.url} className="w-10 h-10 rounded shrink-0" />
                        <div className="min-w-0 flex-1">
                          <p className={`text-sm font-medium truncate ${isCurrent ? "text-accent-text" : ""}`}>{t.name}</p>
                          <p className="text-xs text-text-secondary truncate">{artistNames(t.artists)}</p>
                        </div>
                        {isCurrent && playback && <PlayingBars active={playback.isPlaying} />}
                        <span className="text-xs text-text-secondary tabular-nums shrink-0">{formatDuration(t.durationMs)}</span>
                      </button>
                      <ExternalLink url={t.externalUrls?.spotify ?? null} className="shrink-0" />
                    </div>
                  );
                })}
              </div>
            </Card>
          ))}

        {tab === "albums" &&
          (!albums ? (
            loadError ? null : <MediaGridSkeleton />
          ) : albums.length === 0 ? (
            <Card>
              <EmptyState title="No saved albums" description="Albums you save on Spotify will show up here." />
            </Card>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {albums.map((a) => (
                <MediaCard
                  key={a.id}
                  imageUrl={a.images[0]?.url}
                  title={a.name}
                  subtitle={artistNames(a.artists)}
                  externalUrl={a.externalUrls?.spotify ?? null}
                  disabled={playbackBusy}
                  onPlay={() => withPlaybackBusy(() => spotifyPlayContext(`spotify:album:${a.id}`))}
                />
              ))}
            </div>
          ))}

        {tab === "podcasts" &&
          (!shows ? (
            loadError ? null : <MediaGridSkeleton />
          ) : shows.length === 0 ? (
            <Card>
              <EmptyState title="No saved podcasts" description="Shows you save on Spotify will show up here." />
            </Card>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              {shows.map((s) => (
                <MediaCard
                  key={s.id}
                  imageUrl={s.images[0]?.url}
                  title={s.name}
                  subtitle={`${s.publisher} · ${s.totalEpisodes} episodes`}
                  externalUrl={s.externalUrls?.spotify ?? null}
                  disabled={playbackBusy}
                  onPlay={() => withPlaybackBusy(() => spotifyPlayContext(`spotify:show:${s.id}`))}
                />
              ))}
            </div>
          ))}
      </div>
    </PageShell>
  );
}
