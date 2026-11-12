import { mkdir, cp, copyFile } from 'node:fs/promises';

await mkdir('dist', { recursive: true });
await copyFile('index.html', 'dist/index.html');
await cp('static', 'dist/static', { recursive: true });
console.log('Static site built in dist/');
