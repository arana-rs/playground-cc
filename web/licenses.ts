// The build's license check and notices (design/licensing.md): it lists the packages whose modules
// end up in the bundle, the page's and the Worker's, fails on a license outside the allowlist, and
// writes LICENSE.txt and THIRD-PARTY-LICENSES.txt next to the page.
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import type { Plugin } from 'vite';

/**
 * Third-party code that ships but that no module of the bundle names: code copied into the site,
 * with its license written here, or the output of a build tool, a package whose own manifest gives
 * its license.
 */
export type Extra =
  | { name: string; license: string; dir: string; how: string }
  | { package: string; how: string };

export interface Notice {
  name: string;
  version?: string;
  /** Its SPDX license, checked against the allowlist. */
  license: string;
  /** The directory with its license file. */
  dir: string;
  /** How it ships, for the notices. */
  how: string;
  /** Its license and NOTICE files, by name. */
  files: { name: string; text: string }[];
}

/** Where the parenthesis that opens a text closes, or -1. */
function closingOf(text: string): number {
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')' && --depth === 0) return i;
  }
  return -1;
}

/**
 * Whether an SPDX expression is allowed: with `OR`, one choice must be; with `AND`, every part.
 * An expression it cannot read is not allowed.
 */
export function isAllowed(expression: string, allowed: ReadonlySet<string>): boolean {
  let text = expression.trim();
  // Splits the text at an operator outside parentheses; undefined when they do not balance.
  const split = (operator: string): string[] | undefined => {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')' && --depth < 0) return undefined;
      else if (depth === 0 && text.startsWith(operator, i)) {
        parts.push(text.slice(start, i));
        start = i + operator.length;
      }
    }
    if (depth !== 0) return undefined;
    parts.push(text.slice(start));
    return parts;
  };
  // Parentheses around the whole expression, and only those, are dropped.
  while (text.startsWith('(') && closingOf(text) === text.length - 1) {
    text = text.slice(1, -1).trim();
  }
  const choices = split(' OR ');
  const all = split(' AND ');
  if (choices === undefined || all === undefined) return false;
  if (choices.length > 1) return choices.some((part) => isAllowed(part, allowed));
  if (all.length > 1) return all.every((part) => isAllowed(part, allowed));
  return allowed.has(text);
}

/** The files of a package or copied directory that carry its license or notices. */
export function licenseFiles(dir: string): { name: string; text: string }[] {
  return readdirSync(dir)
    .filter((name) => /^(licen[cs]e|copying|notice)(\.(md|txt))?$/i.test(name))
    .sort()
    .map((name) => ({ name, text: readFileSync(join(dir, name), 'utf8').trim() }));
}

/**
 * The directory of the package a module file belongs to, never above the `node_modules` holding
 * it; undefined outside `node_modules`, or for a file of no package.
 */
export function packageDirOf(id: string): string | undefined {
  const file = id.replace(/[?#].*$/, '');
  if (!file.includes('/node_modules/')) return undefined;
  for (let dir = dirname(file); basename(dir) !== 'node_modules'; dir = dirname(dir)) {
    if (dir === dirname(dir)) return undefined;
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).name !== undefined) {
      return dir;
    }
  }
  return undefined;
}

/** The directory of a package, resolved from another directory. */
function resolvePackage(name: string, from: string): string {
  const require = createRequire(join(from, 'package.json'));
  let dir: string | undefined;
  try {
    dir = dirname(require.resolve(`${name}/package.json`));
  } catch {
    dir = packageDirOf(require.resolve(name));
  }
  if (dir === undefined) throw new Error(`cannot find the package ${name}`);
  return realpathSync(dir);
}

const IN_BUNDLE = 'a package in the bundle';
const RUNTIME = 'its runtime code is generated into the bundle';

