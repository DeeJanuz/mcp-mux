// @ts-nocheck
/* Column context renderer — get_column_context */

(function () {
  'use strict';

  window.__renderers = window.__renderers || {};

  var DATA_TYPE_COLORS = {
    TEXT: { bg: '#dbeafe', text: '#1e40af' },
    DATE: { bg: '#fef9c3', text: '#854d0e' },
    MULTISELECT: { bg: '#f3e8ff', text: '#6b21a8' },
  };

  var DEFAULT_DATA_TYPE_COLOR = { bg: '#f3f4f6', text: '#374151' };

  var STYLES = {
    infoCard: 'padding:12px 16px;background:#ffffff;border:1px solid #e5e5e5;border-radius:8px;margin-bottom:12px;',
    badgesRow: 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:8px;',
    sectionHeading: 'font-size:12px;font-weight:600;color:#737373;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px;',
    section: 'margin-bottom:12px;',
    metaRow: 'display:flex;align-items:center;gap:6px;padding:4px 8px;',
    monoPath: 'font-family:monospace;font-size:12px;color:#171717;',
  };

  /**
   * @param {HTMLElement} container
   * @param {unknown} data
   * @param {Record<string, unknown>} meta
   * @param {Record<string, unknown>} toolArgs
   * @param {boolean} reviewRequired
   * @param {(decision: string | Record<string, string>) => void} onDecision
   */
  window.__renderers.column_context = function renderColumnContext(container, data, meta, toolArgs, reviewRequired, onDecision) {
    container.innerHTML = '';

    var utils = window.__companionUtils;
    var ctx = (data && data.data) || data || {};

    var column = ctx.column || {};
    var table = ctx.table || {};
    var dataSource = (table.dataSource || table.data_source) || {};

    // Breadcrumb header: dataSource > table > column
    var breadcrumb = document.createElement('div');
    breadcrumb.style.cssText = 'display:flex;align-items:center;gap:4px;margin-bottom:12px;flex-wrap:wrap;';

    var parts = [dataSource.name, table.name, column.name].filter(Boolean);
    for (var p = 0; p < parts.length; p++) {
      if (p > 0) {
        var sep = document.createElement('span');
        sep.style.cssText = 'color:#a3a3a3;font-size:14px;';
        sep.textContent = '\u203A';
        breadcrumb.appendChild(sep);
      }
      var partEl = document.createElement('span');
      partEl.style.cssText = 'font-family:monospace;font-size:15px;color:#171717;' + (p === parts.length - 1 ? 'font-weight:700;' : 'font-weight:500;');
      partEl.textContent = parts[p];
      breadcrumb.appendChild(partEl);
    }

    container.appendChild(breadcrumb);

    // Column info card
    var infoCard = document.createElement('div');
    infoCard.style.cssText = STYLES.infoCard;

    var badgesRow = document.createElement('div');
    badgesRow.style.cssText = STYLES.badgesRow;

    // Type badge
    var originalType = column.originalDataType || column.original_data_type || '';
    if (originalType) {
      badgesRow.appendChild(utils.createBadge(originalType, '#e0e7ff', '#3730a3'));
    }

    // Nullable badge
    if (column.nullable) {
      badgesRow.appendChild(utils.createBadge('NULLABLE', '#f3f4f6', '#737373'));
    } else {
      badgesRow.appendChild(utils.createBadge('NOT NULL', '#fef9c3', '#854d0e'));
    }

    // PK badge
    if (column.isPrimaryKey || column.is_primary_key) {
      badgesRow.appendChild(utils.createBadge('PRIMARY KEY', '#fef9c3', '#b45309'));
    }

    infoCard.appendChild(badgesRow);

    // Description
    if (column.description) {
      var descEl = document.createElement('div');
      descEl.style.cssText = 'font-size:13px;color:#525252;line-height:1.5;';
      descEl.textContent = column.description;
      infoCard.appendChild(descEl);
    }

    container.appendChild(infoCard);

    // Business Concepts
    var concepts = ctx.businessConcepts || ctx.business_concepts || [];
    if (concepts.length > 0) {
      var conceptsSection = document.createElement('div');
      conceptsSection.style.cssText = STYLES.section;

      var conceptsHeading = document.createElement('div');
      conceptsHeading.style.cssText = STYLES.sectionHeading;
      conceptsHeading.textContent = 'Business Concepts (' + concepts.length + ')';
      conceptsSection.appendChild(conceptsHeading);

      var conceptsRow = document.createElement('div');
      conceptsRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;';

      for (var c = 0; c < concepts.length; c++) {
        var concept = concepts[c];
        var chip = document.createElement('span');
        chip.style.cssText = 'display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:6px;font-size:12px;font-weight:500;background:#f0fdfa;color:#0d9488;border:1px solid #ccfbf1;cursor:default;';
        chip.textContent = concept.name || '';
        if (concept.description) {
          chip.title = concept.description;
        }

        if (concept.category) {
          var catBadge = document.createElement('span');
          catBadge.style.cssText = 'font-size:10px;color:#a3a3a3;margin-left:2px;';
          catBadge.textContent = '(' + concept.category + ')';
          chip.appendChild(catBadge);
        }

        conceptsRow.appendChild(chip);
      }

      conceptsSection.appendChild(conceptsRow);
      container.appendChild(conceptsSection);
    }

    // Document Links
    var docLinks = ctx.documentLinks || ctx.document_links || [];
    if (docLinks.length > 0) {
      var docsSection = document.createElement('div');
      docsSection.style.cssText = STYLES.section;

      var docsHeading = document.createElement('div');
      docsHeading.style.cssText = STYLES.sectionHeading;
      docsHeading.textContent = 'Document Links (' + docLinks.length + ')';
      docsSection.appendChild(docsHeading);

      for (var d = 0; d < docLinks.length; d++) {
        var link = docLinks[d];
        var doc = link.document || {};
        var linkRow = document.createElement('div');
        linkRow.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 10px;margin:2px 0;border-radius:6px;cursor:pointer;transition:background 0.15s;';
        linkRow.addEventListener('mouseenter', function () { this.style.background = '#f9fafb'; });
        linkRow.addEventListener('mouseleave', function () { this.style.background = 'transparent'; });

        var docColor = utils.CITATION_COLORS.doc;
        linkRow.appendChild(utils.createBadge(docColor.label, docColor.hex + '15', docColor.hex));

        var titleEl = document.createElement('span');
        titleEl.style.cssText = 'font-size:13px;font-weight:500;color:#171717;';
        titleEl.textContent = doc.title || doc.id || '';
        linkRow.appendChild(titleEl);

        docsSection.appendChild(linkRow);
      }

      container.appendChild(docsSection);
    }

    // Cross-Column Links
    var crossLinks = ctx.crossColumnLinks || ctx.cross_column_links || [];
    if (crossLinks.length > 0) {
      var crossSection = document.createElement('div');
      crossSection.style.cssText = STYLES.section;

      var crossHeading = document.createElement('div');
      crossHeading.style.cssText = STYLES.sectionHeading;
      crossHeading.textContent = 'Cross-Column Links (' + crossLinks.length + ')';
      crossSection.appendChild(crossHeading);

      for (var x = 0; x < crossLinks.length; x++) {
        var crossLink = crossLinks[x];
        var linked = crossLink.linkedColumn || crossLink.linked_column || {};
        var linkedTable = linked.table || {};

        var crossRow = document.createElement('div');
        crossRow.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px 10px;margin:2px 0;border-radius:6px;';

        // Direction arrow
        var direction = crossLink.direction || '';
        var dirArrow = document.createElement('span');
        dirArrow.style.cssText = 'font-size:14px;color:#a3a3a3;flex-shrink:0;';
        if (direction === 'outgoing' || direction === 'OUTGOING') {
          dirArrow.textContent = '\u2192';
        } else if (direction === 'incoming' || direction === 'INCOMING') {
          dirArrow.textContent = '\u2190';
        } else {
          dirArrow.textContent = '\u2194';
        }
        crossRow.appendChild(dirArrow);

        var pathEl = document.createElement('span');
        pathEl.style.cssText = STYLES.monoPath;
        var pathParts = [linkedTable.name, linked.name].filter(Boolean);
        pathEl.textContent = pathParts.join('.');
        crossRow.appendChild(pathEl);

        crossSection.appendChild(crossRow);
      }

      container.appendChild(crossSection);
    }

    // Metadata Columns
    var metaCols = ctx.metadataColumns || ctx.metadata_columns || [];
    if (metaCols.length > 0) {
      var metaSection = document.createElement('div');
      metaSection.style.cssText = STYLES.section;

      var metaHeading = document.createElement('div');
      metaHeading.style.cssText = STYLES.sectionHeading;
      metaHeading.textContent = 'Metadata Columns (' + metaCols.length + ')';
      metaSection.appendChild(metaHeading);

      for (var mc = 0; mc < metaCols.length; mc++) {
        var metaCol = metaCols[mc];
        var metaRow = document.createElement('div');
        metaRow.style.cssText = STYLES.metaRow;

        var metaName = document.createElement('span');
        metaName.style.cssText = 'font-size:13px;font-weight:500;color:#171717;';
        metaName.textContent = metaCol.name || '';
        metaRow.appendChild(metaName);

        // Type badge
        var dtType = (metaCol.dataType || metaCol.data_type || '').toUpperCase();
        var dtColors = DATA_TYPE_COLORS[dtType] || DEFAULT_DATA_TYPE_COLOR;
        metaRow.appendChild(utils.createBadge(dtType || 'UNKNOWN', dtColors.bg, dtColors.text));

        // Required indicator
        if (metaCol.isRequired || metaCol.is_required) {
          metaRow.appendChild(utils.createBadge('REQUIRED', '#fee2e2', '#991b1b'));
        }

        // System column indicator
        if (metaCol.isSystemColumn || metaCol.is_system_column) {
          metaRow.appendChild(utils.createBadge('SYSTEM', '#f3f4f6', '#a3a3a3'));
        }

        metaSection.appendChild(metaRow);
      }

      container.appendChild(metaSection);
    }
  };
})();
