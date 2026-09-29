import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const directory=join(process.cwd(),'dist/installers');
const files=(await readdir(directory)).filter(name=>/\.(dmg|exe)$/.test(name)).sort();
if(!files.length)throw new Error('No installer artifacts found.');
const lines=[];
for(const file of files){const hash=createHash('sha256');for await(const chunk of createReadStream(join(directory,file)))hash.update(chunk);lines.push(`${hash.digest('hex')}  ${file}`);}
await writeFile(join(directory,'SHA256SUMS.txt'),lines.join('\n')+'\n');
console.log(`Recorded SHA-256 for ${files.length} installer(s).`);
