import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

var __dirnameResolved = dirname(fileURLToPath(import.meta.url));
var registry = JSON.parse(
  readFileSync(join(__dirnameResolved, '../registry/registry.json'), 'utf8'),
);
var entries = registry.plugins.filter(function (entry) {
  return entry.name === 'mcpviews-gronk-speak';
});
var entry = entries[0];
var manifest = entry && entry.manifest;

describe('Gronk Speak registry entry', function () {
  it('publishes the complete verified v0.3.0 manifest and release URL', function () {
    expect(entries).toHaveLength(1);
    expect(entry.version).toBe('0.3.0');
    expect(manifest.version).toBe('0.3.0');
    expect(entry.download_url).toBe(
      'https://github.com/DeeJanuz/mcpviews-gronk-speak-plugin/releases/download/v0.3.0/mcpviews-gronk-speak.zip',
    );
    expect(manifest.download_url).toBe(entry.download_url);
    expect(Object.keys(manifest).sort()).toEqual([
      'description',
      'download_url',
      'name',
      'plugin_rules',
      'registry_index',
      'setup_questions',
      'startup_rules',
      'version',
    ]);
    expect(entry.tags).toEqual(manifest.registry_index.tags);
    expect(entry.tags).toContain('unslop');
  });

  it('keeps two independent Enable or Off setup questions', function () {
    expect(manifest.setup_questions).toHaveLength(2);
    expect(
      manifest.setup_questions.map(function (question) {
        return question.id;
      }),
    ).toEqual(['enable_gronk_speak', 'enable_plain_prose']);

    manifest.setup_questions.forEach(function (question) {
      expect(question.options.map(function (option) { return option.value; })).toEqual([
        'enabled',
        'off',
      ]);
      expect(question.options[0].persisted_rule.length).toBeGreaterThan(100);
      expect(question.options[1].persisted_rule).toContain('disabled');
    });
  });

  it('publishes stable rule IDs with upgraded versions and valid question sources', function () {
    var questions = new Map(
      manifest.setup_questions.map(function (question) {
        return [question.id, question];
      }),
    );
    var versions = Object.fromEntries(
      manifest.startup_rules.map(function (rule) {
        return [rule.id, rule.version];
      }),
    );

    expect(versions).toEqual({ GronkSpeak: '5', PlainProse: '2' });
    manifest.startup_rules.forEach(function (rule) {
      expect(questions.has(rule.source.question_id)).toBe(true);
      expect(rule.source.skip_install_values).toContain('off');
    });
  });

  it('makes each enabled rule independently complete', function () {
    manifest.setup_questions.forEach(function (question) {
      var enabled = question.options.find(function (option) {
        return option.value === 'enabled';
      });
      var ruleText = enabled.persisted_rule;

      ['Scope:', 'Writing baseline:', 'Protected content:', 'Self-audit:', 'Precedence:'].forEach(
        function (heading) {
          expect(ruleText).toContain(heading);
        },
      );
      ['puffery', 'chatbot phrases', 'named source', 'forced groups of three', 'em dashes'].forEach(
        function (behavior) {
          expect(ruleText).toContain(behavior);
        },
      );
      ['code', 'commands', 'file paths', 'identifiers', 'schemas', 'API names', 'errors', 'citations', 'exact values'].forEach(
        function (protectedValue) {
          expect(ruleText).toContain(protectedValue);
        },
      );
      expect(ruleText).toContain('User instructions');
    });
  });
});
