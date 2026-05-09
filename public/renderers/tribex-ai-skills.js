// @ts-check
/* Persona skill normalization, variable defaults, and prompt expansion */

(function () {
  'use strict';

  var EMAIL_ANALYSIS_TEMPLATE = [
    'Use the Email Coordinator persona to inspect email for the selected inboxes.',
    '',
    'Inbox selection:',
    '{{inboxes}}',
    '',
    'Date window:',
    '- Start: {{date_start}}',
    '- End: {{date_end}}',
    '',
    'List the relevant emails you find and propose candidates that look safe to archive.',
    'Do not archive anything yet. Present the archive candidates clearly and wait for approval before taking any mailbox action.',
  ].join('\n');

  var BUILTIN_EMAIL_ANALYSIS_SKILL = Object.freeze({
    key: 'email-analysis',
    name: 'Email Analysis',
    description: 'Analyze connected inboxes over a date range and propose archive candidates.',
    promptTemplate: EMAIL_ANALYSIS_TEMPLATE,
    variables: [
      {
        name: 'inboxes',
        label: 'Inboxes',
        type: 'email_account_multi_select',
        default: 'all_connected',
      },
      {
        name: 'date_start',
        label: 'Start',
        type: 'datetime',
        default: 'last_24_hours_start',
      },
      {
        name: 'date_end',
        label: 'End',
        type: 'datetime',
        default: 'now',
      },
    ],
  });

  function asArray(value) {
    return Array.isArray(value) ? value.filter(Boolean) : [];
  }

  function pickFirst(values, fallback) {
    for (var i = 0; i < values.length; i += 1) {
      var value = values[i];
      if (value !== null && value !== undefined && value !== '') return value;
    }
    return fallback;
  }

  function kebab(value) {
    return String(value || '')
      .trim()
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase();
  }

  function normalizeVariable(raw, index) {
    raw = raw || {};
    var name = pickFirst([raw.name, raw.key, raw.variableName], 'variable_' + index);
    var type = pickFirst([raw.type, raw.kind, raw.dataType, raw.variableType], 'text');
    return {
      name: String(name),
      label: pickFirst([raw.label, raw.displayName, raw.title], String(name).replace(/[_-]+/g, ' ')),
      type: String(type),
      default: pickFirst([raw.default, raw.defaultValue, raw.value], null),
      required: raw.required !== false,
    };
  }

  function normalizeSkill(raw, index) {
    raw = raw || {};
    var key = kebab(pickFirst([raw.key, raw.slug, raw.name, raw.id], 'skill-' + index));
    if (!key) return null;
    var variables = asArray(raw.variables || raw.params || raw.inputs).map(normalizeVariable);
    return {
      id: pickFirst([raw.id, raw.skillId, raw.skill_id], key),
      key: key,
      name: pickFirst([raw.name, raw.displayName, raw.title], key.replace(/-/g, ' ')),
      description: pickFirst([raw.description, raw.summary], ''),
      promptTemplate: pickFirst([raw.promptTemplate, raw.prompt_template, raw.template, raw.prompt], ''),
      variables: variables,
      source: pickFirst([raw.source], 'control-plane'),
    };
  }

  function builtinSkills() {
    return [normalizeSkill(BUILTIN_EMAIL_ANALYSIS_SKILL, 0)];
  }

  function mergeSkillLists(primary, fallback) {
    var byKey = {};
    asArray(primary).concat(asArray(fallback)).forEach(function (skill, index) {
      var normalized = skill && skill.key ? skill : normalizeSkill(skill, index);
      if (!normalized || byKey[normalized.key]) return;
      byKey[normalized.key] = normalized;
    });
    return Object.keys(byKey).map(function (key) { return byKey[key]; });
  }

  function normalizeEmailAccount(raw, index) {
    raw = raw || {};
    var id = pickFirst([
      raw.id,
      raw.accountId,
      raw.account_id,
      raw.connectionId,
      raw.connection_id,
      raw.email,
      raw.emailAddress,
      raw.email_address,
    ], 'email-account-' + index);
    var emailAddress = pickFirst([raw.emailAddress, raw.email_address, raw.email, raw.address], '');
    var provider = pickFirst([raw.provider, raw.providerName, raw.provider_name, raw.type], 'email');
    var label = pickFirst([raw.displayName, raw.display_name, raw.name, emailAddress], 'Mailbox ' + (index + 1));
    return {
      id: String(id),
      provider: String(provider || 'email'),
      emailAddress: String(emailAddress || ''),
      label: String(label || emailAddress || id),
      status: pickFirst([raw.status, raw.state], null),
    };
  }

  function normalizeEmailAccounts(value) {
    var items = Array.isArray(value)
      ? value
      : asArray(value && (value.accounts || value.emailAccounts || value.email_accounts || value.items || value.results || value.data));
    return items.map(normalizeEmailAccount);
  }

  function addHours(date, hours) {
    return new Date(date.getTime() + hours * 60 * 60 * 1000);
  }

  function defaultValueForVariable(variable, emailAccounts, now) {
    var date = now instanceof Date ? now : new Date();
    if (variable.type === 'email_account_multi_select') {
      return normalizeEmailAccounts(emailAccounts).map(function (account) { return account.id; });
    }
    if (variable.type === 'datetime') {
      if (variable.default === 'last_24_hours_start') return addHours(date, -24).toISOString();
      return date.toISOString();
    }
    return variable.default || '';
  }

  function buildDefaultValues(skill, emailAccounts, now) {
    var values = {};
    asArray(skill && skill.variables).forEach(function (variable) {
      values[variable.name] = defaultValueForVariable(variable, emailAccounts, now);
    });
    return values;
  }

  function accountsById(emailAccounts) {
    var byId = {};
    normalizeEmailAccounts(emailAccounts).forEach(function (account) {
      byId[account.id] = account;
    });
    return byId;
  }

  function selectedEmailAccounts(value, emailAccounts) {
    var byId = accountsById(emailAccounts);
    return asArray(value).map(function (id) { return byId[id]; }).filter(Boolean);
  }

  function formatAccountLabel(account) {
    if (!account) return '';
    if (account.emailAddress) return account.emailAddress;
    return account.label || account.id;
  }

  function formatDateLabel(value) {
    if (!value) return 'Unset';
    var parsed = Date.parse(value);
    if (Number.isNaN(parsed)) return String(value);
    return new Date(parsed).toISOString().replace('.000Z', 'Z');
  }

  function formatVariableChip(variable, value, emailAccounts) {
    if (!variable) return '';
    if (variable.type === 'email_account_multi_select') {
      var accounts = selectedEmailAccounts(value, emailAccounts);
      if (!accounts.length) return 'No inboxes';
      if (accounts.length === normalizeEmailAccounts(emailAccounts).length) return 'All inboxes';
      if (accounts.length === 1) return formatAccountLabel(accounts[0]);
      return accounts.length + ' inboxes';
    }
    if (variable.type === 'datetime') return formatDateLabel(value);
    return String(value || '');
  }

  function formatVariableForPrompt(variable, value, emailAccounts) {
    if (!variable) return '';
    if (variable.type === 'email_account_multi_select') {
      var accounts = selectedEmailAccounts(value, emailAccounts);
      if (!accounts.length) return '- No inboxes selected';
      return accounts.map(function (account) {
        return [
          '- ',
          account.emailAddress || account.label || account.id,
          ' (provider: ',
          account.provider || 'email',
          ', account id: ',
          account.id,
          ')',
        ].join('');
      }).join('\n');
    }
    if (variable.type === 'datetime') return formatDateLabel(value);
    return String(value || '');
  }

  function safeJson(value) {
    try {
      return JSON.stringify(value, null, 2);
    } catch (_error) {
      return '{}';
    }
  }

  function buildVariableContext(skill, values, emailAccounts) {
    var accounts = normalizeEmailAccounts(emailAccounts);
    var context = {
      skill: {
        key: skill && skill.key ? skill.key : '',
        name: skill && skill.name ? skill.name : '',
      },
      variables: {},
    };
    asArray(skill && skill.variables).forEach(function (variable) {
      var value = values ? values[variable.name] : null;
      context.variables[variable.name] = {
        label: variable.label,
        type: variable.type,
        required: variable.required !== false,
        value: value === undefined ? null : value,
        displayValue: formatVariableChip(variable, value, accounts),
        promptValue: formatVariableForPrompt(variable, value, accounts),
      };
    });
    return context;
  }

  function buildVariableJsonBlock(skill, values, emailAccounts) {
    if (!skill || !asArray(skill.variables).length) return '';
    return [
      'Skill variable values (defensive JSON context; use if any merge token was not fully resolved):',
      '```json',
      safeJson(buildVariableContext(skill, values || {}, emailAccounts)),
      '```',
    ].join('\n');
  }

  function substituteTemplate(template, skill, values, emailAccounts) {
    var byName = {};
    asArray(skill && skill.variables).forEach(function (variable) {
      byName[variable.name] = variable;
    });
    var source = String(template || '');
    var output = '';
    var index = 0;
    var mergeNamePattern = /^[A-Za-z0-9_-]+$/;
    var parseMergeToken = function (openToken, closeToken) {
      var closeIndex = source.indexOf(closeToken, index + openToken.length);
      if (closeIndex < 0) return null;
      var name = source.slice(index + openToken.length, closeIndex).trim();
      if (!mergeNamePattern.test(name)) return null;
      return {
        end: closeIndex + closeToken.length,
        name: name,
        raw: source.slice(index, closeIndex + closeToken.length),
      };
    };
    var resolveMergeToken = function (token) {
      if (!byName[token.name]) return token.raw;
      return formatVariableForPrompt(byName[token.name], values ? values[token.name] : null, emailAccounts);
    };

    while (index < source.length) {
      var token = null;
      if (source.slice(index, index + 2) === '{{') {
        token = parseMergeToken('{{', '}}');
      } else if (source.slice(index, index + 2) === '${') {
        token = parseMergeToken('${', '}');
      } else if (source.charAt(index) === '{') {
        token = parseMergeToken('{', '}');
      }
      if (token) {
        output += resolveMergeToken(token);
        index = token.end;
      } else {
        output += source.charAt(index);
        index += 1;
      }
    }
    return output;
  }

  function buildDisplayPrompt(userText, skill, values, emailAccounts) {
    var text = String(userText || '').trim();
    if (!skill) return text;
    var skillSummary = '/' + skill.key;
    return text ? (text + '\n' + skillSummary) : skillSummary;
  }

  function buildSkillInvocation(skill, values, emailAccounts) {
    if (!skill) return null;
    var accounts = normalizeEmailAccounts(emailAccounts);
    return {
      key: skill.key,
      name: skill.name,
      variables: asArray(skill.variables).map(function (variable) {
        return {
          name: variable.name,
          label: variable.label,
          type: variable.type,
          value: values ? values[variable.name] : null,
          displayValue: formatVariableChip(variable, values ? values[variable.name] : null, accounts),
        };
      }),
      selectedAccounts: selectedEmailAccounts(values && values.inboxes, accounts).map(function (account) {
        return {
          id: account.id,
          provider: account.provider,
          emailAddress: account.emailAddress,
          label: account.label,
        };
      }),
    };
  }

  function buildRuntimePrompt(userText, skill, values, emailAccounts) {
    var text = String(userText || '').trim();
    if (!skill) return text;
    var expanded = substituteTemplate(skill.promptTemplate, skill, values || {}, emailAccounts);
    var variableJson = buildVariableJsonBlock(skill, values || {}, emailAccounts);
    var skillPrompt = variableJson ? (expanded + '\n\n' + variableJson) : expanded;
    return text ? (text + '\n\n' + skillPrompt) : skillPrompt;
  }

  function filterSkills(skills, query) {
    var normalizedQuery = String(query || '').replace(/^\//, '').toLowerCase();
    return asArray(skills).filter(function (skill) {
      if (!normalizedQuery) return true;
      return (
        String(skill.key || '').toLowerCase().indexOf(normalizedQuery) >= 0 ||
        String(skill.name || '').toLowerCase().indexOf(normalizedQuery) >= 0 ||
        String(skill.description || '').toLowerCase().indexOf(normalizedQuery) >= 0
      );
    });
  }

  function detectSlashSkillQuery(text) {
    var value = String(text || '');
    var match = value.match(/(^|\s)\/([A-Za-z0-9_-]*)$/);
    if (!match) return null;
    var start = value.length - match[0].length + match[1].length;
    return {
      start: start,
      end: value.length,
      query: match[2] || '',
    };
  }

  window.__tribexAiSkills = {
    builtinSkills: builtinSkills,
    buildDefaultValues: buildDefaultValues,
    buildDisplayPrompt: buildDisplayPrompt,
    buildRuntimePrompt: buildRuntimePrompt,
    buildSkillInvocation: buildSkillInvocation,
    buildVariableJsonBlock: buildVariableJsonBlock,
    detectSlashSkillQuery: detectSlashSkillQuery,
    filterSkills: filterSkills,
    formatVariableChip: formatVariableChip,
    mergeSkillLists: mergeSkillLists,
    normalizeEmailAccount: normalizeEmailAccount,
    normalizeEmailAccounts: normalizeEmailAccounts,
    normalizeSkill: normalizeSkill,
    substituteTemplate: substituteTemplate,
  };
})();
