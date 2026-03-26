// @ts-nocheck
/* Analysis stats renderer — get_analysis_stats */

(function () {
  'use strict';

  window.__renderers = window.__renderers || {};

  var LANGUAGE_COLORS = {
    TypeScript: { bg: '#dbeafe', text: '#1e40af' },
    JavaScript: { bg: '#fef9c3', text: '#854d0e' },
    Python: { bg: '#dcfce7', text: '#166534' },
    Go: { bg: '#e0e7ff', text: '#3730a3' },
    Rust: { bg: '#ffedd5', text: '#9a3412' },
    Java: { bg: '#fee2e2', text: '#991b1b' },
    'C#': { bg: '#f3e8ff', text: '#6b21a8' },
  };

  var DEFAULT_LANG_COLOR = { bg: '#f3f4f6', text: '#374151' };

  var STYLES = {
    summaryBar: 'display:flex;align-items:center;gap:8px;margin-bottom:16px;padding:8px 12px;background:#f9fafb;border-radius:6px;',
    card: 'margin:8px 0;padding:12px 16px;background:#ffffff;border:1px solid #e5e5e5;border-radius:8px;',
    metricCard: 'flex:1;min-width:100px;padding:12px 16px;background:#ffffff;border:1px solid #e5e5e5;border-radius:8px;text-align:center;',
    sectionHeading: 'font-size:13px;font-weight:600;color:#737373;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;',
    headerRow: 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px;',
    monoSmall: 'font-family:monospace;font-size:12px;color:#737373;',
  };

  /**
   * @param {HTMLElement} container
   * @param {unknown} data
   * @param {Record<string, unknown>} meta
   * @param {Record<string, unknown>} toolArgs
   * @param {boolean} reviewRequired
   * @param {(decision: string | Record<string, string>) => void} onDecision
   */
  window.__renderers.analysis_stats = function renderAnalysisStats(container, data, meta, toolArgs, reviewRequired, onDecision) {
    container.innerHTML = '';

    var utils = window.__companionUtils;
    var stats = (data && data.data) || data || {};

    var repos = stats.analyzed_repositories || [];
    var totals = stats.totals || {};

    // Summary bar
    var summary = document.createElement('div');
    summary.style.cssText = STYLES.summaryBar;
    summary.appendChild(utils.createBadge(repos.length + ' repositor' + (repos.length !== 1 ? 'ies' : 'y') + ' analyzed', '#f3f4f6', '#171717'));
    container.appendChild(summary);

    // Totals metric cards
    var metrics = [
      { label: 'Repositories', value: totals.repositories || 0 },
      { label: 'Code Units', value: totals.codeUnits || totals.code_units || 0 },
      { label: 'Data Sources', value: totals.dataSources || totals.data_sources || 0 },
      { label: 'Tables', value: totals.tables || 0 },
      { label: 'Business Concepts', value: totals.businessConcepts || totals.business_concepts || 0 },
    ];

    var metricsRow = document.createElement('div');
    metricsRow.style.cssText = 'display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap;';

    for (var m = 0; m < metrics.length; m++) {
      var card = document.createElement('div');
      card.style.cssText = STYLES.metricCard;

      var countEl = document.createElement('div');
      countEl.style.cssText = 'font-size:24px;font-weight:700;color:#171717;';
      countEl.textContent = String(metrics[m].value);
      card.appendChild(countEl);

      var labelEl = document.createElement('div');
      labelEl.style.cssText = 'font-size:11px;color:#737373;font-weight:500;text-transform:uppercase;letter-spacing:0.5px;margin-top:4px;';
      labelEl.textContent = metrics[m].label;
      card.appendChild(labelEl);

      metricsRow.appendChild(card);
    }

    container.appendChild(metricsRow);

    // Analyzed repositories
    if (repos.length > 0) {
      var reposHeading = document.createElement('div');
      reposHeading.style.cssText = STYLES.sectionHeading;
      reposHeading.textContent = 'Analyzed Repositories';
      container.appendChild(reposHeading);

      for (var i = 0; i < repos.length; i++) {
        container.appendChild(renderRepoCard(repos[i], utils));
      }
    }

    // Unanalyzed repositories
    var unanalyzedCount = stats.unanalyzed_count || 0;
    var unanalyzedNames = stats.unanalyzed_names || [];
    if (unanalyzedCount > 0 || unanalyzedNames.length > 0) {
      var unSection = document.createElement('div');
      unSection.style.cssText = 'margin-top:16px;padding:12px 16px;background:#f9fafb;border:1px solid #e5e5e5;border-radius:8px;';

      var unHeading = document.createElement('div');
      unHeading.style.cssText = STYLES.sectionHeading;
      unHeading.textContent = (unanalyzedCount || unanalyzedNames.length) + ' unanalyzed repositor' + ((unanalyzedCount || unanalyzedNames.length) !== 1 ? 'ies' : 'y');
      unSection.appendChild(unHeading);

      for (var u = 0; u < unanalyzedNames.length; u++) {
        var nameEl = document.createElement('div');
        nameEl.style.cssText = STYLES.monoSmall + 'padding:2px 0;';
        nameEl.textContent = unanalyzedNames[u];
        unSection.appendChild(nameEl);
      }

      container.appendChild(unSection);
    }
  };

  function renderRepoCard(repo, utils) {
    var card = document.createElement('div');
    card.style.cssText = STYLES.card;

    // Header: name + badges
    var header = document.createElement('div');
    header.style.cssText = STYLES.headerRow;

    var name = document.createElement('span');
    name.style.cssText = 'font-weight:700;color:#171717;font-size:15px;';
    name.textContent = repo.name || '(unnamed)';
    header.appendChild(name);

    if (repo.language) {
      var langColors = LANGUAGE_COLORS[repo.language] || DEFAULT_LANG_COLOR;
      header.appendChild(utils.createBadge(repo.language, langColors.bg, langColors.text));
    }

    var unitCount = repo.codeUnitCount || repo.code_unit_count || 0;
    header.appendChild(utils.createBadge(unitCount + ' code unit' + (unitCount !== 1 ? 's' : ''), '#f3f4f6', '#525252'));

    card.appendChild(header);

    // Full name
    if (repo.fullName || repo.full_name) {
      var fullName = document.createElement('div');
      fullName.style.cssText = STYLES.monoSmall + 'margin-bottom:4px;';
      fullName.textContent = repo.fullName || repo.full_name;
      card.appendChild(fullName);
    }

    // Last analyzed
    var lastAnalyzed = repo.lastAnalyzedAt || repo.last_analyzed_at;
    if (lastAnalyzed) {
      var dateEl = document.createElement('div');
      dateEl.style.cssText = 'font-size:11px;color:#a3a3a3;';
      try {
        dateEl.textContent = 'Last analyzed: ' + new Date(lastAnalyzed).toLocaleDateString();
      } catch (e) {
        dateEl.textContent = 'Last analyzed: ' + String(lastAnalyzed);
      }
      card.appendChild(dateEl);
    }

    return card;
  }
})();
