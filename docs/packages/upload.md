# @axiomify/upload

Multipart upload parsing for routes that declare file fields.

## Install

```bash
npm install @axiomify/upload busboy
```

## Export

- `useUpload(app, options?)`

### Options

- `autoSaveTo` (or `dest` default): The destination folder to save files.
- `autoCleanup` (boolean, default `false`): If `true`, automatically unlinks all uploaded files in the `onPostHandler` lifecycle hook.

---

## File Cleanup

If a request fails (throws an error, validation fails, or client disconnects), the `onError` hook automatically deletes any written files.

For successful requests, you can manage cleanup:

- **Automatically**: Set `autoCleanup: true` when registering `useUpload`.
- **Manually**: Invoke the asynchronous `req.cleanup()` function inside your route handler after processing.

---

## Route Example

```ts
useUpload(app, { autoCleanup: true });

app.route({
  method: 'POST',
  path: '/avatar',
  schema: {
    body: z.object({
      userId: z.string().uuid(),
    }),
    files: {
      avatar: {
        maxSize: 5 * 1024 * 1024,
        accept: ['image/png', 'image/jpeg'],
        autoSaveTo: './uploads',
      },
    },
  },
  handler: async (req, res) => {
    res.send({ file: req.files?.avatar });
  },
});
```

## Behavior

- parses multipart form fields into `req.body`
- stores uploaded file metadata in `req.files`
- sanitizes filenames
- enforces per-field `accept` and `maxSize`
- removes orphaned files on error
- supports manual/automatic file cleanup post-handler
