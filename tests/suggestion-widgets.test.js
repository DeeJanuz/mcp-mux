import './suggestion-widgets-setup.js';
import { describe, it, expect } from 'vitest';

var utils = window.__companionUtils;

describe('renderMarkdownWithSuggestions', function () {
  it('falls back to renderMarkdown when no suggestions provided', function () {
    var result = utils.renderMarkdownWithSuggestions('hello world', null);
    expect(result).toBeInstanceOf(HTMLElement);
    expect(result.textContent).toBe('hello world');
  });

  it('falls back to renderMarkdown when text is empty', function () {
    var result = utils.renderMarkdownWithSuggestions('', { s1: { old: 'a', new: 'b' } });
    expect(result).toBe('');
  });

  it('replaces suggestion tokens with widget elements', function () {
    var text = 'Before {{suggest:id=s1}} after';
    var suggestions = { s1: { old: 'old text', new: 'new text' } };
    var result = utils.renderMarkdownWithSuggestions(text, suggestions);

    expect(result).toBeInstanceOf(HTMLElement);
    var widget = result.querySelector('.suggest-widget');
    expect(widget).not.toBeNull();
    expect(widget.getAttribute('data-suggest-id')).toBe('s1');
  });

  it('skips suggestion tokens inside fenced code blocks', function () {
    var text = '```\n{{suggest:id=s1}}\n```';
    var suggestions = { s1: { old: 'a', new: 'b' } };
    var result = utils.renderMarkdownWithSuggestions(text, suggestions);

    // The token should remain as-is inside the code block, no widget created
    var widget = result.querySelector('.suggest-widget');
    expect(widget).toBeNull();
    expect(result.textContent).toContain('{{suggest:id=s1}}');
  });

  it('handles replace type suggestions', function () {
    var text = '{{suggest:id=r1}}';
    var suggestions = { r1: { old: 'old', new: 'new' } };
    var result = utils.renderMarkdownWithSuggestions(text, suggestions);

    var widget = result.querySelector('.suggest-widget');
    expect(widget.querySelector('.suggest-old')).not.toBeNull();
    expect(widget.querySelector('.suggest-new')).not.toBeNull();
  });

  it('handles insert type suggestions', function () {
    var text = '{{suggest:id=i1}}';
    var suggestions = { i1: { type: 'insert', new: 'inserted' } };
    var result = utils.renderMarkdownWithSuggestions(text, suggestions);

    var widget = result.querySelector('.suggest-widget');
    expect(widget.querySelector('.suggest-old')).toBeNull();
    expect(widget.querySelector('.suggest-new')).not.toBeNull();
    expect(widget.querySelector('.suggest-new').textContent).toBe('inserted');
  });

  it('handles delete type suggestions', function () {
    var text = '{{suggest:id=d1}}';
    var suggestions = { d1: { type: 'delete', old: 'deleted' } };
    var result = utils.renderMarkdownWithSuggestions(text, suggestions);

    var widget = result.querySelector('.suggest-widget');
    expect(widget.querySelector('.suggest-old')).not.toBeNull();
    expect(widget.querySelector('.suggest-old').textContent).toBe('deleted');
    expect(widget.querySelector('.suggest-new')).toBeNull();
  });

  it('preserves unmatched suggestion tokens', function () {
    var text = 'Before {{suggest:id=missing}} after';
    var suggestions = { other: { old: 'a', new: 'b' } };
    var result = utils.renderMarkdownWithSuggestions(text, suggestions);

    // Token for 'missing' stays as literal text since it has no matching suggestion
    var widget = result.querySelector('.suggest-widget');
    expect(widget).toBeNull();
    expect(result.textContent).toContain('{{suggest:id=missing}}');
  });
});

