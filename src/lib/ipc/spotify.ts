import { invoke } from "@tauri-apps/api/core";
import type {
  SpotifyAlbum,
  SpotifyPlaybackState,
  SpotifyPlaylist,
  SpotifyShow,
  SpotifyStatus,
  SpotifyTrack,
} from "@/types";

export function getSpotifyStatus(): Promise<SpotifyStatus> {
  return invoke("spotify_get_status");
}

/** Opens the Spotify consent screen in the user's default browser and
 * waits (up to 3 minutes) for sign-in to complete via a local loopback
 * listener — see spotify/oauth.rs. Rejects if no Client ID is set. */
export function connectSpotify(): Promise<SpotifyStatus> {
  return invoke("spotify_connect");
}

export function disconnectSpotify(): Promise<void> {
  return invoke("spotify_disconnect");
}

export function getSpotifyPlaylists(): Promise<SpotifyPlaylist[]> {
  return invoke("spotify_get_playlists");
}

export function getSpotifySavedTracks(): Promise<SpotifyTrack[]> {
  return invoke("spotify_get_saved_tracks");
}

export function getSpotifySavedAlbums(): Promise<SpotifyAlbum[]> {
  return invoke("spotify_get_saved_albums");
}

export function getSpotifySavedShows(): Promise<SpotifyShow[]> {
  return invoke("spotify_get_saved_shows");
}

export function getSpotifyPlaybackState(): Promise<SpotifyPlaybackState | null> {
  return invoke("spotify_get_playback_state");
}

export function spotifyPlay(): Promise<void> {
  return invoke("spotify_play");
}
export function spotifyPause(): Promise<void> {
  return invoke("spotify_pause");
}
/** Starts playing a specific track on whichever Spotify Connect device is
 * currently active (phone, desktop app, speaker, etc.) — this controls
 * that device rather than producing audio inside this app itself; see
 * spotify/client.rs's doc comment on play_track_uris for why. Needs an
 * active device or it errors with "no active device found." */
export function spotifyPlayTrack(uri: string): Promise<void> {
  return invoke("spotify_play_track", { uri });
}
/** Same as spotifyPlayTrack but for a playlist/album/show's context URI
 * (plays the whole thing, not just one track). */
export function spotifyPlayContext(contextUri: string): Promise<void> {
  return invoke("spotify_play_context", { contextUri });
}
export function spotifyNextTrack(): Promise<void> {
  return invoke("spotify_next_track");
}
export function spotifyPreviousTrack(): Promise<void> {
  return invoke("spotify_previous_track");
}
export function spotifySetVolume(percent: number): Promise<void> {
  return invoke("spotify_set_volume", { percent });
}
