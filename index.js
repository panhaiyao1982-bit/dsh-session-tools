/**
 * Host half of the Session tools bundle.
 *
 * One owner for three operations the shipped sidebar does not offer:
 *
 *  - **lock**     — a durable "do not delete or move" mark, enforced by this
 *                   Host half on every mutating route,
 *  - **recycle bin** — a Session's log directory (and optionally the files the
 *                   Session wrote) is moved out of the Session store instead of
 *                   being unlinked, so the operation stays reversible,
 *  - **move**     — a Session plus the files it produced is relocated into
 *                   another workspace: the produced files are moved, the
 *                   Session's own header `cwd` is rewritten inside the first
 *                   zstd frame of its log, and the Workspace registry account is
 *                   re-pointed.
 *
 * Why the header rewrite is not optional: `@deepseek-ai/dsh-workspace` derives a
 * Session's membership from `realpath(header.cwd) === workspace.path`, and both
 * `WorkspaceEntity.sessionIds` and the startup header index enforce it. A record
 * that claims a Session for a workspace it does not belong to is filtered out of
 * every projection at the next start, so a move that skipped the rewrite would
 * silently lose the row.
 *
 * Everything here reads and writes the same durable files the shipped packages
 * use, and the only in-memory reach-through is the registry's own account writer
 * and its canonical-cwd index; both are guarded and reported instead of assumed.
 *
 * @module dsh-session-tools/host
 */

import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import zlib from 'node:zlib'

const STATE_VERSION = 1
const ROUTE = '/api/session-tools'
/**
 * Stamp of the Host build that is actually loaded. `apply` records it beside the
 * plugin state so a support question ("is the running copy the one I installed?")
 * has an answer on disk instead of a guess.
 */
const BUILD = '0.1.6+2026-11-08T13:42'
const LOG_PREFIX = 'session.'
const LOG_SUFFIX = '.jsonl.zstd'
const SESSION_FORMAT_VERSION = 4
const MAX_LOG_BYTES = 512 * 1024 * 1024
const WRITE_TOOLS = new Set(['write', 'edit', 'multi_edit', 'apply_patch'])
/** How many Session relocations are remembered; enough to undo a long history of moves. */
const MAX_RELOCATIONS = 5000

/** A refusal the browser can explain: `code` names the reason, `message` is the sentence. */
class ToolError extends Error {
	/**
	 * @param code - Stable machine reason.
	 * @param message - Operator-facing sentence.
	 * @param detail - Optional structured context for the Client.
	 */
	constructor(code, message, detail) {
		super(message)
		this.name = 'SessionToolError'
		this.code = code
		this.detail = detail
	}
}

/**
 * @param code - Stable machine reason.
 * @param message - Operator-facing sentence.
 * @param detail - Optional structured context.
 * @returns the refusal to throw.
 */
const refuse = (code, message, detail) => new ToolError(code, message, detail)

//#region storage layout
/*
 * The Session store's physical layout belongs to @deepseek-ai/dsh-session-persistence-jsonl:
 * `<root>/<projectKey(cwd)>/<encodeSegment(id)>/session.<v>.jsonl.zstd`. The two
 * encoders below are byte-for-byte ports of that package's own, because moving a
 * Session means writing into exactly the directory its reader will scan.
 */

/**
 * Escape one path segment the way the JSONL Session backend does.
 * @param raw - Unescaped segment.
 * @returns a single filesystem-safe segment.
 */
function encodeSegment(raw) {
	if (raw.length === 0) throw new Error('cannot encode an empty path segment')
	if (raw === '.') return '~002E'
	if (raw === '..') return '~002E~002E'
	let out = ''
	for (let i = 0; i < raw.length; i++) {
		const code = raw.charCodeAt(i)
		const ch = String.fromCharCode(code)
		if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) out += ch
		else out += '~' + code.toString(16).toUpperCase().padStart(4, '0')
	}
	return out
}

/**
 * Build the readable project directory key for one workspace path.
 * @param cwd - Canonical workspace path.
 * @returns the directory name the Session store groups that path under.
 */
function projectKey(cwd) {
	if (cwd.length === 0) throw new Error('cannot encode an empty project path')
	let readable = ''
	let separatorRun = false
	for (let i = 0; i < cwd.length; i++) {
		const code = cwd.charCodeAt(i)
		const ch = String.fromCharCode(code)
		if (ch === '/' || ch === '\\' || ch === ':') {
			if (!separatorRun) readable += '-'
			separatorRun = true
		} else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
			readable += ch
			separatorRun = false
		} else {
			readable += '~' + code.toString(16).toUpperCase().padStart(4, '0')
			separatorRun = false
		}
	}
	return `--${(readable.replace(/^-+/, '') || 'root').slice(0, 251)}--`
}

/**
 * Resolve the Harness home directory the same way other Host plugins do.
 * @param ctx - Host context.
 * @returns the absolute home directory.
 */
