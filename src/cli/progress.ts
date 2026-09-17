import type { BackupProgress, ProgressReporter } from "../core/types.ts";
import { formatBytes } from "../core/format.ts";

export interface ProgressOutput {
  write(text: string): void | Promise<void>;
  isTerminal?: boolean;
}

const PHASE_LABELS: Record<BackupProgress["phase"], string> = {
  validating: "Validating",
  preparing: "Preparing",
  screenshots: "Screenshots",
  mods: "Mods",
  shaders: "Shaders",
  resourcepacks: "Resource packs",
  options: "Options",
  saves: "Saves",
  xaero: "Xaero",
  distantHorizons: "Distant Horizons",
  customFolders: "Custom folders",
  metadata: "Metadata",
  archive: "Archive",
  opening: "Opening",
  complete: "Complete",
};

function terminalByDefault(): boolean {
  try {
    if (Deno.env.has("NO_COLOR") || Deno.env.get("TERM") === "dumb") return false;
    return Deno.stderr.isTerminal();
  } catch {
    return false;
  }
}

function plainProgress(progress: BackupProgress): string {
  const phase = PHASE_LABELS[progress.phase] ?? progress.phase;
  const total = progress.totalFiles === undefined ? "" : `/${progress.totalFiles}`;
  const counters = `${progress.completedFiles}${total} files`;
  const listed = `${progress.stats.totalEntriesListed} listed`;
  const bytes = formatBytes(progress.stats.totalBytesCopied);
  return `${phase}: ${progress.message} (${counters}; ${listed}; ${bytes} copied)`;
}

export function formatProgress(progress: BackupProgress): string {
  return plainProgress(progress);
}

/** A progress reporter that updates one line on TTYs and emits stable lines elsewhere. */
export class ProgressRenderer {
  private lastLine = "";
  private lastPhase: BackupProgress["phase"] | undefined;
  private pending: Promise<void> = Promise.resolve();

  constructor(private readonly output: ProgressOutput = defaultOutput()) {}

  report(progress: BackupProgress): Promise<void> {
    this.pending = this.pending.catch(() => undefined).then(() => this.render(progress));
    return this.pending;
  }

  private async render(progress: BackupProgress): Promise<void> {
    const line = plainProgress(progress);
    const terminal = this.output.isTerminal ?? false;
    if (!terminal) {
      // Non-TTY output must remain parseable and must not be overwritten.
      if (line !== this.lastLine || progress.phase !== this.lastPhase) {
        await this.output.write(`${line}\n`);
      }
    } else {
      await this.output.write(`\r\x1b[2K${line}`);
      if (progress.phase === "complete") await this.output.write("\n");
    }
    this.lastLine = line;
    this.lastPhase = progress.phase;
  }

  asReporter(): ProgressReporter {
    return (progress) => this.report(progress);
  }
}

function defaultOutput(): ProgressOutput {
  return {
    isTerminal: terminalByDefault(),
    write(text: string): Promise<void> {
      return Deno.stderr.write(new TextEncoder().encode(text)).then(() => undefined);
    },
  };
}

export function createProgressReporter(output?: ProgressOutput): ProgressReporter {
  return new ProgressRenderer(output ?? defaultOutput()).asReporter();
}