/** Virtual modules the build tools add to the bundle, by the package whose code they are. */
const VIRTUAL: [RegExp, string][] = [
  [/^\0?vite\//, 'vite'],
  [/^\0?rolldown\//, 'rolldown'],
  [/^\0?virtual:paraglide\//, '@inlang/paraglide-js'],
];

/**
 * The packages of a bundle's modules, by directory, with how each ships: modules outside
 * `node_modules` are the playground's own; a virtual module must be one the build tools are known
 * to add.
 */
export function packagesOf(ids: Iterable<string>, root: string): Map<string, string> {
  const dirs = new Map<string, string>();
  const vite = resolvePackage('vite', root);
  for (const id of ids) {
    const virtual = VIRTUAL.find(([pattern]) => pattern.test(id));
    if (virtual !== undefined) {
      const dir = resolvePackage(virtual[1], virtual[1] === 'rolldown' ? vite : root);
      if (!dirs.has(dir)) dirs.set(dir, RUNTIME);
    } else if (id.startsWith('\0') || !id.startsWith('/')) {
      throw new Error(`a module of unknown origin in the bundle: ${id}`);
    } else if (id.includes('/node_modules/')) {
      const dir = packageDirOf(id);
      if (dir === undefined) throw new Error(`a module of unknown origin in the bundle: ${id}`);
      dirs.set(realpathSync(dir), IN_BUNDLE);
    }
  }
  return dirs;
}

function packageNotice(dir: string, how: string): Notice {
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  return {
    name: manifest.name,
    version: manifest.version,
    license: typeof manifest.license === 'string' ? manifest.license : '',
    dir,
    how,
    files: licenseFiles(dir),
  };
}

/**
 * Checks every notice's license against the allowlist, and that it has a license file. Returns
 * the problems, one line each.
 */
export function problems(notices: readonly Notice[], allowed: ReadonlySet<string>): string[] {
  return notices.flatMap((notice) => {
    const name = notice.version === undefined ? notice.name : `${notice.name}@${notice.version}`;
    if (!isAllowed(notice.license, allowed)) {
      return [`${name}: license "${notice.license}" is not on the allowlist`];
    }
    const license = notice.files.some((file) => /^(licen[cs]e|copying)/i.test(file.name));
    return license ? [] : [`${name}: no license file in ${notice.dir}`];
  });
}

const RULE = '='.repeat(80);

/** THIRD-PARTY-LICENSES.txt: a pointer to LICENSE.txt, then every notice in full. */
export function thirdPartyText(notices: readonly Notice[], sourceUrl: string): string {
  const head = [
    'playground-cc is licensed under the GNU Affero General Public License, version 3: see',
    'LICENSE.txt, next to this file. Its source code is at',
    sourceUrl,
    '',
    'It ships the third-party code below: packages in its bundle, code copied into it, and code',
    'that its build tools generate into it, each with its license.',
  ];
  const sections = notices.map((notice) => {
    const title = notice.version === undefined ? notice.name : `${notice.name} ${notice.version}`;
    const files = notice.files.map((file) => `--- ${file.name}\n\n${file.text}`);
    return [RULE, `${title} (${notice.license}), ${notice.how}`, RULE, '', ...files].join('\n');
  });
  return `${[head.join('\n'), ...sections].join('\n\n')}\n`;
}

/**
 * The plugin: `collect` goes in the Worker's build, `main` in the page's, which runs after the
 * Worker's and writes the files.
 */
export function licenses(options: {
  /** The web package's directory. */
  root: string;
  /** The JSON file with the allowed SPDX ids. */
  allowlist: string;
  /** playground-cc's own license file. */
  license: string;
  extras: Extra[];
  sourceUrl: string;
}): { main: Plugin; collect: () => Plugin } {
  const ids = new Set<string>();
  const add = (bundle: Record<string, { type: string; moduleIds?: readonly string[] }>) => {
    for (const file of Object.values(bundle)) for (const id of file.moduleIds ?? []) ids.add(id);
  };
  const collect = (): Plugin => ({
    name: 'playground-cc:licenses-collect',
    apply: 'build',
    generateBundle(_options, bundle) {
      add(bundle);
    },
  });
  const main: Plugin = {
    name: 'playground-cc:licenses',
    apply: 'build',
    generateBundle(_options, bundle) {
      add(bundle);
      const allowed = new Set<string>(
        JSON.parse(readFileSync(resolve(options.root, options.allowlist), 'utf8')),
      );
      let dirs: Map<string, string>;
      try {
        dirs = packagesOf(ids, options.root);
      } catch (error) {
        this.error(String(error));
      }
      const extras = options.extras.map((extra): Notice => {
        if ('package' in extra) {
          return packageNotice(resolvePackage(extra.package, options.root), extra.how);
        }
        const dir = realpathSync(resolve(options.root, extra.dir));
        return { ...extra, dir, files: licenseFiles(dir) };
      });
      // A build tool listed as an extra says better how it ships than its virtual modules do.
      for (const extra of extras) dirs.delete(extra.dir);
      const packages = [...dirs]
        .map(([dir, how]) => packageNotice(dir, how))
        .sort((a, b) => a.name.localeCompare(b.name, 'en'));
      const notices = [...packages, ...extras];
      const found = problems(notices, allowed);
      if (found.length > 0) {
        this.error(`licenses outside design/licensing.md#allowed-licenses:\n${found.join('\n')}`);
      }
      this.emitFile({
        type: 'asset',
        fileName: 'LICENSE.txt',
        source: readFileSync(resolve(options.root, options.license), 'utf8'),
      });
      this.emitFile({
        type: 'asset',
        fileName: 'THIRD-PARTY-LICENSES.txt',
        source: thirdPartyText(notices, options.sourceUrl),
      });
    },
  };
  return { main, collect };
}
