# PenEcho Canvas Bundle v2

Status: stable for PenEcho 0.8.x. Changes to required fields or existing asset semantics require a new `formatVersion` and a backward-compatible reader.

## Goals

- One self-contained JSON object for server storage, browser sharing, export, and import.
- No device paths, server object URLs, access tokens, project IDs, or other environment-specific state inside the portable content.
- Keep independently evolving content separate: raster tiles, preview, widgets, images, and future attachments are individual assets inside one bundle.
- Match the PenEcho Cloud bundle envelope so the same content can move between the local server and cloud storage without conversion.

## Portable envelope

```json
{
  "version": 2,
  "bundleVersion": 2,
  "mode": "snapshot",
  "formatVersion": 1,
  "extensions": {},
  "manifest": {},
  "assets": []
}
```

`bundleVersion` describes the single-object container. `formatVersion` describes PenEcho canvas semantics. `mode` is `snapshot`; PenEcho Cloud may additionally accept a transport-only `patch` and materialize it to a snapshot before sharing or export. Local writers include `version: 2`; readers also recognize a Cloud bundle that identifies itself only with `bundleVersion: 2`.

## Manifest

The manifest follows the existing PenEcho Cloud portable format:

- `format`: `penecho-raster-tiles`.
- `formatVersion`: currently `1`.
- `canvasSize` and `tileSize`.
- `theme` and `view`.
- `animations` and `textBoxes` when present.
- `savedAt`, an ISO timestamp describing the captured content.
- `extensions`, reserved for namespaced future metadata.

Canvas ID, name, creation/modification timestamps, project membership, ownership, and sharing policy are storage-index metadata. They are not part of the manifest. This lets the same Bundle be imported into another account, embedded in a shared web page, or moved between projects without rewriting its content.

The local server API may attach `id`, `name`, `createdAt`, `updatedAt`, and `projectId` to a Bundle response. These fields are an import/export transport wrapper: the stored portable Bundle excludes them except for `version`, and importing a Bundle without an ID assigns a new local identity.

## Assets

Every asset has `kind`, `contentType`, `metadata`, and `dataBase64`. Core asset keys are unique:

- `preview`: one WebP or legacy PNG thumbnail. Metadata includes its dimensions.
- `tile`: one PNG raster tile. Metadata includes `tileKey`.
- `widget`: one UTF-8 JSON widget record. Metadata includes `widgetId` matching the decoded record and may include `pluginId`.
- `resource` with `resourceType: image`: one placed image. Metadata contains its stable `resourceId`, position, dimensions, and source name.

Future portable data should use a namespaced entry in `manifest.extensions`, or a `resource`, `attachment`, or `export` asset with a stable ID and MIME type. Binary payloads remain embedded, so loading shared or imported content never depends on expiring links. The local server preserves supported extension metadata and non-core assets without executing them; clients safely ignore extensions they do not understand.

## Compatibility and migration

- A legacy local aggregate snapshot with no version, or with `version: 1`, uses the v1 reader.
- A Bundle with `bundleVersion: 2` uses the v2 reader even when the optional local `version` field is absent.
- Successful v1 loads are written as v2 on the next save; listing does not rewrite old files.
- v2 writers keep Widget and image identities stable and update the external modification timestamp.
- The history index is not authoritative canvas content. It contains project membership, counts, modification time, and the preview for fast listing.

## Projects and sharing

Projects exist only in PenEcho server storage. `uncategorized` is permanent. Creating, moving, or deleting a project updates external metadata; deleting a project immediately moves its canvases to `uncategorized` and does not rewrite Bundle content. Device-only IndexedDB snapshots do not expose project organization.

For export or web sharing, the server can return the latest snapshot Bundle directly. For import, the same Bundle can be posted back with or without its transport metadata. This boundary leaves room for future share links, access-control metadata, revision history, partial upload transport, and additional asset types without changing the portable canvas semantics.
