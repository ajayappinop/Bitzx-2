import type { NavigationProp, ParamListBase } from '@react-navigation/native';

type AnyNav = Pick<NavigationProp<ParamListBase>, 'navigate' | 'getParent'>;

/** Walk up to the root stack navigator (AppNavigator). */
export function getRootNavigation(navigation: AnyNav): AnyNav {
  let current: AnyNav = navigation;
  while (current.getParent?.()) {
    current = current.getParent() as AnyNav;
  }
  return current;
}