function dshHome(ctx) {
	try {
		const helper = ctx.get('dshHomePath')
		if (typeof helper === 'function') {
			const value = helper()
			if (typeof value === 'string' && value !== '') return value
		}
	} catch {
		/* a Host without the helper still has the conventional directory */
	}
	return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

/**
 * Locate the directory one Session owns, without trusting a computed key.
 * @param root - Session store root.
 * @param sessionId - Session identity.
 * @returns the owning directory, or undefined when the log is gone.
 */
async function findSessionDir(root, sessionId) {
	const segment = encodeSegment(sessionId)
	let projects
	try {
		projects = await fs.readdir(root, { withFileTypes: true })
	} catch {
		return undefined
	}
	for (const project of projects) {
		if (!project.isDirectory()) continue
		const candidate = join(root, project.name, segment)
		try {
			const entries = await fs.readdir(candidate)
			if (entries.some((name) => name.startsWith(LOG_PREFIX) && name.endsWith(LOG_SUFFIX))) return candidate
		} catch {
			/* not this project */
		}
	}
	return undefined
}

/**
 * Every Session directory present in the store, without reading a single log.
 *
 * Only `session-…` identities are user Sessions: a subagent child is created with a
 * bare uuid and is never listed in the sidebar, so the prefix is the same filter the
 * sidebar applies through its `origin` check — obtained here for the price of two
 * directory listings.
 *
 * @param root - Session store root.
 * @returns the on-disk Session identities.
 */
async function listSessionIds(root) {
	const ids = new Set()
	let projects
	try {
		projects = await fs.readdir(root, { withFileTypes: true })
	} catch {
		return ids
	}
	for (const project of projects) {
		if (!project.isDirectory()) continue
		let entries
		try {
			entries = await fs.readdir(join(root, project.name), { withFileTypes: true })
		} catch {
			continue
		}
		for (const entry of entries) {
			if (entry.isDirectory() && entry.name.startsWith('session-')) ids.add(entry.name)
		}
	}
	return ids
}

/**
 * Cached display titles, read from the projection cache the app itself rebuilds.
 *
 * A batch panel needs a title per row and cannot pay for a log read each; the cache
 * file is one small JSON per Session and its `title` projection is the same string the
 * sidebar renders. A missing or unreadable cache simply yields no title, which the
 * panel labels as untitled rather than inventing one.
 *
 * @param cacheDir - Projection cache directory.
 * @param sessionIds - Session identities to look up.
 * @returns title by Session identity.
 */
async function cachedTitles(cacheDir, sessionIds) {
	const titles = new Map()
	const queue = [...sessionIds]
	const worker = async () => {
		for (;;) {
			const sessionId = queue.pop()
			if (sessionId === undefined) return
			try {
				const raw = await fs.readFile(join(cacheDir, `${sessionId}.json`), 'utf8')
				const value = JSON.parse(raw)?.record?.rows?.title?.val
				if (typeof value === 'string' && value.trim() !== '') titles.set(sessionId, value)
			} catch {
				/* no cache row: the panel shows the Session as untitled */
			}
		}
	}
	await Promise.all(Array.from({ length: Math.min(16, queue.length) }, worker))
	return titles
}

/**
 * Read a Session's own early log: the title it recorded, and whether it ever carried a
 * message from the reader.
 *
 * The projection cache covers every Session the app has opened at least once, so this
 * runs only for the ones it never saw. Those are exactly the Sessions that may be empty
 * shells — a log with a header and nothing else, created when a conversation was opened
 * and then abandoned — and calling one "untitled" hides what it actually is. The log is
 * read whole here but only for those rows, and an oversized log is refused outright.
 *
 * @param logFile - Absolute log path.
 * @returns the recorded title and whether any user message exists.
 */
async function inspectLog(logFile) {
	if (!hasZstd()) return { blank: false }
	let stat
	try {
		stat = await fs.stat(logFile)
	} catch {
		return { blank: false }
	}
	if (stat.size > 64 * 1024 * 1024) return { blank: false }
	let buf
	try {
		buf = await fs.readFile(logFile)
	} catch {
		return { blank: false }
	}
	let offset = 0
	let title
	let spoke = false
	while (offset < buf.length) {
		let length
		try {
			length = frameLength(buf, offset)
		} catch {
			break
		}
		let text
		try {
			text = zlib.zstdDecompressSync(buf.subarray(offset, offset + length)).toString('utf8')
		} catch {
			break
		}
		if (!spoke && text.includes('"type":"user/message"')) spoke = true
		if (title === undefined && text.includes('session/title')) {
			for (const line of text.split('\n')) {
				if (line === '' || !line.includes('session/title')) continue
				try {
					const event = JSON.parse(line)
					const value = event?.data?.title ?? event?.data?.value ?? event?.data?.text
					if (typeof value === 'string' && value.trim() !== '') {
						title = value
						break
					}
				} catch {
					/* a torn line is not a title */
				}
			}
		}
		offset += length
		if (title !== undefined && spoke) break
	}
	return { title, blank: title === undefined && !spoke }
}

/**
 * The current-generation log inside one Session directory.
 * @param dir - Session directory.
 * @returns the absolute log path, or undefined when no log generation is present.
 */
async function logFileOf(dir) {
	const preferred = join(dir, `${LOG_PREFIX}v${SESSION_FORMAT_VERSION}${LOG_SUFFIX}`)
	if (existsSync(preferred)) return preferred
	const entries = await fs.readdir(dir).catch(() => [])
	const found = entries.filter((name) => name.startsWith(LOG_PREFIX) && name.endsWith(LOG_SUFFIX)).sort().pop()
	return found === undefined ? undefined : join(dir, found)
}
//#endregion

//#region zstd frames
/*
 * A Session log is a concatenation of independent zstd frames: frame 1 holds the
 * header line, every later frame holds one appended batch. `zlib.zstdDecompressSync`
 * stops at the first frame, so the frame walker below finds the first frame's exact
 * end; the rewrite then replaces only that frame and copies every byte after it,
 * which is what keeps the append-only log intact.
 */

/**
 * Measure one zstd frame at `start`, following the format's own header and block
 * tables rather than searching for the next magic.
 * @param buf - Buffer containing the frame.
 * @param start - Offset of the frame magic.
 * @returns the frame's byte length.
 */
function frameLength(buf, start = 0) {
	if (buf.length - start < 8 || buf.readUInt32LE(start) !== 0xfd2fb528) throw new Error('not a zstd frame')
	let i = start + 4
	const descriptor = buf[i++]
	const contentSizeFlag = descriptor >> 6
	const singleSegment = (descriptor >> 5) & 1
	const checksum = (descriptor >> 2) & 1
	const dictFlag = descriptor & 3
	if (!singleSegment) i += 1
	i += [0, 1, 2, 4][dictFlag]
	i += [singleSegment ? 1 : 0, 2, 4, 8][contentSizeFlag]
	for (;;) {
		if (i + 3 > buf.length) throw new Error('truncated zstd block header')
		const header = buf[i] | (buf[i + 1] << 8) | (buf[i + 2] << 16)
		const last = header & 1
		const type = (header >> 1) & 3
		const size = header >>> 3
		i += 3
		if (type === 0 || type === 2) i += size
		else if (type === 1) i += 1
		else throw new Error('reserved zstd block type')
		if (last) break
	}
	if (checksum) i += 4
	return i - start
}

/** @returns whether this runtime can read and rewrite zstd frames. */
function hasZstd() {
	return typeof zlib.zstdDecompressSync === 'function' && typeof zlib.zstdCompressSync === 'function'
}

/**
 * Read the Session header recorded in frame 1.
 * @param logFile - Absolute log path.
 * @returns the parsed header object.
 */
async function readHeader(logFile) {
	const buf = await fs.readFile(logFile)
	const length = frameLength(buf, 0)
	const head = zlib.zstdDecompressSync(buf.subarray(0, length)).toString('utf8')
	const firstLine = head.split('\n', 1)[0]
	const header = JSON.parse(firstLine)
	if (header === null || typeof header !== 'object') throw new Error('Session header is not an object')
	return header
}

/**
 * Replace the header's `cwd`, leaving every later frame untouched.
 * @param logFile - Absolute log path.
 * @param cwd - New canonical workspace path.
 * @returns true when the frame was rewritten.
 */
async function rewriteHeaderCwd(logFile, cwd) {
	if (!hasZstd()) throw refuse('unsupported/zstd', 'This runtime has no zstd support, so a Session cannot change workspace.')
	const buf = await fs.readFile(logFile)
	const length = frameLength(buf, 0)
	const head = zlib.zstdDecompressSync(buf.subarray(0, length)).toString('utf8')
	const newline = head.indexOf('\n')
	const firstLine = newline === -1 ? head : head.slice(0, newline)
	const tail = newline === -1 ? '\n' : head.slice(newline)
	const header = JSON.parse(firstLine)
	if (header.type !== 'session') throw refuse('session/format', `Unrecognised Session header (type ${String(header.type)}).`)
	if (header.cwd === cwd) return false
	header.cwd = cwd
	const frame = zlib.zstdCompressSync(Buffer.from(JSON.stringify(header) + tail, 'utf8'))
	const staging = `${logFile}.session-tools-tmp`
	await fs.writeFile(staging, Buffer.concat([frame, buf.subarray(length)]))
	await fs.rename(staging, logFile)
	return true
}

/**
 * Read every event line of a log, following the frame chain.
 * @param logFile - Absolute log path.
 * @returns parsed events, oldest first.
 */
async function readEvents(logFile) {
	let buf
	try {
		buf = await fs.readFile(logFile)
	} catch {
		return []
	}
	if (buf.length > MAX_LOG_BYTES) buf = buf.subarray(0, MAX_LOG_BYTES)
	const events = []
	let offset = 0
	while (offset < buf.length) {
		let length
		try {
			length = frameLength(buf, offset)
		} catch {
			break
		}
		let text
		try {
			text = zlib.zstdDecompressSync(buf.subarray(offset, offset + length)).toString('utf8')
		} catch {
			break
		}
		for (const line of text.split('\n')) {
			if (line === '') continue
			try {
				events.push(JSON.parse(line))
			} catch {
				/* a torn tail line is not an event */
			}
		}
		offset += length
	}
	return events
}
//#endregion

//#region produced files
/**
 * Parse one tool call's argument payload.
 * @param raw - Serialized arguments.
 * @returns the parsed object, or undefined.
 */
function parseArguments(raw) {
	if (typeof raw === 'string') {
		try {
			return JSON.parse(raw)
		} catch {
			return undefined
		}
	}
	return raw !== null && typeof raw === 'object' ? raw : undefined
}

/**
 * Every path one Session wrote through a file-writing tool call.
 *
 * The paths come back exactly as the log recorded them — relative entries resolved
 * against the workspace the Session started in — and are not yet filtered by the
 * Session's current workspace, because after a move the recorded spelling still
 * names the old location. {@link reAnchor} maps them forward.
 *
 * @param events - Parsed Session events.
 * @param baseCwd - The workspace path the Session used when those calls were made.
 * @returns absolute paths, first occurrence order.
 */
function writtenPaths(events, baseCwd) {
	const seen = new Map()
	const add = (raw) => {
		if (typeof raw !== 'string' || raw === '') return
		seen.set(resolve(baseCwd, raw), true)
	}
	for (const event of events) {
		if (event?.type !== 'tool/call') continue
		const name = event.data?.name
		if (typeof name !== 'string' || !WRITE_TOOLS.has(name)) continue
		const args = parseArguments(event.data?.arguments)
		if (args === undefined) continue
		if (name === 'apply_patch') {
			const patch = typeof args.patch === 'string' ? args.patch : ''
			for (const match of patch.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)) add(match[1].trim())
			continue
		}
		for (const key of ['file_path', 'path', 'filePath', 'target_file']) add(args[key])
	}
	return [...seen.keys()]
}

