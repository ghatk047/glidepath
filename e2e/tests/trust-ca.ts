import { getCACertificates, setDefaultCACertificates } from 'node:tls';
import { siteCa } from '@glidepath/int';

// Node's fetch (INT sign-in, mailpit) trusts the stack's site CA on top of the default roots, as
// `tools/int/src/setup.ts` does for the INT specs. Nothing changes for a plain-http base.
const ca = siteCa();
if (ca) setDefaultCACertificates([...getCACertificates('default'), ca]);
