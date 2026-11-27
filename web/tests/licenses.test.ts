// The build's license check (design/licensing.md): which packages it finds, which licenses pass,
// and the notices it writes.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import licensingSpec from '../../design/licensing.md?raw';
import allowlist from '../license-allowlist.json';
import {
  isAllowed,
  licenseFiles,
  licenses,
  type Notice,
  packageDirOf,
  packagesOf,
  problems,
  thirdPartyText,
} from '../licenses';

const allowed = new Set(allowlist);
const root = join(import.meta.dirname, '..');

/** A fake `node_modules` with one package, `pkg`, whose module is at `pkg/dist/index.js`. */
const fixture = mkdtempSync(join(tmpdir(), 'licenses-'));
const pkg = join(fixture, 'node_modules', 'pkg');
mkdirSync(join(pkg, 'dist'), { recursive: true });
writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: 'pkg', license: 'MIT' }));
// A manifest without a name, as some packages put in their dist folders.
writeFileSync(join(pkg, 'dist', 'package.json'), JSON.stringify({ type: 'module' }));
writeFileSync(join(pkg, 'dist', 'index.js'), '');
writeFileSync(join(pkg, 'LICENSE'), 'MIT License\n');
writeFileSync(join(pkg, 'NOTICE.md'), 'Notice\n');
writeFileSync(join(pkg, 'README.md'), 'Readme\n');
/** A package under GPL-2.0-only, which the allowlist refuses. */
const gpl = join(fixture, 'node_modules', 'gpl');
mkdirSync(gpl);
writeFileSync(join(gpl, 'package.json'), JSON.stringify({ name: 'gpl', license: 'GPL-2.0-only' }));
writeFileSync(join(gpl, 'index.js'), '');
writeFileSync(join(gpl, 'COPYING'), 'GPL\n');
/** Code copied into the site, with its license beside it. */
const copied = join(fixture, 'copied');
mkdirSync(copied);
writeFileSync(join(copied, 'LICENSE'), 'MIT License\n');
/** A file in `node_modules` that belongs to no package. */
mkdirSync(join(fixture, 'node_modules', 'loose'));
writeFileSync(join(fixture, 'node_modules', 'loose', 'index.js'), '');
afterAll(() => rmSync(fixture, { recursive: true }));

const notice = (fields: Partial<Notice>): Notice => ({
  name: 'pkg',
  license: 'MIT',
  dir: pkg,
  how: 'a package in the bundle',
  files: [{ name: 'LICENSE', text: 'MIT License' }],
  ...fields,
});

