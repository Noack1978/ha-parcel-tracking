'use strict';

class ParcelTrackingCard extends HTMLElement {
  constructor() {
    super();
    this._hass        = null;
    this._config      = {};
    this._initialized = false;
    this._expanded    = new Set(); // erweiterte Sendungen
    this._archiveOpen   = false;
    this._pendingPurge  = [];
    this._renamingNumber = null;
    this.attachShadow({ mode: 'open' });
  }

  static getStubConfig() { return {}; }

  setConfig(config) {
    this._config = config || {};
    if (!this._initialized) {
      this._buildDOM();
      this._initialized = true;
    }
  }

  set hass(hass) {
    this._hass = hass;
    // Waehrend ein Rename aktiv ist, Liste nicht neu bauen
    // (wuerde den Input-Fokus und die Tastatur schliessen)
    if (!this._renamingNumber) {
      this._updateList();
    }
    this._updateArchive();
  }

  getCardSize() { return 5; }

  // ── Sensoren ──────────────────────────────────────────────────────────────

  _getSensors() {
    if (!this._hass) return [];
    return Object.values(this._hass.states)
      .filter(s => s.attributes.tracking_number !== undefined)
      .sort((a, b) =>
        (a.attributes.label || a.attributes.tracking_number)
          .localeCompare(b.attributes.label || b.attributes.tracking_number)
      );
  }

  _getArchiveSensor() {
    if (!this._hass) return null;
    return Object.values(this._hass.states).find(
      s => s.attributes.archived_items !== undefined
    );
  }

  // ── DOM (einmalig) ────────────────────────────────────────────────────────

