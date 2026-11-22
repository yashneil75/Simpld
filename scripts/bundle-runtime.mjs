import { spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';

const repo = 'ggml-org/llama.cpp';
const release = 'b12633';
const target = process.argv[2] ?? ({
  darwin: 'macos-metal', win32: 'windows-vulkan', linux: 'linux-vulkan',
})[process.platform];
const assets = {
  'windows-cuda': [
    `llama-${release}-bin-win-cuda-12.4-x64.zip`,
    'cudart-llama-bin-win-cuda-12.4-x64.zip',
  ],
  'windows-vulkan': [`llama-${release}-bin-win-vulkan-x64.zip`],
  'macos-metal': [`llama-${release}-bin-macos-${process.arch}.tar.gz`],
  'linux-cuda': [
    `llama-${release}-bin-ubuntu-cuda-12.8-x64.tar.gz`,
    `cudart-llama-${release}-bin-ubuntu-cuda-12.8-x64.tar.gz`,
  ],
  'linux-vulkan': [`llama-${release}-bin-ubuntu-vulkan-x64.tar.gz`],
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
