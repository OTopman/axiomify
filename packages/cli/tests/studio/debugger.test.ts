import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseStackTrace,
  readSourceContext,
} from '../../src/studio/api/debugger';

describe('Studio Debugger & Stack Trace Parser', () => {
  describe('Stack Trace Parser', () => {
    it('should extract correct function names, line numbers, and file paths', () => {
      const mockStack = `Error: Something went wrong
    at Object.handler (/Users/Topman/Documents/Projects/NodeJS/axiomify/examples/my-app/src/index.ts:25:12)
    at runNextTicks (node:internal/process/task_queues:60:5)
    at listOnTimeout (node:internal/timers:538:9)
    at process.processTimers (node:internal/timers:512:7)`;

      const frames = parseStackTrace(mockStack);

      expect(frames.length).toBe(4);

      expect(frames[0].functionName).toBe('Object.handler');
      expect(frames[0].file).toBe(
        '/Users/Topman/Documents/Projects/NodeJS/axiomify/examples/my-app/src/index.ts',
      );
      expect(frames[0].line).toBe(25);
      expect(frames[0].column).toBe(12);
      expect(frames[0].isInternal).toBe(false);
      expect(frames[0].isNodeModule).toBe(false);

      expect(frames[1].functionName).toBe('runNextTicks');
      expect(frames[1].isInternal).toBe(true);
    });
  });

  describe('Source Reader', () => {
    it('should refuse to read files outside the project root for security', async () => {
      const result = await readSourceContext('/etc/passwd', 1, 5);
      expect(result).toBeNull();
    });

    it('should read surrounding lines correctly from a valid file', async () => {
      // Read this test file itself as a test case!
      const thisFile = path.resolve(__filename);
      const result = await readSourceContext(thisFile, 5, 2);

      expect(result).not.toBeNull();
      if (result) {
        expect(result.file).toBe(thisFile);
        expect(result.targetLine).toBe(5);
        expect(result.startLine).toBe(3);
        expect(result.endLine).toBe(7);
        expect(result.lines.length).toBe(5);
        expect(result.lines.find((l) => l.isTarget)?.num).toBe(5);
      }
    });
  });
});