  _buildDOM() {
    this.shadowRoot.innerHTML = `
      <style>
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :host {
          --dhl-red:    #D40511;
          --dhl-yellow: #FFCC00;
          --radius: 12px;
          display: block;
        }
        ha-card {
          overflow: hidden;
          border-radius: var(--radius);
          background: var(--ha-card-background, var(--card-background-color, #1c1c1e));
        }

        /* Header */
        .header {
          background: var(--dhl-red);
          padding: 14px 18px;
          display: flex;
          align-items: center;
          gap: 14px;
        }
        .dhl-badge {
          background: var(--dhl-yellow);
          color: #000;
          font-weight: 900;
          font-size: 20px;
          letter-spacing: -1px;
          padding: 4px 10px;
          border-radius: 6px;
          line-height: 1.2;
          flex-shrink: 0;
        }
        .header-title    { color: #fff; font-size: 16px; font-weight: 700; }
        .header-subtitle { color: rgba(255,255,255,.75); font-size: 12px; margin-top: 2px; }

        /* Sections */
        .section {
          padding: 14px 16px;
          border-bottom: 1px solid var(--divider-color, rgba(255,255,255,.08));
        }
        .section:last-child { border-bottom: none; }
        .section-label {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: .8px;
          text-transform: uppercase;
          color: var(--secondary-text-color, #9ca3af);
          margin-bottom: 10px;
        }

        /* Inputs */
        .input-row { display: flex; gap: 8px; margin-bottom: 8px; }
        input {
          flex: 1;
          background: var(--secondary-background-color, #374151);
          border: 1.5px solid var(--divider-color, rgba(255,255,255,.12));
          border-radius: 8px;
          color: var(--primary-text-color, #fff);
          padding: 11px 13px;
          font-size: 14px;
          font-family: inherit;
          outline: none;
          transition: border-color .2s;
          min-width: 0;
          width: 100%;
        }
        input:focus { border-color: var(--dhl-red); }
        input::placeholder { color: var(--secondary-text-color, #9ca3af); }
        .input-sub { margin-top: 8px; }

        /* Buttons */
        button {
          cursor: pointer;
          font-family: inherit;
          border: none;
          border-radius: 8px;
          font-weight: 700;
          transition: opacity .15s, transform .1s;
        }
        button:active { transform: scale(.97); }
        .btn-add {
          background: var(--dhl-red);
          color: #fff;
          padding: 11px 16px;
          font-size: 14px;
          white-space: nowrap;
          flex-shrink: 0;
        }
        .btn-add:hover { opacity: .88; }
        .btn-icon {
          background: transparent;
          padding: 5px 8px;
          font-size: 16px;
          line-height: 1;
          border-radius: 6px;
        }
        .btn-delete { color: var(--secondary-text-color, #9ca3af); }
        .btn-delete:hover { background: rgba(212,5,17,.15); color: var(--dhl-red); }
        .btn-expand { color: var(--secondary-text-color, #9ca3af); font-size: 14px; }
        .btn-expand:hover { color: var(--primary-text-color, #fff); }

        /* Sensor-Item */
        .sensor-item {
          background: var(--secondary-background-color, #374151);
          border-radius: 9px;
          margin-bottom: 8px;
          overflow: hidden;
        }
        .sensor-item:last-child { margin-bottom: 0; }

        /* Sensor-Header (immer sichtbar) */
        .sensor-header {
          display: flex;
          align-items: flex-start;
          gap: 10px;
          padding: 12px 13px;
          cursor: pointer;
          user-select: none;
        }
        .sensor-header:hover { background: rgba(255,255,255,.04); }

        .status-dot {
          width: 10px; height: 10px;
          border-radius: 50%;
          flex-shrink: 0;
          margin-top: 5px;
        }
        .sensor-main { flex: 1; min-width: 0; }
        .sensor-label {
          font-weight: 600;
          font-size: 14px;
          color: var(--primary-text-color, #fff);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .sensor-sender {
          font-size: 11px;
          color: var(--secondary-text-color, #9ca3af);
          margin-top: 1px;
          font-style: italic;
        }
        .btn-rename {
          color: var(--secondary-text-color, #9ca3af);
          font-size: 13px;
          opacity: .45;
          padding: 2px 5px;
          flex-shrink: 0;
        }
        .btn-rename:hover { opacity: 1; }
        .rename-form {
          display: flex;
          gap: 6px;
          margin-top: 6px;
          align-items: center;
        }
        .rename-input {
          flex: 1;
          background: var(--secondary-background-color, #374151);
          border: 1.5px solid var(--dhl-red, #D40511);
          border-radius: 7px;
          color: var(--primary-text-color, #fff);
          padding: 7px 10px;
          font-size: 13px;
          font-family: inherit;
          outline: none;
          min-width: 0;
        }
        .btn-rename-save {
          background: var(--dhl-red, #D40511);
          color: #fff;
          padding: 7px 12px;
          font-size: 12px;
          border-radius: 7px;
          border: none;
          cursor: pointer;
          font-weight: 700;
          flex-shrink: 0;
        }
        .btn-rename-cancel {
          background: transparent;
          color: var(--secondary-text-color, #9ca3af);
          padding: 7px 8px;
          font-size: 16px;
          border-radius: 7px;
          border: none;
          cursor: pointer;
          flex-shrink: 0;
        }
        .sensor-number {
          font-family: 'Courier New', monospace;
          font-size: 11px;
          color: var(--secondary-text-color, #9ca3af);
          margin-top: 1px;
        }
        .sensor-state {
          font-size: 13px;
          font-weight: 600;
          margin-top: 5px;
        }
        .sensor-quick {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-top: 5px;
        }
        .pill {
          font-size: 11px;
          color: var(--secondary-text-color, #9ca3af);
          background: rgba(255,255,255,.06);
          border-radius: 20px;
          padding: 2px 8px;
          white-space: nowrap;
        }
        .pill.green { color: #4CAF50; background: rgba(76,175,80,.12); }

        .sensor-actions { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }

        /* Detailbereich (ausgeklappt) */
        .sensor-detail {
          border-top: 1px solid var(--divider-color, rgba(255,255,255,.08));
          padding: 12px 13px;
          display: none;
        }
        .sensor-detail.open { display: block; }

        .detail-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
          margin-bottom: 12px;
        }
        .detail-cell { }
        .detail-key {
          font-size: 10px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: .5px;
          color: var(--secondary-text-color, #9ca3af);
          margin-bottom: 2px;
        }
        .detail-val {
          font-size: 13px;
          color: var(--primary-text-color, #fff);
          word-break: break-word;
        }
        .detail-val.green { color: #4CAF50; font-weight: 600; }

        /* Ereignis-Timeline */
        .timeline-title {
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: .5px;
          color: var(--secondary-text-color, #9ca3af);
          margin-bottom: 8px;
        }
        .timeline { display: flex; flex-direction: column; gap: 0; }
        .timeline-event {
          display: flex;
          gap: 10px;
          position: relative;
          padding-bottom: 10px;
        }
        .timeline-event:last-child { padding-bottom: 0; }
        .tl-line {
          display: flex;
          flex-direction: column;
          align-items: center;
          flex-shrink: 0;
          width: 16px;
        }
        .tl-dot {
          width: 8px; height: 8px;
          border-radius: 50%;
          background: var(--secondary-text-color, #9ca3af);
          flex-shrink: 0;
          margin-top: 4px;
        }
        .tl-dot.first { background: var(--dhl-red); width: 10px; height: 10px; margin-top: 3px; }
        .tl-connector {
          width: 2px;
          flex: 1;
          background: var(--divider-color, rgba(255,255,255,.1));
          margin-top: 3px;
          min-height: 10px;
        }
        .tl-content { flex: 1; min-width: 0; }
        .tl-desc {
          font-size: 12px;
          color: var(--primary-text-color, #fff);
          line-height: 1.3;
        }
        .tl-meta {
          font-size: 11px;
          color: var(--secondary-text-color, #9ca3af);
          margin-top: 2px;
        }

        /* Refresh */
        .refresh-row {
          display: flex;
          justify-content: flex-end;
          padding: 8px 16px 12px;
        }
        .btn-refresh {
          background: transparent;
          color: var(--secondary-text-color, #9ca3af);
          font-size: 12px;
          padding: 5px 10px;
          border-radius: 6px;
          display: flex;
          align-items: center;
          gap: 5px;
        }
        .btn-refresh:hover {
          background: var(--secondary-background-color, #374151);
          color: var(--primary-text-color, #fff);
        }

        .empty {
          text-align: center;
          color: var(--secondary-text-color, #9ca3af);
          font-size: 13px;
          padding: 16px 0;
        }
        .modal-title { font-size: 14px; font-weight: 700; color: var(--primary-text-color,#fff); margin-bottom:6px; }
        .modal-subtitle { font-size: 12px; color: var(--secondary-text-color,#9ca3af); }
        .clean-item {
          display: flex; align-items: flex-start; gap: 10px;
          background: var(--secondary-background-color,#374151);
          border-radius: 7px; padding: 9px 12px; margin-bottom: 7px;
        }
        .clean-item input[type=checkbox] { margin-top:3px; flex-shrink:0; width:16px; height:16px; cursor:pointer; }
        .clean-item-info { flex:1; min-width:0; }
        .clean-item-label { font-size:13px; color:var(--primary-text-color,#fff); }
        .clean-item-num { font-family:monospace; font-size:11px; color:var(--secondary-text-color,#9ca3af); margin-top:2px; }
        .clean-item-date { font-size:11px; color:var(--secondary-text-color,#9ca3af); margin-top:1px; }
        .clean-item-date.overdue { color:#FF9800; font-weight:600; }
        .btn-small { padding:6px 14px; font-size:13px; border-radius:7px; border:none; cursor:pointer; font-weight:700; }
        .btn-confirm { background:var(--dhl-red,#D40511); color:#fff; }
        .btn-confirm:hover { opacity:.88; }
        .btn-cancel { background:var(--secondary-background-color,#374151); color:var(--primary-text-color,#fff); }
      </style>

      <ha-card>
        <div class="header">
          <div class="dhl-badge">DHL</div>
          <div>
            <div class="header-title">Sendungsverfolgung</div>
            <div class="header-subtitle">Sendungsverfolgung</div>
          </div>
        </div>

        <div class="section">
          <div class="section-label">Neue Sendung</div>
          <div class="input-row">
            <input id="num-input" type="text" placeholder="Sendungsnummer"
              autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">
            <button class="btn-add" id="add-btn">Verfolgen</button>
          </div>
          <input id="lbl-input" class="input-sub" type="text"
            placeholder="Bezeichnung (z. B. Amazon, Zalando ...)">
          <input id="plz-input" class="input-sub" type="text"
            placeholder="PLZ Empfaenger (optional)" inputmode="numeric" maxlength="10">
        </div>

        <div class="section">
          <div class="section-label">Gespeicherte Sendungen</div>
          <div id="sensor-list"><div class="empty">Noch keine Sendungen gespeichert</div></div>
        </div>

        <div class="refresh-row">
          <button class="btn-refresh" id="refresh-btn">&#8635; Aktualisieren</button>
        </div>

        <!-- Archiv -->
        <div class="section" id="archive-section">
          <div class="section-header">
            <div class="section-label-inline">&#128230; Archiv (<span id="archive-count">0</span>)</div>
            <div style="display:flex;gap:6px;align-items:center">
              <button class="btn-clean" id="clean-btn">&#128465; Bereinigen</button>
              <button class="btn-icon btn-expand" id="archive-toggle">&#9660;</button>
            </div>
          </div>
          <div id="archive-list" style="display:none;margin-top:10px">
            <div class="empty">Archiv ist leer</div>
          </div>
          <!-- Inline Bereinigen-Dialog -->
          <div id="clean-dialog" style="display:none;margin-top:12px;padding-top:12px;border-top:1px solid var(--divider-color,rgba(255,255,255,.08))">
            <div class="modal-title" style="font-size:14px;margin-bottom:8px">&#128465; Sendungen loeschen</div>
            <div class="modal-subtitle" id="clean-subtitle" style="margin-bottom:10px"></div>
            <div id="clean-items"></div>
            <div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end">
              <button class="btn-small btn-cancel" id="clean-cancel">Abbrechen</button>
              <button class="btn-small btn-confirm" id="clean-confirm">Ausgewaehlte loeschen</button>
            </div>
          </div>
        </div>
      </ha-card>

    `;

    this.shadowRoot.getElementById('add-btn').addEventListener('click', () => this._add());
    this.shadowRoot.getElementById('refresh-btn').addEventListener('click', () => this._refresh());
    this.shadowRoot.getElementById('clean-btn').addEventListener('click', () => this._openCleanDialog());
    this.shadowRoot.getElementById('clean-cancel').addEventListener('click', () => this._closeCleanDialog());
    this.shadowRoot.getElementById('clean-confirm').addEventListener('click', () => this._confirmPurge());
    this.shadowRoot.getElementById('archive-toggle').addEventListener('click', () => this._toggleArchive());
    ['num-input','lbl-input','plz-input'].forEach(id => {
      this.shadowRoot.getElementById(id).addEventListener('keydown', e => {
        if (e.key === 'Enter') this._add();
      });
    });

    // Delegierter Handler fuer sensor-list – EINMALIG registrieren
    const list = this.shadowRoot.getElementById('sensor-list');
    list.addEventListener('click', (e) => {
      const del = e.target.closest('[data-del]');
      const arc = e.target.closest('[data-arc]');
      const sav = e.target.closest('.btn-rename-save');
      const can = e.target.closest('.btn-rename-cancel');
      const ren = e.target.closest('[data-ren]');
      const exp = e.target.closest('[data-exp]');
      const hdr = e.target.closest('.sensor-header');

      if (del) { e.stopPropagation(); this._remove(del.dataset.del); return; }
      if (arc) { e.stopPropagation(); this._archiveShipment(arc.dataset.arc); return; }
      if (sav) {
        e.stopPropagation();
        const num = sav.dataset.num;
        const inp = this.shadowRoot.getElementById('rename-input-' + num);
        if (inp) this._saveRename(num, inp.value.trim());
        return;
      }
      if (can) {
        e.stopPropagation();
        this._renamingNumber = null;
        this._updateList();
        return;
      }
      if (ren) {
        e.stopPropagation();
        const num = ren.dataset.ren;
        this._renamingNumber = num;
        this._updateList();
        requestAnimationFrame(() => {
          const inp = this.shadowRoot.getElementById('rename-input-' + num);
          if (inp) { inp.focus(); inp.select(); }
        });
        return;
      }
      if (exp) { e.stopPropagation(); this._toggleExpand(exp.dataset.exp); return; }
      if (hdr && !e.target.closest('button')) { this._toggleExpand(hdr.dataset.num); }
    });

    list.addEventListener('keydown', (e) => {
      if (!e.target.classList.contains('rename-input')) return;
      if (e.key === 'Enter') {
        const num = this._renamingNumber;
        if (num) this._saveRename(num, e.target.value.trim());
      }
      if (e.key === 'Escape') {
        this._renamingNumber = null;
        this._updateList();
      }
    });
  }