/**
 * Whether one absolute path sits inside a directory.
 * @param child - Candidate file path.
 * @param parent - Candidate directory path.
 * @returns true when `child` is inside `parent` and is not `parent` itself.
 */
function isInside(child, parent) {
	return child !== parent && child.startsWith(parent.endsWith(sep) ? parent : parent + sep)
}

/**
 * Follow a Session's recorded relocations to find where a file lives now.
 *
 * A move rewrites the Session's workspace but not the absolute paths already
 * written into its log, so every later question about "the files this Session
 * wrote" has to be answered through the chain of moves it went through. The chain
 * is applied oldest-first, which is what makes a move and its undo a round trip.
 *
 * @param recorded - Absolute path as the log spelled it.
 * @param moves - That Session's relocations, oldest first.
 * @returns the path the file occupies now.
 */
function reAnchor(recorded, moves) {
	let current = recorded
	for (const move of moves) {
		if (!isInside(current, move.from)) continue
		current = join(move.to, relative(move.from, current))
	}
	return current
}

/**
 * Describe the regular files among the given paths, restricted to one directory.
 * @param paths - Absolute candidate paths.
 * @param cwd - The Session's current workspace path.
 * @returns file descriptors for regular files that exist inside that workspace.
 */
async function describeFiles(paths, cwd) {
	const files = []
	const seen = new Set()
	for (const path of paths) {
		if (!isInside(path, cwd) || seen.has(path)) continue
		seen.add(path)
		let stat
		try {
			stat = await fs.stat(path)
		} catch {
			continue
		}
		if (!stat.isFile()) continue
		files.push({ path, rel: relative(cwd, path), bytes: stat.size })
	}
	return files
}

/**
 * The Session's display title, folded from its own log.
 * @param events - Parsed Session events.
 * @param fallback - Value used when the log carries no title.
 * @returns the title.
 */
function titleOf(events, fallback) {
	for (let i = events.length - 1; i >= 0; i--) {
		const event = events[i]
		if (event?.type !== 'session/title') continue
		const data = event.data ?? {}
		const candidate = data.title ?? data.value ?? data.text ?? data.snapshot?.title
		if (typeof candidate === 'string' && candidate.trim() !== '') return candidate
	}
	return fallback
}
//#endregion

//#region filesystem moves
/**
 * Move a file or directory, falling back to copy-and-remove across devices.
 * @param from - Source path.
 * @param to - Destination path.
 */
async function movePath(from, to) {
	try {
		await fs.rename(from, to)
		return
	} catch (error) {
		if (error?.code !== 'EXDEV') throw error
	}
	await fs.cp(from, to, { recursive: true, preserveTimestamps: true })
	await fs.rm(from, { recursive: true, force: true })
}
//#endregion

//#region durable plugin state
/**
 * The plugin's own durable record: lock marks and recycle-bin entries. It lives
 * beside the Session store, never inside the profile, so the lock outlives a
 * profile reinstall and a reinstall never rewrites a user's plugin list.
 * @param base - Plugin data directory.
 * @returns reader and writer over `state.json`.
 */
function createStateStore(base) {
	return {
		path: join(base, 'state.json'),
		async read() {
			try {
				const raw = await fs.readFile(join(base, 'state.json'), 'utf8')
				const parsed = JSON.parse(raw)
				return {
					version: STATE_VERSION,
					locked: Array.isArray(parsed?.locked) ? parsed.locked.filter((id) => typeof id === 'string') : [],
					trash: Array.isArray(parsed?.trash) ? parsed.trash.filter((entry) => entry !== null && typeof entry === 'object' && typeof entry.entryId === 'string') : [],
					relocations: Array.isArray(parsed?.relocations) ? parsed.relocations.filter((move) => move !== null && typeof move === 'object' && typeof move.sessionId === 'string' && typeof move.from === 'string' && typeof move.to === 'string') : [],
				}
			} catch {
				return { version: STATE_VERSION, locked: [], trash: [], relocations: [] }
			}
		},
		async write(state) {
			await fs.mkdir(base, { recursive: true })
			const staging = `${join(base, 'state.json')}.tmp`
			await fs.writeFile(staging, `${JSON.stringify({ version: STATE_VERSION, locked: state.locked, trash: state.trash, relocations: state.relocations }, null, 2)}\n`)
			await fs.rename(staging, join(base, 'state.json'))
		},
	}
}
//#endregion

//#region host context adapters
/**
 * Read the Workspace registry without assuming it is mounted.
 * @param ctx - Host context.
 * @returns the registry service.
 */
function registryOf(ctx) {
	const registry = ctx.get('workspaceRegistry')
	if (registry === undefined || typeof registry.list !== 'function') {
		throw refuse('registry/unavailable', 'The workspace registry is not available in this profile.')
	}
	return registry
}

/**
 * The registry's durable `workspaces` table. Account edits go through it so the
 * domain emits the same `domain/changed` events the shipped controller relays to
 * the sidebar, which is what makes the row move without a reload.
 * @param registry - Workspace registry service.
 * @returns the domain table.
 */
function accountTable(registry) {
	const table = registry.table
	if (table === undefined || typeof table.update !== 'function' || typeof table.entries !== 'function') {
		throw refuse('registry/unavailable', 'The workspace registry does not expose its account table.')
	}
	return table
}

/**
 * The workspace whose account currently claims a Session.
 * @param registry - Workspace registry service.
 * @param sessionId - Session identity.
 * @returns the durable record plus id, when one claims it.
 */
