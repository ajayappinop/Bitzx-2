import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import type { MainTabParamList } from './types';
import { getRootNavigation } from './rootNavigation';

type Nav = Pick<NavigationProp<ParamListBase>, 'getParent' | 'navigate'>;

/**
 * Navigate to a bottom tab from Profile stack, MainTabNavigator, or any nested screen.
 */
export function navigateToMainTab<T extends keyof MainTabParamList>(
  navigation: Nav,
  tab: T,
  params?: MainTabParamList[T],
) {
  const root = getRootNavigation(navigation);
  root.navigate('Main', { screen: tab, params });
}

export { getRootNavigation } from './rootNavigation';
