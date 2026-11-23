import { getCACertificates, setDefaultCACertificates } from 'node:tls';
import { siteCa } from './stack';

// Trust the stack's site CA (Caddy `tls internal`) for fetch and the WebSocket client, on top of
// the default roots. Nothing changes for a plain-http base.
const ca = siteCa();
if (ca) setDefaultCACertificates([...getCACertificates('default'), ca]);
