import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm, readFile, readdir } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import {
    buildMinecraftPaths,
    validateMinecraftPath,
    performBackup,
} from "../src/backup";
import type { BackupOptions } from "../src/types";

describe("buildMinecraftPaths", () => {
    it("should build correct paths from root", () => {
        const paths = buildMinecraftPaths("C:\\Users\\test\\.minecraft");

        expect(paths.root).toBe("C:\\Users\\test\\.minecraft");
        expect(paths.mods).toContain("mods");
        expect(paths.screenshots).toContain("screenshots");
        expect(paths.shaders).toContain("shaderpacks");
        expect(paths.resourcepacks).toContain("resourcepacks");
        expect(paths.saves).toContain("saves");
        expect(paths.xaero).toContain("xaero");
        expect(paths.distantHorizons).toContain("distant_horizons");
    });
});

describe("validateMinecraftPath", () => {
    let testDir: string;

    beforeEach(async () => {
        testDir = join(tmpdir(), `totem-test-${Date.now()}`);
        await mkdir(testDir, { recursive: true });
    });

    afterEach(async () => {
        await rm(testDir, { recursive: true, force: true });
    });

    it("should fail if root path does not exist", async () => {
        const paths = buildMinecraftPaths("/nonexistent/path");
        const result = await validateMinecraftPath(paths);

        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
    });

    it("should fail if no Minecraft files found", async () => {
        const paths = buildMinecraftPaths(testDir);
        const result = await validateMinecraftPath(paths);

        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.includes("doesn't look like"))).toBe(true);
    });

    it("should pass if options.txt exists", async () => {
        await writeFile(join(testDir, "options.txt"), "test=value");
        const paths = buildMinecraftPaths(testDir);
        const result = await validateMinecraftPath(paths);

        expect(result.valid).toBe(true);
        expect(result.errors.length).toBe(0);
    });

    it("should pass if mods folder exists", async () => {
        await mkdir(join(testDir, "mods"));
        const paths = buildMinecraftPaths(testDir);
        const result = await validateMinecraftPath(paths);

        expect(result.valid).toBe(true);
    });
});