  // ── Liste rendern ─────────────────────────────────────────────────────────

  _updateList() {
    const list = this.shadowRoot.getElementById('sensor-list');
    if (!list) return;

    const sensors = this._getSensors();
    if (!sensors.length) {
      list.innerHTML = '<div class="empty">Noch keine Sendungen.<br>Sendungsnummer oben eingeben.</div>';
      return;
    }

    list.innerHTML = sensors.map(s => this._renderItem(s)).join('');


  }

  _renderItem(sensor) {
    const a    = sensor.attributes;
    const num  = a.tracking_number;
    const open = this._expanded.has(num);
    const dot  = this._statusColor(a.status_code || '');

    // Quick-Pills (Header)
    const pills = [];
    if (a.current_location) pills.push(`&#128205; ${this._esc(a.current_location)}`);
    if (a.estimated_delivery) pills.push(`&#128666; ${this._esc(a.estimated_delivery)}`);
    if (a.service) pills.push(this._esc(a.service));

    return `
      <div class="sensor-item">
        <div class="sensor-header" data-num="${this._esc(num)}">
          <div class="status-dot" style="background:${dot}"></div>
          <div class="sensor-main">
            <div class="sensor-label">${this._esc(a.label || num)}</div>
            <div class="sensor-number">${this._esc(num)}</div>
            <div class="sensor-state" style="color:${dot}">${this._esc(sensor.state)}</div>
            ${pills.length ? `<div class="sensor-quick">${pills.map(p => `<span class="pill">${p}</span>`).join('')}</div>` : ''}
          </div>
          <div class="sensor-actions">
            <button class="btn-icon btn-expand" data-exp="${this._esc(num)}"
              title="${open ? 'Zuklappen' : 'Details'}">
              ${open ? '&#9650;' : '&#9660;'}
            </button>
            <button class="btn-icon btn-rename" data-ren="${this._esc(num)}"
              title="Umbenennen">&#9998;</button>
            ${a.status_code === 'delivered' ? `<button class="btn-icon btn-archive" data-arc="${this._esc(num)}" title="Archivieren">&#128230;</button>` : ''}
            <button class="btn-icon btn-delete" data-del="${this._esc(num)}"
              title="Sendung entfernen">&#215;</button>
          </div>
        </div>
        ${this._renamingNumber === num ? `
        <div class="rename-form" style="padding:8px 13px 10px">
          <input class="rename-input" type="text" id="rename-input-${this._esc(num)}"
            value="${this._esc(a.label || '')}" placeholder="Bezeichnung eingeben" autocomplete="off">
          <button class="btn-rename-save" data-num="${this._esc(num)}">&#10003;</button>
          <button class="btn-rename-cancel" data-num="${this._esc(num)}">&#215;</button>
        </div>` : ''}
        <div class="sensor-detail ${open ? 'open' : ''}">
          ${this._renderDetail(sensor)}
        </div>
      </div>
    `;
  }

  _renderDetail(sensor) {
    const a   = sensor.attributes;
    const num = a.tracking_number;
    const rows = [];

    // Detailgitter
    const cells = [];
    if (a.status_description)  cells.push(['Status-Detail',  a.status_description]);
    if (a.last_event_time)     cells.push(['Letztes Ereignis', a.last_event_time]);
    if (a.estimated_delivery)  cells.push(['Lieferung ca.',   a.estimated_delivery]);
    if (a.current_location)    cells.push(['Aktueller Ort',   a.current_location]);
    if (a.current_country)     cells.push(['Land',            a.current_country]);
    if (a.origin)              cells.push(['Absender-Ort',    a.origin]);
    if (a.destination)         cells.push(['Zielort',         a.destination]);
    if (a.service)             cells.push(['Dienstleistung',  a.service]);
    if (a.event_count != null) cells.push(['Ereignisse ges.', String(a.event_count)]);

    if (cells.length) {
      rows.push('<div class="detail-grid">');
      for (const [k, v] of cells) {
        const green = k === 'Lieferung ca.' ? ' green' : '';
        rows.push(`
          <div class="detail-cell">
            <div class="detail-key">${this._esc(k)}</div>
            <div class="detail-val${green}">${this._esc(v)}</div>
          </div>`);
      }
      rows.push('</div>');
    }

    // Ereignis-Timeline
    const events = a.events;
    if (events && events.length) {
      rows.push('<div class="timeline-title">Ereignisverlauf</div>');
      rows.push('<div class="timeline">');
      events.forEach((evt, i) => {
        const isFirst = i === 0;
        const loc  = evt.location   ? ` &bull; ${this._esc(evt.location)}` : '';
        const time = evt.time || evt.timestamp || '';
        rows.push(`
          <div class="timeline-event">
            <div class="tl-line">
              <div class="tl-dot ${isFirst ? 'first' : ''}"></div>
              ${i < events.length - 1 ? '<div class="tl-connector"></div>' : ''}
            </div>
            <div class="tl-content">
              <div class="tl-desc">${this._esc(evt.description || '')}</div>
              <div class="tl-meta">${this._esc(time)}${loc}</div>
            </div>
          </div>`);
      });
      rows.push('</div>');
    }

    return rows.join('') || '<div class="empty">Keine Detaildaten verfuegbar</div>';
  }

  _toggleExpand(num) {
    if (this._expanded.has(num)) {
      this._expanded.delete(num);
    } else {
      this._expanded.add(num);
    }
    this._updateList();
  }

  // ── Services ──────────────────────────────────────────────────────────────

  async _add() {
    const numEl = this.shadowRoot.getElementById('num-input');
    const lblEl = this.shadowRoot.getElementById('lbl-input');
    const plzEl = this.shadowRoot.getElementById('plz-input');
    const number = (numEl.value || '').trim().replace(/\s+/g, '').toUpperCase();
    const label  = (lblEl.value || '').trim();
    const plz    = (plzEl.value || '').trim();
    if (!number) { numEl.focus(); return; }

    try {
      await this._hass.callService('parcel_tracking', 'add_tracking', {
        tracking_number: number,
        ...(label ? { label }            : {}),
        ...(plz   ? { postal_code: plz } : {}),
      });
      numEl.value = '';
      lblEl.value = '';
      plzEl.value = '';
      numEl.focus();
    } catch (err) {
      console.error('[dhl-card] parcel_tracking: add_tracking:', err);
    }
  }

  async _remove(number) {
    this._expanded.delete(number);
    try {
      await this._hass.callService('parcel_tracking', 'remove_tracking', {
        tracking_number: number,
      });
    } catch (err) {
      console.error('[dhl-card] parcel_tracking: remove_tracking:', err);
    }
  }

  async _refresh() {
    try {
      await this._hass.callService('parcel_tracking', 'refresh', {});
    } catch (err) {
      console.error('[dhl-card] parcel_tracking: refresh:', err);
    }
  }

  // ── Hilfsfunktionen ───────────────────────────────────────────────────────

  _statusColor(code) {
    return {
      'delivered':        '#4CAF50',
      'out-for-delivery': '#FF9800',
      'transit':          '#2196F3',
      'pre-transit':      '#9C27B0',
      'delivery-failure': '#F44336',
      'exception':        '#F44336',
      'pickup-failure':   '#F44336',
      'not-found':        '#9E9E9E',
      'expired':          '#9E9E9E',
    }[code] || '#9E9E9E';
  }

  _esc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  // ── Umbenennen ───────────────────────────────────────────────────────────────

  async _saveRename(number, newLabel) {
    if (!newLabel) return;
    this._renamingNumber = null;
    try {
      await this._hass.callService('parcel_tracking', 'rename_tracking', {
        tracking_number: number,
        label: newLabel,
      });
    } catch (err) {
      console.error('[dhl-card] rename_tracking:', err);
      this._updateList();
    }
  }

  // ── Archiv ────────────────────────────────────────────────────────────────

  _updateArchive() {
    const sensor   = this._getArchiveSensor();
    const countEl  = this.shadowRoot.getElementById('archive-count');
    const list     = this.shadowRoot.getElementById('archive-list');
    if (!countEl || !list) return;
    if (!sensor) { countEl.textContent = '0'; return; }

    const archived = sensor.attributes.archived_items || {};
    const pending  = sensor.attributes.pending_deletion || [];
    const days     = sensor.attributes.archive_days || 30;
    const count    = Object.keys(archived).length;
    countEl.textContent = count;

    if (!count) {
      list.innerHTML = '<div class="empty">Archiv ist leer</div>';
      return;
    }
    list.innerHTML = Object.entries(archived).map(([num, item]) => {
      const isPending  = pending.includes(num);
      const archivedAt = item.archived_at
        ? new Date(item.archived_at).toLocaleDateString('de-DE') : '';
      return `
        <div class="archive-item">
          <div class="archive-label">${this._esc(item.label || num)}</div>
          <div class="archive-number">${this._esc(num)}</div>
          <div class="archive-meta ${isPending ? 'pending' : ''}">
            ${archivedAt ? 'Archiviert: ' + archivedAt : ''}
            ${isPending ? ' &bull; &#9888; Loeschung ausstehend (>' + days + ' Tage)' : ''}
          </div>
        </div>`;
    }).join('');
  }

  _toggleArchive() {
    this._archiveOpen = !this._archiveOpen;
    const list = this.shadowRoot.getElementById('archive-list');
    const btn  = this.shadowRoot.getElementById('archive-toggle');
    if (list) list.style.display = this._archiveOpen ? 'block' : 'none';
    if (btn)  btn.innerHTML = this._archiveOpen ? '&#9650;' : '&#9660;';
  }

  _openCleanDialog() {
    const sensor  = this._getArchiveSensor();
    const dialog  = this.shadowRoot.getElementById('clean-dialog');
    const itemsEl = this.shadowRoot.getElementById('clean-items');
    const sub     = this.shadowRoot.getElementById('clean-subtitle');
    if (!sensor || !dialog) return;

    const archived = sensor.attributes.archived_items || {};
    const pending  = sensor.attributes.pending_deletion || [];
    const days     = sensor.attributes.archive_days || 30;
    const allNums  = Object.keys(archived);

    if (!allNums.length) {
      sub.textContent = 'Archiv ist leer.';
      itemsEl.innerHTML = '';
    } else {
      sub.textContent = 'Sendungen auswaehlen die geloescht werden sollen:';
      itemsEl.innerHTML = allNums.map(num => {
        const item      = archived[num] || {};
        const isOverdue = pending.includes(num);
        const date      = item.archived_at
          ? new Date(item.archived_at).toLocaleDateString('de-DE') : '';
        return `<label class="clean-item">
          <input type="checkbox" value="${this._esc(num)}" ${isOverdue ? 'checked' : ''}>
          <div class="clean-item-info">
            <div class="clean-item-label">${this._esc(item.label || num)}</div>
            <div class="clean-item-num">${this._esc(num)}</div>
            <div class="clean-item-date ${isOverdue ? 'overdue' : ''}">
              ${date ? 'Archiviert: ' + date : ''}
              ${isOverdue ? ' &bull; Loeschung vorgeschlagen (>' + days + ' Tage)' : ''}
            </div>
          </div>
        </label>`;
      }).join('');
    }

    // Archiv-Liste aufklappen falls noch zu
    if (!this._archiveOpen) this._toggleArchive();
    dialog.style.display = 'block';
  }

  _closeCleanDialog() {
    const dialog = this.shadowRoot.getElementById('clean-dialog');
    if (dialog) dialog.style.display = 'none';
    this._pendingPurge = [];
  }

  async _confirmPurge() {
    const dialog  = this.shadowRoot.getElementById('clean-dialog');
    const checked = dialog
      ? [...dialog.querySelectorAll('input[type=checkbox]:checked')].map(cb => cb.value)
      : [];
    if (!checked.length) { this._closeCleanDialog(); return; }
    try {
      await this._hass.callService('parcel_tracking', 'purge_archive', {
        tracking_numbers: checked,
      });
    } catch (err) { console.error('[dhl-card] purge_archive:', err); }
    this._closeCleanDialog();
  }

  async _archiveShipment(number) {
    try {
      await this._hass.callService('parcel_tracking', 'archive_tracking', {
        tracking_number: number,
      });
    } catch (err) { console.error('[dhl-card] archive_tracking:', err); }
  }

}

customElements.define('parcel-tracking-card', ParcelTrackingCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type:        'parcel-tracking-card',
  name:        'Paket-Sendungsverfolgung',
  version:     '1.2.2',
  description: 'Karte zur Sendungsverfolgung mit Ereignis-Timeline und Archiv.',
  preview:     false,
});
