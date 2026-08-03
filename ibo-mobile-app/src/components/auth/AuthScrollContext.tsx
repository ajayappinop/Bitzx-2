import { createContext, type RefObject } from 'react';
import type { View } from 'react-native';

export type AuthScrollContextValue = {
  scrollFieldIntoView: (fieldRef: RefObject<View | null>) => void;
};

export const AuthScrollContext = createContext<AuthScrollContextValue | null>(null);