function accountHolding(registry, sessionId) {
	const table = accountTable(registry)
	for (const [workspaceId, record] of table.entries()) {
		if (Array.isArray(record?.sessionIds) && record.sessionIds.includes(sessionId)) {
			return { workspaceId, path: record.path, title: record.title }
		}
	}
	return undefined
}

/**
 * Rewrite one workspace's accounted Session list.
 * @param registry - Workspace registry service.
 * @param workspaceId - Workspace to edit.
 * @param next - Complete replacement list.
 */
async function setAccount(registry, workspaceId, next) {
	const table = accountTable(registry)
	if (table.get(workspaceId) === undefined) throw refuse('workspace/missing', 'That workspace is no longer registered.')
	await table.update(workspaceId, (record) => {
		const unchanged = record.sessionIds.length === next.length && record.sessionIds.every((id, index) => id === next[index])
		if (unchanged) return record
		return { ...record, sessionIds: next, updatedAt: new Date().toISOString() }
	})
	const entity = registry.get(workspaceId)
	const fresh = table.get(workspaceId)
	if (entity !== undefined && fresh !== undefined) entity.record = fresh
}

/**
 * Add a Session to one workspace's account and teach the registry's canonical-cwd
 * index about it. Without the index update the entity's own `sessionIds` getter
 * would filter the Session straight back out of every projection.
 * @param registry - Workspace registry service.
 * @param workspaceId - Destination workspace.
 * @param sessionId - Session identity.
 * @param path - The workspace's canonical path.
 */
async function attachAccount(registry, workspaceId, sessionId, path) {
	const record = accountTable(registry).get(workspaceId)
	if (record === undefined) throw refuse('workspace/missing', 'That workspace is no longer registered.')
	registry.host?.rememberSessionPath?.(sessionId, path)
	await setAccount(registry, workspaceId, [sessionId, ...record.sessionIds.filter((id) => id !== sessionId)])
}

/**
 * Remove a Session from whichever workspace claims it.
 * @param registry - Workspace registry service.
 * @param sessionId - Session identity.
 * @returns the workspace that held it, when one did.
 */
async function detachAccount(registry, sessionId) {
	const holding = accountHolding(registry, sessionId)
	if (holding === undefined) return undefined
	const record = accountTable(registry).get(holding.workspaceId)
	if (record !== undefined) await setAccount(registry, holding.workspaceId, record.sessionIds.filter((id) => id !== sessionId))
	return holding
}
//#endregion

/**
 * Build the Host side of the bundle: durable state, the file operations, and the
 * one route the Client calls.
 * @param ctx - Host context.
 * @returns the request handler.
 */
