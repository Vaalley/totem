import { describe, it, expect } from "vitest";
import {
    normalizePath,
    generateTimestamp,
    formatBytes,
    formatDuration,
    getOSInfo,
    getBasename,
} from "../src/utils";

describe("normalizePath", () => {
    it("should remove surrounding quotes", () => {
        expect(normalizePath('"C:\\Users\\test"')).toBe("C:\\Users\\test");
        expect(normalizePath("'C:\\Users\\test'")).toBe("C:\\Users\\test");
    });

    it("should trim whitespace", () => {
        expect(normalizePath("  C:\\Users\\test  ")).toBe("C:\\Users\\test");
    });

    it("should handle paths without quotes", () => {
        expect(normalizePath("C:\\Users\\test")).toBe("C:\\Users\\test");
    });

    it("should normalize slashes", () => {
        const result = normalizePath("C:/Users/test");
        // On Windows, should convert to backslashes
        expect(result).toMatch(/C:[\\\/]Users[\\\/]test/);
    });
});

describe("generateTimestamp", () => {
    it("should return a formatted timestamp string", () => {
        const timestamp = generateTimestamp();
        // Format: YYYY-MM-DD_HH-MM
        expect(timestamp).toMatch(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}$/);
    });

    it("should contain current year", () => {
        const timestamp = generateTimestamp();
        const currentYear = new Date().getFullYear().toString();
        expect(timestamp).toContain(currentYear);
    });
});

describe("formatBytes", () => {
    it("should format 0 bytes", () => {
        expect(formatBytes(0)).toBe("0 B");
    });

    it("should format bytes", () => {
        expect(formatBytes(500)).toBe("500.0 B");
    });

    it("should format kilobytes", () => {
        expect(formatBytes(1024)).toBe("1.0 KB");
        expect(formatBytes(1536)).toBe("1.5 KB");
    });

    it("should format megabytes", () => {
        expect(formatBytes(1048576)).toBe("1.0 MB");
        expect(formatBytes(1572864)).toBe("1.5 MB");
    });

    it("should format gigabytes", () => {
        expect(formatBytes(1073741824)).toBe("1.0 GB");
    });

    it("should format terabytes", () => {
        expect(formatBytes(1099511627776)).toBe("1.0 TB");
    });
});

describe("formatDuration", () => {
    it("should format seconds", () => {
        expect(formatDuration(5.5)).toBe("5.5 seconds");
        expect(formatDuration(30)).toBe("30.0 seconds");
    });

    it("should format minutes and seconds", () => {
        expect(formatDuration(65)).toBe("1m 5s");
        expect(formatDuration(130)).toBe("2m 10s");
    });

    it("should handle exact minutes", () => {
        expect(formatDuration(120)).toBe("2m 0s");
    });
});

describe("getOSInfo", () => {
    it("should return a string with platform and architecture", () => {
        const osInfo = getOSInfo();
        expect(osInfo).toMatch(/\(.*\)/); // Should contain architecture in parentheses
        expect(typeof osInfo).toBe("string");
        expect(osInfo.length).toBeGreaterThan(0);
    });
});

describe("getBasename", () => {
    it("should extract filename from path", () => {
        expect(getBasename("C:\\Users\\test\\file.txt")).toBe("file.txt");
        expect(getBasename("/home/user/file.txt")).toBe("file.txt");
    });

    it("should handle directories", () => {
        expect(getBasename("C:\\Users\\test\\folder")).toBe("folder");
    });
});
