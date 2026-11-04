import { render } from 'preact';
import { registerSW } from 'virtual:pwa-register';
import { App } from './app';
import './styles.css';

render(<App />, document.getElementById('app')!);

// Offline support + automatic updates when a new version is deployed.
registerSW({ immediate: true });
