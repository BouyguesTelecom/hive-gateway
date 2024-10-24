import fs from 'node:fs';
import path from 'node:path';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import sucrase from '@rollup/plugin-sucrase';
import { defineConfig } from 'rollup';
import tsConfigPaths from 'rollup-plugin-tsconfig-paths';

console.log('Bundling...');

/**
 * Dependencies that need to be bundled and placed in the bundled node_modules. Modules that
 * are imported by the `mesh.config.ts` file need to exist here.
 *
 * Please note that the node_modules will not be in the WORKDIR of the docker image,
 * it will instead be one level up. This is because we want to keep the
 * bundled node_modules isolated from npm so that managing additional dependencies
 * wont have npm remove bundled ones.
 *
 * Needs to be used with the {@link packagejson} rollup plugin.
 *
 * Is a map of destination path to the source file to bundle.
 *
 * Include a plugin by adding to the {@link deps}:
 * ```json
 * {
 *   "node_modules/<package name>/index": "<relative path to main source file>"
 * }
 * ```
 *
 * For example, include the `@graphql-mesh/plugin-http-cache` plugin by adding:
 * ```json
 * {
 *   "node_modules/@graphql-mesh/plugin-http-cache/index": "../plugins/http-cache/src/index.ts"
 * }
 * ```
 *
 * @type {Record<string, string>}
 */
const deps = {
  'node_modules/@graphql-hive/gateway/index': 'src/index.ts',
  'node_modules/@graphql-hive/gateway-runtime/index': '../runtime/src/index.ts',
  'node_modules/@graphql-mesh/include/hooks':
    'node_modules/@graphql-mesh/include/esm/hooks.js',
  // default transports should be in the container
  'node_modules/@graphql-mesh/transport-common/index':
    'node_modules/@graphql-mesh/transport-common/esm/index.js',
  'node_modules/@graphql-mesh/transport-http/index':
    'node_modules/@graphql-mesh/transport-http/esm/index.js',
  // extras for docker only
  'node_modules/@graphql-mesh/transport-ws/index':
    'node_modules/@graphql-mesh/transport-ws/esm/index.js',
  'node_modules/@graphql-mesh/transport-http-callback/index':
    'node_modules/@graphql-mesh/transport-http-callback/esm/index.js',
  'node_modules/@graphql-mesh/plugin-http-cache/index':
    'node_modules/@graphql-mesh/plugin-http-cache/esm/index.js',
  'node_modules/@graphql-mesh/hmac-upstream-signature/index':
    'node_modules/@graphql-mesh/hmac-upstream-signature/esm/index.js',
};

export default defineConfig({
  input: {
    'dist/bin': 'src/bin.ts',
    ...deps,
  },
  output: {
    dir: 'bundle',
    format: 'esm',
    // having an .mjs extension will make sure that node treats the files as ES modules always
    entryFileNames: '[name].mjs',
    // we want the chunks (common files) to be in the node_modules to avoid name
    // collisions with system files. the node_modules will be in the root of the
    // system (`/node_modules`)
    chunkFileNames: 'node_modules/.chunk/[name]-[hash].mjs',
  },
  external: ['tuql', '@parcel/watcher'],
  plugins: [
    tsConfigPaths(), // use tsconfig paths to resolve modules
    nodeResolve({ preferBuiltins: true }), // resolve node_modules and bundle them too
    graphql(), // handle graphql imports
    commonjs({ strictRequires: true }), // convert commonjs to esm
    json(), // support importing json files to esm (needed for commonjs() plugin)
    sucrase({ transforms: ['typescript'] }), // transpile typescript
    packagejson(), // add package jsons
  ],
});

/**
 * Adds package.json files to the bundle and its dependencies.
 *
 * @type {import('rollup').PluginImpl}
 */