describe('buildSuggestionWidget', function () {
  it('creates a replace widget with old and new elements', function () {
    var widget = utils.buildSuggestionWidget('s1', { old: 'old text', new: 'new text' });
    expect(widget.getAttribute('data-suggest-id')).toBe('s1');
    expect(widget.querySelector('.suggest-old')).not.toBeNull();
    expect(widget.querySelector('.suggest-new')).not.toBeNull();
    expect(widget.querySelector('.suggest-old').textContent).toBe('old text');
    expect(widget.querySelector('.suggest-new').textContent).toBe('new text');
  });

  it('creates an insert widget with only new element', function () {
    var widget = utils.buildSuggestionWidget('i1', { type: 'insert', new: 'new text' });
    expect(widget.querySelector('.suggest-old')).toBeNull();
    expect(widget.querySelector('.suggest-new')).not.toBeNull();
    expect(widget.querySelector('.suggest-new').textContent).toBe('new text');
  });

  it('creates a delete widget with only old element', function () {
    var widget = utils.buildSuggestionWidget('d1', { type: 'delete', old: 'removed' });
    expect(widget.querySelector('.suggest-old')).not.toBeNull();
    expect(widget.querySelector('.suggest-old').textContent).toBe('removed');
    expect(widget.querySelector('.suggest-new')).toBeNull();
  });

  it('uses block mode for multiline old content', function () {
    var widget = utils.buildSuggestionWidget('b1', { old: 'line1\nline2', new: 'replacement' });
    expect(widget.className).toContain('suggest-block');
    expect(widget.tagName.toLowerCase()).toBe('div');
  });

  it('uses block mode for multiline new content', function () {
    var widget = utils.buildSuggestionWidget('b2', { type: 'insert', new: 'line1\nline2' });
    expect(widget.className).toContain('suggest-block');
  });

  it('uses inline mode for single-line content', function () {
    var widget = utils.buildSuggestionWidget('i1', { old: 'old', new: 'new' });
    expect(widget.className).not.toContain('suggest-block');
    expect(widget.tagName.toLowerCase()).toBe('span');
  });

  it('accept button adds accepted class and sets status', function () {
    var widget = utils.buildSuggestionWidget('a1', { old: 'x', new: 'y' });
    var acceptBtn = widget.querySelector('.suggest-accept-btn');
    expect(acceptBtn).not.toBeNull();

    acceptBtn.click();
    expect(widget.classList.contains('suggest-accepted')).toBe(true);
    expect(widget.getAttribute('data-suggest-status')).toBe('accept');
  });

  it('reject button adds rejected class and sets status', function () {
    var widget = utils.buildSuggestionWidget('r1', { old: 'x', new: 'y' });
    var rejectBtn = widget.querySelector('.suggest-reject-btn');
    expect(rejectBtn).not.toBeNull();

    rejectBtn.click();
    expect(widget.classList.contains('suggest-rejected')).toBe(true);
    expect(widget.getAttribute('data-suggest-status')).toBe('reject');
  });

  it('accept removes rejected class if previously rejected', function () {
    var widget = utils.buildSuggestionWidget('t1', { old: 'x', new: 'y' });
    var rejectBtn = widget.querySelector('.suggest-reject-btn');
    var acceptBtn = widget.querySelector('.suggest-accept-btn');

    rejectBtn.click();
    expect(widget.classList.contains('suggest-rejected')).toBe(true);

    acceptBtn.click();
    expect(widget.classList.contains('suggest-rejected')).toBe(false);
    expect(widget.classList.contains('suggest-accepted')).toBe(true);
    expect(widget.getAttribute('data-suggest-status')).toBe('accept');
  });

  it('reject removes accepted class if previously accepted', function () {
    var widget = utils.buildSuggestionWidget('t2', { old: 'x', new: 'y' });
    var acceptBtn = widget.querySelector('.suggest-accept-btn');
    var rejectBtn = widget.querySelector('.suggest-reject-btn');

    acceptBtn.click();
    expect(widget.classList.contains('suggest-accepted')).toBe(true);

    rejectBtn.click();
    expect(widget.classList.contains('suggest-accepted')).toBe(false);
    expect(widget.classList.contains('suggest-rejected')).toBe(true);
  });

  it('comment button creates popover with textarea', function () {
    var widget = utils.buildSuggestionWidget('c1', { old: 'x', new: 'y' });
    var commentBtn = widget.querySelector('.suggest-comment-btn');
    expect(commentBtn).not.toBeNull();

    commentBtn.click();
    var popover = widget.querySelector('.suggest-comment-popover');
    expect(popover).not.toBeNull();
    var textarea = popover.querySelector('.suggest-comment-input');
    expect(textarea).not.toBeNull();
  });

  it('comment save stores data-suggest-comment attribute', function () {
    var widget = utils.buildSuggestionWidget('c2', { old: 'x', new: 'y' });
    var commentBtn = widget.querySelector('.suggest-comment-btn');

    commentBtn.click();
    var popover = widget.querySelector('.suggest-comment-popover');
    var textarea = popover.querySelector('.suggest-comment-input');
    textarea.value = 'My feedback';
    var saveBtn = popover.querySelector('.suggest-comment-save');
    saveBtn.click();

    expect(widget.getAttribute('data-suggest-comment')).toBe('My feedback');
    expect(commentBtn.classList.contains('has-comment')).toBe(true);
  });

  it('comment save with empty text removes data-suggest-comment', function () {
    var widget = utils.buildSuggestionWidget('c3', { old: 'x', new: 'y' });
    widget.setAttribute('data-suggest-comment', 'old comment');
    var commentBtn = widget.querySelector('.suggest-comment-btn');

    commentBtn.click();
    var popover = widget.querySelector('.suggest-comment-popover');
    var textarea = popover.querySelector('.suggest-comment-input');
    textarea.value = '   ';
    var saveBtn = popover.querySelector('.suggest-comment-save');
    saveBtn.click();

    expect(widget.getAttribute('data-suggest-comment')).toBeNull();
    expect(commentBtn.classList.contains('has-comment')).toBe(false);
  });

  it('has accept and reject toggle buttons', function () {
    var widget = utils.buildSuggestionWidget('tb1', { old: 'a', new: 'b' });
    var toggle = widget.querySelector('.suggest-toggle');
    expect(toggle).not.toBeNull();
    expect(toggle.querySelector('.suggest-accept-btn')).not.toBeNull();
    expect(toggle.querySelector('.suggest-reject-btn')).not.toBeNull();
  });
});
