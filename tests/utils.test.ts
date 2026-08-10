import { assert, assertEquals, assertFalse } from "@std/assert";
import {
  absoluteUserPath,
  normalizeUserPath,
  pathsEqual,
  pathsOverlap,
} from "../src/core/paths.ts";

Deno.test("normalizeUserPath trims whitespace and matching single or double quotes", () => {
  assertEquals(
    normalizeUserPath('  "./minecraft/../minecraft"  '),
    normalizeUserPath("./minecraft"),
  );
  assertEquals(normalizeUserPath(" './minecraft/../minecraft' "), normalizeUserPath("./minecraft"));
  assertFalse(normalizeUserPath('"./minecraft/../minecraft"').includes(".."));
});

Deno.test("absoluteUserPath resolves relative input while pathsEqual normalizes equivalent spellings", () => {
  assertEquals(absoluteUserPath("./instance/../instance"), absoluteUserPath("./instance"));
  assertEquals(absoluteUserPath(' "./instance" '), absoluteUserPath("./instance"));
  assert(pathsEqual("./instance", "./instance/../instance"));
  assertFalse(pathsEqual("./instance", "./different-instance"));
});

Deno.test("pathsOverlap recognizes ancestors but not similarly named siblings", () => {
  assert(pathsOverlap("/tmp/minecraft", "/tmp/minecraft/screenshots"));
  assert(pathsOverlap("/tmp/minecraft/screenshots", "/tmp/minecraft"));
  assert(pathsOverlap("/tmp/minecraft", "/tmp/minecraft"));
  assertFalse(pathsOverlap("/tmp/minecraft", "/tmp/minecraft-backup"));
  assertFalse(pathsOverlap("/tmp/minecraft/screenshots", "/tmp/other/screenshots"));
});
