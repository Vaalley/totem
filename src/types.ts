/**
* Totem CLI - Type Definitions
*/

/** Options selected by user in the TUI */
export interface BackupOptions {
    zipOutput: boolean;
    includeSaves: boolean;
    includeXaero: boolean;
    includeDistantHorizons: boolean;
    openWhenDone: boolean;
}

/** Paths within the Minecraft installation */
export interface MinecraftPaths {
    root: string;
    screenshots: string;
    mods: string;
    shaders: string;
    shaderConfigs: string;
    resourcepacks: string;
    options: string;
    saves: string;
    xaero: string;
    distantHorizons: string;
}

/** Result of a backup operation */
export interface BackupResult {
    success: boolean;
    outputPath: string;
    errors: string[];
    stats: {
        screenshotsCopied: number;
        modsListed: number;
        shadersListed: number;
        shaderConfigsCopied: number;
        resourcepacksListed: number;
        savesCopied: number;
        xaeroCopied: number;
        distantHorizonsCopied: number;
    };
}
