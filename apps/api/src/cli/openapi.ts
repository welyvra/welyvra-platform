import { writeFileSync } from 'node:fs';
import { buildOpenApi } from '../services/openapi.js';

const out = process.argv[2] ?? 'openapi.json';
writeFileSync(out, (await buildOpenApi()) + '\n');
console.log(`wrote ${out}`);
