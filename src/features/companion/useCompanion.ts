import { useEffect, useState } from "react";
import {
  getCompanionManifest,
  getCompanionState,
  onCompanionAssetsChanged,
  onCompanionUpdated,
} from "@/lib/ipc/companion";
import type { AssetManifest, CompanionState } from "@/types";

export function useCompanion() {
  const [state, setState] = useState<CompanionState | null>(null);
  const [manifest, setManifest] = useState<AssetManifest | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let unlistenAssets: (() => void) | undefined;

    Promise.all([getCompanionState(), getCompanionManifest()])
      .then(([s, m]) => {
        setState(s);
        setManifest(m);
      })
      .catch((e) => setError(String(e)));

    onCompanionUpdated(setState).then((fn) => {
      unlisten = fn;
    });

    // The manifest is otherwise read once at startup, so a custom pack that
    // was just installed or edited (name / pixel-art / speeds) wouldn't show
    // until relaunch. Re-read it whenever the pack changes.
    onCompanionAssetsChanged(() => {
      getCompanionManifest()
        .then(setManifest)
        .catch((e) => setError(String(e)));
    }).then((fn) => {
      unlistenAssets = fn;
    });

    return () => {
      unlisten?.();
      unlistenAssets?.();
    };
  }, []);

  return { state, manifest, error };
}
