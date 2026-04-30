import { describe, expect, it, vi, afterEach } from 'vitest';
import { unlink } from 'fs/promises';
import { useUpload } from '../src/index';

// 1. Mock fs & fs/promises
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
    mkdirSync: vi.fn(),
    createWriteStream: vi.fn().mockReturnValue({ on: vi.fn(), end: vi.fn() }),
  };
});
vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(true),
  open: vi.fn().mockResolvedValue({
    read: vi.fn(async (buffer: Buffer) => {
      const pngHeader = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      ]);
      pngHeader.copy(buffer);
      return { bytesRead: pngHeader.length };
    }),
    close: vi.fn().mockResolvedValue(undefined),
  }),
}));

// 2. Mock stream pipeline to resolve instantly
vi.mock('stream/promises', () => ({
  pipeline: vi.fn().mockResolvedValue(true),
}));

// 3. Smart Busboy Mock to capture and trigger stream events
let busboyHandlers: Record<string, Function> = {};
vi.mock('busboy', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      on: (event: string, handler: Function) => {
        busboyHandlers[event] = handler;
      },
    })),
  };
});

describe('useUpload Plugin', () => {
  afterEach(() => {
    vi.clearAllMocks();
    busboyHandlers = {}; // Reset handlers between tests
  });

  it('registers the onPreHandler and onError hooks', () => {
    const mockApp = { addHook: vi.fn() } as any;
    useUpload(mockApp);
    expect(mockApp.addHook).toHaveBeenCalledTimes(2);
  });

  it('skips parsing immediately if the request is not multipart/form-data', async () => {
    const mockApp = { addHook: vi.fn() } as any;
    useUpload(mockApp);
    const onPreHandler = mockApp.addHook.mock.calls[0][1];

    const mockReq = { headers: { 'content-type': 'application/json' } } as any;
    await expect(
      onPreHandler(mockReq, {} as any, { route: {} } as any),
    ).resolves.toBeUndefined();
  });

  it('safely scrubs the hard drive of orphaned files if a request crashes', async () => {
    const mockApp = { addHook: vi.fn() } as any;
    useUpload(mockApp);
    const onError = mockApp.addHook.mock.calls[1][1];

    const mockReq = { files: { avatar: { path: '/tmp/avatar.png' } } } as any;
    await onError(new Error('Crash'), mockReq, {} as any);

    expect(unlink).toHaveBeenCalledWith('/tmp/avatar.png');
  });

  // 🚀 THE MISSING TEST: Simulating a successful multipart stream parsing
  it('processes multipart fields and streams files successfully', async () => {
    const mockApp = { addHook: vi.fn() } as any;
    useUpload(mockApp);
    const onPreHandler = mockApp.addHook.mock.calls[0][1];

    // Setup a mock route that expects a PNG avatar
    const mockMatch = {
      route: {
        schema: {
          files: {
            avatar: {
              accept: ['image/png'],
              maxSize: 5000,
              autoSaveTo: '/tmp',
            },
          },
        },
      },
    } as any;

    const mockReq = {
      headers: { 'content-type': 'multipart/form-data; boundary=---boundary' },
      stream: { pipe: vi.fn() }, // Mock the native stream pipe
      raw: { socket: { destroy: vi.fn() } },
    } as any;

    // Start the handler (it returns a pending Promise waiting for the stream to finish)
    const handlerPromise = onPreHandler(mockReq, {} as any, mockMatch);

    // Simulate Busboy receiving a text field
    busboyHandlers['field']('username', 'axiom_user');

    // Simulate Busboy receiving the file stream
    const mockFileStream = { on: vi.fn(), resume: vi.fn() };
    busboyHandlers['file']('avatar', mockFileStream, {
      filename: 'profile.png',
      mimeType: 'image/png',
    });

    // Simulate Busboy finishing the parse job
    busboyHandlers['finish']();

    // Await the handler promise to resolve
    await handlerPromise;

    // Assertions!
    expect(mockReq.body.username).toBe('axiom_user');
    expect(mockReq.files.avatar).toBeDefined();
    expect(mockReq.files.avatar.originalName).toBe('profile.png');
    expect(mockReq.files.avatar.savedName).toMatch(/\.png$/);
    expect(mockReq.files.avatar.savedName).not.toBe('profile.png');
    expect(mockReq.files.avatar.path.endsWith('.png')).toBe(true);
  });
});
