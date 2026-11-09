import "server-only";

import { ChangeSet, Text } from "@codemirror/state";
import { db, DriveProblem } from "../drive";
import { noteFor, saveNote, textOf, type NoteMeta } from "./index";

/*
 * 共 Writing a note together. While anyone has a note open, the Portal holds
 * it here: the text, and every change made to it since, numbered. Each page
 * sends its changes against the number it has seen (CodeMirror's collab
 * protocol); one that has fallen behind is refused, takes the changes it
 * missed, and sends again, so everyone ends with the same text. Changes and
 * where everyone's cursor is go out to every page as they come. The text is
 * saved to Drive a moment after the typing stops, by whoever typed last. An
 * edit made elsewhere (the phone, Kimono AI) comes in as a change; one that
 * lands while there's unsaved typing here is kept as a copy, as Drive does.
 */

type Update = { clientID: string; changes: unknown };
export type Cursor = { clientID: string; username: string; anchor: number | null; head: number | null; at: number };
export type LiveEvent =
  | { type: "updates"; from: number; updates: Update[] }
  | { type: "cursors"; cursors: Cursor[] }
  | { type: "saved"; note: NoteMeta }
  | { type: "copy"; note: NoteMeta }
  | { type: "gone" };

type Room = {
  id: string; doc: Text; updates: (Update & { set: ChangeSet })[];
  /** Drive's content version the text was last saved at or read from. */
  saved: number; savedAt: number;
  /** Changes since the last save, and who made the newest. */
  dirty: boolean; by: string | null;
  saving: boolean; again: boolean; timer: ReturnType<typeof setTimeout> | null; firstDirty: number;
  cursors: Map<string, Cursor>;
  /** Pages listening now, by their name: only their cursors stay. */
  listening: Map<string, number>;
  listeners: Set<(event: LiveEvent) => void>;
  idleSince: number;
};

/* Kept across hot reloads in development, as Drive's connection is. */
const cache = globalThis as unknown as { kimonoNoteRooms?: Map<string, Promise<Room>>; kimonoNoteSweep?: ReturnType<typeof setInterval> };
const rooms = (cache.kimonoNoteRooms ??= new Map());

const saveAfter = 900, saveAtMost = 5000;
const textOfDoc = (text: string) => Text.of(text.split("\n"));

async function open(id: string, username: string): Promise<Room> {
  noteFor(db(), id, username);
  let room = rooms.get(id);
  if (!room) {
    room = (async () => {
      const { blob, version } = noteFor(db(), id, username);
      return {
        id, doc: textOfDoc(await textOf(blob)), updates: [], saved: version, savedAt: Date.now(), dirty: false, by: null,
        saving: false, again: false, timer: null, firstDirty: 0, cursors: new Map(), listening: new Map(), listeners: new Set(), idleSince: Date.now(),
      } satisfies Room;
    })();
    rooms.set(id, room);
    room.catch(() => rooms.delete(id));
    sweepSoon();
  }
  const opened = await room;
  /* A room made by older code, kept over a hot reload in development. */
  opened.listening ??= new Map();
  return opened;
}

function tell(room: Room, event: LiveEvent) { for (const listener of room.listeners) listener(event); }
const cursorsOf = (room: Room) => [...room.cursors.values()];

/** The note as it is now: its text and the number of changes made to it, to start from. */
export async function join(id: string, username: string) {
  const room = await open(id, username);
  return { version: room.updates.length, text: room.doc.toString(), cursors: cursorsOf(room) };
}

/**
 * Listens to the note from change [from] on: the changes since then first,
 * then each as it comes, and where everyone is. The listener's own cursor
 * goes when it stops listening. Null when [from] is ahead of what's here
 * (the Portal restarted): the page starts again from join.
 */
