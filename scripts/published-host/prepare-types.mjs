import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { canonicalPackages, readManifest, sourceRoot } from "./environment.mjs";

function declarationTarget(value, root) {
  if (typeof value === "string") {
    if (/\.(?:[cm]?ts|tsx)$/.test(value)) return value;
    const adjacent = value.replace(/\.(m|c)?js$/, (_, kind = "") => `.d.${kind}ts`);
    return adjacent !== value && !adjacent.includes("*") && existsSync(new URL(adjacent, root)) ? adjacent : null;
  }
  if (!value || typeof value !== "object") return null;
  return declarationTarget(value.types, root) ?? declarationTarget(value.import, root) ?? declarationTarget(value.default, root);
}

// Declarations and type roots of the selected host graph.
function hostTypeOptions(environment) {
  const paths = {};
  for (const name of ["emdash", "@emdash-cms/admin", "astro", "@cloudflare/kumo", "@phosphor-icons/react", "@tanstack/react-query"]) {
    const root = environment.hostPackageRoot(name);
    const manifest = readManifest(root);
    for (const [subpath, value] of Object.entries(manifest.exports ?? {})) {
      const target = declarationTarget(value, root);
      if (target) paths[subpath === "." ? name : `${name}/${subpath.slice(2)}`] = [fileURLToPath(new URL(target, root))];
    }
    if (!paths[name] && manifest.types) paths[name] = [fileURLToPath(new URL(manifest.types, root))];
    if (!paths[name]) throw new Error(`No declaration export found for ${name}`);
  }
  const typeRoots = [];
  for (const name of ["node", "react", "react-dom"]) {
    const root = environment.hostPackageRoot(`@types/${name}`);
    typeRoots.push(fileURLToPath(new URL("../", root)));
    if (name !== "node") {
      paths[name] = [fileURLToPath(new URL("index.d.ts", root))];
      paths[`${name}/*`] = [fileURLToPath(new URL("*.d.ts", root))];
    }
  }
  paths["*"] = [fileURLToPath(new URL("*", environment.hostModules)), fileURLToPath(new URL(".pnpm/node_modules/*", environment.hostModules))];
  return { paths, typeRoots: [...new Set(typeRoots)] };
}

function compilerOptionsFor(paths, typeRoots) {
  return {
    target: "ES2022", module: "preserve", moduleResolution: "bundler", resolveJsonModule: true, strict: true,
    esModuleInterop: true, allowImportingTsExtensions: true, verbatimModuleSyntax: true,
    skipLibCheck: true, paths, typeRoots, types: ["node"],
  };
}

export function prepareTypes(environment) {
  const outputRoot = environment.target.outputRoot;
  const { paths: hostPaths, typeRoots } = hostTypeOptions(environment);
  const paths = { ...hostPaths };
  for (const [name, root] of canonicalPackages) {
    for (const [subpath, value] of Object.entries(readManifest(root).exports)) {
      const target = declarationTarget(value, root);
      if (!target) throw new Error(`No declaration export found for ${name}${subpath}`);
      paths[subpath === "." ? name : `${name}/${subpath.slice(2)}`] = [fileURLToPath(new URL(target, root))];
    }
  }
  const compilerOptions = compilerOptionsFor(paths, typeRoots);
  mkdirSync(outputRoot, { recursive: true });
  const configs = {};
  for (const [name, directory] of [["engine", "emdash-plugin-seo"], ["admin", "emdash-plugin-seo/src/admin-ui"]]) {
    const admin = name === "admin";
    const config = {
      compilerOptions: { ...compilerOptions, ...(admin ? { jsx: "react-jsx", types: ["node", "react"] } : {}) },
      include: [fileURLToPath(new URL(`packages/${directory}${admin ? "/**/*" : "/src/*.ts"}`, sourceRoot)), ...(admin ? [fileURLToPath(new URL("client.d.ts", environment.hostPackageRoot("astro")))] : [])],
      exclude: ["node_modules"],
    };
    const destination = new URL(`tsconfig.${name}.json`, outputRoot);
    writeFileSync(destination, `${JSON.stringify(config, null, 2)}\n`);
    configs[name] = fileURLToPath(destination);
  }
  return configs;
}

// The package build runs before its own declarations exist, so its subpaths
// resolve to their source entry points; everything else comes from the host graph.
export function preparePackageBuildTypes(environment) {
  const outputRoot = environment.target.outputRoot;
  const { paths: hostPaths, typeRoots } = hostTypeOptions(environment);
  const paths = { ...hostPaths };
  for (const [name, root] of canonicalPackages) {
    for (const [subpath, value] of Object.entries(readManifest(root).exports)) {
      const declaration = typeof value?.types === "string" ? value.types : null;
      const source = declaration?.startsWith("./dist/") && declaration.endsWith(".d.ts")
        ? [".ts", ".tsx"].map((extension) => new URL(`./src/${declaration.slice(7, -5)}${extension}`, root)).find((url) => existsSync(url))
        : null;
      if (!source) throw new Error(`No source entry point found for ${name}${subpath}`);
      paths[subpath === "." ? name : `${name}/${subpath.slice(2)}`] = [fileURLToPath(source)];
    }
  }
  const config = {
    compilerOptions: { ...compilerOptionsFor(paths, typeRoots), jsx: "react-jsx", types: ["node", "react"] },
    include: [fileURLToPath(new URL("packages/emdash-plugin-seo/src/**/*", sourceRoot)), fileURLToPath(new URL("client.d.ts", environment.hostPackageRoot("astro")))],
    exclude: ["node_modules"],
  };
  mkdirSync(outputRoot, { recursive: true });
  const destination = new URL("tsconfig.package-build.json", outputRoot);
  writeFileSync(destination, `${JSON.stringify(config, null, 2)}\n`);
  return fileURLToPath(destination);
}
