import { useSyncExternalStore } from "react";
import { subscribe, getState, ensureLoaded } from "./store";

export function useAppState() {
  ensureLoaded();
  return useSyncExternalStore(subscribe, getState, getState);
}