export async function listen(id: string, username: string, clientID: string, from: number, send: (event: LiveEvent) => void): Promise<(() => void) | null> {
  const room = await open(id, username);
  if (from > room.updates.length) return null;
  if (from < room.updates.length) send({ type: "updates", from, updates: room.updates.slice(from).map(({ clientID, changes }) => ({ clientID, changes })) });
  room.listeners.add(send);
  room.listening.set(clientID, (room.listening.get(clientID) ?? 0) + 1);
  if (!room.cursors.has(clientID)) room.cursors.set(clientID, { clientID, username: username.toLowerCase(), anchor: null, head: null, at: Date.now() });
  tell(room, { type: "cursors", cursors: cursorsOf(room) });
  return () => {
    room.listeners.delete(send);
    const left = (room.listening.get(clientID) ?? 1) - 1;
    if (left > 0) room.listening.set(clientID, left); else { room.listening.delete(clientID); room.cursors.delete(clientID); }
    if (!room.listeners.size) room.idleSince = Date.now();
    tell(room, { type: "cursors", cursors: cursorsOf(room) });
  };
}

/** Changes made on a page that had seen [version] changes. False when it is behind: it takes what it missed, then sends again. */
export async function push(id: string, username: string, clientID: string, version: number, updates: { changes: unknown }[]): Promise<boolean> {
  noteFor(db(), id, username, "editor");
  const room = await open(id, username);
  if (version !== room.updates.length) return false;
  const added: Update[] = [];
  let doc = room.doc;
  const sets: ChangeSet[] = [];
  for (const update of updates) {
    let set: ChangeSet;
    try { set = ChangeSet.fromJSON(update.changes); } catch { throw new DriveProblem("That change doesn't fit the note."); }
    if (set.length !== doc.length) throw new DriveProblem("That change doesn't fit the note.");
    doc = set.apply(doc);
    sets.push(set);
  }
  sets.forEach((set, i) => { room.updates.push({ clientID, changes: updates[i].changes, set }); added.push({ clientID, changes: updates[i].changes }); });
  room.doc = doc;
  for (const cursor of room.cursors.values()) {
    if (cursor.head === null || cursor.anchor === null) continue;
    for (const set of sets) { cursor.anchor = set.mapPos(cursor.anchor!, -1); cursor.head = set.mapPos(cursor.head!, 1); }
  }
  tell(room, { type: "updates", from: version, updates: added });
  changed(room, username);
  return true;
}

/** Where someone's cursor is, in the note as it was after [version] changes. */
export async function moveCursor(id: string, username: string, clientID: string, version: number, anchor: number, head: number) {
  const room = await open(id, username);
  if (version > room.updates.length) return;
  for (const { set } of room.updates.slice(version)) { anchor = set.mapPos(anchor, -1); head = set.mapPos(head, 1); }
  const most = room.doc.length;
  room.cursors.set(clientID, { clientID, username: username.toLowerCase(), anchor: Math.min(Math.max(0, anchor), most), head: Math.min(Math.max(0, head), most), at: Date.now() });
  tell(room, { type: "cursors", cursors: cursorsOf(room) });
}

/** The note's details changed some other way (retitled, moved): pages showing it follow. */
export async function noteChanged(note: NoteMeta) {
  const room = rooms.get(note.id);
  if (room) tell(await room, { type: "saved", note });
}

/* ── saving ── */

function changed(room: Room, username: string) {
  if (!room.dirty) room.firstDirty = Date.now();
  room.dirty = true; room.by = username;
  if (room.timer) clearTimeout(room.timer);
  const wait = Math.max(0, Math.min(saveAfter, room.firstDirty + saveAtMost - Date.now()));
  room.timer = setTimeout(() => void save(room), wait);
}

/** A change taking [from] to [to], as small as their shared start and end allow. */
function difference(from: Text, to: string): ChangeSet {
  const now = from.toString();
  let start = 0;
  while (start < now.length && start < to.length && now[start] === to[start]) start++;
  let end = 0;
  while (end < now.length - start && end < to.length - start && now[now.length - 1 - end] === to[to.length - 1 - end]) end++;
  return ChangeSet.of([{ from: start, to: now.length - end, insert: to.slice(start, to.length - end) }], from.length);
}