describe("performBackup (E2E)", () => {
    let mcDir: string;
    let backupDir: string;

    beforeEach(async () => {
        // Create mock Minecraft directory
        mcDir = join(tmpdir(), `totem-mc-${Date.now()}`);
        backupDir = join(tmpdir(), `totem-backup-${Date.now()}`);

        await mkdir(mcDir, { recursive: true });
        await mkdir(backupDir, { recursive: true });

        // Create mock Minecraft structure
        await mkdir(join(mcDir, "mods"));
        await mkdir(join(mcDir, "screenshots"));
        await mkdir(join(mcDir, "shaderpacks"));
        await mkdir(join(mcDir, "resourcepacks"));
        await mkdir(join(mcDir, "saves"));

        // Add some mock files
        await writeFile(join(mcDir, "options.txt"), "fov:110\nrender_distance:16");
        await writeFile(join(mcDir, "mods", "fabric-api-1.0.0.jar"), "mock mod");
        await writeFile(join(mcDir, "mods", "sodium-1.0.0.jar"), "mock mod");
        await writeFile(join(mcDir, "shaderpacks", "BSL_v8.2.zip"), "mock shader");
        await writeFile(join(mcDir, "shaderpacks", "BSL_v8.2.txt"), "config data");
        await writeFile(join(mcDir, "resourcepacks", "Faithful.zip"), "mock pack");
        await writeFile(join(mcDir, "screenshots", "2024-01-01.png"), "mock image");
    });

    afterEach(async () => {
        await rm(mcDir, { recursive: true, force: true });
        await rm(backupDir, { recursive: true, force: true });
    });

    it("should create a backup folder with timestamp", async () => {
        const paths = buildMinecraftPaths(mcDir);
        const options: BackupOptions = {
            zipOutput: false,
            includeSaves: false,
            includeXaero: false,
            includeDistantHorizons: false,
            openWhenDone: false,
        };

        const result = await performBackup(paths, backupDir, options);

        expect(result.success).toBe(true);
        expect(result.outputPath).toContain("backup_");
        expect(result.errors.length).toBe(0);
    });

    it("should backup screenshots folder", async () => {
        const paths = buildMinecraftPaths(mcDir);
        const options: BackupOptions = {
            zipOutput: false,
            includeSaves: false,
            includeXaero: false,
            includeDistantHorizons: false,
            openWhenDone: false,
        };

        const result = await performBackup(paths, backupDir, options);
        const screenshotsPath = join(result.outputPath, "screenshots");
        const files = await readdir(screenshotsPath);

        expect(result.stats.screenshotsCopied).toBe(1);
        expect(files).toContain("2024-01-01.png");
    });

    it("should create mods.txt with mod listings", async () => {
        const paths = buildMinecraftPaths(mcDir);
        const options: BackupOptions = {
            zipOutput: false,
            includeSaves: false,
            includeXaero: false,
            includeDistantHorizons: false,
            openWhenDone: false,
        };

        const result = await performBackup(paths, backupDir, options);
        const modsContent = await readFile(join(result.outputPath, "mods.txt"), "utf-8");

        expect(result.stats.modsListed).toBe(2);
        expect(modsContent).toContain("fabric-api-1.0.0.jar");
        expect(modsContent).toContain("sodium-1.0.0.jar");
    });

    it("should create shaders.txt without config files", async () => {
        const paths = buildMinecraftPaths(mcDir);
        const options: BackupOptions = {
            zipOutput: false,
            includeSaves: false,
            includeXaero: false,
            includeDistantHorizons: false,
            openWhenDone: false,
        };

        const result = await performBackup(paths, backupDir, options);
        const shadersContent = await readFile(join(result.outputPath, "shaders.txt"), "utf-8");

        // Should list the shader zip but not the txt config
        expect(result.stats.shadersListed).toBe(1);
        expect(shadersContent).toContain("BSL_v8.2.zip");
        expect(shadersContent).not.toContain("BSL_v8.2.txt");
    });

    it("should copy shader config files to shader_configs folder", async () => {
        const paths = buildMinecraftPaths(mcDir);
        const options: BackupOptions = {
            zipOutput: false,
            includeSaves: false,
            includeXaero: false,
            includeDistantHorizons: false,
            openWhenDone: false,
        };

        const result = await performBackup(paths, backupDir, options);
        const configsPath = join(result.outputPath, "shader_configs");
        const files = await readdir(configsPath);

        expect(result.stats.shaderConfigsCopied).toBe(1);
        expect(files).toContain("BSL_v8.2.txt");
    });

    it("should copy options.txt", async () => {
        const paths = buildMinecraftPaths(mcDir);
        const options: BackupOptions = {
            zipOutput: false,
            includeSaves: false,
            includeXaero: false,
            includeDistantHorizons: false,
            openWhenDone: false,
        };

        const result = await performBackup(paths, backupDir, options);
        const optionsContent = await readFile(join(result.outputPath, "options.txt"), "utf-8");

        expect(optionsContent).toContain("fov:110");
        expect(optionsContent).toContain("render_distance:16");
    });

    it("should generate info.md with metadata", async () => {
        const paths = buildMinecraftPaths(mcDir);
        const options: BackupOptions = {
            zipOutput: false,
            includeSaves: false,
            includeXaero: false,
            includeDistantHorizons: false,
            openWhenDone: false,
        };

        const result = await performBackup(paths, backupDir, options);
        const infoContent = await readFile(join(result.outputPath, "info.md"), "utf-8");

        expect(infoContent).toContain("# 🗿 Totem Backup");
        expect(infoContent).toContain("System Information");
        expect(infoContent).toContain("Backup Details");
        expect(infoContent).toContain("Restoration Guide");
    });

    it("should backup saves when includeSaves is true", async () => {
        // Add a save file
        await mkdir(join(mcDir, "saves", "MyWorld"));
        await writeFile(join(mcDir, "saves", "MyWorld", "level.dat"), "world data");

        const paths = buildMinecraftPaths(mcDir);
        const options: BackupOptions = {
            zipOutput: false,
            includeSaves: true,
            includeXaero: false,
            includeDistantHorizons: false,
            openWhenDone: false,
        };

        const result = await performBackup(paths, backupDir, options);
        const savesPath = join(result.outputPath, "saves", "MyWorld");
        const files = await readdir(savesPath);

        expect(result.stats.savesCopied).toBeGreaterThan(0);
        expect(files).toContain("level.dat");
    });
});
