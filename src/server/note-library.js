"use strict";
const fs = require("node:fs/promises"), path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const NOTE = require("../../public/note-card.js");
const key = id => createHash("sha256").update(id).digest("hex");
const fingerprint = entry => key(JSON.stringify(NOTE.libraryEntry(entry)));

// Each acknowledged write has reached disk before the HTTP response. Previous
// revisions are retained for recovery; absence from a Canvas never deletes one.
class NoteLibrary {
  constructor(directory, connector = () => null) {
    this.directory = directory;
    this.connector = connector;
    this.queue = Promise.resolve();
    this.syncing = null;
  }
  async atomic(file, value) {
    await fs.mkdir(path.dirname(file), { recursive:true });
    const temporary = `${file}.${randomUUID()}.tmp`, handle = await fs.open(temporary, "wx", 0o600);
    try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); }
    finally { await handle.close(); }
    await fs.rename(temporary, file);
    const folder = await fs.open(path.dirname(file), "r");
    try { await folder.sync(); } finally { await folder.close(); }
  }
  serial(run) {
    const operation = this.queue.then(run);
    this.queue = operation.catch(() => {});
    return operation;
  }
  async read(id) {
    try { return JSON.parse(await fs.readFile(path.join(this.directory, `${key(id)}.json`), "utf8")); }
    catch (error) { if (error.code === "ENOENT") return null; throw error; }
  }
  async records() {
    let names;
    try { names = await fs.readdir(this.directory); } catch (error) { if (error.code === "ENOENT") return []; throw error; }
    return Promise.all(names.filter(name => /^[a-f0-9]{64}\.json$/.test(name)).map(async name => JSON.parse(await fs.readFile(path.join(this.directory, name), "utf8"))));
  }
  view(record) {
    const status = this.connector()?.status(), owner = status?.account?.id;
    return { ...record.entry, version:record.version,
      storage:{ server:true, cloud:record.conflict ? "conflict" : record.cloudAccountId && record.cloudAccountId !== owner ? "other-account"
        : record.cloudVersion && !record.cloudPending ? "saved" : status?.accountSession?.signedIn ? "pending" : "signed-out" } };
  }
  async list() { await this.queue; return (await this.records()).map(record => this.view(record)); }
  async page(options) { return NOTE.libraryPage(await this.list(), options); }
  async get(id) {
    await this.queue;
    const record = await this.read(id);
    if (!record) throw Object.assign(Error("Note not found."), { status:404 });
    return this.view(record);
  }
  async write(previous, next) {
    if (previous) await this.atomic(path.join(this.directory, "history", key(next.entry.id), `${previous.version}.json`), previous);
    await this.atomic(path.join(this.directory, `${key(next.entry.id)}.json`), next);
  }
  async put(raw, expectedVersion = 0) {
    const entry = NOTE.libraryEntry(raw);
    return this.serial(async () => {
      const previous = await this.read(entry.id), contentKey = fingerprint(entry);
      if (previous?.contentKey === contentKey) return this.view(previous);
      if ((previous?.version || 0) !== expectedVersion) throw Object.assign(Error("This note changed in another window. Both copies have been retained; reload Notes & Cards before retrying."), { status:409, code:"note_version_conflict" });
      const next = { ...previous, entry, contentKey, version:(previous?.version || 0) + 1, cloudPending:true, conflict:false };
      await this.write(previous, next);
      return this.view(next);
    });
  }
  // The outbox lives in each durable record, so closing the browser or server
  // during upload leaves a retryable write. Account changes never re-upload
  // another account's existing library into the new account.
  syncCloud() {
    if (this.syncing) return this.syncing;
    this.syncing = this.runCloudSync().finally(() => { this.syncing = null; });
    return this.syncing;
  }
  async runCloudSync() {
    const connector = this.connector(), status = connector?.status(), accountId = status?.account?.id;
    if (!accountId || !status.accountSession?.signedIn) return;
    const sameAccount = () => connector.status().account?.id === accountId && connector.status().accountSession?.signedIn;
    for (const snapshot of await this.records()) {
      if (!sameAccount()) return;
      if (!snapshot.cloudPending || snapshot.conflict || snapshot.cloudAccountId && snapshot.cloudAccountId !== accountId) continue;
      try {
        const result = await connector.saveNote(snapshot.entry.id, snapshot.entry, snapshot.cloudVersion || 0);
        await this.serial(async () => {
          const current = await this.read(snapshot.entry.id);
          if (!current || !sameAccount()) return;
          await this.atomic(path.join(this.directory, `${key(current.entry.id)}.json`), {
            ...current, cloudAccountId:accountId, cloudVersion:result.version,
            cloudPending:current.contentKey !== snapshot.contentKey, conflict:false,
          });
        });
      } catch (error) {
        if (error.status !== 409) throw error;
        await this.serial(async () => {
          const current = await this.read(snapshot.entry.id);
          if (current && sameAccount()) await this.atomic(path.join(this.directory, `${key(current.entry.id)}.json`), { ...current, conflict:true, cloudAccountId:accountId });
        });
      }
    }
    let cursor = "";
    do {
      const page = await connector.listNotes(cursor);
      for (const summary of page.notes) {
        if (!sameAccount()) return;
        const local = await this.read(summary.id);
        if (local && (local.cloudAccountId && local.cloudAccountId !== accountId || local.cloudPending || local.cloudVersion >= summary.version)) continue;
        const remote = await connector.getNote(summary.id);
        if (!sameAccount()) return;
        await this.serial(async () => {
          const current = await this.read(summary.id);
          if (current?.cloudAccountId && current.cloudAccountId !== accountId || current?.cloudPending || current?.cloudVersion >= remote.version) return;
          const entry = NOTE.libraryEntry(remote.entry), next = { entry, contentKey:fingerprint(entry), version:(current?.version || 0) + 1,
            cloudAccountId:accountId, cloudVersion:remote.version, cloudPending:false, conflict:false };
          await this.write(current, next);
        });
      }
      cursor = page.nextCursor || "";
    } while (cursor && sameAccount());
  }
}
module.exports = { NoteLibrary };