function createTools(ctx) {
	const base = join(dshHome(ctx), 'session-tools')
	const stateStore = createStateStore(base)
	const sessionRoot = join(dshHome(ctx), 'sessions')
	const projectionCache = join(dshHome(ctx), 'storages', 'session_projcache', 'sessions')

	/**
	 * Announce one Session appearance or removal to the Client's session catalog.
	 *
	 * That catalog is what the sidebar renders rows from, and the shipped Session
	 * Controller only shrinks it when a live Session is disposed. A Session this
	 * plugin lifted out of the store is never disposed, so without this signal its row
	 * would survive until the page rebuilt its catalog — which is exactly what "the
	 * button worked but nothing was deleted" looks like. The removal payload is the
	 * one the controller emits for itself; the addition payload is built through the
	 * controller's own cold-summary path so the shape matches.
	 *
	 * @param kind - `removed` or `added`.
	 * @param payload - Session identity, or the summary to add.
	 */
	const announce = (kind, payload) => {
		if (typeof ctx.emit !== 'function' || payload === undefined) return
		try {
			if (kind === 'removed') ctx.emit('api-session/removed', payload)
			else ctx.emit('api-session/added', payload)
		} catch (error) {
			ctx.logger?.warn?.(`session-tools: could not announce a ${kind} Session (${String(error)})`)
		}
	}

	/**
	 * The Client-catalog summary of one Session, when the Controller can build it.
	 * @param sessionId - Session identity.
	 * @returns the summary, or undefined when the Controller is not mounted.
	 */
	const summaryOf = async (sessionId) => {
		const listState = ctx.get('sessionController')?.listState
		if (listState === undefined || typeof listState.summarizeCold !== 'function') return undefined
		const persistence = ctx.get('sessionPersistence')
		if (typeof persistence?.stat !== 'function') return undefined
		const snapshot = await persistence.stat(sessionId).catch(() => undefined)
		if (snapshot?.header === undefined) return undefined
		try {
			return listState.summarizeCold({ header: snapshot.header })
		} catch {
			return undefined
		}
	}

	/** Mutating operations run one at a time: a Session must never be half-moved. */
	let tail = Promise.resolve()
	const serialize = (operation) => {
		const run = tail.then(operation, operation)
		tail = run.then(() => undefined, () => undefined)
		return run
	}

	/**
	 * What this Session is currently doing, asked of the same providers the shipped
	 * archives ask.
	 *
	 * Holding a Session in memory is not the same as running one: the sidebar keeps
	 * every Session it has opened resident, so an idle Session that merely sits in the
	 * store would otherwise be refused forever. `workspace/session-activity` is the
	 * platform's answer to "is anything actually working here", and it stays empty for
	 * a resident-but-idle Session.
	 *
	 * @param sessionId - Session identity.
	 * @returns the reported activities, or undefined when this Host has no such channel.
	 */
	const activityOf = async (sessionId) => {
		if (typeof ctx.waterfall !== 'function') return undefined
		try {
			const entries = await ctx.waterfall('workspace/session-activity', { sessionId }, () => Promise.resolve([]))
			return Array.isArray(entries) ? entries : []
		} catch {
			return undefined
		}
	}

	/**
	 * Refuse to touch a Session while it is doing work.
	 * @param sessionId - Session identity.
	 */
	const assertIdle = async (sessionId) => {
		const entries = await activityOf(sessionId)
		if (entries === undefined) {
			// Without the activity channel the in-memory Session is the only signal left.
			if (isLive(sessionId)) throw refuse('session/live', 'This Session is running. Stop it first, then try again.')
			return
		}
		if (entries.length === 0) return
		const kinds = entries.map((entry) => (entry !== null && typeof entry === 'object' && typeof entry.kind === 'string' ? entry.kind : 'activity'))
		throw refuse('session/live', `This Session is still working (${[...new Set(kinds)].join(', ')}). Stop it first, then try again.`, { activity: kinds })
	}

	/**
	 * @param state - Current durable state.
	 * @param sessionId - Session identity.
	 */
	const assertUnlocked = (state, sessionId) => {
		if (state.locked.includes(sessionId)) throw refuse('session/locked', 'This Session is locked. Unlock it first.')
	}

	/**
	 * Read one Session's on-disk identity, header and produced files.
	 * @param sessionId - Session identity.
	 * @returns the inspection record shared by the mutating routes.
	 */
	/**
	 * One Session's moves, oldest first.
	 * @param state - Durable state.
	 * @param sessionId - Session identity.
	 * @returns the relocation chain.
	 */
	const movesOf = (state, sessionId) => (state.relocations ?? []).filter((move) => move.sessionId === sessionId)

	const inspectSession = async (sessionId, state) => {
		const dir = await findSessionDir(sessionRoot, sessionId)
		if (dir === undefined) throw refuse('session/missing', 'This Session\'s log is no longer on disk.', { sessionId })
		const logFile = await logFileOf(dir)
		if (logFile === undefined) throw refuse('session/missing', 'This Session\'s log is no longer on disk.', { sessionId })
		const header = await readHeader(logFile)
		const events = await readEvents(logFile)
		const cwd = typeof header.cwd === 'string' ? header.cwd : undefined
		const moves = movesOf(state, sessionId)
		const baseCwd = moves.length === 0 ? cwd : moves[0].from
		const files = cwd === undefined || baseCwd === undefined
			? []
			: await describeFiles(writtenPaths(events, baseCwd).map((recorded) => reAnchor(recorded, moves)), cwd)
		const registry = registryOf(ctx)
		const holding = accountHolding(registry, sessionId)
		return {
			sessionId,
			title: titleOf(events, header.title ?? sessionId),
			cwd,
			dir,
			logFile,
			header,
			files,
			fileCount: files.length,
			totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
			workspaceId: holding?.workspaceId ?? null,
			workspaceTitle: holding?.title ?? null,
			workspacePath: holding?.path ?? cwd ?? null,
		}
	}

	/**
	 * Every Session a batch panel may act on, grouped the way the sidebar groups it.
	 *
	 * The list is built here rather than from Client props: the panel must work even
	 * when the owner hands its overlay seat no standard hooks, and the durable account
	 * is the authority anyway.
	 *
	 * @param state - Durable state.
	 * @returns the rows plus the workspace order they belong to.
	 */
	const listSessions = async (state) => {
		const registry = registryOf(ctx)
		const table = accountTable(registry)
		const workspaces = registry.list().map((workspace) => ({
			workspaceId: workspace.id,
			title: workspace.title,
			path: workspace.path,
		}))
		const owner = new Map()
		const order = []
		for (const [workspaceId, record] of table.entries()) {
			for (const sessionId of record.sessionIds ?? []) {
				owner.set(sessionId, workspaceId)
				order.push(sessionId)
			}
		}
		const onDisk = await listSessionIds(sessionRoot)
		const ids = new Set([...order, ...onDisk])
		const titles = await cachedTitles(projectionCache, [...ids])
		// Rows the cache never saw need their own log read: it either recovered a title or
		// proves the Session is an empty shell, which the panel must not call "untitled".
		const unprobed = [...ids].filter((sessionId) => sessionId.startsWith('session-') && !titles.has(sessionId)).slice(0, 200)
		const blanks = new Set()
		for (const sessionId of unprobed) {
			const dir = await findSessionDir(sessionRoot, sessionId)
			if (dir === undefined) continue
			const logFile = await logFileOf(dir)
			if (logFile === undefined) continue
			const probe = await inspectLog(logFile)
			if (probe.title !== undefined) titles.set(sessionId, probe.title)
			else if (probe.blank === true) blanks.add(sessionId)
		}
		const sessions = ctx.get('sessions')
		const items = []
		for (const sessionId of ids) {
			if (!sessionId.startsWith('session-')) continue
			const workspaceId = owner.get(sessionId) ?? null
			// Only a resident Session can be working, so the activity channel is asked
			// for those alone; everything else is idle by construction.
			const resident = typeof sessions?.get === 'function' && sessions.get(sessionId) !== undefined
			const activity = resident ? await activityOf(sessionId) : []
			items.push({
				sessionId,
				title: titles.get(sessionId) ?? null,
				blank: blanks.has(sessionId),
				workspaceId,
				running: resident && (activity === undefined ? true : activity.length > 0),
				locked: state.locked.includes(sessionId),
				onDisk: onDisk.has(sessionId),
			})
		}
		const rank = new Map(order.map((sessionId, index) => [sessionId, index]))
		items.sort((left, right) => (rank.get(left.sessionId) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right.sessionId) ?? Number.MAX_SAFE_INTEGER))
		return { items, workspaces }
	}

	/**
	 * Remove one Session and, optionally, the files it wrote — for good.
	 *
	 * This is the dangerous twin of `trashSession`: nothing is kept, so the caller must
	 * have said so explicitly. It deletes the files first and the log last, which keeps
	 * a failed run from leaving a Session whose log is gone while its files remain
	 * attributed to nothing.
	 *
	 * @param state - Durable state, mutated in place.
	 * @param sessionId - Session identity.
	 * @param withFiles - Whether the files the Session wrote go too.
	 * @returns how much was removed.
	 */
	const destroySession = async (state, sessionId, withFiles) => {
		assertUnlocked(state, sessionId)
		await assertIdle(sessionId)
		if (state.trash.some((entry) => entry.sessionId === sessionId)) {
			throw refuse('bin/already', 'This Session is in the recycle bin. Delete it there, or restore it first.')
		}
		const registry = registryOf(ctx)
		const dir = await findSessionDir(sessionRoot, sessionId)
		const logFile = dir === undefined ? undefined : await logFileOf(dir)
		const header = logFile === undefined ? undefined : await readHeader(logFile)
		const events = logFile === undefined ? [] : await readEvents(logFile)
		const cwd = typeof header?.cwd === 'string' ? header.cwd : undefined
		const moves = movesOf(state, sessionId)
		const baseCwd = moves.length === 0 ? cwd : moves[0].from
		const holding = accountHolding(registry, sessionId)
		if (dir === undefined && holding === undefined) throw refuse('session/missing', 'This Session\'s log is no longer on disk.', { sessionId })
		const files = withFiles === true && cwd !== undefined && baseCwd !== undefined
			? await describeFiles(writtenPaths(events, baseCwd).map((recorded) => reAnchor(recorded, moves)), cwd)
			: []
		for (const file of files) await fs.rm(file.path, { force: true }).catch(() => undefined)
		if (dir !== undefined) await fs.rm(dir, { recursive: true, force: true })
		await registry.unpinSession(sessionId).catch(() => undefined)
		await registry.unarchiveSession(sessionId).catch(() => undefined)
		if (holding !== undefined) {
			const record = accountTable(registry).get(holding.workspaceId)
			if (record !== undefined) await setAccount(registry, holding.workspaceId, record.sessionIds.filter((id) => id !== sessionId))
		}
		await dropProjectionCache(sessionId)
		state.relocations = (state.relocations ?? []).filter((move) => move.sessionId !== sessionId)
		announce('removed', sessionId)
		return { sessionId, title: titleOf(events, header?.title ?? sessionId), fileCount: files.length }
	}

	/**
	 * Move one Session's log directory into the bin and record where it came from.
	 * @param state - Durable state, mutated in place.
	 * @param sessionId - Session identity.
	 * @param withFiles - Whether the files the Session wrote travel with it.
	 * @returns the response payload.
	 */
	const trashSession = async (state, sessionId, withFiles) => {
		assertUnlocked(state, sessionId)
		await assertIdle(sessionId)
		if (state.trash.some((entry) => entry.sessionId === sessionId)) {
			throw refuse('bin/already', 'This Session is already in the recycle bin.')
		}
		const registry = registryOf(ctx)
		const entryId = randomUUID()
		const binDir = join(base, 'trash', entryId)
		const dir = await findSessionDir(sessionRoot, sessionId)
		if (dir === undefined && accountHolding(registry, sessionId) === undefined) {
			// Nothing to bin and nothing to clean up: say so instead of recording an empty entry.
			throw refuse('session/missing', 'This Session\'s log is no longer on disk.', { sessionId })
		}
		const logFile = dir === undefined ? undefined : await logFileOf(dir)
		const header = logFile === undefined ? undefined : await readHeader(logFile)
		const events = logFile === undefined ? [] : await readEvents(logFile)
		const cwd = typeof header?.cwd === 'string' ? header.cwd : undefined
		const holding = accountHolding(registry, sessionId)
		const moves = movesOf(state, sessionId)
		const baseCwd = moves.length === 0 ? cwd : moves[0].from
		const files = withFiles === true && cwd !== undefined && baseCwd !== undefined
			? await describeFiles(writtenPaths(events, baseCwd).map((recorded) => reAnchor(recorded, moves)), cwd)
			: []

		await fs.mkdir(binDir, { recursive: true })
		const movedFiles = []
		try {
			if (dir !== undefined) await movePath(dir, join(binDir, 'session'))
			for (const file of files) {
				const destination = join(binDir, 'files', file.rel)
				await fs.mkdir(dirname(destination), { recursive: true })
				await movePath(file.path, destination)
				movedFiles.push({ rel: file.rel, original: file.path, bytes: file.bytes })
			}
		} catch (error) {
			// Put back whatever already travelled, then report: a half-binned Session is not acceptable.
			if (dir !== undefined && existsSync(join(binDir, 'session'))) await movePath(join(binDir, 'session'), dir).catch(() => undefined)
			for (const file of movedFiles) await movePath(join(binDir, 'files', file.rel), file.original).catch(() => undefined)
			await fs.rm(binDir, { recursive: true, force: true }).catch(() => undefined)
			throw error
		}

		await registry.unpinSession(sessionId).catch(() => undefined)
		await registry.unarchiveSession(sessionId).catch(() => undefined)
		if (holding !== undefined) await setAccount(registry, holding.workspaceId, accountTable(registry).get(holding.workspaceId).sessionIds.filter((id) => id !== sessionId))

		const entry = {
			entryId,
			sessionId,
			title: titleOf(events, header?.title ?? sessionId),
			workspaceId: holding?.workspaceId ?? null,
			workspaceTitle: holding?.title ?? null,
			workspacePath: holding?.path ?? cwd ?? null,
			sessionDir: dir ?? null,
			hadSessionDir: dir !== undefined,
			deletedAt: Date.now(),
			withFiles: movedFiles.length > 0,
			files: movedFiles,
		}
		state.trash.unshift(entry)
		announce('removed', sessionId)
		return {
			entryId,
			sessionId,
			title: entry.title,
			fileCount: movedFiles.length,
			withFiles: entry.withFiles,
		}
	}

	/**
	 * Put one binned Session back: log directory, files, and account.
	 * @param state - Durable state, mutated in place.
	 * @param entryId - Bin entry identity.
	 * @returns the response payload.
	 */
	const restoreEntry = async (state, entryId) => {
		const index = state.trash.findIndex((entry) => entry.entryId === entryId)
		if (index === -1) throw refuse('bin/unknown', 'That recycle-bin entry is gone.')
		const entry = state.trash[index]
		const registry = registryOf(ctx)
		const restoredFiles = []

		if (entry.hadSessionDir === true && typeof entry.sessionDir === 'string') {
			const target = entry.sessionDir
			await fs.mkdir(dirname(target), { recursive: true })
			if (existsSync(target)) throw refuse('bin/occupied', 'A Session already occupies that directory; nothing was restored.')
			await movePath(join(base, 'trash', entryId, 'session'), target)
		}
		for (const file of entry.files ?? []) {
			const source = join(base, 'trash', entryId, 'files', file.rel)
			if (!existsSync(source)) continue
			await fs.mkdir(dirname(file.original), { recursive: true })
			if (existsSync(file.original)) continue
			await movePath(source, file.original)
			restoredFiles.push(file.rel)
		}

		const workspace = entry.workspaceId === null ? undefined : registry.get(entry.workspaceId)
		if (workspace !== undefined && typeof entry.workspacePath === 'string') {
			await attachAccount(registry, workspace.id, entry.sessionId, workspace.path)
		}

		await fs.rm(join(base, 'trash', entryId), { recursive: true, force: true }).catch(() => undefined)
		state.trash.splice(index, 1)
		announce('added', await summaryOf(entry.sessionId))
		return { sessionId: entry.sessionId, title: entry.title, fileCount: restoredFiles.length, grouped: workspace !== undefined }
	}

	/**
	 * Forget one Session's cached projections; a stale cache would otherwise keep
	 * answering for a Session that no longer exists.
	 * @param sessionId - Session identity.
	 */
	const dropProjectionCache = async (sessionId) => {
		const bare = sessionId.startsWith('session-') ? sessionId.slice('session-'.length) : sessionId
		for (const name of [bare, sessionId]) {
			await fs.rm(join(projectionCache, `${name}.json`), { force: true }).catch(() => undefined)
		}
	}

	/**
	 * Delete one bin entry for good.
	 * @param state - Durable state, mutated in place.
	 * @param entryId - Bin entry identity.
	 * @returns the response payload.
	 */
	const purgeEntry = async (state, entryId) => {
		const index = state.trash.findIndex((entry) => entry.entryId === entryId)
		if (index === -1) throw refuse('bin/unknown', 'That recycle-bin entry is gone.')
		const entry = state.trash[index]
		await fs.rm(join(base, 'trash', entryId), { recursive: true, force: true })
		await dropProjectionCache(entry.sessionId)
		// The Session is gone for good: its relocation history has nothing left to describe.
		state.relocations = (state.relocations ?? []).filter((move) => move.sessionId !== entry.sessionId)
		state.trash.splice(index, 1)
		announce('removed', entry.sessionId)
		return { sessionId: entry.sessionId, title: entry.title }
	}

	/**
	 * Relocate one Session, its produced files and its account into another
	 * workspace, rewriting the log header so a restart derives the same answer.
	 * @param sessionId - Session identity.
	 * @param targetWorkspaceId - Destination workspace.
	 * @param withFiles - Whether the files the Session wrote move too.
	 * @returns the response payload.
	 */
	const moveSession = async (state, sessionId, targetWorkspaceId, withFiles) => {
		assertUnlocked(state, sessionId)
		await assertIdle(sessionId)
		const registry = registryOf(ctx)
		const target = registry.get(targetWorkspaceId)
		if (target === undefined) throw refuse('workspace/missing', 'That workspace is no longer registered.')
		const inspection = await inspectSession(sessionId, state)
		const source = inspection.workspaceId === null ? undefined : registry.get(inspection.workspaceId)
		if (source !== undefined && source.id === target.id) throw refuse('move/same', 'The Session is already in that workspace.')
		const fromCwd = inspection.cwd
		if (typeof fromCwd !== 'string') throw refuse('session/format', 'This Session records no working directory, so it cannot change workspace.')

		const targetDir = join(sessionRoot, projectKey(target.path), encodeSegment(sessionId))
		const movedFiles = []
		const skipped = []
		let directionMoved = false
		let headerRewritten = false
		let sourceDetached = false
		let targetAttached = false

		/*
		 * A move touches four durable things — produced files, the log header, the log
		 * directory and the two accounts. Any failure after the first of them leaves a
		 * Session nobody can open, so the whole operation unwinds from whatever point it
		 * reached instead of reporting a half-move the user would have to repair by hand.
		 */
		const rewind = async () => {
			if (targetAttached) {
				const record = accountTable(registry).get(target.id).sessionIds.filter((id) => id !== sessionId)
				await setAccount(registry, target.id, record).catch(() => undefined)
			}
			if (sourceDetached && source !== undefined) await attachAccount(registry, source.id, sessionId, source.path).catch(() => undefined)
			if (directionMoved) await movePath(targetDir, inspection.dir).catch(() => undefined)
			if (headerRewritten) await rewriteHeaderCwd(join(inspection.dir, basename(inspection.logFile)), fromCwd).catch(() => undefined)
			for (const rel of movedFiles) {
				const parked = join(target.path, rel)
				if (!existsSync(parked)) continue
				await fs.mkdir(dirname(join(fromCwd, rel)), { recursive: true }).catch(() => undefined)
				await movePath(parked, join(fromCwd, rel)).catch(() => undefined)
			}
		}

		try {
			for (const file of withFiles === true ? inspection.files : []) {
				const destination = join(target.path, file.rel)
				if (existsSync(destination)) {
					skipped.push(file.rel)
					continue
				}
				await fs.mkdir(dirname(destination), { recursive: true })
				await movePath(file.path, destination)
				movedFiles.push(file.rel)
			}

			await rewriteHeaderCwd(inspection.logFile, target.path)
			headerRewritten = true
			await fs.mkdir(dirname(targetDir), { recursive: true })
			await movePath(inspection.dir, targetDir)
			directionMoved = true

			if (source !== undefined) {
				const record = accountTable(registry).get(source.id)
				if (record !== undefined) await setAccount(registry, source.id, record.sessionIds.filter((id) => id !== sessionId))
				sourceDetached = true
			}
			await attachAccount(registry, target.id, sessionId, target.path)
			targetAttached = true

			const persistence = ctx.get('sessionPersistence')
			if (typeof persistence?.stat === 'function') {
				const snapshot = await persistence.stat(sessionId).catch(() => undefined)
				if (snapshot === undefined) {
					throw refuse('move/unverified', 'The Session store does not list the Session at its new location, so the move was undone.', { targetDir })
				}
			}

			// Remember the move: later file questions must look where the files went.
			state.relocations = [...(state.relocations ?? []), { sessionId, from: fromCwd, to: target.path, at: Date.now() }].slice(-MAX_RELOCATIONS)
		} catch (error) {
			await rewind()
			state.relocations = (state.relocations ?? []).filter((move) => !(move.sessionId === sessionId && move.to === target.path && move.from === fromCwd))
			throw error
		}

		return {
			sessionId,
			title: inspection.title,
			targetWorkspaceId: target.id,
			targetWorkspaceTitle: target.title,
			movedFiles,
			skipped,
			fileCount: movedFiles.length,
		}
	}

	/**
	 * Complete projection the Client renders from.
	 * @returns the snapshot value.
	 */
	const snapshot = async (state) => {
		const registry = registryOf(ctx)
		const workspaces = registry.list().map((workspace) => ({
			workspaceId: workspace.id,
			title: workspace.title,
			path: workspace.path,
			sessionCount: Array.isArray(workspace.sessionIds) ? workspace.sessionIds.length : 0,
		}))
		return {
			lockedIds: [...state.locked],
			trash: state.trash.map((entry) => ({
				entryId: entry.entryId,
				sessionId: entry.sessionId,
				title: entry.title,
				workspaceTitle: entry.workspaceTitle ?? null,
				deletedAt: entry.deletedAt,
				withFiles: entry.withFiles === true,
				fileCount: Array.isArray(entry.files) ? entry.files.length : 0,
			})),
			workspaces,
			caps: { move: hasZstd(), trash: true },
			binPath: join(base, 'trash'),
		}
	}

	/**
	 * Whether this Host holds a live Session for one identity.
	 * @param sessionId - Session identity.
	 * @returns true while the Session is active in memory.
	 */
	const isLive = (sessionId) => {
		const sessions = ctx.get('sessions')
		return typeof sessions?.get === 'function' && sessions.get(sessionId) !== undefined
	}

	/**
	 * Split one failure into "the caller asked for something this Session cannot do"
	 * (a stated refusal) and "something broke" (an unexpected fault).
	 * @param error - Thrown value.
	 * @returns its code and message.
	 */
	const describeFailure = (error) => ({
		code: error instanceof ToolError ? error.code : 'internal',
		message: error instanceof Error ? error.message : String(error),
	})

	/**
	 * Run one operation over many Sessions without letting one refusal abort the rest.
	 *
	 * A batch is the place where "all or nothing" is wrong: a locked or running
	 * Session in the middle of a selection must not undo the nine that already
	 * succeeded, and the operator needs the exact split afterwards.
	 *
	 * @param state - Durable state, mutated in place.
	 * @param request - Action, targets and options.
	 * @returns what succeeded, what was refused, and what broke.
	 */
	const runBatch = async (state, request) => {
		const action = request.action
		const done = []
		const skipped = []
		const failed = []
		let fileCount = 0
		for (const sessionId of request.sessionIds) {
			try {
				if (action === 'lock' || action === 'unlock') {
					const next = new Set(state.locked)
					if (action === 'lock') next.add(sessionId)
					else next.delete(sessionId)
					state.locked = [...next]
					done.push(sessionId)
					continue
				}
				if (action === 'trash') {
					fileCount += (await trashSession(state, sessionId, request.withFiles === true)).fileCount
					done.push(sessionId)
					continue
				}
				if (action === 'delete') {
					fileCount += (await destroySession(state, sessionId, request.withFiles === true)).fileCount
					done.push(sessionId)
					continue
				}
				if (action === 'move') {
					fileCount += (await moveSession(state, sessionId, request.targetWorkspaceId, request.withFiles === true)).fileCount
					done.push(sessionId)
					continue
				}
				throw refuse('request/invalid', `Unknown batch action "${String(action)}".`)
			} catch (error) {
				const info = describeFailure(error)
				if (error instanceof ToolError) skipped.push({ sessionId, ...info })
				else failed.push({ sessionId, ...info })
			}
		}
		return { done, skipped, failed, fileCount }
	}

	/**
	 * Count what a destructive batch would actually touch, before it runs.
	 * @param state - Durable state.
	 * @param sessionIds - Requested targets.
	 * @param withFiles - Whether the files the Sessions wrote travel too.
	 * @returns eligible, refused and file totals for the confirmation.
	 */
	const previewBatch = async (state, sessionIds, withFiles) => {
		let fileCount = 0
		let locked = 0
		let live = 0
		let binned = 0
		for (const sessionId of sessionIds) {
			if (state.locked.includes(sessionId)) {
				locked += 1
				continue
			}
			const activity = await activityOf(sessionId)
			const working = activity === undefined ? isLive(sessionId) : activity.length > 0
			if (working) {
				live += 1
				continue
			}
			if (state.trash.some((entry) => entry.sessionId === sessionId)) {
				binned += 1
				continue
			}
			if (withFiles !== true) continue
			try {
				fileCount += (await inspectSession(sessionId, state)).fileCount
			} catch {
				/* a Session whose log is already gone contributes no files */
			}
		}
		return {
			sessionCount: sessionIds.length,
			eligible: sessionIds.length - locked - live - binned,
			locked,
			live,
			binned,
			fileCount,
		}
	}

	/**
	 * Route one request. Unknown input is a refusal, not an exception: the Client
	 * always receives a reason it can show.
	 * @param request - Incoming HTTP request.
	 * @returns the JSON response.
	 */
	const handle = async (request) => {
		let payload
		try {
			payload = await request.json()
		} catch {
			return respond({ ok: false, error: { code: 'request/invalid', message: 'The request body is not JSON.' } })
		}
		const op = typeof payload?.op === 'string' ? payload.op : ''
		try {
			const state = await stateStore.read()
			switch (op) {
				case 'snapshot':
					return respond({ ok: true, value: await snapshot(state) })
				case 'inspect': {
					const sessionId = requireSessionId(payload)
					const inspection = await inspectSession(sessionId, state)
					return respond({
						ok: true,
						value: {
							sessionId: inspection.sessionId,
							title: inspection.title,
							cwd: inspection.cwd,
							workspaceId: inspection.workspaceId,
							workspaceTitle: inspection.workspaceTitle,
							locked: state.locked.includes(sessionId),
							fileCount: inspection.fileCount,
							totalBytes: inspection.totalBytes,
							files: inspection.files.map((file) => ({ rel: file.rel, bytes: file.bytes })),
						},
					})
				}
				case 'sessions':
					return respond({ ok: true, value: await listSessions(state) })
				case 'lock': {
					const sessionId = requireSessionId(payload)
					const locked = payload?.locked === true
					const next = new Set(state.locked)
					if (locked) next.add(sessionId)
					else next.delete(sessionId)
					state.locked = [...next]
					await stateStore.write(state)
					return respond({ ok: true, value: { sessionId, locked } })
				}
				case 'trash': {
					const sessionId = requireSessionId(payload)
					const value = await serialize(() => trashSession(state, sessionId, payload?.withFiles === true))
					await stateStore.write(state)
					return respond({ ok: true, value })
				}
				case 'delete': {
					const sessionId = requireSessionId(payload)
					const value = await serialize(() => destroySession(state, sessionId, payload?.withFiles === true))
					await stateStore.write(state)
					return respond({ ok: true, value })
				}
				case 'restore': {
					const entryId = requireEntryId(payload)
					const value = await serialize(() => restoreEntry(state, entryId))
					await stateStore.write(state)
					return respond({ ok: true, value })
				}
				case 'purge': {
					const entryId = requireEntryId(payload)
					const value = await serialize(() => purgeEntry(state, entryId))
					await stateStore.write(state)
					return respond({ ok: true, value })
				}
				case 'empty': {
					const value = await serialize(async () => {
						const removed = []
						for (const entry of [...state.trash]) {
							await purgeEntry(state, entry.entryId)
							removed.push(entry.title)
						}
						return { count: removed.length }
					})
					await stateStore.write(state)
					return respond({ ok: true, value })
				}
				case 'move': {
					const sessionId = requireSessionId(payload)
					const targetWorkspaceId = typeof payload?.targetWorkspaceId === 'string' ? payload.targetWorkspaceId : ''
					if (targetWorkspaceId === '') throw refuse('request/invalid', 'Pick a destination workspace.')
					const value = await serialize(() => moveSession(state, sessionId, targetWorkspaceId, payload?.withFiles === true))
					await stateStore.write(state)
					return respond({ ok: true, value })
				}
				case 'batch-preview': {
					const sessionIds = requireSessionIds(payload)
					const value = await serialize(() => previewBatch(state, sessionIds, payload?.withFiles === true))
					return respond({ ok: true, value })
				}
				case 'batch': {
					const sessionIds = requireSessionIds(payload)
					const action = typeof payload?.action === 'string' ? payload.action : ''
					if (!['lock', 'unlock', 'trash', 'delete', 'move'].includes(action)) throw refuse('request/invalid', `Unknown batch action "${action}".`)
					if (action === 'move' && (typeof payload?.targetWorkspaceId !== 'string' || payload.targetWorkspaceId === '')) throw refuse('request/invalid', 'Pick a destination workspace.')
					const value = await serialize(() => runBatch(state, {
						action,
						sessionIds,
						withFiles: payload?.withFiles === true,
						targetWorkspaceId: payload?.targetWorkspaceId,
					}))
					await stateStore.write(state)
					return respond({ ok: true, value })
				}
				default:
					throw refuse('request/invalid', `Unknown operation "${op}".`)
			}
		} catch (error) {
			const code = error instanceof ToolError ? error.code : 'internal'
			return respond({
				ok: false,
				error: {
					code,
					message: error instanceof Error ? error.message : String(error),
					detail: error instanceof ToolError ? error.detail : undefined,
				},
			})
		}
	}

	/**
	 * Re-announce every binned Session. A page that was already open when the Session
	 * was binned kept its row; mounting the plugin again is a chance to clear it.
	 */
	const syncCatalog = async () => {
		const state = await stateStore.read()
		for (const entry of state.trash) announce('removed', entry.sessionId)
	}

	return { handle, syncCatalog }
}

