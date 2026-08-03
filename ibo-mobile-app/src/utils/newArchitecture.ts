/** True when the app runs with React Native New Architecture (Fabric). */
export function isNewArchitectureEnabled(): boolean {
  const g = global as typeof global & {
    nativeFabricUIManager?: unknown;
    RN$Bridgeless?: boolean;
  };
  return Boolean(g.nativeFabricUIManager ?? g.RN$Bridgeless);
}
