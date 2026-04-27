import './tribex-ai-utils-setup.js';
import { describe, expect, it } from 'vitest';

describe('tribex-ai-utils', function () {
  var utils = window.__tribexAiUtils;

  it('detects AI content types', function () {
    expect(utils.isAiContentType('tribex_ai_thread')).toBe(true);
    expect(utils.isAiContentType('rich_content')).toBe(false);
  });

  it('sorts the active project ahead of newer inactive items', function () {
    var sorted = utils.sortProjects(
      [
        { id: 'older', lastActivityAt: '2026-04-13T10:00:00Z' },
        { id: 'newer', lastActivityAt: '2026-04-14T10:00:00Z' },
        { id: 'current', lastActivityAt: '2026-04-13T09:00:00Z' },
      ],
      'current',
    );

    expect(sorted.map(function (project) { return project.id; })).toEqual([
      'current',
      'newer',
      'older',
    ]);
  });

  it('matches search terms across project, workspace, thread title, and preview', function () {
    var project = { name: 'Alpha Project', workspaceName: 'Ops Workspace' };
    var thread = { title: 'Incident follow-up', preview: 'Need Cloudflare logs', workspaceName: 'Ops Workspace' };

    expect(utils.matchesSearch(project, thread, 'incident')).toBe(true);
    expect(utils.matchesSearch(project, thread, 'cloudflare')).toBe(true);
    expect(utils.matchesSearch(project, thread, 'ops workspace')).toBe(true);
    expect(utils.matchesSearch(project, thread, 'missing')).toBe(false);
  });

  it('formats internal runtime labels into user-facing text', function () {
    var rawTitle = 'Email Inbox Summarizer: Analyze accountId=cmobypfhy0000l904abcd1234, provider=GMAIL, emailAddress=user@example.com';
    var rawPrompt = 'The user submitted a review decision for session archive_review_cmobypfhy0000l904abcd1234. Call await_review with session_id=archive_review_cmobypfhy0000l904abcd1234.';
    var delegatePrompt = 'Analyze accountId=cmobypfhy0000l904abcd1234, provider=GMAIL, emailAddress=user@example.com, receivedAfter=2026-04-26T02:19:30Z, receivedBefore=2026-04-27T02:19:30Z, inInboxOnly=true. Call user_email_search with that accountId and date range, call email item, and do not mutate email.';

    expect(utils.formatThreadTitleForDisplay(rawTitle)).toBe('Email Inbox Summarizer');
    expect(utils.sanitizeDisplayText(rawPrompt)).not.toContain('archive_review_');
    expect(utils.sanitizeDisplayText(rawPrompt)).not.toContain('session_id');
    expect(utils.isSyntheticReviewResumeContent(rawPrompt)).toBe(true);
    expect(utils.sanitizeDisplayText(delegatePrompt)).toBe('Checking the connected mailbox for the requested time window. No email changes are made in this step.');
    expect(utils.formatActivityTitleForDisplay({ title: 'Get Tool Instructions' })).toBe('Preparing available actions');
    expect(utils.formatActivityTitleForDisplay({ title: 'User Email Accounts List' })).toBe('Checking connected mailboxes');
    expect(utils.formatActivityTitleForDisplay({ title: 'User Email Search' })).toBe('Searching mailbox');
  });

  it('builds project groups with sorted threads and search filtering', function () {
    var groups = utils.buildProjectGroups(
      [
        { id: 'project-b', name: 'Project B', lastActivityAt: '2026-04-13T09:00:00Z' },
        { id: 'project-a', name: 'Project A', workspaceName: 'Workspace A', lastActivityAt: '2026-04-14T09:00:00Z' },
      ],
      [
        { id: 'thread-1', projectId: 'project-a', title: 'Deploy prep', preview: 'Cloudflare rollout', lastActivityAt: '2026-04-14T08:00:00Z' },
        { id: 'thread-2', projectId: 'project-a', title: 'Bug bash', preview: 'Regression sweep', lastActivityAt: '2026-04-14T10:00:00Z' },
        { id: 'thread-3', projectId: 'project-b', title: 'Retrospective', preview: 'Weekly recap', lastActivityAt: '2026-04-13T08:00:00Z' },
      ],
      'project-a',
      'cloudflare',
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].project.id).toBe('project-a');
    expect(groups[0].threads.map(function (thread) { return thread.id; })).toEqual(['thread-1']);
  });

  it('nests child threads under their parent in project groups', function () {
    var groups = utils.buildProjectGroups(
      [{ id: 'project-a', name: 'Project A', lastActivityAt: '2026-04-14T09:00:00Z' }],
      [
        { id: 'child-1', parentThreadId: 'thread-1', projectId: 'project-a', title: 'Finance delegate', lastActivityAt: '2026-04-14T10:00:00Z' },
        { id: 'thread-1', projectId: 'project-a', title: 'Coordinator', lastActivityAt: '2026-04-14T08:00:00Z' },
        { id: 'thread-2', projectId: 'project-a', title: 'Standalone', lastActivityAt: '2026-04-14T09:00:00Z' },
      ],
      'project-a',
      '',
    );

    expect(groups[0].threadTree.map(function (thread) { return thread.id; })).toEqual(['thread-1', 'thread-2']);
    expect(groups[0].threadTree[0].childThreads.map(function (thread) { return thread.id; })).toEqual(['child-1']);
    expect(groups[0].threads.map(function (thread) { return thread.id; })).toEqual(['thread-1', 'child-1', 'thread-2']);
  });

  it('keeps matching child threads visible with their parent while filtering', function () {
    var groups = utils.buildProjectGroups(
      [{ id: 'project-a', name: 'Project A' }],
      [
        { id: 'thread-1', projectId: 'project-a', title: 'Coordinator', lastActivityAt: '2026-04-14T08:00:00Z' },
        { id: 'child-1', parentThreadId: 'thread-1', projectId: 'project-a', title: 'Finance delegate', lastActivityAt: '2026-04-14T10:00:00Z' },
      ],
      'project-a',
      'finance',
    );

    expect(groups).toHaveLength(1);
    expect(groups[0].threadTree).toHaveLength(1);
    expect(groups[0].threadTree[0].id).toBe('thread-1');
    expect(groups[0].threadTree[0].childThreads[0].id).toBe('child-1');
  });
});