/**
 * @param payload - Request body.
 * @returns the Session identity it names.
 */
function requireSessionId(payload) {
	const sessionId = payload?.sessionId
	if (typeof sessionId !== 'string' || sessionId === '') throw refuse('request/invalid', 'A Session is required.')
	return sessionId
}

/**
 * @param payload - Request body.
 * @returns the non-empty Session identity list it names.
 */
function requireSessionIds(payload) {
	const sessionIds = payload?.sessionIds
	if (!Array.isArray(sessionIds) || sessionIds.length === 0) throw refuse('request/invalid', 'Pick at least one Session.')
	const ids = sessionIds.filter((id) => typeof id === 'string' && id !== '')
	if (ids.length === 0) throw refuse('request/invalid', 'Pick at least one Session.')
	return ids
}

/**
 * @param payload - Request body.
 * @returns the bin entry identity it names.
 */
function requireEntryId(payload) {
	const entryId = payload?.entryId
	if (typeof entryId !== 'string' || entryId === '') throw refuse('request/invalid', 'A recycle-bin entry is required.')
	return entryId
}

/**
 * Wrap one payload in a JSON response.
 * @param body - Response payload.
 * @returns the HTTP response.
 */
function respond(body) {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
	})
}

/**
 * Mount the bundle: one Host route on the composed connection.
 * @param ctx - Host context.
 */
