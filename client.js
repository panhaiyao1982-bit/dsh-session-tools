/**
 * Browser half of the Session tools bundle.
 *
 * Three seats and one overlay, all of them additive:
 *
 *  - `sidebar.workspaces.session.menu.item` — lock, bin and move rows in a
 *    Session row's menu,
 *  - `sidebar.session.row.trailing` — a lock mark on a protected row,
 *  - `sidebar.footer.action` — the recycle bin beside Settings,
 *  - `shell.overlay` — the bin panel, the move dialog and the confirmations.
 *
 * The Host half owns every durable decision; this file renders, and asks.
 */
window.__ModuleLoader__.load({
	id: 'dsh-session-tools',
	factory(require) {
		const React = require('react')
		const { useEffect, useState, useSyncExternalStore } = React
		const h = React.createElement

		/** Route the Host half mounts on the composed connection. */
		const ENDPOINT = 'api/session-tools'

		const COPY = {
			zh: {
				menuLock: '锁定（禁止删除和移动）',
				menuUnlock: '解锁',
				menuDelete: '删除会话和文件…',
				menuMove: '移动到其他工作空间…',
				rowLocked: '已锁定',
				sessionFallback: '这个会话',
				footerBin: '回收站',
				footerBinCount: '回收站（{count}）',
				binTitle: '回收站',
				binEmpty: '回收站是空的。删除的会话会先放到这里，随时可以还原。',
				binSubtitle: '会话记录移出了列表，文件还在原处。永久删除之后才真的没了。',
				binCount: '{count} 项',
				empty: '清空回收站',
				emptyTitle: '清空回收站？',
				emptyConfirm: '回收站里的 {count} 项会被永久删除，这一步不能撤销。',
				restore: '还原',
				purge: '永久删除',
				close: '关闭',
				withFiles: '含 {count} 个文件',
				noFiles: '只有会话记录',
				unknownWorkspace: '原工作空间已删除',
				lockedToast: '已锁定「{title}」，之后不能删除或移动它。',
				unlockedToast: '已解锁「{title}」。',
				trashedToast: '「{title}」已放进回收站。',
				trashedFilesToast: '「{title}」和 {count} 个文件已放进回收站。',
				restoredToast: '已还原「{title}」。',
				purgedToast: '已永久删除「{title}」。',
				emptiedToast: '回收站已清空。',
				deleteTitleFiles: '删除「{title}」和它写过的 {count} 个文件？',
				deleteTitlePlain: '删除「{title}」？',
				deleteBodyChoice: '放进回收站可以随时还原；直接删除会把会话（和它写过的文件）从磁盘上抹掉，不能还原。',
				toBin: '放入回收站',
				deleteForever: '直接删除',
				deletedToast: '已直接删除「{title}」。',
				moveTitle: '把「{title}」移到其他工作空间',
				moveTarget: '目标工作空间',
				moveFiles: '同时搬走这个会话写过的 {count} 个文件',
				moveNoFiles: '这个会话在自己的工作空间里没有写过文件。',
				moveConfirm: '移动',
				moveDoneToast: '已移动到 {workspace}。',
				moveSkippedToast: '已移动到 {workspace}；有 {count} 个文件在目标目录已存在，留在了原处。',
				moveNone: '没有其他工作空间可去。先在左侧添加一个工作空间。',
				working: '正在处理…',
				errorTitle: '这一步没成功',
				cancel: '取消',
				zstdMissing: '改会话所属的工作空间需要 zstd 支持，当前运行环境里没有。',
				live: '这个会话正在运行。先停下来，再试一次。',
				locked: '这个会话已锁定，先解锁。',
				missing: '这个会话的日志已经不在磁盘上了。',
				same: '会话已经在这个工作空间里了。',
				alreadyBinned: '这个会话已经在回收站里了。',
				bulkButton: '批量管理',
				bulkTitle: '批量管理会话',
				bulkSubtitle: '勾选下面的会话，再选动作。已锁定和正在运行的一律跳过，结果写在这里。',
				bulkLoading: '正在读取会话列表…',
				bulkEmpty: '这里没有可以管理的会话。',
				bulkUngrouped: '未分组',
				bulkUntitled: '未命名会话',
				bulkBlank: '新会话',
				bulkSelected: '已选 {count} 个',
				bulkSelectAll: '全选',
				bulkExpandAll: '展开全部',
				bulkCollapseAll: '收起全部',
				bulkToggleGroup: '展开或收起这个工作空间',
				bulkClear: '清除',
				bulkLock: '锁定',
				bulkUnlock: '解锁',
				bulkDelete: '删除会话和文件…',
				bulkMove: '移动到…',
				bulkLockedMark: '已锁定',
				bulkRunningMark: '运行中',
				bulkMissingMark: '日志缺失',
				bulkResultDone: '完成 {count} 个',
				bulkResultSkipped: '跳过 {count} 个（{reasons}）',
				bulkResultFailed: '{count} 个出错',
				bulkNothing: '没有可以处理的会话',
				bulkJoin: '；',
				bulkReasonJoin: '、',
				reasonLocked: '已锁定',
				reasonLive: '运行中',
				reasonBinned: '已在回收站',
				reasonMissing: '日志已不在磁盘上',
				reasonOther: '其他原因',
				bulkDeleteTitle: '删除这 {count} 个会话和它们写过的 {files} 个文件？',
				bulkDeleteTitlePlain: '删除这 {count} 个会话？',
				bulkSkipNote: '其中 {locked} 个已锁定、{live} 个正在运行，会跳过。',
				bulkMoveTitle: '把这 {count} 个会话移到其他工作空间',
				bulkMoveFiles: '同时搬走它们写过的 {files} 个文件',
				bulkMoveNoFiles: '这些会话在各自的工作空间里没有写过文件。',
				bulkNoDestination: '没有其他工作空间可去。先在左侧添加一个工作空间。',
				bulkWorking: '正在处理…',
			},
			en: {
				menuLock: 'Lock (block delete and move)',
				menuUnlock: 'Unlock',
				menuDelete: 'Delete Session and files…',
				menuMove: 'Move to another workspace…',
				rowLocked: 'Locked',
				sessionFallback: 'This Session',
				footerBin: 'Recycle bin',
				footerBinCount: 'Recycle bin ({count})',
				binTitle: 'Recycle bin',
				binEmpty: 'The bin is empty. Anything you delete lands here first, and can be restored.',
				binSubtitle: 'A binned Session left the list; its files stayed where they were. Only a permanent delete removes anything.',
				binCount: '{count} item(s)',
				empty: 'Empty the bin',
				emptyTitle: 'Empty the recycle bin?',
				emptyConfirm: 'All {count} item(s) are permanently deleted. This cannot be undone.',
				restore: 'Restore',
				purge: 'Delete forever',
				close: 'Close',
				withFiles: '{count} file(s)',
				noFiles: 'Record only',
				unknownWorkspace: 'Workspace deleted',
				lockedToast: 'Locked “{title}”. It can no longer be deleted or moved.',
				unlockedToast: 'Unlocked “{title}”.',
				trashedToast: '“{title}” is in the recycle bin.',
				trashedFilesToast: '“{title}” and {count} file(s) are in the recycle bin.',
				restoredToast: 'Restored “{title}”.',
				purgedToast: 'Deleted “{title}” for good.',
				emptiedToast: 'Recycle bin emptied.',
				deleteTitleFiles: 'Delete “{title}” and the {count} file(s) it wrote?',
				deleteTitlePlain: 'Delete “{title}”?',
				deleteBodyChoice: 'The recycle bin keeps it restorable; a direct delete wipes the Session and its files from disk and cannot be undone.',
				toBin: 'Move to the bin',
				deleteForever: 'Delete directly',
				deletedToast: '“{title}” was deleted directly.',
				moveTitle: 'Move “{title}” to another workspace',
				moveTarget: 'Destination',
				moveFiles: 'Also move the {count} file(s) this Session wrote',
				moveNoFiles: 'This Session wrote no files in its workspace.',
				moveConfirm: 'Move',
				moveDoneToast: 'Moved to {workspace}.',
				moveSkippedToast: 'Moved to {workspace}; {count} file(s) already existed there and stayed where they were.',
				moveNone: 'There is no other workspace yet. Add one from the sidebar first.',
				working: 'Working…',
				errorTitle: 'That did not work',
				cancel: 'Cancel',
				zstdMissing: 'Changing a Session’s workspace needs zstd in this runtime, which is missing.',
				live: 'This Session is running. Stop it first, then try again.',
				locked: 'This Session is locked. Unlock it first.',
				missing: 'This Session’s log is no longer on disk.',
				same: 'The Session is already in that workspace.',
				alreadyBinned: 'This Session is already in the recycle bin.',
				bulkButton: 'Manage',
				bulkTitle: 'Manage Sessions',
				bulkSubtitle: 'Tick the Sessions below, then pick an action. Locked and running ones are skipped, and the result is written here.',
				bulkLoading: 'Reading the Session list…',
				bulkEmpty: 'There is nothing to manage here.',
				bulkUngrouped: 'Ungrouped',
				bulkUntitled: 'Untitled Session',
				bulkBlank: 'New Session',
				bulkSelected: '{count} selected',
				bulkSelectAll: 'Select all',
				bulkExpandAll: 'Expand all',
				bulkCollapseAll: 'Collapse all',
				bulkToggleGroup: 'Expand or collapse this workspace',
				bulkClear: 'Clear',
				bulkLock: 'Lock',
				bulkUnlock: 'Unlock',
				bulkDelete: 'Delete Sessions and files…',
				bulkMove: 'Move to…',
				bulkLockedMark: 'locked',
				bulkRunningMark: 'running',
				bulkMissingMark: 'log missing',
				bulkResultDone: '{count} done',
				bulkResultSkipped: '{count} skipped ({reasons})',
				bulkResultFailed: '{count} failed',
				bulkNothing: 'Nothing to do',
				bulkJoin: '; ',
				bulkReasonJoin: ', ',
				reasonLocked: 'locked',
				reasonLive: 'running',
				reasonBinned: 'already in the bin',
				reasonMissing: 'log gone',
				reasonOther: 'other',
				bulkDeleteTitle: 'Delete these {count} Session(s) and the {files} file(s) they wrote?',
				bulkDeleteTitlePlain: 'Delete these {count} Session(s)?',
				bulkSkipNote: '{locked} locked and {live} running are skipped.',
				bulkMoveTitle: 'Move these {count} Session(s) to another workspace',
				bulkMoveFiles: 'Also move the {files} file(s) they wrote',
				bulkMoveNoFiles: 'These Sessions wrote no files in their workspaces.',
				bulkNoDestination: 'There is no other workspace yet. Add one from the sidebar first.',
				bulkWorking: 'Working…',
			},
		}

		//#region store
		/*
		 * One module-level store keeps the four seats in agreement: a lock pressed in
		 * the menu must grey the same row's badge and gate the footer count without a
		 * reload. `useSyncExternalStore` reads it without a Context provider, which a
		 * slot registration cannot wrap around an owner-rendered region.
		 */
		const store = {
			state: {
				localeId: 'zh',
				snapshot: null,
				view: null,
				target: null,
				confirm: null,
				toast: null,
				busy: false,
				error: null,
				bulkStep: null,
				bulkItems: null,
				bulkWorkspaces: [],
				bulkLoading: false,
				bulkSelected: [],
				bulkExpanded: [],
				bulkPreview: null,
				bulkResult: null,
				bulkDestination: '',
				bulkWithFiles: true,
			},
			listeners: new Set(),
			patch(next) {
				store.state = { ...store.state, ...next }
				for (const listener of store.listeners) listener()
			},
			subscribe(listener) {
				store.listeners.add(listener)
				return () => store.listeners.delete(listener)
			},
		}

		const useStore = () => useSyncExternalStore(store.subscribe, () => store.state)

		const language = () => (String(store.state.localeId).toLowerCase().startsWith('zh') ? 'zh' : 'en')

		/**
		 * Fill `{name}` slots in one copy string.
		 * @param template - Copy with placeholders.
		 * @param values - Replacement values.
		 * @returns the rendered sentence.
		 */
		const fill = (template, values) => {
			if (values === undefined) return template
			return template.replace(/\{(\w+)\}/g, (match, key) => (values[key] === undefined ? match : String(values[key])))
		}

		/**
		 * @param key - Copy key.
		 * @param values - Optional placeholders.
		 * @returns localized copy.
		 */
		const t = (key, values) => {
			const dict = COPY[language()]
			return fill(dict[key] ?? COPY.zh[key] ?? key, values)
		}

		let toastTimer
		/**
		 * Show one transient sentence above the composed frame.
		 * @param message - Sentence to show.
		 */
		const notify = (message) => {
			clearTimeout(toastTimer)
			store.patch({ toast: { message } })
			toastTimer = setTimeout(() => store.patch({ toast: null }), 4200)
		}

		/** @param error - Host refusal. @returns the sentence to show for it. */
		const sentenceFor = (error) => {
			switch (error?.code) {
				case 'session/live':
					return t('live')
				case 'session/locked':
					return t('locked')
				case 'session/missing':
					return t('missing')
				case 'bin/already':
					return t('alreadyBinned')
				case 'move/same':
					return t('same')
				case 'unsupported/zstd':
					return t('zstdMissing')
				default:
					return typeof error?.message === 'string' && error.message !== '' ? error.message : String(error)
			}
		}

		/**
		 * Ask the Host half for one operation.
		 * @param op - Operation name.
		 * @param payload - Operation payload.
		 * @returns the operation value.
		 */
		async function call(op, payload) {
			const response = await fetch(ENDPOINT, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ op, ...payload }),
			})
			const body = await response.json().catch(() => null)
			if (body === null) throw Object.assign(new Error(`The Host answered ${response.status} without JSON.`), { code: 'transport' })
			if (body.ok !== true) throw Object.assign(new Error(body.error?.message ?? 'The operation failed.'), { code: body.error?.code })
			return body.value
		}

		let refreshToken = 0
		let reportedFirstFailure = false
		/** Reload the Host snapshot; the latest request wins. */
		async function refresh() {
			const token = ++refreshToken
			try {
				const snapshot = await call('snapshot', {})
				if (token === refreshToken) store.patch({ snapshot })
			} catch (error) {
				if (token !== refreshToken) return
				store.patch({ error: { message: sentenceFor(error) } })
				// A Host half that never answered must not look like a silent no-op.
				if (!reportedFirstFailure) {
					reportedFirstFailure = true
					notify(sentenceFor(error))
				}
			}
		}
		//#endregion

		//#region styles
		/**
		 * One stylesheet for every seat, built from the Host theme tokens so the
		 * chrome follows light/dark and the reader's font size.
		 * @returns the style element.
		 */
		function buildStyle() {
			const style = document.createElement('style')
			style.dataset.dshSessionTools = 'style'
			style.textContent = `
.dst-menu-item{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;padding:6px 12px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary,#222);font:inherit;font-size:13px;line-height:20px;text-align:left;cursor:default;-webkit-appearance:none;appearance:none}
.dst-menu-item:hover,.dst-menu-item:focus-visible{background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.06));outline:none}
.dst-menu-item-danger{color:var(--dsw-alias-state-error-primary,#c0392b)}
.dst-lock{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;color:var(--dsw-alias-label-secondary,#666)}
.dst-foot{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 6px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#666);font:inherit;font-size:12px;cursor:default;-webkit-appearance:none;appearance:none;white-space:nowrap}
.dst-foot:hover{background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.06));color:var(--dsw-alias-label-primary,#222)}
.dst-backdrop{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(12,14,18,.42);pointer-events:auto;z-index:40}
.dst-panel{display:flex;flex-direction:column;width:min(560px,calc(100vw - 48px));max-height:min(72vh,640px);background:var(--dsw-alias-bg-layer-1,#fff);color:var(--dsw-alias-label-primary,#222);border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12));border-radius:14px;box-shadow:0 18px 48px rgba(0,0,0,.28);overflow:hidden}
.dst-panel-head{display:flex;align-items:flex-start;gap:12px;padding:16px 18px 10px}
.dst-panel-title{margin:0;font-size:15px;font-weight:600;line-height:22px}
.dst-panel-sub{margin:4px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#666)}
.dst-panel-body{flex:1;min-height:0;overflow:auto;padding:4px 10px 10px}
.dst-panel-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 18px 16px;border-top:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1))}
.dst-close{margin-left:auto;width:26px;height:26px;flex:none;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#666);cursor:default;font-size:16px;line-height:1}
.dst-close:hover{background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.06))}
.dst-row{display:flex;align-items:flex-start;gap:10px;padding:10px;border-radius:10px}
.dst-row:hover{background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.04))}
.dst-row-main{flex:1;min-width:0}
.dst-row-title{font-size:13px;line-height:20px;font-weight:550;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dst-row-meta{font-size:11px;line-height:18px;color:var(--dsw-alias-label-secondary,#666);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dst-row-actions{display:flex;gap:6px;flex:none}
.dst-btn{height:28px;padding:0 12px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.18));border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary,#222);font:inherit;font-size:12px;cursor:default;white-space:nowrap;-webkit-appearance:none;appearance:none}
.dst-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.06))}
.dst-btn:disabled{opacity:.55}
.dst-btn-primary{border-color:transparent;background:var(--dsw-alias-label-primary,#0f1115);color:var(--dsw-alias-bg-base,#fff)}
.dst-btn-primary:hover:not(:disabled){background:var(--dsw-alias-label-primary,#0f1115);filter:brightness(1.12)}
.dst-btn-danger{color:var(--dsw-alias-state-error-primary,#c0392b);border-color:var(--dsw-alias-state-error-primary,#c0392b)}
.dst-empty{padding:26px 18px;text-align:center;font-size:12px;line-height:20px;color:var(--dsw-alias-label-secondary,#666)}
.dst-field{display:flex;flex-direction:column;gap:8px;padding:0 8px 8px}
.dst-field-label{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#666)}
.dst-select{height:30px;padding:0 8px;border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.18));border-radius:8px;background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.04));color:var(--dsw-alias-label-primary,#222);font:inherit;font-size:13px}
.dst-check{display:flex;align-items:center;gap:8px;font-size:12px;line-height:20px}
.dst-checkbox{accent-color:var(--dsw-alias-brand-primary,#1f6feb)}
.dst-error{margin:8px;padding:10px 12px;border-radius:10px;border:1px solid var(--dsw-alias-state-error-primary,#c0392b);font-size:12px;line-height:18px}
.dst-error-title{font-weight:600;margin-bottom:2px}
.dst-bulk-toolbar{display:flex;align-items:center;gap:12px;padding:6px 10px 8px;margin-bottom:2px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.1))}
.dst-bulk-selected{margin-left:auto;font-size:12px;color:var(--dsw-alias-label-secondary,#666)}
.dst-bulk-group{display:flex;align-items:center;gap:8px;margin:8px 6px 2px;padding:9px 10px;border-radius:8px;background:rgba(59,130,246,.10);border-left:3px solid #3b82f6}
.dst-bulk-count{margin-left:auto;font-size:11px;line-height:16px;font-weight:400;color:var(--dsw-alias-label-secondary,#666)}
.dst-group-toggle{display:inline-flex;align-items:center;gap:7px;padding:0;border:0;background:none;color:#3b82f6;font:inherit;font-size:15px;line-height:22px;font-weight:700;letter-spacing:.01em;cursor:default;text-align:left}
.dst-group-toggle:hover{color:#1d4ed8}
.dst-bulk-group-title{font-size:15px;line-height:22px;font-weight:700;color:#3b82f6;letter-spacing:.01em}
.dst-chevron{display:inline-block;width:11px;font-size:11px;opacity:.9}
.dst-bulk-row{display:flex;align-items:center;gap:8px;padding:6px 10px 6px 18px;border-radius:8px;font-size:13px;line-height:20px;cursor:default}
.dst-bulk-row:hover{background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.05))}
.dst-bulk-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dst-bulk-mark{flex:none;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#666);border:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.12));border-radius:6px;padding:0 5px}
.dst-bulk-mark-lock{color:var(--dsw-alias-state-warn-primary,#a06a00);border-color:currentColor}
.dst-bulk-result{margin:8px 8px 2px;padding:8px 10px;border-radius:10px;background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.05));font-size:12px;line-height:18px}
.dst-bulk-actions{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
.dst-bulk-foot-left{display:flex;align-items:center;gap:10px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#666);white-space:nowrap}
.dst-link{border:0;background:none;padding:0;color:var(--dsw-alias-brand-primary,#1f6feb);font:inherit;font-size:12px;cursor:default}
.dst-link:hover{text-decoration:underline}
.dst-panel-foot-wrap{flex-wrap:wrap;row-gap:10px}
.dst-toast{position:fixed;left:50%;bottom:36px;transform:translateX(-50%);max-width:min(560px,calc(100vw - 48px));padding:9px 14px;border-radius:10px;background:var(--dsw-alias-bg-overlay,#222);color:var(--dsw-alias-label-primary,#fff);border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.16));box-shadow:0 10px 28px rgba(0,0,0,.3);font-size:12px;line-height:18px;pointer-events:auto}
`
			return style
		}
		//#endregion

		//#region glyphs
		const GlyphLock = (props) => h('svg', { viewBox: '0 0 16 16', width: props?.size ?? 14, height: props?.size ?? 14, 'aria-hidden': true, focusable: false },
			h('path', { d: 'M4.5 7V5.5a3.5 3.5 0 0 1 7 0V7', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.4, 'stroke-linecap': 'round' }),
			h('rect', { x: 3, y: 7, width: 10, height: 7, rx: 1.8, fill: 'currentColor' }),
		)

		const GlyphBin = (props) => h('svg', { viewBox: '0 0 16 16', width: props?.size ?? 14, height: props?.size ?? 14, 'aria-hidden': true, focusable: false, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.3, 'stroke-linecap': 'round' },
			h('path', { d: 'M3 4.5h10' }),
			h('path', { d: 'M5 4.5V3.2c0-.4.3-.7.7-.7h4.6c.4 0 .7.3.7.7V4.5' }),
			h('path', { d: 'M4.4 4.5l.6 8.1c0 .5.4.9.9.9h4.2c.5 0 .9-.4.9-.9l.6-8.1' }),
		)
		const GlyphChecklist = (props) => h('svg', { viewBox: '0 0 16 16', width: props?.size ?? 14, height: props?.size ?? 14, 'aria-hidden': true, focusable: false, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' },
			h('path', { d: 'M2.5 4.5l1.4 1.4L6.5 3.3' }),
			h('path', { d: 'M2.5 11.5l1.4 1.4L6.5 10.3' }),
			h('path', { d: 'M9 5h4.5' }),
			h('path', { d: 'M9 12h4.5' }),
		)
		//#endregion

		//#region commands
		/**
		 * Open the dialog that asks before the files travel with the Session.
		 * @param sessionId - Session identity.
		 * @param title - Row title.
		 */
		async function openDeleteDialog(sessionId, title) {
			store.patch({ busy: true, error: null })
			try {
				const inspection = await call('inspect', { sessionId })
				store.patch({
					busy: false,
					view: null,
					confirm: { kind: 'delete', sessionId, title: inspection.title || title, fileCount: inspection.fileCount },
				})
			} catch (error) {
				store.patch({ busy: false, error: { message: sentenceFor(error) } })
			}
		}

		/**
		 * Open the move dialog for one Session.
		 * @param sessionId - Session identity.
		 * @param title - Row title.
		 */
		async function openMoveDialog(sessionId, title) {
			store.patch({ busy: true, error: null })
			try {
				const inspection = await call('inspect', { sessionId })
				store.patch({
					busy: false,
					target: {
						sessionId,
						title: inspection.title || title,
						workspaceId: inspection.workspaceId,
						fileCount: inspection.fileCount,
						totalBytes: inspection.totalBytes,
						withFiles: inspection.fileCount > 0,
					},
					view: 'move',
					error: null,
				})
			} catch (error) {
				store.patch({ busy: false, error: { message: sentenceFor(error) } })
			}
		}

		/**
		 * Toggle one Session's lock.
		 * @param sessionId - Session identity.
		 * @param title - Row title.
		 * @param locked - Desired state.
		 */
		async function setLock(sessionId, title, locked) {
			try {
				await call('lock', { sessionId, locked })
				await refresh()
				notify(locked ? t('lockedToast', { title }) : t('unlockedToast', { title }))
			} catch (error) {
				notify(sentenceFor(error))
			}
		}

		/**
		 * Run one mutating call with the shared busy state and error surface.
		 * @param operation - Operation to await.
		 * @param done - Called with the value after the panels close.
		 */
		async function run(operation, done) {
			store.patch({ busy: true, error: null })
			try {
				const value = await operation()
				await refresh()
				store.patch({ busy: false, view: null, target: null, confirm: null, error: null })
				done?.(value)
			} catch (error) {
				store.patch({ busy: false, error: { message: sentenceFor(error) } })
			}
		}

		/** Close whatever the overlay is showing. */
		function closeOverlay() {
			store.patch({ view: null, target: null, confirm: null, bulkStep: null, bulkPreview: null, error: null })
		}
		//#endregion

		/**
		 * Contain a render failure inside this bundle.
		 *
		 * A slot occupant renders inside the owner's tree, so an exception here would
		 * otherwise reach the application root and take the whole frame down. Swallowing
		 * it costs one seat for the rest of the session; the console keeps the reason.
		 * @param render - The component body.
		 * @returns a component that never throws.
		 */
		function guard(render) {
			return function Guarded(props) {
				try {
					return render(props)
				} catch (error) {
					console.warn('[session-tools] a seat failed to render:', error)
					return null
				}
			}
		}

		//#region bulk
		/** @param code - Batch refusal code. @returns the short reason label. */
		function reasonLabel(code) {
			switch (code) {
				case 'session/locked':
					return t('reasonLocked')
				case 'session/live':
					return t('reasonLive')
				case 'bin/already':
					return t('reasonBinned')
				case 'session/missing':
					return t('reasonMissing')
				default:
					return t('reasonOther')
			}
		}

		/**
		 * One sentence that says exactly what a batch did, refusals included.
		 * @param value - Host batch result.
		 * @returns the summary sentence.
		 */
		function summarizeBatch(value) {
			const parts = []
			if (value.done.length > 0) parts.push(t('bulkResultDone', { count: value.done.length }))
			if (value.skipped.length > 0) {
				const reasons = [...new Set(value.skipped.map((item) => reasonLabel(item.code)))].join(t('bulkReasonJoin'))
				parts.push(t('bulkResultSkipped', { count: value.skipped.length, reasons }))
			}
			if (value.failed.length > 0) parts.push(t('bulkResultFailed', { count: value.failed.length }))
			return parts.length === 0 ? t('bulkNothing') : parts.join(t('bulkJoin'))
		}

		/** @returns the currently selected Session ids. */
		const selectedIds = () => store.state.bulkSelected

		/** @param ids - Replacement selection. */
		const setSelection = (ids) => store.patch({ bulkSelected: ids })

		/** @param id - Session to add or remove from the selection. */
		function toggleSelected(id) {
			const current = selectedIds()
			setSelection(current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
		}

		/**
		 * Read the manageable Session list from the Host.
		 *
		 * The Host builds it from the durable account and the store's own directory
		 * listing, so the panel never depends on which hooks the sidebar happens to hand
		 * its overlay seat — the earlier version asked for standard props and rendered an
		 * empty list whenever they were absent, which looked like "there is nowhere to
		 * tick a Session".
		 */
		async function loadBulk() {
			store.patch({ bulkLoading: true, error: null })
			try {
				const value = await call('sessions', {})
				store.patch({ bulkItems: value.items, bulkWorkspaces: value.workspaces, bulkLoading: false })
			} catch (error) {
				store.patch({ bulkLoading: false, error: { message: sentenceFor(error) } })
			}
		}

		/** Open the batch panel on a clean selection. */
		function openBulk() {
			refresh()
			store.patch({ view: 'bulk', bulkStep: null, bulkSelected: [], bulkPreview: null, bulkResult: null, bulkItems: null, error: null })
			loadBulk()
		}

		/**
		 * Run one batch over the selection and report the split.
		 * @param action - Host batch action.
		 * @param options - `withFiles` and `targetWorkspaceId` for that action.
		 */
		async function runBatch(action, options) {
			const ids = selectedIds()
			if (ids.length === 0) return
			store.patch({ busy: true, error: null })
			try {
				const value = await call('batch', { action, sessionIds: ids, ...options })
				await refresh()
				await loadBulk()
				store.patch({ busy: false, bulkStep: null, bulkSelected: [], bulkPreview: null, bulkResult: { action, ...value } })
				notify(summarizeBatch(value))
			} catch (error) {
				store.patch({ busy: false, error: { message: sentenceFor(error) } })
			}
		}

		/**
		 * Ask the Host how large a destructive batch would be, then ask for consent.
		 * @param step - `delete` or `move`.
		 */
		async function openBulkStep(step) {
			const ids = selectedIds()
			if (ids.length === 0) return
			store.patch({ busy: true, error: null })
			try {
				const preview = await call('batch-preview', { sessionIds: ids, withFiles: true })
				store.patch({
					busy: false,
					bulkStep: step,
					bulkPreview: preview,
					bulkDestination: '',
					bulkWithFiles: preview.fileCount > 0,
				})
			} catch (error) {
				store.patch({ busy: false, error: { message: sentenceFor(error) } })
			}
		}

		/**
		 * Group Host rows the way the sidebar groups them, so a batch acts on rows the
		 * reader already recognizes.
		 * @param items - Host Session rows.
		 * @param workspaces - Workspace projections in registry order.
		 * @returns the non-empty groups.
		 */
		function groupRows(items, workspaces) {
			const groups = []
			const claimed = new Set()
			for (const workspace of workspaces) {
				const rows = items.filter((item) => item.workspaceId === workspace.workspaceId)
				for (const row of rows) claimed.add(row.sessionId)
				groups.push({ key: workspace.workspaceId, title: workspace.title, rows })
			}
			const stray = items.filter((item) => !claimed.has(item.sessionId))
			if (stray.length > 0) groups.push({ key: '', title: t('bulkUngrouped'), rows: stray })
			return groups.filter((group) => group.rows.length > 0)
		}

		/** @param item - Host row. @returns its display title. */
		const rowTitle = (item) => item.title || (item.blank === true ? t('bulkBlank') : t('bulkUntitled'))

		/** The batch panel: groups, checkboxes, and the action bar. */
		function BulkPanel() {
			const state = useStore()
			const items = state.bulkItems ?? []
			const groups = groupRows(items, state.bulkWorkspaces ?? [])
			const selected = state.bulkSelected
			const loading = state.bulkLoading === true || state.bulkItems === null
			const busy = state.busy === true
			const allIds = items.map((item) => item.sessionId)
			const disabled = busy || selected.length === 0
			const action = (label, run, danger) => h('button', {
				type: 'button',
				className: `dst-btn${danger === true ? ' dst-btn-danger' : ''}`,
				disabled,
				onClick: run,
			}, label)
			const expanded = state.bulkExpanded ?? []
			const toggleGroup = (key) => store.patch({ bulkExpanded: expanded.includes(key) ? expanded.filter((value) => value !== key) : [...expanded, key] })
			const toolbar = h('div', { className: 'dst-bulk-toolbar' },
				h('label', { className: 'dst-check' },
					h('input', {
						type: 'checkbox',
						className: 'dst-checkbox',
						checked: allIds.length > 0 && selected.length === allIds.length,
						onChange: (event) => setSelection(event.target.checked ? allIds : []),
					}),
					h('span', null, t('bulkSelectAll')),
				),
				h('span', { className: 'dst-bulk-selected' }, t('bulkSelected', { count: selected.length })),
				h('button', {
					type: 'button',
					className: 'dst-link',
					onClick: () => store.patch({ bulkExpanded: expanded.length === groups.length ? [] : groups.map((group) => group.key) }),
				}, expanded.length === groups.length && groups.length > 0 ? t('bulkCollapseAll') : t('bulkExpandAll')),
			)
			const footer = h(React.Fragment, null,
				h('div', { className: 'dst-bulk-foot-left' },
					selected.length === 0
						? null
						: h('button', { type: 'button', className: 'dst-link', onClick: () => setSelection([]) }, t('bulkClear')),
				),
				h('div', { className: 'dst-bulk-actions' },
					action(t('bulkLock'), () => { runBatch('lock', {}) }),
					action(t('bulkUnlock'), () => { runBatch('unlock', {}) }),
					action(t('bulkDelete'), () => { openBulkStep('delete') }, true),
					action(t('bulkMove'), () => { openBulkStep('move') }),
				),
			)
			return h(Panel, {
				title: t('bulkTitle'),
				subtitle: t('bulkSubtitle'),
				onClose: closeOverlay,
				footer,
				footerClassName: 'dst-panel-foot dst-panel-foot-wrap',
			},
				h(ErrorBlock, { error: state.error }),
				state.bulkResult === null ? null : h('div', { className: 'dst-bulk-result' }, summarizeBatch(state.bulkResult)),
				loading
					? h('div', { className: 'dst-empty' }, t('bulkLoading'))
					: groups.length === 0
						? h('div', { className: 'dst-empty' }, t('bulkEmpty'))
						: h(React.Fragment, null,
							toolbar,
							groups.map((group) => {
								const opened = expanded.includes(group.key)
								return h('div', { key: group.key || 'ungrouped' },
								h('div', { className: 'dst-bulk-group' },
									h('input', {
										type: 'checkbox',
										className: 'dst-checkbox',
										'aria-label': group.title,
										checked: group.rows.length > 0 && group.rows.every((row) => selected.includes(row.sessionId)),
										onChange: (event) => {
											const ids = group.rows.map((row) => row.sessionId)
											const rest = selected.filter((id) => !ids.includes(id))
											setSelection(event.target.checked ? [...rest, ...ids] : rest)
										},
									}),
									h('button', {
										type: 'button',
										className: 'dst-group-toggle',
										'aria-expanded': opened,
										title: t('bulkToggleGroup'),
										onClick: () => toggleGroup(group.key),
									},
										h('span', { className: 'dst-chevron', 'aria-hidden': true }, opened ? '▾' : '▸'),
										h('span', { className: 'dst-bulk-group-title' }, group.title),
									),
									h('span', { className: 'dst-bulk-count' }, String(group.rows.length)),
								),
								opened ? group.rows.map((row) => h('label', { key: row.sessionId, className: 'dst-bulk-row' },
									h('input', {
										type: 'checkbox',
										className: 'dst-checkbox',
										checked: selected.includes(row.sessionId),
										onChange: () => toggleSelected(row.sessionId),
									}),
									h('span', { className: 'dst-bulk-title', title: rowTitle(row) }, rowTitle(row)),
									row.onDisk === false ? h('span', { className: 'dst-bulk-mark' }, t('bulkMissingMark')) : null,
									row.locked === true ? h('span', { className: 'dst-bulk-mark dst-bulk-mark-lock' }, t('bulkLockedMark')) : null,
									row.running === true ? h('span', { className: 'dst-bulk-mark' }, t('bulkRunningMark')) : null,
								)) : null,
								)
							}),
						),
			)
		}

		/** The consent step for a batch delete: bin it, or wipe it. */
		function BulkDeletePanel() {
			const state = useStore()
			const preview = state.bulkPreview
			const count = state.bulkSelected.length
			if (preview === null) return h(Panel, { title: t('bulkTitle'), onClose: closeOverlay }, h('div', { className: 'dst-empty' }, t('bulkLoading')))
			const heading = preview.fileCount > 0
				? t('bulkDeleteTitle', { count, files: preview.fileCount })
				: t('bulkDeleteTitlePlain', { count })
			const skip = preview.locked + preview.live > 0
				? t('bulkSkipNote', { locked: preview.locked, live: preview.live })
				: null
			const footer = h(React.Fragment, null,
				h('button', { type: 'button', className: 'dst-btn', disabled: state.busy, onClick: () => store.patch({ bulkStep: null }) }, t('cancel')),
				h('div', { className: 'dst-bulk-actions' },
					h('button', {
						type: 'button',
						className: 'dst-btn',
						disabled: state.busy,
						onClick: () => { runBatch('trash', { withFiles: true }) },
					}, state.busy ? t('bulkWorking') : t('toBin')),
					h('button', {
						type: 'button',
						className: 'dst-btn dst-btn-danger',
						disabled: state.busy,
						onClick: () => { runBatch('delete', { withFiles: true }) },
					}, state.busy ? t('bulkWorking') : t('deleteForever')),
				),
			)
			return h(Panel, { title: heading, onClose: closeOverlay, footer },
				h(ErrorBlock, { error: state.error }),
				h('div', { className: 'dst-empty' }, t('deleteBodyChoice')),
				skip === null ? null : h('div', { className: 'dst-bulk-result' }, skip),
			)
		}

		/** The destination step for a batch move. */
		function BulkMovePanel() {
			const state = useStore()
			const preview = state.bulkPreview
			const workspaces = state.bulkWorkspaces ?? []
			const count = state.bulkSelected.length
			useEffect(() => {
				if (store.state.bulkDestination === '' && (state.bulkWorkspaces ?? []).length > 0) {
					store.patch({ bulkDestination: state.bulkWorkspaces[0].workspaceId })
				}
			}, [state.bulkWorkspaces, state.bulkDestination])
			if (preview === null) return h(Panel, { title: t('bulkTitle'), onClose: closeOverlay }, h('div', { className: 'dst-empty' }, t('bulkLoading')))
			if (workspaces.length === 0) {
				return h(Panel, { title: t('bulkMoveTitle', { count }), onClose: closeOverlay },
					h('div', { className: 'dst-empty' }, t('bulkNoDestination')),
				)
			}
			const footer = h(React.Fragment, null,
				h('button', { type: 'button', className: 'dst-btn', disabled: state.busy, onClick: () => store.patch({ bulkStep: null }) }, t('cancel')),
				h('button', {
					type: 'button',
					className: 'dst-btn dst-btn-primary',
					disabled: state.busy || state.bulkDestination === '',
					onClick: () => { runBatch('move', { targetWorkspaceId: state.bulkDestination, withFiles: state.bulkWithFiles }) },
				}, state.busy ? t('bulkWorking') : t('moveConfirm')),
			)
			return h(Panel, { title: t('bulkMoveTitle', { count }), onClose: closeOverlay, footer },
				h(ErrorBlock, { error: state.error }),
				h('div', { className: 'dst-field' },
					h('label', { className: 'dst-field-label', htmlFor: 'dsh-session-tools-bulk-destination' }, t('moveTarget')),
					h('select', {
						id: 'dsh-session-tools-bulk-destination',
						className: 'dst-select',
						value: state.bulkDestination,
						onChange: (event) => store.patch({ bulkDestination: event.target.value }),
					}, workspaces.map((workspace) => h('option', { key: workspace.workspaceId, value: workspace.workspaceId }, `${workspace.title} — ${workspace.path}`))),
					preview.fileCount === 0
						? h('div', { className: 'dst-field-label' }, t('bulkMoveNoFiles'))
						: h('label', { className: 'dst-check' },
							h('input', {
								className: 'dst-checkbox',
								type: 'checkbox',
								checked: state.bulkWithFiles === true,
								onChange: (event) => store.patch({ bulkWithFiles: event.target.checked }),
							}),
							h('span', null, t('bulkMoveFiles', { files: preview.fileCount })),
						),
					preview.locked + preview.live > 0
						? h('div', { className: 'dst-field-label' }, t('bulkSkipNote', { locked: preview.locked, live: preview.live }))
						: null,
				),
			)
		}

		/**
		 * The sidebar-foot entry into the batch panel.
		 * @param props - `wide` reports whether the sidebar renders labels.
		 */
		function BulkButton(props) {
			const label = t('bulkButton')
			return h('button', {
				type: 'button',
				className: 'dst-foot',
				title: label,
				'aria-label': label,
				onClick: openBulk,
			},
				h(GlyphChecklist, null),
				props.wide === true ? h('span', null, label) : null,
			)
		}
		//#endregion

		//#region seats
		/**
		 * One Session row's menu rows.
		 * @param props - Owner props plus the menu's dismissal hook.
		 */
		function SessionMenu(props) {
			const { sessionId, displayTitle } = props
			const state = useStore()
			const menuOpen = typeof props.useMenuOpenState === 'function' ? props.useMenuOpenState() : undefined
			const closeMenu = () => {
				try {
					menuOpen?.[1]?.(false)
				} catch {
					/* dismissal is a courtesy; the action still runs */
				}
			}
			const locked = (state.snapshot?.lockedIds ?? []).includes(sessionId)
			const title = displayTitle || t('sessionFallback')
			const row = (label, onSelect, danger) => h('button', {
				key: label,
				type: 'button',
				role: 'menuitem',
				className: `dst-menu-item${danger === true ? ' dst-menu-item-danger' : ''}`,
				onClick: (event) => {
					event.preventDefault()
					event.stopPropagation()
					closeMenu()
					onSelect()
				},
			}, label)
			return h(React.Fragment, null,
				row(locked ? t('menuUnlock') : t('menuLock'), () => { setLock(sessionId, title, !locked) }),
				row(t('menuDelete'), () => { openDeleteDialog(sessionId, title) }, true),
				row(t('menuMove'), () => { openMoveDialog(sessionId, title) }),
			)
		}

		/**
		 * The lock mark on a protected Session row.
		 * @param props - Owner props carry the row's Session id.
		 */
		function LockBadge(props) {
			const state = useStore()
			if (!(state.snapshot?.lockedIds ?? []).includes(props.sessionId)) return null
			return h('span', { className: 'dst-lock', title: t('rowLocked'), 'aria-label': t('rowLocked'), role: 'img' }, h(GlyphLock, null))
		}

		/**
		 * The recycle-bin entry beside Settings.
		 * @param props - `wide` reports whether the sidebar renders labels.
		 */
		function FooterBin(props) {
			const state = useStore()
			const count = state.snapshot?.trash?.length ?? 0
			const label = count > 0 ? t('footerBinCount', { count }) : t('footerBin')
			return h('button', {
				type: 'button',
				className: 'dst-foot',
				title: label,
				'aria-label': label,
				onClick: () => {
					refresh()
					store.patch({ view: 'trash', error: null })
				},
			},
				h(GlyphBin, null),
				props.wide === true ? h('span', null, label) : null,
			)
		}
		//#endregion

		//#region overlay
		/** @param props - Panel chrome and content. */
		function Panel(props) {
			return h('div', {
				className: 'dst-backdrop',
				onMouseDown: (event) => {
					if (event.target === event.currentTarget) props.onClose()
				},
			},
				h('div', { className: 'dst-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': props.title },
					h('div', { className: 'dst-panel-head' },
						h('div', null,
							h('h2', { className: 'dst-panel-title' }, props.title),
							props.subtitle ? h('p', { className: 'dst-panel-sub' }, props.subtitle) : null,
						),
						h('button', { type: 'button', className: 'dst-close', title: t('close'), 'aria-label': t('close'), onClick: props.onClose }, '×'),
					),
					h('div', { className: 'dst-panel-body' }, props.children),
					props.footer ? h('div', { className: props.footerClassName ?? 'dst-panel-foot' }, props.footer) : null,
				),
			)
		}

		/** @param props - Error block, or nothing. */
		function ErrorBlock(props) {
			if (props.error === null || props.error === undefined) return null
			return h('div', { className: 'dst-error' },
				h('div', { className: 'dst-error-title' }, t('errorTitle')),
				h('div', null, props.error.message),
			)
		}

		/**
		 * One recycle-bin entry row.
		 * @param props - Entry and its actions.
		 */
		function BinRow(props) {
			const entry = props.entry
			const when = new Date(entry.deletedAt)
			const meta = [
				entry.workspaceTitle === null || entry.workspaceTitle === undefined ? t('unknownWorkspace') : entry.workspaceTitle,
				entry.withFiles ? t('withFiles', { count: entry.fileCount }) : t('noFiles'),
				Number.isNaN(when.getTime()) ? '' : when.toLocaleString(),
			].filter((part) => part !== '').join(' · ')
			return h('div', { className: 'dst-row' },
				h('div', { className: 'dst-row-main' },
					h('div', { className: 'dst-row-title', title: entry.title }, entry.title),
					h('div', { className: 'dst-row-meta', title: meta }, meta),
				),
				h('div', { className: 'dst-row-actions' },
					h('button', { type: 'button', className: 'dst-btn', disabled: props.busy, onClick: () => props.onRestore(entry) }, t('restore')),
					h('button', { type: 'button', className: 'dst-btn dst-btn-danger', disabled: props.busy, onClick: () => props.onPurge(entry) }, t('purge')),
				),
			)
		}

		/** The recycle-bin panel. */
		function BinPanel() {
			const state = useStore()
			const entries = state.snapshot?.trash ?? []
			const footer = entries.length === 0 ? null : h(React.Fragment, null,
				h('span', { className: 'dst-row-meta' }, t('binCount', { count: entries.length })),
				h('button', {
					type: 'button',
					className: 'dst-btn dst-btn-danger',
					disabled: state.busy,
					onClick: () => store.patch({ confirm: { kind: 'empty', count: entries.length } }),
				}, t('empty')),
			)
			return h(Panel, { title: t('binTitle'), subtitle: t('binSubtitle'), onClose: closeOverlay, footer },
				h(ErrorBlock, { error: state.error }),
				entries.length === 0
					? h('div', { className: 'dst-empty' }, t('binEmpty'))
					: entries.map((entry) => h(BinRow, {
						key: entry.entryId,
						entry,
						busy: state.busy,
						onRestore: (item) => { run(() => call('restore', { entryId: item.entryId }), () => notify(t('restoredToast', { title: item.title }))) },
						onPurge: (item) => store.patch({ confirm: { kind: 'purge', entry: item } }),
					})),
			)
		}

		/** The move dialog for the Session in `state.target`. */
		function MovePanel() {
			const state = useStore()
			const target = state.target
			const [destination, setDestination] = useState('')
			const [withFiles, setWithFiles] = useState(target?.withFiles === true)
			const workspaces = (state.snapshot?.workspaces ?? []).filter((workspace) => workspace.workspaceId !== target?.workspaceId)
			useEffect(() => {
				if (destination === '' && workspaces.length > 0) setDestination(workspaces[0].workspaceId)
			}, [workspaces.length, destination])
			if (target === null) return null
			if (workspaces.length === 0) {
				return h(Panel, { title: t('moveTitle', { title: target.title }), onClose: closeOverlay },
					h('div', { className: 'dst-empty' }, t('moveNone')),
				)
			}
			const footer = h(React.Fragment, null,
				h('button', { type: 'button', className: 'dst-btn', onClick: closeOverlay, disabled: state.busy }, t('cancel')),
				h('button', {
					type: 'button',
					className: 'dst-btn dst-btn-primary',
					disabled: state.busy || destination === '',
					onClick: () => {
						const chosen = workspaces.find((workspace) => workspace.workspaceId === destination)
						run(
							() => call('move', { sessionId: target.sessionId, targetWorkspaceId: destination, withFiles }),
							(value) => {
								const movedTo = chosen?.title ?? value.targetWorkspaceTitle
								notify(value.skipped.length > 0
									? t('moveSkippedToast', { workspace: movedTo, count: value.skipped.length })
									: t('moveDoneToast', { workspace: movedTo }))
							},
						)
					},
				}, state.busy ? t('working') : t('moveConfirm')),
			)
			return h(Panel, { title: t('moveTitle', { title: target.title }), onClose: closeOverlay, footer },
				h(ErrorBlock, { error: state.error }),
				h('div', { className: 'dst-field' },
					h('label', { className: 'dst-field-label', htmlFor: 'dsh-session-tools-destination' }, t('moveTarget')),
					h('select', {
						id: 'dsh-session-tools-destination',
						className: 'dst-select',
						value: destination,
						onChange: (event) => setDestination(event.target.value),
					}, workspaces.map((workspace) => h('option', { key: workspace.workspaceId, value: workspace.workspaceId }, `${workspace.title} — ${workspace.path}`))),
					target.fileCount === 0
						? h('div', { className: 'dst-field-label' }, t('moveNoFiles'))
						: h('label', { className: 'dst-check' },
							h('input', {
								className: 'dst-checkbox',
								type: 'checkbox',
								checked: withFiles,
								onChange: (event) => setWithFiles(event.target.checked),
							}),
							h('span', null, t('moveFiles', { count: target.fileCount })),
						),
				),
			)
		}

		/**
		 * The confirmation for a destructive step.
		 *
		 * A Session delete always offers the same two exits, because "delete" alone is
		 * ambiguous once a recycle bin exists: the bin keeps it restorable, a direct
		 * delete is final. Both buttons say which one they are.
		 */
		function ConfirmPanel() {
			const state = useStore()
			const confirm = state.confirm
			if (confirm === null) return null
			const isDelete = confirm.kind === 'delete'
			const isPurge = confirm.kind === 'purge'
			const heading = isDelete
				? (confirm.fileCount > 0 ? t('deleteTitleFiles', { title: confirm.title, count: confirm.fileCount }) : t('deleteTitlePlain', { title: confirm.title }))
				: isPurge ? t('purge', { title: confirm.entry.title }) : t('emptyTitle')
			const body = isDelete
				? t('deleteBodyChoice')
				: isPurge ? null : t('emptyConfirm', { count: confirm.count })
			const binButton = isDelete
				? h('button', {
					type: 'button',
					className: 'dst-btn',
					disabled: state.busy,
					onClick: () => {
						run(
							() => call('trash', { sessionId: confirm.sessionId, withFiles: true }),
							(value) => notify(value.fileCount > 0 ? t('trashedFilesToast', { title: value.title, count: value.fileCount }) : t('trashedToast', { title: value.title })),
						)
					},
				}, state.busy ? t('working') : t('toBin'))
				: null
			const dangerButton = h('button', {
				type: 'button',
				className: 'dst-btn dst-btn-danger',
				disabled: state.busy,
				onClick: () => {
					if (isDelete) {
						run(
							() => call('delete', { sessionId: confirm.sessionId, withFiles: true }),
							(value) => notify(t('deletedToast', { title: value.title })),
						)
						return
					}
					if (isPurge) {
						run(() => call('purge', { entryId: confirm.entry.entryId }), () => notify(t('purgedToast', { title: confirm.entry.title })))
						return
					}
					run(() => call('empty', {}), () => notify(t('emptiedToast')))
				},
			}, state.busy ? t('working') : (isDelete ? t('deleteForever') : isPurge ? t('purge') : t('empty')))
			const footer = h(React.Fragment, null,
				h('button', { type: 'button', className: 'dst-btn', onClick: () => store.patch({ confirm: null }), disabled: state.busy }, t('cancel')),
				h('div', { className: 'dst-bulk-actions' }, binButton, dangerButton),
			)
			return h(Panel, { title: heading, onClose: () => store.patch({ confirm: null }), footer },
				h(ErrorBlock, { error: state.error }),
				body === null ? null : h('div', { className: 'dst-empty' }, body),
			)
		}

		/** The frame-wide layer: one panel at a time, plus the transient sentence. */
		function Overlay(props) {
			const state = useStore()
			const open = state.view !== null || state.confirm !== null
			useEffect(() => {
				if (!open) return undefined
				const onKey = (event) => {
					if (event.key !== 'Escape') return
					if (state.confirm !== null) store.patch({ confirm: null })
					else if (state.bulkStep !== null) store.patch({ bulkStep: null, bulkPreview: null })
					else closeOverlay()
				}
				window.addEventListener('keydown', onKey)
				return () => window.removeEventListener('keydown', onKey)
			}, [open, state.confirm, state.bulkStep])
			let panel = null
			if (state.confirm !== null) panel = h(ConfirmPanel, null)
			else if (state.view === 'trash') panel = h(BinPanel, null)
			else if (state.view === 'move') panel = h(MovePanel, null)
			else if (state.view === 'bulk') {
				if (state.bulkStep === 'delete') panel = h(BulkDeletePanel, null)
				else if (state.bulkStep === 'move') panel = h(BulkMovePanel, null)
				else panel = h(BulkPanel, null)
			}
			return h(React.Fragment, null,
				panel,
				state.toast === null ? null : h('div', { className: 'dst-toast', role: 'status' }, state.toast.message),
			)
		}
		//#endregion

		return {
			inject: ['slots'],
			apply(ctx) {
				ctx.effect(() => {
					const style = buildStyle()
					document.head.appendChild(style)
					return () => style.remove()
				}, 'session-tools.style')

				// The copy follows the reader's language through the Client locale service.
				try {
					const locale = ctx.locale ?? ctx.get?.('locale')
					const read = () => {
						const snapshot = locale?.getLocale?.()
						const id = snapshot?.locale ?? snapshot?.id ?? snapshot?.current
						if (typeof id === 'string' && id !== '') store.patch({ localeId: id })
					}
					read()
					if (typeof locale?.subscribe === 'function') ctx.effect(() => locale.subscribe(read), 'session-tools.locale')
				} catch {
					/* copy falls back to the default language */
				}

				refresh()

				ctx.slots.inject('sidebar.workspaces.session.menu.item', () => ctx.slots.register({
					name: 'sidebar.workspaces.session.menu.item',
					id: 'session-tools.session-menu',
					order: 700,
				}, guard(SessionMenu)))

				ctx.slots.inject('sidebar.session.row.trailing', () => ctx.slots.register({
					name: 'sidebar.session.row.trailing',
					id: 'session-tools.lock-badge',
					order: 10,
				}, guard(LockBadge)))

				ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
					name: 'sidebar.footer.action',
					id: 'session-tools.bulk',
					order: 9,
				}, guard(BulkButton)))

				ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
					name: 'sidebar.footer.action',
					id: 'session-tools.bin',
					order: 10,
				}, guard(FooterBin)))

				ctx.slots.inject('shell.overlay', () => ctx.slots.register({
					name: 'shell.overlay',
					id: 'session-tools.overlay',
					order: 20,
				}, guard(Overlay)))
			},
		}
	},
})
