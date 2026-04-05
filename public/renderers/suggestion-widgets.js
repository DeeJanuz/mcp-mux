// @ts-nocheck
/* Suggestion widget system — extracted from shared.js (M-033b) */

(function () {
  'use strict';

  var utils = window.__companionUtils;

  /**
   * Render markdown with inline suggestion markers.
   * Pre-processes {{suggest:id=X}} tokens into placeholders, parses markdown,
   * then replaces placeholders with suggestion widgets.
   * Skips tokens inside fenced code blocks.
   */
  function renderMarkdownWithSuggestions(text, suggestions) {
    if (!text || !suggestions) return utils.renderMarkdown(text);

    // Step 1: Protect fenced code blocks from suggestion replacement
    var codeBlocks = [];
    var protected_ = text.replace(/```[\s\S]*?```/g, function (match) {
      codeBlocks.push(match);
      return '%%CODEBLOCK_' + (codeBlocks.length - 1) + '%%';
    });

    // Step 2: Replace {{suggest:id=X}} with HTML placeholders
    protected_ = protected_.replace(/\{\{suggest:id=([^}]+)\}\}/g, function (match, id) {
      if (!suggestions[id]) return match;
      return '<span data-suggest-placeholder="' + utils.escapeHtml(id) + '"></span>';
    });

    // Step 3: Restore code blocks
    protected_ = protected_.replace(/%%CODEBLOCK_(\d+)%%/g, function (match, idx) {
      return codeBlocks[parseInt(idx, 10)] || match;
    });

    // Step 4: Parse markdown
    var el = utils.renderMarkdown(protected_);

    // Step 5: Replace placeholders with suggestion widgets
    if (el instanceof HTMLElement) {
      var placeholders = el.querySelectorAll('[data-suggest-placeholder]');
      placeholders.forEach(function (ph) {
        var id = ph.getAttribute('data-suggest-placeholder');
        var suggestion = suggestions[id];
        if (suggestion) {
          var widget = buildSuggestionWidget(id, suggestion);
          ph.parentNode.replaceChild(widget, ph);
        }
      });
    }

    return el;
  }

  /**
   * Build a suggestion widget with old/new text, accept/reject toggles, and comment button.
   * Detects block-level (multiline) content and renders as a block diff.
   * @param {string} id - suggestion id
   * @param {object} suggestion - { old?: string, new?: string, type?: 'insert'|'delete' }
   * @returns {HTMLElement}
   */
  function buildSuggestionWidget(id, suggestion) {
    var type = suggestion.type || 'replace';
    var isBlock = (suggestion.old && suggestion.old.indexOf('\n') !== -1) ||
                  (suggestion.new && suggestion.new.indexOf('\n') !== -1);

    var tag = isBlock ? 'div' : 'span';
    var widget = document.createElement(tag);
    widget.className = 'suggest-widget' + (isBlock ? ' suggest-block' : '');
    widget.setAttribute('data-suggest-id', id);

    // Content area
    var content = document.createElement(isBlock ? 'div' : 'span');
    content.className = 'suggest-content';

    // Old text (for replace and delete)
    if (type !== 'insert' && suggestion.old) {
      var del = document.createElement(isBlock ? 'div' : 'del');
      del.className = 'suggest-old';
      if (isBlock) {
        del.textContent = suggestion.old;
      } else {
        del.textContent = suggestion.old;
      }
      content.appendChild(del);

      // Space between old and new for inline replace
      if (!isBlock && type === 'replace' && suggestion.new) {
        content.appendChild(document.createTextNode(' '));
      }
    }

    // New text (for replace and insert)
    if (type !== 'delete' && suggestion.new) {
      var ins = document.createElement(isBlock ? 'div' : 'ins');
      ins.className = 'suggest-new';
      ins.textContent = suggestion.new;
      content.appendChild(ins);
    }

    widget.appendChild(content);

    // Controls bar (accept/reject/comment)
    var controls = document.createElement('span');
    controls.className = 'suggest-controls';

    // Accept/reject toggle buttons
    var toggleContainer = document.createElement('span');
    toggleContainer.className = 'suggest-toggle';

    var acceptBtn = document.createElement('button');
    acceptBtn.className = 'suggest-toggle-btn suggest-accept-btn';
    acceptBtn.textContent = '\u2713';
    acceptBtn.title = 'Accept suggestion';
    acceptBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      widget.classList.remove('suggest-rejected');
      widget.classList.add('suggest-accepted');
      widget.setAttribute('data-suggest-status', 'accept');
    });

    var rejectBtn = document.createElement('button');
    rejectBtn.className = 'suggest-toggle-btn suggest-reject-btn';
    rejectBtn.textContent = '\u2717';
    rejectBtn.title = 'Reject suggestion';
    rejectBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      widget.classList.remove('suggest-accepted');
      widget.classList.add('suggest-rejected');
      widget.setAttribute('data-suggest-status', 'reject');
    });

    toggleContainer.appendChild(acceptBtn);
    toggleContainer.appendChild(rejectBtn);
    controls.appendChild(toggleContainer);

    // Comment button
    var commentBtn = document.createElement('button');
    commentBtn.className = 'suggest-toggle-btn suggest-comment-btn';
    commentBtn.textContent = '\uD83D\uDCAC';
    commentBtn.title = 'Add comment';
    commentBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var existing = widget.querySelector('.suggest-comment-popover');
      if (existing) {
        existing.style.display = existing.style.display === 'none' ? '' : 'none';
        if (existing.style.display !== 'none') {
          existing.querySelector('textarea').focus();
        }
        return;
      }

      var popover = document.createElement('div');
      popover.className = 'suggest-comment-popover';

      var textarea = document.createElement('textarea');
      textarea.className = 'suggest-comment-input';
      textarea.placeholder = 'Add a comment...';
      textarea.rows = 2;
      var currentComment = widget.getAttribute('data-suggest-comment') || '';
      textarea.value = currentComment;
      popover.appendChild(textarea);

      var btnRow = document.createElement('div');
      btnRow.className = 'suggest-comment-actions';

      var saveBtn = document.createElement('button');
      saveBtn.className = 'suggest-comment-save';
      saveBtn.textContent = 'Save';
      saveBtn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var val = textarea.value.trim();
        if (val) {
          widget.setAttribute('data-suggest-comment', val);
          commentBtn.classList.add('has-comment');
          commentBtn.title = 'Comment: ' + val;
        } else {
          widget.removeAttribute('data-suggest-comment');
          commentBtn.classList.remove('has-comment');
          commentBtn.title = 'Add comment';
        }
        popover.style.display = 'none';
      });

      var cancelBtn = document.createElement('button');
      cancelBtn.className = 'suggest-comment-cancel';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        popover.style.display = 'none';
      });

      btnRow.appendChild(saveBtn);
      btnRow.appendChild(cancelBtn);
      popover.appendChild(btnRow);

      widget.appendChild(popover);
      textarea.focus();
    });

    controls.appendChild(commentBtn);
    widget.appendChild(controls);

    return widget;
  }

  // Register on shared utils
  utils.renderMarkdownWithSuggestions = renderMarkdownWithSuggestions;
  utils.buildSuggestionWidget = buildSuggestionWidget;
})();
