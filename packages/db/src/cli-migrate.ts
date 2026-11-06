import { connect } from './client.js';
import { migrate } from './migrate.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const { sql, close } = connect(url, { max: 1 });
const applied = await migrate(sql);
console.log(applied.length ? `applied: ${applied.join(', ')}` : 'up to date');
await close();