function packagejson() {
  return {
    name: 'packagejson',
    generateBundle(_outputs, bundles) {
      for (const bundle of Object.values(bundles).filter((bundle) => {
        const bundleName = String(bundle.name);
        return (
          !!deps[bundleName] &&
          (bundleName.startsWith('node_modules/') ||
            bundleName.startsWith('node_modules\\'))
        );
      })) {
        const dir = path.dirname(bundle.fileName);
        const bundledFile = path.basename(bundle.fileName).replace(/\\/g, '/');
        /** @type {Record<string, unknown>} */
        const pkg = { type: 'module' };
        if (bundledFile === 'index.mjs') {
          pkg['main'] = bundledFile;
        } else {
          const mjsFile = path
            .basename(bundle.fileName, '.mjs')
            .replace(/\\/g, '/');
          // if the bundled file is not "index", then it's an exports path (like with @graphql-mesh/include/hooks)
          pkg['exports'] = { [`./${mjsFile}`]: `./${bundledFile}` };
        }
        this.emitFile({
          type: 'asset',
          fileName: path.join(dir, 'package.json'),
          source: JSON.stringify(pkg),
        });
      }
    },
  };
}

/**
 * Marks all "graphql*" module imports as external and fixes the imports to match
 * the node 16 style (append `.js` and `/index.js` for directories) where necessary.
 *
 * Furthermore, it also converts all default imports of the "graphql*" modules to
 * separate namespace imports, essentially:
 *
 * ```ts
 * import gql, { some, other, imports } from 'graphql*'
 * ```
 *
 * transforms to:
 *
 * ```ts
 * import * as gql from 'graphql'
 * import { some, other, imports } from 'graphql*'
 * ```
 *
 * @type {import('rollup').PluginImpl}
 */
function graphql() {
  return {
    name: 'graphql',
    async resolveId(source, importer) {
      if (source === 'graphql') {
        // import 'graphql'
        return { id: source, external: true };
      }
      if (!source.startsWith('graphql/') && !source.startsWith('graphql\\')) {
        // not import 'graphql/*'
        return null;
      }
      if (source.endsWith('.js')) {
        // proper node 16 import
        return { id: source, external: true };
      }

      const relPath = source.replace('graphql/', '').replace('graphql\\', '');
      if (!relPath) {
        throw new Error(
          `Importing "${source}" from "${importer}" is not a graphql module relative import`,
        );
      }

      // NOTE: cwd must be here
      // NOTE: the installed graphql must match the graphql in the Dockerfile
      const graphqlModulePath = path.resolve(
        '..',
        '..',
        'node_modules',
        'graphql',
      );
      try {
        fs.lstatSync(graphqlModulePath);
      } catch (e) {
        console.error(
          `"graphql" module not found in ${graphqlModulePath}. Have you run "yarn"?`,
        );
        throw e;
      }

      try {
        if (fs.lstatSync(path.join(graphqlModulePath, relPath)).isDirectory()) {
          // isdir
          return {
            id: source + '/index.js',
            external: true,
          };
        }
      } catch {
        // noop
      }

      // isfile or doesnt exist
      return {
        id: source + '.js',
        external: true,
      };
    },
    renderChunk(code) {
      if (!code.includes("from 'graphql")) {
        // code doesnt include a "graphql*" import
        return null;
      }

      let augmented = code;
      for (const line of code.split('\n')) {
        if (!line.startsWith('import ')) {
          // not an import line
          continue;
        }
        if (!line.includes("from 'graphql")) {
          // line doesnt include a "graphql*" import
          continue;
        }
        if (line.startsWith('import {')) {
          // no default import, ok
          continue;
        }

        let defaultImportPart = line.match(/import(.*) {/)?.[1]; // default + named
        const hasNamedImports = !!defaultImportPart;
        defaultImportPart ??= line.match(/import(.*) from/)?.[1]; // just default
        if (!defaultImportPart) {
          throw new Error(`Unable to match default import on:\n${line}`);
        }

        const module = line.split(' from ')?.[1];
        if (!module) {
          throw new Error(`Unable to detect module on:\n${line}`);
        }

        const namespaceImportLine = `import * as ${
          defaultImportPart
            .trim() // remove spaces
            .replace(/,$/, '') // remove last comma
        } from ${module}`;
        const lineWithoutDefaultImport = line.replace(defaultImportPart, '');

        augmented = augmented.replace(
          line,
          // NOTE: we use replacer instead because strings can mess up dollar signs
          //       see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/replace#specifying_a_string_as_the_replacement
          () => {
            if (hasNamedImports) {
              return `${lineWithoutDefaultImport}\n${namespaceImportLine}`;
            } else {
              // no named imports, so we just need the namespace import line
              return namespaceImportLine;
            }
          },
        );
      }
      return augmented;
    },
  };
}
