import { createElement } from 'react';
import { registerRootComponent } from 'expo';
import { Provider } from 'react-redux';

import App from './App';
import { store } from './store';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(() =>
  createElement(Provider, { store, children: createElement(App) }),
);
