import { writeAll, GENERATED_DIR } from './generate';

const written = writeAll();
console.log(`gen-types: wrote ${written.length} files to ${GENERATED_DIR}`);
