// Custom Expo entrypoint.
// Important: register Android background/headless handlers before the app mounts.
import './src/boot/incomingCallBootstrap';

import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
