/**
 * Totem CLI - Main Entry Point
 * Minecraft Backup Utility
 */

import {
    showBanner,
    getBackupOptions,
    getMinecraftPath,
    getBackupDestination,
    showSuccess,
    showError,
    showProgress,
    closePrompts,
} from "./src/prompts";
import { buildMinecraftPaths, validateMinecraftPath, performBackup, openFolder } from "./src/backup";

async function main(): Promise<void> {
    try {
        // Show welcome banner
        showBanner();

        // Get backup options from user
        const options = await getBackupOptions();

        // Get Minecraft installation path
        const mcPath = await getMinecraftPath();
        if (!mcPath) {
            showError("No path provided. Exiting.");
            closePrompts();
            process.exit(1);
        }

        // Build and validate paths
        const mcPaths = buildMinecraftPaths(mcPath);
        const validation = await validateMinecraftPath(mcPaths);

        if (!validation.valid) {
            showError("Invalid Minecraft path:");
            validation.errors.forEach(err => console.error(`  - ${err}`));
            closePrompts();
            process.exit(1);
        }

        // Get backup destination
        const destPath = await getBackupDestination();
        if (!destPath) {
            showError("No destination provided. Exiting.");
            closePrompts();
            process.exit(1);
        }

        console.log("");
        showProgress("Starting backup...");
        console.log("");

        // Perform the backup
        const result = await performBackup(mcPaths, destPath, options);

        if (result.success) {
            showSuccess(result.outputPath, options.zipOutput);

            // Open folder in explorer if requested
            if (options.openWhenDone) {
                const outputPath = options.zipOutput
                    ? destPath  // Open parent folder if zipped
                    : result.outputPath;
                await openFolder(outputPath);
            }
        } else {
            showError("Backup completed with errors:");
            result.errors.forEach(err => console.error(`  - ${err}`));
        }

        closePrompts();
        process.exit(result.success ? 0 : 1);

    } catch (error) {
        showError(`Unexpected error: ${error}`);
        closePrompts();
        process.exit(1);
    }
}

// Run the CLI
main();