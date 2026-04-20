# @axiomify/upload

Multipart upload parsing for routes that declare file fields.

## Install

```bash
npm install @axiomify/upload busboy
```

## Export

- `useUpload(app)`

## How It Works

`useUpload(app)` installs hooks. Actual file handling is driven by `schema.files` on individual routes.

## Route Example

```ts
useUpload(app);

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