describe('the allowlist', () => {
  it('is the list of design/licensing.md', () => {
    const section = licensingSpec.slice(
      licensingSpec.indexOf('## Allowed licenses'),
      licensingSpec.indexOf('- **Not allowed**'),
    );
    const ids = [...section.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    expect(allowlist).toEqual(ids);
  });

  it('reads SPDX expressions: one choice of OR, every part of AND', () => {
    expect(isAllowed('MIT', allowed)).toBe(true);
    expect(isAllowed('GPL-2.0-only', allowed)).toBe(false);
    expect(isAllowed('(MIT OR GPL-2.0-only)', allowed)).toBe(true);
    expect(isAllowed('MIT AND GPL-2.0-only', allowed)).toBe(false);
    expect(isAllowed('(Apache-2.0 AND MIT) OR GPL-2.0-only', allowed)).toBe(true);
    expect(isAllowed('MIT AND (ISC OR LGPL-2.1-only)', allowed)).toBe(true);
    expect(isAllowed('(MIT) AND (Apache-2.0)', allowed)).toBe(true);
    expect(isAllowed('(MIT OR GPL-2.0-only) AND (ISC OR GPL-2.0-only)', allowed)).toBe(true);
    expect(isAllowed('(GPL-2.0-only OR MIT) AND (GPL-2.0-only)', allowed)).toBe(false);
    const unbalanced = ['MIT OR (GPL-2.0-only', 'MIT OR GPL-2.0-only)', '(MIT', 'MIT)'];
    for (const expression of unbalanced)
      expect(isAllowed(expression, allowed), expression).toBe(false);
    for (const unreadable of ['', 'SEE LICENSE IN LICENSE.txt', 'UNLICENSED', 'MIT WITH x']) {
      expect(isAllowed(unreadable, allowed), unreadable).toBe(false);
    }
  });
});

describe('the packages of a bundle', () => {
  it('finds the package of a module, skipping manifests without a name', () => {
    expect(packageDirOf(join(pkg, 'dist', 'index.js'))).toBe(pkg);
    expect(packageDirOf(join(root, 'src', 'App.tsx'))).toBeUndefined();
    expect(packageDirOf(`${join(pkg, 'dist', 'index.js')}?worker&url`)).toBe(pkg);
    // Never above the node_modules holding it, even with a package.json there.
    writeFileSync(join(fixture, 'package.json'), JSON.stringify({ name: 'outer' }));
    expect(packageDirOf(join(fixture, 'node_modules', 'loose', 'index.js'))).toBeUndefined();
  });

  it('reads the license and notice files of a package', () => {
    expect(licenseFiles(pkg)).toEqual([
      { name: 'LICENSE', text: 'MIT License' },
      { name: 'NOTICE.md', text: 'Notice' },
    ]);
  });

  it("skips the playground's own modules and knows the build tools' virtual modules", () => {
    const found = packagesOf(
      [
        join(root, 'src', 'App.tsx'),
        join(pkg, 'dist', 'index.js'),
        '\0vite/modulepreload-polyfill.js',
        '\0rolldown/runtime.js',
        '\0virtual:paraglide/123/messages/run.js',
      ],
      root,
    );
    const names = [...found].map(([dir, how]) => `${dir.split('/node_modules/').at(-1)}: ${how}`);
    expect(names.sort()).toEqual([
      '@inlang/paraglide-js: its runtime code is generated into the bundle',
      'pkg: a package in the bundle',
      'rolldown: its runtime code is generated into the bundle',
      'vite: its runtime code is generated into the bundle',
    ]);
  });

  it('refuses a module of unknown origin', () => {
    expect(() => packagesOf(['\0commonjsHelpers.js'], root)).toThrow(/unknown origin/);
    expect(() => packagesOf(['virtual:other'], root)).toThrow(/unknown origin/);
    const loose = join(fixture, 'node_modules', 'loose', 'index.js');
    expect(() => packagesOf([loose], root)).toThrow(/unknown origin/);
  });
});

describe('the check and the notices', () => {
  it('fails on a license outside the allowlist, or without a license file', () => {
    expect(problems([notice({})], allowed)).toEqual([]);
    expect(problems([notice({ version: '1.0.0', license: 'GPL-2.0-only' })], allowed)).toEqual([
      'pkg@1.0.0: license "GPL-2.0-only" is not on the allowlist',
    ]);
    expect(problems([notice({ license: '' })], allowed)).toHaveLength(1);
    expect(problems([notice({ files: [] })], allowed)).toEqual([`pkg: no license file in ${pkg}`]);
    const onlyNotice = notice({ files: [{ name: 'NOTICE', text: 'Notice' }] });
    expect(problems([onlyNotice], allowed)).toEqual([`pkg: no license file in ${pkg}`]);
  });

  it('start by pointing to LICENSE.txt and the source, then hold every license in full', () => {
    const text = thirdPartyText(
      [notice({ version: '1.0.0' }), notice({ name: 'copied', how: 'code copied into the site' })],
      'https://example.org/source',
    );
    expect(text.split('\n').slice(0, 3)).toEqual([
      'playground-cc is licensed under the GNU Affero General Public License, version 3: see',
      'LICENSE.txt, next to this file. Its source code is at',
      'https://example.org/source',
    ]);
    expect(text).toContain('pkg 1.0.0 (MIT), a package in the bundle\n');
    expect(text).toContain('copied (MIT), code copied into the site\n');
    expect(text.match(/--- LICENSE\n\nMIT License/g)).toHaveLength(2);
  });
});

describe('the plugin', () => {
  type Hook = (this: unknown, options: unknown, bundle: unknown) => void;
  const bundle = (...ids: string[]) => ({ 'index.js': { type: 'chunk', moduleIds: ids } });

  /** Builds with the plugin: the Worker's bundle first, then the page's. */
  function build(worker: string[], page: string[]) {
    const plugin = licenses({
      root,
      allowlist: 'license-allowlist.json',
      license: '../LICENSE',
      sourceUrl: 'https://example.org/source',
      extras: [
        { name: 'copied', license: 'MIT', dir: copied, how: 'code copied into the site' },
        { package: '@inlang/paraglide-js', how: 'its code is generated into the bundle' },
      ],
    });
    const files = new Map<string, string>();
    const context = {
      error: (message: string) => {
        throw new Error(message);
      },
      emitFile: (file: { fileName: string; source: string }) => {
        files.set(file.fileName, file.source);
      },
    };
    (plugin.collect().generateBundle as Hook).call(context, {}, bundle(...worker));
    (plugin.main.generateBundle as Hook).call(context, {}, bundle(...page));
    return files;
  }

  it("checks the Worker's packages too, and writes both files", () => {
    const files = build([join(pkg, 'dist', 'index.js')], [join(root, 'src', 'App.tsx')]);
    expect(files.get('LICENSE.txt')).toContain('GNU AFFERO GENERAL PUBLIC LICENSE');
    const text = files.get('THIRD-PARTY-LICENSES.txt') ?? '';
    expect(text).toContain('\npkg (MIT), a package in the bundle\n');
    expect(text).toContain('\ncopied (MIT), code copied into the site\n');
    expect(() => build([join(gpl, 'index.js')], [])).toThrow(/gpl: license "GPL-2.0-only"/);
  });

  it("lists a build tool once, as its extra says, with its manifest's license and version", () => {
    const text =
      build([], ['\0virtual:paraglide/1/runtime.js']).get('THIRD-PARTY-LICENSES.txt') ?? '';
    const titles = text.split('\n').filter((line) => line.startsWith('@inlang/paraglide-js'));
    expect(titles).toEqual([
      expect.stringMatching(/^@inlang\/paraglide-js \d+\.\d+\.\d+ \(MIT\), its code is generated/),
    ]);
  });
});