export function apply(ctx) {
	const tools = createTools(ctx)
	recordBuildStamp(ctx)
	tools.syncCatalog().catch((error) => ctx.logger.warn(`session-tools: catalog resync failed (${String(error)})`))
	ctx.inject(['connection'], (scope) => {
		const connection = scope.get('connection')
		if (connection === undefined || typeof connection.fetch?.register !== 'function') {
			ctx.logger.warn('session-tools: the connection has no fetch surface; the Session tools stay unreachable')
			return
		}
		scope.effect(
			() => connection.fetch.register({
				path: ROUTE,
				methods: ['POST'],
				requestBody: 'buffered',
				fetch: (request) => tools.handle(request),
			}),
			'session-tools.route',
		)
	})
}

/**
 * Record which Host build this process loaded. Best effort: a read-only home
 * directory must never stop the plugin from mounting.
 * @param ctx - Host context.
 */
function recordBuildStamp(ctx) {
	const base = join(dshHome(ctx), 'session-tools')
	fs.mkdir(base, { recursive: true })
		.then(() => fs.writeFile(join(base, 'host-build.json'), `${JSON.stringify({ build: BUILD, node: process.versions.node, zstd: hasZstd(), at: new Date().toISOString() }, null, 2)}\n`))
		.catch((error) => ctx.logger.warn(`session-tools: could not record the build stamp (${String(error)})`))
}

export const name = 'dsh-session-tools'