/* Someone else's text, put in as a change everyone receives. */
function adopt(room: Room, text: string) {
  if (room.doc.toString() === text) return;
  const set = difference(room.doc, text);
  const update = { clientID: "kimono", changes: set.toJSON() };
  const from = room.updates.length;
  room.updates.push({ ...update, set });
  room.doc = set.apply(room.doc);
  for (const cursor of room.cursors.values()) if (cursor.anchor !== null && cursor.head !== null) { cursor.anchor = set.mapPos(cursor.anchor, -1); cursor.head = set.mapPos(cursor.head, 1); }
  tell(room, { type: "updates", from, updates: [update] });
}

async function save(room: Room) {
  if (room.timer) { clearTimeout(room.timer); room.timer = null; }
  if (!room.dirty || !room.by) return;
  if (room.saving) { room.again = true; return; }
  room.saving = true;
  const at = room.updates.length, text = room.doc.toString(), by = room.by;
  try {
    const { note, conflict } = await saveNote(by, room.id, { text, version: room.saved });
    if (!conflict) {
      room.saved = note.version; room.savedAt = Date.now();
      room.dirty = room.updates.length !== at;
      tell(room, { type: "saved", note });
    } else {
      /* It was changed elsewhere first: theirs stays, this is kept beside it, and everyone goes on from theirs. */
      tell(room, { type: "copy", note });
      const theirs = noteFor(db(), room.id, by);
      room.saved = theirs.version; room.savedAt = Date.now();
      room.dirty = false;
      adopt(room, await textOf(theirs.blob));
      const { blob, ...meta } = theirs; void blob;
      tell(room, { type: "saved", note: meta });
    }
  } catch (error) {
    if (error instanceof DriveProblem && error.status === 404) { tell(room, { type: "gone" }); rooms.delete(room.id); return; }
    /* Kept, and tried again in a moment. */
    console.warn("Notes: saving a note being written together failed:", error instanceof Error ? error.message : error);
    room.timer = setTimeout(() => void save(room), 5000);
  } finally {
    room.saving = false;
    if (room.again) { room.again = false; if (room.dirty) void save(room); }
  }
}

/* ── looking after the rooms ── */

/*
 * Every few seconds: a note changed elsewhere with nothing unsaved here takes
 * the new text; one nobody has had open for a while is saved and let go.
 */
function sweepSoon() {
  if (cache.kimonoNoteSweep) return;
  cache.kimonoNoteSweep = setInterval(() => void sweep(), 5000);
  cache.kimonoNoteSweep.unref?.();
}

async function sweep() {
  for (const [id, pending] of rooms) {
    let room: Room;
    try { room = await pending; } catch { continue; }
    /* A cursor from a page that isn't listening (it closed, or only sent) goes after a little while. */
    let dropped = false;
    room.listening ??= new Map();
    for (const [client, cursor] of room.cursors) if (!room.listening.has(client) && Date.now() - cursor.at > 20_000) { room.cursors.delete(client); dropped = true; }
    if (dropped) tell(room, { type: "cursors", cursors: cursorsOf(room) });
    if (room.dirty || room.saving) {
      if (!room.listeners.size && !room.timer) void save(room);
      continue;
    }
    if (!room.listeners.size && Date.now() - room.idleSince > 2 * 60_000) { rooms.delete(id); continue; }
    const row = db().prepare("SELECT content_version, blob, trashed_at FROM nodes WHERE id = ?").get(id) as { content_version: number; blob: string | null; trashed_at: number | null } | undefined;
    if (!row || row.trashed_at) { tell(room, { type: "gone" }); rooms.delete(id); continue; }
    if (row.content_version !== room.saved) {
      room.saved = row.content_version; room.savedAt = Date.now();
      adopt(room, await textOf(row.blob));
    }
  }
  if (!rooms.size && cache.kimonoNoteSweep) { clearInterval(cache.kimonoNoteSweep); cache.kimonoNoteSweep = undefined; }
}

/* Over a hot reload in development, the timer kept from before runs this code from now on. */
if (cache.kimonoNoteSweep) { clearInterval(cache.kimonoNoteSweep); cache.kimonoNoteSweep = undefined; if (rooms.size) sweepSoon(); }
