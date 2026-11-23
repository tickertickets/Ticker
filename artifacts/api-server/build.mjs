import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { rm } from "node:fs/promises";

// Plugins (e.g. 'esbuild-plugin-pino') may use `require` to resolve dependencies
globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));

async function buildAll() {
  const distDir = path.resolve(artifactDir, "dist");
  await rm(distDir, { recursive: true, force: true });

  await esbuild({
    entryPoints: [path.resolve(artifactDir, "src/index.ts")],
    platform: "node",
    bundle: true,
    format: "esm",
    outdir: distDir,
    outExtension: { ".js": ".mjs" },
    logLevel: "info",
    // ── Externals strategy ──────────────────────────────────────────────────
    // Two categories of externals:
    //
    // 1. Large npm runtime deps — express, drizzle-orm, zod, etc.
    //    These are always present in node_modules at runtime. Externalising them
    //    prevents esbuild from inlining their code into the bundle, which is the
    //    primary technique for keeping index.mjs small.
    //
    // 2. Native / non-bundleable packages — same as before.
    external: [
      // ── Core runtime deps (large, always in node_modules) ───────────────
      // Externalising these removes them from the bundle so Node.js loads
      // them from node_modules at runtime — they are always present.
      // NOTE: @workspace/* packages are NOT externalised because they are
      // raw TypeScript source; esbuild must transpile them.
      // All packages below are direct dependencies of @workspace/api-server,
      // so pnpm guarantees they are resolvable at runtime from dist/index.mjs.
      // Transitive-only deps (e.g. `pg`) must NOT be listed here — they stay bundled.
      "express",
      "cors",
      "cookie-session",
      "socket.io",
      "pino",
      "pino-http",
      "nanoid",
      "zod",
      "drizzle-orm",
      "drizzle-orm/*",
      "isomorphic-dompurify",
      "@supabase/supabase-js",
      "resend",
      "satori",
      "@resvg/resvg-js",
      "react",
      "react/*",
      "@fontsource/dm-sans",
      "@fontsource/dm-sans/*",
      "@fontsource/space-grotesk",
      "@fontsource/space-grotesk/*",
      "@fontsource/noto-sans-thai",
      "@fontsource/noto-sans-thai/*",

      // ── Native / non-bundleable ─────────────────────────────────────────
      "*.node",
      "sharp",
      "better-sqlite3",
      "sqlite3",
      "canvas",
      "bcrypt",
      "argon2",
      "fsevents",
      "re2",
      "farmhash",
      "xxhash-addon",
      "bufferutil",
      "utf-8-validate",
      "ssh2",
      "cpu-features",
      "dtrace-provider",
      "isolated-vm",
      "lightningcss",
      "pg-native",
      "oracledb",
      "mongodb-client-encryption",
      "nodemailer",
      "handlebars",
      "knex",
      "typeorm",
      "protobufjs",
      "onnxruntime-node",
      "@tensorflow/*",
      "@prisma/client",
      "@mikro-orm/*",
      "@grpc/*",
      "@swc/*",
      "@aws-sdk/*",
      "@azure/*",
      "@opentelemetry/*",
      "@google-cloud/*",
      "@google/*",
      "googleapis",
      "firebase-admin",
      "@parcel/watcher",
      "@sentry/profiling-node",
      "@tree-sitter/*",
      "aws-sdk",
      "classic-level",
      "dd-trace",
      "ffi-napi",
      "grpc",
      "hiredis",
      "kerberos",
      "leveldown",
      "miniflare",
      "mysql2",
      "newrelic",
      "odbc",
      "piscina",
      "realm",
      "ref-napi",
      "rocksdb",
      "sass-embedded",
      "sequelize",
      "serialport",
      "snappy",
      "tinypool",
      "usb",
      "workerd",
      "wrangler",
      "zeromq",
      "zeromq-prebuilt",
      "playwright",
      "puppeteer",
      "puppeteer-core",
      "electron",
    ],
    sourcemap: "linked",
    plugins: [
      // pino relies on workers to handle logging, instead of externalizing it we use a plugin to handle it
      esbuildPluginPino({ transports: ["pino-pretty"] })
    ],
    // Make sure packages that are cjs only (e.g. express) but are bundled continue to work in our esm output file
    banner: {
      js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
    `,
    },
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
