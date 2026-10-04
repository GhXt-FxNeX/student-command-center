import { useEffect, useState } from "react";
import { Card } from "@/components/Card";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { updateSettings } from "@/lib/ipc/settings";
import { connectSpotify, disconnectSpotify, getSpotifyStatus } from "@/lib/ipc/spotify";
import { SettingsCategoryLayout, SettingsSectionTitle } from "@/features/settings/SettingsCategoryLayout";
import type { SpotifyStatus, UserSettings } from "@/types";
import { FieldMessage } from "@/components/ui/Callout";

interface Props {
  settings: UserSettings;
  onSettingsChange: (s: UserSettings) => void;
}

export function SettingsSpotifyPage({ settings, onSettingsChange }: Props) {
  const [spotifyStatus, setSpotifyStatus] = useState<SpotifyStatus | null>(null);
  const [spotifyClientIdDraft, setSpotifyClientIdDraft] = useState(settings.spotifyClientId);
  const [spotifyBusy, setSpotifyBusy] = useState(false);
  const [spotifyError, setSpotifyError] = useState<string | null>(null);

  function refreshSpotifyStatus() {
    getSpotifyStatus()
      .then((status) => setSpotifyStatus(status))
      .catch((e) => setSpotifyError(String(e)));
  }

  useEffect(() => {
    refreshSpotifyStatus();
  }, []);

  async function handleSaveSpotifyClientId() {
    const trimmed = spotifyClientIdDraft.trim();
    if (trimmed === settings.spotifyClientId) return;
    try {
      await updateSettings({ ...settings, spotifyClientId: trimmed });
      onSettingsChange({ ...settings, spotifyClientId: trimmed });
    } catch (e) {
      setSpotifyError(String(e));
    }
  }

  async function handleConnectSpotify() {
    setSpotifyBusy(true);
    setSpotifyError(null);
    try {
      const status = await connectSpotify();
      setSpotifyStatus(status);
    } catch (e) {
      setSpotifyError(String(e));
    } finally {
      setSpotifyBusy(false);
    }
  }

  async function handleDisconnectSpotify() {
    setSpotifyBusy(true);
    setSpotifyError(null);
    try {
      await disconnectSpotify();
      refreshSpotifyStatus();
    } catch (e) {
      setSpotifyError(String(e));
    } finally {
      setSpotifyBusy(false);
    }
  }

  return (
    <SettingsCategoryLayout title="Spotify" description="Connect your account and control playback.">
      <Card>
        <SettingsSectionTitle>Connection</SettingsSectionTitle>
        <p className="text-xs text-text-secondary mb-4">
          Connect your own Spotify account to browse your playlists, saved tracks and albums, and
          control playback without leaving the app. Playback control needs Spotify Premium and an
          active device (open Spotify somewhere first).
        </p>

        <div className="space-y-2 mb-4">
          <label htmlFor="f-spotify-app-client-id" className="block text-sm text-text-secondary mb-1">Spotify app Client ID</label>
          <Input id="f-spotify-app-client-id"
            className="w-full font-mono"
            value={spotifyClientIdDraft}
            onChange={(e) => setSpotifyClientIdDraft(e.target.value)}
            onBlur={handleSaveSpotifyClientId}
            placeholder="Paste your Client ID from developer.spotify.com/dashboard"
          />
          <p className="text-xs text-text-secondary">
            You'll need your own Spotify app — free to create at{" "}
            <span className="font-mono">developer.spotify.com/dashboard</span>. Add{" "}
            <span className="font-mono">http://127.0.0.1:8898/callback</span> as a Redirect URI on
            that app (byte-for-byte — Spotify checks it exactly). This is your app's Client ID, not a
            secret — it isn't stored anywhere sensitive.
          </p>
        </div>

        {spotifyError && <FieldMessage className="mb-2">{spotifyError}</FieldMessage>}

        {spotifyStatus?.connected ? (
          <div className="flex items-center justify-between rounded-md border border-border bg-bg p-3 text-sm">
            <span>
              Connected{spotifyStatus.displayName ? ` as ${spotifyStatus.displayName}` : ""}
            </span>
            <Button variant="secondary" onClick={handleDisconnectSpotify} disabled={spotifyBusy}>
              {spotifyBusy ? "Disconnecting…" : "Disconnect Spotify"}
            </Button>
          </div>
        ) : (
          <Button
            variant="primary"
            onClick={handleConnectSpotify}
            disabled={spotifyBusy || !settings.spotifyClientId.trim()}
          >
            {spotifyBusy ? "Waiting for Spotify sign-in…" : "Connect Spotify"}
          </Button>
        )}
      </Card>
    </SettingsCategoryLayout>
  );
}
