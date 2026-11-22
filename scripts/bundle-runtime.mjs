import { spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';

// Kintsugi 27B uses the Inkling 2 looped-layer GGUF layout. Only Unsloth's
// build supports it; upstream llama.cpp reads a different layout and emits
// gibberish with these weights.
const repo = 'unslothai/llama.cpp';
const release = 'b12588-mix-c0c3de8';
const target = process.argv[2] ?? ({
  darwin: 'macos-metal', win32: 'windows-vulkan', linux: 'linux-vulkan',
})[process.platform];
const assets = {
  'windows-cuda': [`app-${release}-windows-x64-cuda12-portable.zip`],
  'windows-vulkan': [`app-${release}-windows-x64-vulkan.zip`],
  'macos-metal': [`llama-${release}-bin-macos-${process.arch}.tar.gz`],
  'linux-cuda': [`app-${release}-linux-x64-cuda12-portable.tar.gz`],
  'linux-vulkan': [`app-${release}-linux-x64-vulkan.tar.gz`],
}[target];

if (!assets) throw new Error(`Unknown llama.cpp build: ${target}`);

const destination = resolve('dist-backend/simpld-backend/llama');
const scratch = await mkdtemp(join(tmpdir(), 'simpld-runtime-'));
try {
  for (const asset of assets) {
    const archive = join(scratch, asset);
    const response = await fetch(`https://github.com/${repo}/releases/download/${release}/${asset}`);
    if (!response.ok) throw new Error(`Download failed for ${asset}: HTTP ${response.status}`);
    await pipeline(response.body, createWriteStream(archive));

    const extracted = join(scratch, asset + '-files');
    await mkdir(extracted);
    const result = spawnSync('tar', ['-xf', archive, '-C', extracted], { stdio: 'inherit' });
    if (result.error || result.status !== 0) {
      throw result.error ?? new Error(`Could not extract ${asset}`);
    }

    const files = await readdir(extracted, { recursive: true });
    const runtimeFiles = files.filter((file) => {
      const name = file.split(/[\\/]/).at(-1);
      return /^(llama-server(?:\.exe)?|.*\.dll|.*\.dylib|.*\.so(?:\..*)?|LICENSE.*)$/i.test(name);
    });
    if (!runtimeFiles.length) throw new Error(`No runtime files in ${asset}`);
    await mkdir(destination, { recursive: true });
    for (const file of runtimeFiles) {
      const name = file.split(/[\\/]/).at(-1);
      await cp(join(extracted, file), join(destination, name), {
        dereference: false, verbatimSymlinks: true,
      });
    }
    if (asset === assets[0] && !runtimeFiles.some((f) => /(?:^|[\\/])llama-server(?:\.exe)?$/.test(f))) {
      throw new Error(`llama-server is missing from ${asset}`);
    }
  }
  const license = await fetch(`https://raw.githubusercontent.com/${repo}/${release}/LICENSE`);
  if (!license.ok) throw new Error(`Could not fetch llama.cpp license: HTTP ${license.status}`);
  await writeFile(join(destination, 'LICENSE-llama.cpp'), await license.text());
} finally {
  await rm(scratch, { recursive: true, force: true });
}
