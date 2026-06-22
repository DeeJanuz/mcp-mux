import { beforeAll, describe, expect, it } from 'vitest';

var classifyManifest;
var NAMED_ENVIRONMENT_CLONES;
var overallChannel;
var transformManifestForNamedEnvironment;
var transformRendererJsForNamedEnvironment;
var validateManifestForChannel;

function manifest(pluginName, mcpOrigin, authOrigin, extras) {
  return {
    name: pluginName,
    version: '1.0.0',
    frame_origins: extras && extras.frame_origins,
    mcp: {
      url: mcpOrigin + '/api/mcp',
      auth: {
        type: 'oauth',
        token_url: authOrigin + '/oauth/token',
      },
    },
  };
}

beforeAll(async function () {
  var helpers = await import('../scripts/use-local-plugin-channel.mjs');
  classifyManifest = helpers.classifyManifest;
  NAMED_ENVIRONMENT_CLONES = helpers.NAMED_ENVIRONMENT_CLONES;
  overallChannel = helpers.overallChannel;
  transformManifestForNamedEnvironment = helpers.transformManifestForNamedEnvironment;
  transformRendererJsForNamedEnvironment = helpers.transformRendererJsForNamedEnvironment;
  validateManifestForChannel = helpers.validateManifestForChannel;
});

describe('local plugin channel toggle helpers', function () {
  it('classifies DecidR and Ludflow production manifests', function () {
    expect(
      classifyManifest(
        'decidr',
        manifest('decidr', 'https://app.decidrmcp.com', 'https://app.ludflow.com'),
      ),
    ).toBe('production');
    expect(
      classifyManifest('ludflow', manifest('ludflow', 'https://app.ludflow.com', 'https://app.ludflow.com')),
    ).toBe('production');
  });

  it('classifies DecidR and Ludflow staging manifests', function () {
    expect(
      classifyManifest(
        'decidr',
        manifest('decidr', 'https://staging.app.decidrmcp.com', 'https://staging.app.ludflow.com'),
      ),
    ).toBe('staging');
    expect(
      classifyManifest(
        'ludflow',
        manifest('ludflow', 'https://staging.app.ludflow.com', 'https://staging.app.ludflow.com'),
      ),
    ).toBe('staging');
  });

  it('detects mixed installed state', function () {
    expect(
      overallChannel([
        { name: 'decidr', channel: 'production' },
        { name: 'ludflow', channel: 'staging' },
      ]),
    ).toBe('mixed');
  });

  it('rejects forbidden endpoints in a staging artifact manifest', function () {
    expect(function () {
      validateManifestForChannel(
        'ludflow',
        manifest('ludflow', 'https://staging.app.ludflow.com', 'https://staging.app.ludflow.com', {
          frame_origins: ['https://app.ludflow.com'],
        }),
        'staging',
      );
    }).toThrow('forbidden endpoint https://app.ludflow.com');
  });

  it('transforms the DecidR staging clone into separate names, tools, and renderers', function () {
    var clone = NAMED_ENVIRONMENT_CLONES.find(function (entry) {
      return entry.installedName === 'decidr-staging';
    });
    var transformed = transformManifestForNamedEnvironment(
      Object.assign(manifest('decidr', 'https://staging.app.decidrmcp.com', 'https://staging.app.ludflow.com'), {
        renderers: { list_decisions: 'decidr_list' },
        renderer_definitions: [
          {
            name: 'decidr_dashboard',
            description: 'Dashboard',
            standalone: true,
            standalone_label: 'User Dashboard',
            tools: ['list_decisions'],
          },
        ],
        startup_rules: [{ id: 'prod_rule' }],
        setup_questions: [{ id: 'prod_question' }],
      }),
      clone,
    );

    expect(transformed.name).toBe('decidr-staging');
    expect(transformed.standalone_group_label).toBe('DecidR Staging');
    expect(transformed.mcp.tool_prefix).toBe('decidr_staging__');
    expect(transformed.renderers.list_decisions).toBe('decidr_staging_list');
    expect(transformed.renderer_definitions[0].name).toBe('decidr_staging_dashboard');
    expect(transformed.renderer_definitions[0].standalone_label).toBe('User Dashboard (Staging)');
    expect(transformed.renderer_definitions[0].tools).toEqual(['decidr_staging__list_decisions']);
    expect(transformed.startup_rules).toEqual([]);
    expect(transformed.setup_questions).toEqual([]);
  });

  it('rewrites DecidR staging renderer globals and dependent Ludflow tool calls', function () {
    var clone = NAMED_ENVIRONMENT_CLONES.find(function (entry) {
      return entry.installedName === 'decidr-staging';
    });
    var source = [
      "window.__renderers.decidr_dashboard = function() {};",
      "window.__decidrAPI.withReady(container, meta, function() {});",
      "window.__mcpviews_plugins.decidr.mcp_url;",
      "window.__TAURI__.core.invoke('get_plugin_auth_header', { pluginName: 'decidr' });",
      "mcpToolFetch('ludflow__get_document', {});",
    ].join('\n');
    var transformed = transformRendererJsForNamedEnvironment('decidr', source, clone);

    expect(transformed).toContain('window.__renderers.decidr_staging_dashboard');
    expect(transformed).toContain('window.__decidrStagingAPI.withReady');
    expect(transformed).toContain("window.__mcpviews_plugins['decidr-staging'].mcp_url");
    expect(transformed).toContain("pluginName: 'decidr-staging'");
    expect(transformed).toContain("mcpToolFetch('ludflow_staging__get_document'");
  });

  it('rewrites Ludflow staging standalone renderer names and plugin constants', function () {
    var clone = NAMED_ENVIRONMENT_CLONES.find(function (entry) {
      return entry.installedName === 'ludflow-staging';
    });
    var source = [
      "var PLUGIN_NAME = 'ludflow';",
      "var TOOL_PREFIX = 'ludflow__';",
      "window.__renderers.ludflow_app = function() {};",
      "{ id: 'docs', label: 'Documentation', renderer: 'ludflow_documents_home' }",
    ].join('\n');
    var transformed = transformRendererJsForNamedEnvironment('ludflow', source, clone);

    expect(transformed).toContain("var PLUGIN_NAME = 'ludflow-staging';");
    expect(transformed).toContain("var TOOL_PREFIX = 'ludflow_staging__';");
    expect(transformed).toContain('window.__renderers.ludflow_staging_app');
    expect(transformed).toContain("renderer: 'ludflow_staging_documents_home'");
  });
});
