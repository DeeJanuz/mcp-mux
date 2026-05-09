import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { beforeEach, describe, expect, it } from 'vitest';

var __dirnameResolved = dirname(fileURLToPath(import.meta.url));
var skillsCode = readFileSync(join(__dirnameResolved, '../public/renderers/tribex-ai-skills.js'), 'utf8');

beforeEach(function () {
  delete window.__tribexAiSkills;
  new Function(skillsCode).call(globalThis);
});

describe('tribex-ai persona skills', function () {
  it('normalizes skills and filters slash commands', function () {
    var normalized = window.__tribexAiSkills.normalizeSkill({
      name: 'Email Analysis',
      description: 'Analyze inboxes',
      prompt_template: 'Analyze {{inboxes}}',
      inputs: [
        { key: 'inboxes', label: 'Inboxes', dataType: 'email_account_multi_select' },
      ],
    }, 0);

    expect(normalized).toMatchObject({
      key: 'email-analysis',
      name: 'Email Analysis',
      promptTemplate: 'Analyze {{inboxes}}',
      variables: [
        expect.objectContaining({
          name: 'inboxes',
          type: 'email_account_multi_select',
        }),
      ],
    });
    expect(window.__tribexAiSkills.detectSlashSkillQuery('please /email')).toEqual({
      start: 7,
      end: 13,
      query: 'email',
    });
    expect(window.__tribexAiSkills.filterSkills([normalized], 'mail')).toHaveLength(1);
    expect(window.__tribexAiSkills.filterSkills([normalized], 'calendar')).toHaveLength(0);
  });

  it('builds email-analysis defaults from connected inboxes and the last 24 hours', function () {
    var skill = window.__tribexAiSkills.builtinSkills()[0];
    var values = window.__tribexAiSkills.buildDefaultValues(skill, [
      { id: 'acct-primary', provider: 'GMAIL', emailAddress: 'primary@example.com' },
      { id: 'acct-work', provider: 'GMAIL', emailAddress: 'work@example.com' },
    ], new Date('2026-04-27T12:00:00.000Z'));

    expect(values).toEqual({
      inboxes: ['acct-primary', 'acct-work'],
      date_start: '2026-04-26T12:00:00.000Z',
      date_end: '2026-04-27T12:00:00.000Z',
    });
  });

  it('expands the hidden runtime prompt while keeping the display prompt clean', function () {
    var skill = window.__tribexAiSkills.builtinSkills()[0];
    var accounts = [
      { id: 'acct-primary', provider: 'GMAIL', emailAddress: 'primary@example.com' },
      { id: 'acct-work', provider: 'GMAIL', emailAddress: 'work@example.com' },
    ];
    var values = {
      inboxes: ['acct-primary', 'acct-work'],
      date_start: '2026-04-26T12:00:00.000Z',
      date_end: '2026-04-27T12:00:00.000Z',
    };

    var displayPrompt = window.__tribexAiSkills.buildDisplayPrompt('Find archive candidates.', skill, values, accounts);
    var runtimePrompt = window.__tribexAiSkills.buildRuntimePrompt('Find archive candidates.', skill, values, accounts);
    var invocation = window.__tribexAiSkills.buildSkillInvocation(skill, values, accounts);

    expect(displayPrompt).toContain('/email-analysis');
    expect(displayPrompt).not.toContain('Inboxes: All inboxes');
    expect(displayPrompt).not.toContain('Use the Email Coordinator persona');
    expect(displayPrompt).not.toContain('acct-primary');
    expect(runtimePrompt).toContain('Use the Email Coordinator persona');
    expect(runtimePrompt).toContain('primary@example.com (provider: GMAIL, account id: acct-primary)');
    expect(runtimePrompt).toContain('work@example.com (provider: GMAIL, account id: acct-work)');
    expect(runtimePrompt).toContain('Skill variable values (defensive JSON context');
    expect(runtimePrompt).toContain('"inboxes"');
    expect(runtimePrompt).toContain('"promptValue"');
    expect(invocation.selectedAccounts).toEqual([
      expect.objectContaining({ id: 'acct-primary', emailAddress: 'primary@example.com' }),
      expect.objectContaining({ id: 'acct-work', emailAddress: 'work@example.com' }),
    ]);
  });

  it('keeps unknown merge tokens visible and passes known variables as defensive JSON', function () {
    var skill = window.__tribexAiSkills.normalizeSkill({
      key: 'weekly-review',
      name: 'Weekly Review',
      promptTemplate: 'Summarize for {{audience}} and keep {{missing_value}} visible.',
      variables: [
        { name: 'audience', label: 'Audience', type: 'text', default: 'leadership' },
      ],
    }, 0);
    var runtimePrompt = window.__tribexAiSkills.buildRuntimePrompt('', skill, {
      audience: 'support leads',
    }, []);

    expect(runtimePrompt).toContain('Summarize for support leads');
    expect(runtimePrompt).toContain('{{missing_value}}');
    expect(runtimePrompt).toContain('"audience"');
    expect(runtimePrompt).toContain('"value": "support leads"');
  });

  it('expands single-brace merge variables in custom skill prompts', function () {
    var skill = window.__tribexAiSkills.normalizeSkill({
      key: 'date-check',
      name: 'Date Check',
      promptTemplate: 'Use {datevar1} and {{datevar2}}. Keep {missing_value} visible.',
      variables: [
        { name: 'datevar1', label: 'Date 1', type: 'text' },
        { name: 'datevar2', label: 'Date 2', type: 'text' },
      ],
    }, 0);
    var runtimePrompt = window.__tribexAiSkills.buildRuntimePrompt('', skill, {
      datevar1: '11/02/2021',
      datevar2: '12/03/2021',
    }, []);

    expect(runtimePrompt).toContain('Use 11/02/2021 and 12/03/2021.');
    expect(runtimePrompt).toContain('{missing_value}');
    expect(runtimePrompt).not.toContain('{datevar1}');
  });
});
