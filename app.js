(function () {
  'use strict';

  const STORAGE_KEY = 'notes-app-data-v2';
  const VIEW_LIST = 'list';
  const VIEW_EDITOR = 'editor';

  let notes = [];
  let currentNoteId = null;
  let currentView = VIEW_LIST;
  let saveTimeout = null;
  let deleteCallback = null;
  let isFullscreen = false;
  let searchQuery = '';
  let historyStack = [];
  let historyIndex = -1;
  let isApplyingHistory = false;
  let saveStatusTimeout = null;

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const noteListEl = $('#note-list');
  const notesUlEl = $('#notes-ul');
  const emptyStateEl = $('#empty-state');
  const noteEditorEl = $('#note-editor');
  const editorEl = $('#editor');
  const noteTitleEl = $('#note-title');
  const noteDateEl = $('#note-date');
  const modalOverlayEl = $('#modal-overlay');
  const modalTextEl = $('#modal-text');
  const modalCancelBtn = $('#modal-cancel');
  const modalConfirmBtn = $('#modal-confirm');
  const saveIndicatorEl = $('#save-indicator');
  const searchInputEl = $('#search-input');
  const fullscreenBackBtn = $('#fullscreen-back');
  const btnFontIncrease = $('#btn-font-increase');
  const btnFontDecrease = $('#btn-font-decrease');
  const syncStatusEl = $('#sync-status');

  let fontSize = 17;
  let supabase = null;
  let currentUserId = null;
  let isOnline = navigator.onLine;
  let syncTimeout = null;
  let isSyncing = false;

  function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function now() {
    return new Date().toISOString();
  }

  function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const nowDate = new Date();
    const diffMs = nowDate - d;
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return diffMins + 'm ago';
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return diffHours + 'h ago';
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return diffDays + 'd ago';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() !== nowDate.getFullYear() ? 'numeric' : undefined });
  }

  function formatFullDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function escapeHtmlAttr(text) {
    return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#039;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function looksLikeMarkdown(text) {
    if (!text || !text.trim()) return false;
    const hasHeading = /^#{1,6}\s+.+$/m.test(text);
    const hasBold = /\*\*\*.+?\*\*\*|\*\*.+?\*\*|__.+=?__/.test(text);
    const hasItalic = /\*.+?\*|_.+?_/.test(text);
    const hasCode = /```[\s\S]*?```|`[^`]+`/.test(text);
    const hasList = /^\s*[-*+]\s+.+$/m.test(text) || /^\s*\d+\.\s+.+$/m.test(text);
    const hasBlockquote = /^(&gt;\s*|>\s*).+$/m.test(text);
    const hasLink = /\[([^\]]+)\]\(([^)]+)\)/.test(text);
    const hasHr = /^(\*{3,}|-{3,}|_{3,})$/m.test(text);
    return hasHeading || hasBold || hasItalic || hasCode || hasList || hasBlockquote || hasLink || hasHr;
  }

  function tokenizeMarkdown(md) {
    const tokens = [];
    const lines = md.split('\n');
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        tokens.push({ type: 'heading', level, text: headingMatch[2] });
        i++;
        continue;
      }

      const hrMatch = line.match(/^(\*{3,}|-{3,}|_{3,})$/);
      if (hrMatch) {
        tokens.push({ type: 'hr' });
        i++;
        continue;
      }

      const blockquoteMatch = line.match(/^(&gt;\s*|>\s*)(.+)$/);
      if (blockquoteMatch) {
        const quoteLines = [];
        while (i < lines.length) {
          const qLine = lines[i];
          if (qLine.match(/^(&gt;\s*|>\s*)(.+)$/)) {
            quoteLines.push(qLine.replace(/^(&gt;\s*|>\s*)/, ''));
            i++;
          } else {
            break;
          }
        }
        tokens.push({ type: 'blockquote', text: quoteLines.join('\n') });
        continue;
      }

      const codeBlockMatch = line.match(/^```(\w+)?\s*$/);
      if (codeBlockMatch) {
        const codeLines = [];
        const lang = codeBlockMatch[1] || '';
        i++;
        while (i < lines.length && !lines[i].startsWith('```')) {
          codeLines.push(lines[i]);
          i++;
        }
        if (i < lines.length) i++;
        tokens.push({ type: 'codeblock', lang, text: codeLines.join('\n') });
        continue;
      }

      const ulMatch = line.match(/^(\s*)([-*+])\s+(.+)$/);
      if (ulMatch) {
        const items = [];
        while (i < lines.length) {
          const uLine = lines[i];
          const uMatch = uLine.match(/^(\s*)([-*+])\s+(.+)$/);
          if (uMatch) {
            items.push(uMatch[3]);
            i++;
          } else {
            break;
          }
        }
        tokens.push({ type: 'ul', items });
        continue;
      }

      const olMatch = line.match(/^(\s*)(\d+)\.\s+(.+)$/);
      if (olMatch) {
        const items = [];
        while (i < lines.length) {
          const oLine = lines[i];
          const oMatch = oLine.match(/^(\s*)(\d+)\.\s+(.+)$/);
          if (oMatch) {
            items.push(oMatch[3]);
            i++;
          } else {
            break;
          }
        }
        tokens.push({ type: 'ol', items });
        continue;
      }

      if (line.trim() === '') {
        tokens.push({ type: 'blank' });
        i++;
        continue;
      }

      const paraLines = [];
      while (i < lines.length && lines[i].trim() !== '') {
        const isStructural = lines[i].match(/^#{1,6}\s/);
        const isHr = lines[i].match(/^(\*{3,}|-{3,}|_{3,})$/);
        const isCodeBlock = lines[i].match(/^```/);
        const isQuote = lines[i].match(/^(&gt;\s*|>\s*)/);
        const isUl = lines[i].match(/^(\s*)([-*+])\s/);
        const isOl = lines[i].match(/^(\s*)(\d+)\.\s/);
        if (isStructural || isHr || isCodeBlock || isQuote || isUl || isOl) break;
        paraLines.push(lines[i]);
        i++;
      }
      tokens.push({ type: 'paragraph', text: paraLines.join('\n') });
    }

    return tokens;
  }

  function inlineMarkdown(text) {
    let html = escapeHtml(text);

    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
    html = html.replace(/_(.+?)_/g, '<em>$1</em>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

    return html;
  }

  function renderTokens(tokens) {
    let html = '';
    tokens.forEach(token => {
      switch (token.type) {
        case 'heading':
          html += '<h' + token.level + '>' + inlineMarkdown(token.text) + '</h' + token.level + '>';
          break;
        case 'hr':
          html += '<hr>';
          break;
        case 'blockquote':
          html += '<blockquote>' + inlineMarkdown(token.text) + '</blockquote>';
          break;
        case 'codeblock':
          html += '<pre><code>' + escapeHtmlAttr(token.text) + '</code></pre>';
          break;
        case 'ul':
          html += '<ul>' + token.items.map(item => '<li>' + inlineMarkdown(item) + '</li>').join('') + '</ul>';
          break;
        case 'ol':
          html += '<ol>' + token.items.map(item => '<li>' + inlineMarkdown(item) + '</li>').join('') + '</ol>';
          break;
        case 'paragraph':
          const escaped = escapeHtml(token.text);
          const withBreaks = escaped.replace(/\n/g, '<br>');
          html += '<p>' + withBreaks + '</p>';
          break;
        case 'blank':
          html += '<p>&nbsp;</p>';
          break;
        default:
          break;
      }
    });
    return html;
  }

  function parseMarkdown(md) {
    const tokens = tokenizeMarkdown(md);
    return renderTokens(tokens);
  }

  function showSaveStatus(status) {
    if (!saveIndicatorEl) return;
    saveIndicatorEl.textContent = status;
    saveIndicatorEl.classList.remove('hidden');
    clearTimeout(saveStatusTimeout);
    if (status === 'Saved') {
      saveStatusTimeout = setTimeout(() => {
        saveIndicatorEl.classList.add('hidden');
      }, 2000);
    }
  }

  function getPlainText(html) {
    const tmp = document.createElement('div');
    tmp.innerHTML = html;
    return (tmp.textContent || tmp.innerText || '').trim();
  }

  function getDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('notes-db', 1);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains('notes')) {
          db.createObjectStore('notes', { keyPath: 'id' });
        }
      };
    });
  }

  function dbPut(note) {
    return getDb().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction('notes', 'readwrite');
      tx.objectStore('notes').put(note);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  function dbDelete(id) {
    return getDb().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction('notes', 'readwrite');
      tx.objectStore('notes').delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  function dbClear() {
    return getDb().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction('notes', 'readwrite');
      tx.objectStore('notes').clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  function dbGetAll() {
    return getDb().then(db => new Promise((resolve, reject) => {
      const tx = db.transaction('notes', 'readonly');
      const request = tx.objectStore('notes').getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    }));
  }

  function migrateToIndexedDb() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return Promise.resolve();
      const data = JSON.parse(raw);
      if (!Array.isArray(data) || data.length === 0) return Promise.resolve();
      return Promise.all(data.map(note => dbPut(note))).then(() => {
        localStorage.removeItem(STORAGE_KEY);
      }).catch(() => {});
    } catch (e) {
      return Promise.resolve();
    }
  }

  async function loadNotes() {
    try {
      await migrateToIndexedDb();
      notes = await dbGetAll();
    } catch (e) {
      console.warn('Failed to load notes from IndexedDB', e);
      notes = [];
    }
  }

  async function saveNotes() {
    try {
      const operations = notes.map(note => dbPut(note));
      await Promise.all(operations);
    } catch (e) {
      console.warn('Failed to save notes to IndexedDB', e);
    }
  }

  async function initSupabase() {
    try {
      if (!window.supabase || !window.SUPABASE_URL || window.SUPABASE_URL === 'https://YOUR_PROJECT_REF.supabase.co') {
        updateSyncStatus('disabled', 'Cloud sync not configured');
        return;
      }
      supabase = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) {
        console.warn('Supabase anonymous auth failed', error);
        const message = (error && error.message) ? error.message : 'Auth failed';
        updateSyncStatus('error', message);
        return;
      }
      currentUserId = data.user?.id;
      updateSyncStatus(isOnline ? 'synced' : 'offline', isOnline ? 'Synced' : 'Offline');
      await syncNotes();
    } catch (e) {
      console.warn('Supabase init failed', e);
      updateSyncStatus('error', 'Sync error');
    }
  }

  async function tryEnableAnonymousAuth() {
    if (!supabase) return;
    try {
      await supabase.auth.signInAnonymously();
    } catch (e) {
      console.warn('Anonymous auth not available:', e);
    }
  }

  function remoteToLocal(remote) {
    if (!remote) return null;
    return {
      id: remote.id,
      title: remote.title || '',
      content: remote.content || '',
      createdAt: remote.created_at || now(),
      updatedAt: remote.updated_at || now()
    };
  }

  function localToRemote(note) {
    return {
      id: note.id,
      user_id: currentUserId,
      title: note.title || '',
      content: note.content || '',
      created_at: note.createdAt || now(),
      updated_at: note.updatedAt || now()
    };
  }

  async function syncNotes() {
    if (!supabase || !currentUserId || !isOnline || isSyncing) return;
    isSyncing = true;
    try {
      updateSyncStatus('syncing', 'Syncing...');
      const { data: remoteNotes, error } = await supabase
        .from('notes')
        .select('*')
        .eq('user_id', currentUserId)
        .order('updated_at', { ascending: false });
      if (error) throw error;
      const normalizedRemote = (remoteNotes || [])
        .map(remoteToLocal)
        .filter(Boolean);
      const remoteMap = new Map(normalizedRemote.map(n => [n.id, n]));
      const merged = new Map();
      for (const note of notes) {
        const remote = remoteMap.get(note.id);
        if (remote && new Date(remote.updatedAt) > new Date(note.updatedAt)) {
          merged.set(remote.id, remote);
        } else {
          merged.set(note.id, note);
        }
      }
      for (const note of normalizedRemote) {
        if (!merged.has(note.id)) merged.set(note.id, note);
      }
      notes = Array.from(merged.values());
      const toUpsert = notes.map(localToRemote);
      const { error: upsertError } = await supabase
        .from('notes')
        .upsert(toUpsert, { onConflict: 'id' });
      if (upsertError) throw upsertError;
      await saveNotes();
      renderNoteList();
      updateSyncStatus('synced', 'Synced');
    } catch (e) {
      console.warn('Sync failed', e);
      updateSyncStatus('error', 'Sync failed');
    } finally {
      isSyncing = false;
    }
  }

  function scheduleSync() {
    clearTimeout(syncTimeout);
    syncTimeout = setTimeout(() => syncNotes(), 1000);
  }

  function updateSyncStatus(state, text) {
    if (!syncStatusEl) return;
    syncStatusEl.textContent = text;
    syncStatusEl.className = 'sync-status ' + (state || '');
  }

  function handleOnline() {
    isOnline = true;
    if (currentUserId) syncNotes();
  }

  function handleOffline() {
    isOnline = false;
    updateSyncStatus('offline', 'Offline');
  }

  function debouncedSave() {
    showSaveStatus('Saving...');
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(async () => {
      syncCurrentNote();
      await saveNotes();
      renderNoteList();
      showSaveStatus('Saved');
      scheduleSync();
    }, 400);
  }

  function syncCurrentNote() {
    if (!currentNoteId) return;
    const note = notes.find(n => n.id === currentNoteId);
    if (!note) return;
    note.title = noteTitleEl.value.trim();
    note.content = editorEl.innerHTML;
    note.updatedAt = now();
    if (!note.createdAt) note.createdAt = now();
  }

  function pushHistory() {
    if (isApplyingHistory) return;
    const html = editorEl.innerHTML;
    if (historyIndex >= 0 && historyStack[historyIndex] === html) return;
    historyStack = historyStack.slice(0, historyIndex + 1);
    historyStack.push(html);
    if (historyStack.length > 200) historyStack.shift();
    historyIndex = historyStack.length - 1;
  }

  function undo() {
    if (historyIndex <= 0) return;
    historyIndex--;
    applyHistory();
  }

  function redo() {
    if (historyIndex >= historyStack.length - 1) return;
    historyIndex++;
    applyHistory();
  }

  function applyHistory() {
    isApplyingHistory = true;
    const html = historyStack[historyIndex];
    editorEl.innerHTML = html;
    isApplyingHistory = false;
    debouncedSave();
  }

  function getFilteredNotes() {
    let result = notes;
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = notes.filter(note => {
        const title = (note.title || '').toLowerCase();
        const body = getPlainText(note.content || '').toLowerCase();
        return title.includes(q) || body.includes(q);
      });
    }
    return result.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  }

  function renderNoteList() {
    notesUlEl.innerHTML = '';
    const filtered = getFilteredNotes();
    if (filtered.length === 0) {
      emptyStateEl.classList.remove('hidden');
    } else {
      emptyStateEl.classList.add('hidden');
      filtered.forEach(note => {
        const li = document.createElement('li');
        li.className = 'note-item';
        li.dataset.id = note.id;
        const title = document.createElement('div');
        title.className = 'note-item-title';
        title.textContent = note.title || 'Untitled';
        const preview = document.createElement('div');
        preview.className = 'note-item-preview';
        preview.textContent = getPlainText(note.content).slice(0, 120) || 'No content';
        const date = document.createElement('div');
        date.className = 'note-item-date';
        date.textContent = formatDate(note.updatedAt);
        li.appendChild(title);
        li.appendChild(preview);
        li.appendChild(date);
        li.addEventListener('click', (e) => {
          if (li.classList.contains('swiped')) {
            li.classList.remove('swiped');
            return;
          }
          openNote(note.id);
        });
        setupSwipeActions(li, note.id);
        setupLongPress(li, note.id);
        notesUlEl.appendChild(li);
      });
    }
  }

  function setupSwipeActions(item, noteId) {
    let startX = 0;
    let currentX = 0;
    let isSwiping = false;
    const threshold = 60;

    item.addEventListener('touchstart', (e) => {
      startX = e.touches[0].clientX;
      isSwiping = true;
      item.style.transition = 'none';
    }, { passive: true });

    item.addEventListener('touchmove', (e) => {
      if (!isSwiping) return;
      currentX = e.touches[0].clientX;
      const diff = currentX - startX;
      if (diff < 0) {
        item.style.transform = 'translateX(' + Math.max(diff, -120) + 'px)';
      }
    }, { passive: true });

    item.addEventListener('touchend', () => {
      isSwiping = false;
      item.style.transition = 'transform 0.2s ease';
      const diff = currentX - startX;
      if (diff < -threshold) {
        item.style.transform = 'translateX(-120px)';
        item.classList.add('swiped');
        const actions = document.createElement('div');
        actions.className = 'note-item-actions';
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'note-action-btn note-action-delete';
        deleteBtn.textContent = 'Delete';
        deleteBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          item.classList.remove('swiped');
          item.style.transform = '';
          deleteNoteById(noteId);
        });
        actions.appendChild(deleteBtn);
        item.appendChild(actions);
      } else {
        item.style.transform = '';
        const actions = item.querySelector('.note-item-actions');
        if (actions) actions.remove();
      }
    });
  }

  function setupLongPress(item, noteId) {
    let timer;
    const duration = 500;

    const start = (e) => {
      timer = setTimeout(() => {
        item.classList.add('long-press');
        if (navigator.vibrate) navigator.vibrate(50);
      }, duration);
    };

    const cancel = () => {
      clearTimeout(timer);
      item.classList.remove('long-press');
    };

    item.addEventListener('touchstart', start, { passive: true });
    item.addEventListener('touchend', cancel);
    item.addEventListener('touchmove', cancel);
    item.addEventListener('touchcancel', cancel);
    item.addEventListener('mousedown', start);
    item.addEventListener('mouseup', cancel);
    item.addEventListener('mouseleave', cancel);
  }

  function deleteNoteById(id) {
    showModal('Delete this note?', async () => {
      notes = notes.filter(n => n.id !== id);
      await dbDelete(id);
      if (currentNoteId === id) {
        currentNoteId = null;
        switchView(VIEW_LIST);
      }
      renderNoteList();
    });
  }

  function openNote(id) {
    const note = notes.find(n => n.id === id);
    if (!note) return;
    currentNoteId = id;
    noteTitleEl.value = note.title || '';
    editorEl.innerHTML = note.content || '';
    historyStack = [editorEl.innerHTML];
    historyIndex = 0;
    noteDateEl.textContent = 'Edited ' + formatFullDate(note.updatedAt);
    switchView(VIEW_EDITOR);
  }

  async function createNote() {
    const note = {
      id: generateId(),
      title: '',
      content: '',
      createdAt: now(),
      updatedAt: now()
    };
    notes.unshift(note);
    await dbPut(note);
    openNote(note.id);
    renderNoteList();
    setTimeout(() => noteTitleEl.focus(), 100);
  }

  async function deleteCurrentNote() {
    if (!currentNoteId) return;
    const id = currentNoteId;
    showModal('Delete this note?', async () => {
      notes = notes.filter(n => n.id !== id);
      await dbDelete(id);
      currentNoteId = null;
      renderNoteList();
      switchView(VIEW_LIST);
    });
  }

  function switchView(view) {
    currentView = view;
    if (view === VIEW_LIST) {
      noteListEl.classList.remove('hidden');
      noteEditorEl.classList.add('hidden');
      editorEl.blur();
      if (isFullscreen) toggleFullscreen();
      $('#btn-fullscreen').classList.add('hidden');
      $('#btn-font-increase').classList.add('hidden');
      $('#btn-font-decrease').classList.add('hidden');
    } else {
      noteListEl.classList.add('hidden');
      noteEditorEl.classList.remove('hidden');
      $('#btn-fullscreen').classList.remove('hidden');
      $('#btn-font-increase').classList.remove('hidden');
      $('#btn-font-decrease').classList.remove('hidden');
    }
  }

  function toggleFullscreen() {
    isFullscreen = !isFullscreen;
    const appEl = $('#app');
    const btn = $('#btn-fullscreen');
    if (isFullscreen) {
      appEl.classList.add('fullscreen');
      btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" y1="10" x2="21" y2="3"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';
      btn.setAttribute('aria-label', 'Exit Fullscreen');
      btn.setAttribute('title', 'Exit Fullscreen');
      editorEl.contentEditable = 'false';
      editorEl.blur();
    } else {
      appEl.classList.remove('fullscreen');
      btn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>';
      btn.setAttribute('aria-label', 'Fullscreen');
      btn.setAttribute('title', 'Fullscreen');
      editorEl.contentEditable = 'true';
    }
  }

  function showModal(text, onConfirm) {
    modalTextEl.textContent = text;
    deleteCallback = onConfirm;
    modalOverlayEl.classList.remove('hidden');
  }

  function hideModal() {
    modalOverlayEl.classList.add('hidden');
    deleteCallback = null;
  }

  function confirmModal() {
    if (typeof deleteCallback === 'function') {
      deleteCallback();
    }
    hideModal();
  }

  function execFormat(command, value) {
    editorEl.focus();
    document.execCommand(command, false, value || null);
    pushHistory();
    debouncedSave();
  }

  function formatBlock(tag) {
    editorEl.focus();
    document.execCommand('formatBlock', false, tag);
    pushHistory();
    debouncedSave();
  }

  function toggleBold() {
    execFormat('bold');
  }

  function toggleItalic() {
    execFormat('italic');
  }

  function toggleUnderline() {
    execFormat('underline');
  }

  function toggleStrikethrough() {
    execFormat('strikeThrough');
  }

  function toggleJustify() {
    editorEl.focus();
    document.execCommand('justifyFull', false, null);
    pushHistory();
    debouncedSave();
  }

  function loadFontSize() {
    try {
      const saved = localStorage.getItem('notes-app-font-size');
      if (saved) fontSize = Math.max(12, Math.min(32, parseInt(saved, 10)));
    } catch (e) {
      fontSize = 17;
    }
  }

  function applyFontSize() {
    const container = $('#note-editor');
    if (container) {
      container.style.setProperty('--editor-font-size', fontSize + 'px');
    }
    try {
      localStorage.setItem('notes-app-font-size', String(fontSize));
    } catch (e) {}
  }

  function increaseFontSize() {
    if (fontSize < 32) {
      fontSize++;
      applyFontSize();
    }
  }

  function decreaseFontSize() {
    if (fontSize > 12) {
      fontSize--;
      applyFontSize();
    }
  }

  function toggleHeading(level) {
    const tag = level === 1 ? 'H1' : level === 2 ? 'H2' : 'H3';
    formatBlock(tag);
  }

  function toggleNormal() {
    formatBlock('P');
  }

  function cleanBlankLines() {
    const walker = document.createTreeWalker(editorEl, NodeFilter.SHOW_ELEMENT, null, false);
    const emptyBlocks = [];
    let node;
    const allowedEmpty = new Set(['BR', 'IMG', 'HR']);
    while ((node = walker.nextNode())) {
      if (node === editorEl) continue;
      const tag = node.tagName.toLowerCase();
      const isBlock = /^(p|h[1-6]|li|blockquote|pre|ul|ol|div)$/.test(tag);
      if (!isBlock) continue;
      const text = (node.textContent || '').replace(/\u00a0/g, ' ').trim();
      if (text.length === 0 && !allowedEmpty.has(node.tagName)) {
        const hasOnlyEmptyBlocks = Array.from(node.children).every(
          child => child.tagName === 'BR' || (/^(p|h[1-6]|li|blockquote|pre|ul|ol|div)$/.test(child.tagName.toLowerCase()) && (child.textContent || '').replace(/\u00a0/g, ' ').trim().length === 0)
        );
        if (hasOnlyEmptyBlocks) emptyBlocks.push(node);
      }
    }
    emptyBlocks.forEach(node => {
      const parent = node.parentNode;
      if (parent) parent.removeChild(node);
    });
    if (emptyBlocks.length) {
      pushHistory();
      debouncedSave();
    }
  }

  function handleKeydown(e) {
    if (e.key === 'Tab') {
      e.preventDefault();
      document.execCommand('insertHTML', false, '&nbsp;&nbsp;&nbsp;&nbsp;');
      pushHistory();
      debouncedSave();
    }
    if (e.key === 'Escape' && isFullscreen) {
      toggleFullscreen();
    }
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const mod = isMac ? e.metaKey : e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
    }
    if (mod && e.key.toLowerCase() === 'z' && e.shiftKey) {
      e.preventDefault();
      redo();
    }
    if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
    }
    if (mod && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      toggleBold();
    }
    if (mod && e.key.toLowerCase() === 'i') {
      e.preventDefault();
      toggleItalic();
    }
    if (mod && e.key.toLowerCase() === 'u') {
      e.preventDefault();
      toggleUnderline();
    }
  }

  function handleEditorInput() {
    if (!isApplyingHistory) {
      pushHistory();
    }
    debouncedSave();
  }

  function setupEditor() {
    noteTitleEl.addEventListener('input', debouncedSave);
    editorEl.addEventListener('input', handleEditorInput);
    editorEl.addEventListener('keydown', handleKeydown);
    editorEl.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text');
      const md = looksLikeMarkdown(text);
      const payload = md ? text : escapeHtml(text);
      document.execCommand('insertText', false, payload);
      pushHistory();
      debouncedSave();
      if (md) {
        setTimeout(() => {
          const raw = editorEl.textContent || '';
          if (raw.trim() && looksLikeMarkdown(raw)) {
            editorEl.innerHTML = parseMarkdown(raw);
            pushHistory();
            debouncedSave();
          }
        }, 0);
      }
    });
  }

  function setupSearch() {
    if (!searchInputEl) return;
    searchInputEl.addEventListener('input', (e) => {
      searchQuery = e.target.value;
      renderNoteList();
    });
  }

  function setupToolbar() {
    $('#btn-back').addEventListener('click', () => {
      if (isFullscreen) {
        toggleFullscreen();
        return;
      }
      if (currentView === VIEW_EDITOR) {
        syncCurrentNote();
        saveNotes();
        renderNoteList();
        switchView(VIEW_LIST);
      }
    });

    $('#btn-edit').addEventListener('click', () => {
      editorEl.focus();
    });

    $('#btn-h1').addEventListener('click', () => toggleHeading(1));
    $('#btn-h2').addEventListener('click', () => toggleHeading(2));
    $('#btn-h3').addEventListener('click', () => toggleHeading(3));
    $('#btn-normal').addEventListener('click', toggleNormal);
    $('#btn-bold').addEventListener('click', toggleBold);

    $('#btn-justify')?.addEventListener('click', toggleJustify);

    $('#btn-clean')?.addEventListener('click', cleanBlankLines);

    $('#btn-font-increase')?.addEventListener('click', increaseFontSize);
    $('#btn-font-decrease')?.addEventListener('click', decreaseFontSize);

    $('#btn-fullscreen').addEventListener('click', toggleFullscreen);

    fullscreenBackBtn?.addEventListener('click', () => {
      if (isFullscreen) toggleFullscreen();
      syncCurrentNote();
      saveNotes();
      renderNoteList();
      switchView(VIEW_LIST);
    });

    $('#btn-more').addEventListener('click', () => {
      if (currentView === VIEW_EDITOR) {
        deleteCurrentNote();
      }
    });

    $('#btn-new').addEventListener('click', createNote);
  }

  function setupModal() {
    if (!modalOverlayEl || !modalCancelBtn || !modalConfirmBtn) return;
    modalCancelBtn.addEventListener('click', hideModal);
    modalConfirmBtn.addEventListener('click', confirmModal);
    modalOverlayEl.addEventListener('click', (e) => {
      if (e.target === modalOverlayEl) hideModal();
    });
  }

  function setupEditor() {
    noteTitleEl.addEventListener('input', debouncedSave);
    editorEl.addEventListener('input', handleEditorInput);
    editorEl.addEventListener('keydown', handleKeydown);
    editorEl.addEventListener('paste', (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData('text');
      const md = looksLikeMarkdown(text);
      const payload = md ? text : escapeHtml(text);
      document.execCommand('insertText', false, payload);
      pushHistory();
      debouncedSave();
      if (md) {
        setTimeout(() => {
          const raw = editorEl.innerText || '';
          if (raw.trim() && looksLikeMarkdown(raw)) {
            editorEl.innerHTML = parseMarkdown(raw);
            pushHistory();
            debouncedSave();
          }
        }, 0);
      }
    });
  }

  function setupServiceWorker() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./service-worker.js').catch(() => {
      });
    }
  }

  function setupInstallPrompt() {
    let deferredPrompt = null;
    window.addEventListener('beforeinstallprompt', (e) => {
      deferredPrompt = e;
      e.preventDefault();
    });
    window.addEventListener('appinstalled', () => {
      deferredPrompt = null;
    });
  }

  async function init() {
    await loadNotes();
    loadFontSize();
    applyFontSize();
    setupToolbar();
    setupModal();
    setupEditor();
    setupSearch();
    setupServiceWorker();
    setupInstallPrompt();
    renderNoteList();
    switchView(VIEW_LIST);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    await initSupabase();

    if (notes.length === 0) {
      setTimeout(() => {
        if (notes.length === 0 && currentView === VIEW_LIST) {
        }
      }, 500);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
